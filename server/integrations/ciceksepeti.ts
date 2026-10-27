import { findVariant } from '../../src/domain/selectors'
import type {
  IntegrationOperation,
  RemoteOrder,
  RemoteProduct,
} from '../../src/domain/integrations'
import { ProviderError } from '../errors'
import {
  array,
  cents,
  integer,
  iso,
  pathPart,
  record,
  text,
  urls,
  inventoryValues,
} from './contracts'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import { ProviderHttp, requireCredential } from './http'

export class CiceksepetiAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'catalog.pull',
    'orders.pull',
    'inventory.push',
    'invoice.link',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    const base =
      context.settings.environment === 'sandbox'
        ? 'https://sandbox-apis.ciceksepeti.com/api/v1'
        : 'https://apis.ciceksepeti.com/api/v1'
    const headers = {
      'x-api-key': requireCredential(context.credentials, 'apiKey'),
      'user-agent': `${requireCredential(context.credentials, 'sellerId')} - ${context.integrationName}`,
    }
    if (operation === 'test' || operation === 'catalog.pull') {
      const page = operation === 'test' ? 1 : Math.max(1, integer(payload.page, 1)),
        size = operation === 'test' ? 1 : 60
      const response = record(
        await this.http.request(`${base}/Products?Page=${page}&PageSize=${size}`, { headers }),
      )
      if (!Array.isArray(response.products))
        throw new ProviderError('INVALID_RESPONSE', 'Çiçeksepeti katalog yanıtı okunamadı.')
      if (operation === 'test')
        return { message: 'Çiçeksepeti kimlik doğrulaması ve katalog okuması başarılı.' }
      const products = response.products.map((raw): RemoteProduct => {
        const item = record(raw)
        const product = {
          externalId: text(item.productCode),
          sku: text(item.stockCode),
          barcode: text(item.barcode),
          title: text(item.productName),
          price: cents(item.salesPrice ?? item.totalPrice),
          quantity: Math.max(0, integer(item.stockQuantity ?? item.StockQuantity ?? item.stock)),
          category: text(item.categoryName),
          categoryId: text(item.categoryId),
          images: urls(item.images),
          status:
            ({ YAYINDA: 'active', PASIF: 'archived', REDDEDILEN: 'rejected' } as const)[
              text(item.productStatusType) as 'YAYINDA'
            ] ?? 'pending',
        }
        if (!product.externalId || !product.title || !Number.isFinite(product.price))
          throw new ProviderError('INVALID_PRODUCT', 'Çiçeksepeti ürün kimliği veya fiyatı eksik.')
        return product
      })
      return {
        message: `${products.length} Çiçeksepeti ürünü okundu.`,
        products,
        ...(page * size < integer(response.totalCount)
          ? { nextPayload: { ...payload, page: page + 1 }, delaySeconds: 6 }
          : {}),
      }
    }
    if (operation === 'orders.pull') {
      const page = integer(payload.page),
        to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - 7 * 86400000)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 14 * 86400000)
        throw new ProviderError(
          'INVALID_WINDOW',
          'Çiçeksepeti sipariş sorgusu en fazla 14 günlük aralıkta yapılır.',
        )
      const response = record(
        await this.http.request(`${base}/Order/GetOrders`, {
          method: 'POST',
          headers,
          json: {
            startDate: new Date(from).toISOString(),
            endDate: new Date(to).toISOString(),
            pageSize: 100,
            page,
          },
          idempotent: true,
        }),
      )
      if (!Array.isArray(response.supplierOrderListWithBranch))
        throw new ProviderError('INVALID_RESPONSE', 'Çiçeksepeti sipariş yanıtı okunamadı.')
      const orders = response.supplierOrderListWithBranch.map(normalizeCiceksepetiOrder)
      return {
        message: `${orders.length} alt sipariş alındı.`,
        orders,
        ...((page + 1) * 100 < integer(response.orderListCount)
          ? { nextPayload: { ...payload, page: page + 1, from, to }, delaySeconds: 6 }
          : {}),
      }
    }
    if (operation === 'inventory.push') {
      if (payload.batchId) {
        const response = record(
          await this.http.request(
            `${base}/Products/batch-status/${pathPart(text(payload.batchId))}`,
            { headers },
          ),
        )
        const items = array(response.items).map(record)
        if (
          !items.length ||
          items.some((item) => ['Pending', 'Processing'].includes(text(item.status)))
        )
          return {
            message: 'Çiçeksepeti stok/fiyat işlemini işliyor.',
            nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
            delaySeconds: 61,
          }
        if (items.some((item) => !['Success', 'Warning'].includes(text(item.status))))
          throw new ProviderError(
            'BATCH_FAILED',
            'Çiçeksepeti stok/fiyat satırını reddetti. Uzak stok kodunu ve fiyatı kontrol edin.',
          )
        return {
          message: 'Çiçeksepeti stok/fiyat işlemi sonuçlandı.',
          reference: text(payload.batchId),
          listingStatus: payload.archive ? 'archived' : 'active',
        }
      }
      const listing = context.state.listings.find(
        (item) => item.id === payload.listingId && item.storeId === context.connectionId,
      )
      const found = listing ? findVariant(context.state, listing.variantId) : undefined
      if (!listing?.externalSku || !found)
        throw new ProviderError(
          'MAPPING_REQUIRED',
          'Çiçeksepeti ilanının uzak stok koduyla eşlenmesi gerekli.',
        )
      const archive =
          record(payload.inventoryPlan).archive ??
          payload.archive ??
          listing.desiredStatus === 'archived',
        values = inventoryValues(context, listing, payload)
      const response = record(
        await this.http.request(`${base}/Products/price-and-stock`, {
          method: 'PUT',
          headers,
          json: {
            items: [
              {
                stockCode: listing.externalSku,
                stockQuantity: archive ? 0 : values.quantity,
                salesPrice: values.price / 100,
              },
            ],
          },
          idempotent: true,
        }),
      )
      const batchId = text(response.batchId)
      if (!batchId)
        throw new ProviderError(
          'MISSING_BATCH_ID',
          'Çiçeksepeti işlem numarası dönmedi.',
          false,
          undefined,
          true,
        )
      return {
        message: 'Çiçeksepeti isteği aldı; satır sonucu bekleniyor.',
        reference: batchId,
        nextPayload: { ...payload, archive, batchId, polls: 0 },
        delaySeconds: 61,
      }
    }
    if (operation === 'invoice.link') {
      const order = context.state.orders.find(
        (item) => item.id === payload.orderId && item.storeId === context.connectionId,
      )
      const invoice = context.state.invoices.find((item) => item.id === order?.invoiceId)
      if (!order?.externalId || invoice?.status !== 'issued' || !invoice.url)
        throw new ProviderError(
          'INVOICE_REQUIRED',
          'Resmileşmiş PDF ve alt sipariş numarası gerekli.',
        )
      await this.http.request(`${base}/Branch/SendInvoiceMail`, {
        method: 'POST',
        headers,
        json: { items: [{ orderItemId: Number(order.externalId), documentUrl: invoice.url }] },
      })
      return { message: 'Fatura PDF bağlantısı Çiçeksepeti siparişine iletildi.' }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Çiçeksepeti işlemi kullanıma açık değil.')
  }
}

function turkeyDate(value: unknown, time: unknown) {
  const date = text(value),
    match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date)
  return iso(match ? `${match[3]}-${match[2]}-${match[1]}T${text(time) || '00:00'}:00+03:00` : date)
}
export function normalizeCiceksepetiOrder(raw: unknown): RemoteOrder {
  const item = record(raw),
    quantity = integer(item.quantity),
    total = cents(item.invoicePrice ?? item.totalPrice),
    shipping = cents(item.cargoPrice ?? 0)
  if (
    !text(item.orderItemId) ||
    quantity < 1 ||
    !Number.isFinite(total) ||
    !Number.isFinite(shipping)
  )
    throw new ProviderError('INVALID_ORDER', 'Çiçeksepeti alt sipariş bilgileri eksik.')
  const subtotal = total - shipping
  if (subtotal < 0)
    throw new ProviderError('INVALID_TOTAL', 'Çiçeksepeti kargo ve fatura tutarı uyuşmuyor.')
  return {
    externalId: text(item.orderItemId),
    number: text(item.orderId),
    createdAt: turkeyDate(item.orderCreateDate, item.orderCreateTime),
    modifiedAt: turkeyDate(item.orderModifyDate, item.orderModifyTime),
    status: text(item.orderProductStatus) || text(item.orderItemStatusId),
    normalizedStatus:
      item.isOrderStatusActive === false
        ? 'cancelled'
        : integer(item.orderItemStatusId) === 7
          ? 'delivered'
          : integer(item.orderItemStatusId) === 5
            ? 'shipped'
            : 'pending',
    total,
    shipping,
    recipient: {
      name: text(item.receiverName),
      address: text(item.receiverAddress),
      city: text(item.receiverCity),
      district: text(item.receiverDistrict),
      phone: text(item.receiverPhone),
      country: 'TR',
      email: text(item.invoiceEmail),
    },
    billing: {
      name: text(item.senderCompanyName) || text(item.senderName),
      address: text(item.senderAddress),
      city: text(item.senderCity),
      district: text(item.senderRegion),
      phone: '',
      taxId: text(item.senderTaxNumber),
      taxOffice: text(item.senderTaxOfficeName),
    },
    lines: [
      {
        externalId: text(item.orderItemId),
        sku: text(item.code),
        barcode: text(item.barcode),
        title: text(item.name),
        quantity,
        unitPrice: Math.round(subtotal / quantity),
        total: subtotal,
        taxRate: integer(item.tax),
      },
    ],
    trackingNumber: text(item.cargoNumber),
    cargoProvider: text(item.cargoCompany),
  }
}
