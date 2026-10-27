import { findVariant } from '../../src/domain/selectors'
import type {
  IntegrationOperation,
  RemoteOrder,
  RemoteProduct,
} from '../../src/domain/integrations'
import { ProviderError } from '../errors'
import { array, cents, integer, iso, pathPart, record, text, urls } from './contracts'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import { inventoryValues } from './contracts'
import { basicAuth, ProviderHttp, requireCredential } from './http'

export class TrendyolAdapter implements ProviderAdapter {
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
    const sellerId = requireCredential(context.credentials, 'sellerId')
    if (!/^\d+$/.test(sellerId))
      throw new ProviderError('INVALID_SELLER', 'Trendyol Satıcı ID sayısal olmalı.')
    const base =
      context.settings.environment === 'sandbox'
        ? 'https://stageapigw.trendyol.com/integration'
        : 'https://apigw.trendyol.com/integration'
    const headers = {
      authorization: basicAuth(
        requireCredential(context.credentials, 'apiKey'),
        requireCredential(context.credentials, 'apiSecret'),
      ),
      'user-agent': `${sellerId} - ${context.integrationName}`,
    }
    const seller = pathPart(sellerId)
    if (operation === 'test' || operation === 'catalog.pull') {
      const page = operation === 'test' ? 0 : integer(payload.page)
      const query = new URLSearchParams({
        page: String(page),
        size: operation === 'test' ? '1' : '100',
      })
      const response = record(
        await this.http.request(`${base}/product/sellers/${seller}/products?${query}`, { headers }),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Trendyol katalog yanıtı beklenen biçimde değil.',
        )
      if (operation === 'test')
        return {
          message:
            'Trendyol kimlik doğrulaması ve katalog okuma başarılı. Diğer işlemler kendi sonuçlarıyla doğrulanır.',
        }
      const products = response.content.map((value): RemoteProduct => {
        const item = record(value)
        const product: RemoteProduct = {
          externalId: text(item.id) || text(item.barcode),
          sku: text(item.stockCode),
          barcode: text(item.barcode),
          title: text(item.title),
          price: cents(item.salePrice),
          ...(Number.isSafeInteger(cents(item.listPrice))
            ? { listPrice: cents(item.listPrice) }
            : {}),
          quantity: Math.max(0, integer(item.quantity)),
          category: text(item.categoryName),
          categoryId: text(item.pimCategoryId ?? item.categoryId),
          brand: text(item.brand),
          taxRate: integer(item.vatRate),
          images: urls(item.images),
        }
        if (!product.externalId || !product.title || !Number.isFinite(product.price))
          throw new ProviderError(
            'INVALID_PRODUCT',
            'Trendyol ürün kimliği, adı veya fiyatı okunamadı.',
          )
        return product
      })
      const totalPages = integer(response.totalPages)
      return {
        message: `${products.length} ürün kaydı okundu.`,
        products,
        ...(page + 1 < totalPages
          ? { nextPayload: { ...payload, page: page + 1 }, delaySeconds: 1 }
          : {}),
      }
    }
    if (operation === 'orders.pull') {
      const page = integer(payload.page)
      const end = Number(payload.to ?? Date.now())
      const start = Number(payload.from ?? end - 7 * 86400000)
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start > end ||
        end - start > 14 * 86400000
      )
        throw new ProviderError(
          'INVALID_WINDOW',
          'Sipariş sorgusu en fazla 14 günlük bir aralıkta yapılır.',
        )
      const query = new URLSearchParams({
        startDate: String(start),
        endDate: String(end),
        page: String(page),
        size: '100',
        orderByField: 'PackageLastModifiedDate',
        orderByDirection: 'ASC',
      })
      const response = record(
        await this.http.request(`${base}/order/sellers/${seller}/orders?${query}`, { headers }),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Trendyol sipariş yanıtı beklenen biçimde değil.',
        )
      if (integer(response.totalElements) > 10000)
        throw new ProviderError(
          'WINDOW_TOO_LARGE',
          'Sorgu 10.000 paket sınırını aşıyor. Daha kısa tarih aralığıyla aktarım başlatın.',
        )
      const orders = response.content.map(normalizeTrendyolOrder)
      return {
        message: `${orders.length} sipariş paketi okundu.`,
        orders,
        ...(page + 1 < integer(response.totalPages)
          ? { nextPayload: { ...payload, from: start, to: end, page: page + 1 }, delaySeconds: 1 }
          : {}),
      }
    }
    if (operation === 'inventory.push') {
      if (payload.batchId) {
        const response = record(
          await this.http.request(
            `${base}/product/sellers/${seller}/products/batch-requests/${pathPart(text(payload.batchId))}`,
            { headers },
          ),
        )
        if (response.status !== 'COMPLETED')
          return {
            message: 'Trendyol toplu işlemi işliyor.',
            nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
            delaySeconds: 8,
          }
        const items = array(response.items).map(record)
        if (
          integer(response.failedItemCount) > 0 ||
          items.some((item) => item.status === 'FAILED' || array(item.failureReasons).length)
        )
          throw new ProviderError(
            'BATCH_FAILED',
            'Trendyol stok/fiyat işleminin en az bir satırını reddetti. Ürün ve kategori bilgilerini kontrol edin.',
          )
        return {
          message: 'Trendyol stok/fiyat işlemi tamamlandı.',
          reference: text(payload.batchId),
          listingStatus: payload.archive ? 'archived' : 'active',
        }
      }
      const listing = context.state.listings.find(
        (item) => item.id === payload.listingId && item.storeId === context.connectionId,
      )
      const found = listing ? findVariant(context.state, listing.variantId) : undefined
      if (!listing || !found || !found.variant.barcode)
        throw new ProviderError(
          'MAPPING_REQUIRED',
          'İlanın yerel varyant ve barkod eşlemesi gerekli.',
        )
      const values = inventoryValues(context, listing, payload)
      const price = values.price / 100
      const quantity = payload.archive ? 0 : Math.min(20000, Math.max(0, values.quantity))
      const response = record(
        await this.http.request(
          `${base}/inventory/sellers/${seller}/products/price-and-inventory`,
          {
            method: 'POST',
            headers,
            json: {
              items: [
                {
                  barcode: listing.externalBarcode || found.variant.barcode,
                  quantity,
                  salePrice: price,
                  listPrice: values.listPrice / 100,
                },
              ],
            },
            idempotent: true,
          },
        ),
      )
      const batchId = text(response.batchRequestId)
      if (!batchId)
        throw new ProviderError(
          'MISSING_BATCH_ID',
          'Trendyol işlem kimliği dönmedi; sonucu panelden doğrulayın.',
          false,
          undefined,
          true,
        )
      return {
        message: 'Trendyol işlemi kabul etti; satır sonuçları bekleniyor.',
        reference: batchId,
        nextPayload: { ...payload, batchId, polls: 0 },
        delaySeconds: 5,
      }
    }
    if (operation === 'invoice.link') {
      const order = context.state.orders.find(
        (item) => item.id === payload.orderId && item.storeId === context.connectionId,
      )
      const invoice = context.state.invoices.find((item) => item.id === order?.invoiceId)
      if (!order?.externalId || !invoice?.url || invoice.status !== 'issued')
        throw new ProviderError(
          'INVOICE_REQUIRED',
          'Resmileşmiş fatura bağlantısı ve pazaryeri paketi gerekli.',
        )
      await this.http.request(`${base}/sellers/${seller}/seller-invoice-links`, {
        method: 'POST',
        headers,
        json: {
          shipmentPackageId: Number(order.externalId),
          invoiceLink: invoice.url,
          ...(invoice.documentNumber
            ? {
                invoiceNumber: invoice.documentNumber,
                invoiceDateTime: Math.floor(new Date(invoice.createdAt).getTime() / 1000),
              }
            : {}),
        },
        idempotent: true,
      })
      return { message: 'Fatura bağlantısı Trendyol paketine iletildi.' }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Trendyol işlemi henüz desteklenmiyor.')
  }
}

export function normalizeTrendyolOrder(value: unknown): RemoteOrder {
  const item = record(value),
    address = record(item.shipmentAddress),
    invoice = record(item.invoiceAddress)
  const lines = array(item.lines).map((raw) => {
    const line = record(raw),
      quantity = integer(line.quantity)
    const price = cents(line.price ?? line.amount)
    if (quantity < 1 || !Number.isFinite(price))
      throw new ProviderError(
        'INVALID_ORDER_LINE',
        'Sipariş satırının miktar veya fiyat bilgisi okunamadı.',
      )
    return {
      externalId: text(line.id),
      sku: text(line.merchantSku ?? line.sku),
      barcode: text(line.barcode),
      title: text(line.productName),
      quantity,
      unitPrice: price,
      taxRate: integer(line.vatBaseAmount ?? line.vatRate),
    }
  })
  const id = text(item.id),
    number = text(item.orderNumber)
  if (!id || !number || !lines.length)
    throw new ProviderError('INVALID_ORDER', 'Sipariş kimliği veya satırları eksik.')
  return {
    externalId: id,
    number,
    createdAt: iso(item.orderDate),
    modifiedAt: iso(item.lastModifiedDate ?? item.orderDate),
    status: text(item.status),
    total: Number.isFinite(cents(item.totalPrice))
      ? cents(item.totalPrice)
      : lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    shipping: 0,
    recipient: {
      name: text(address.fullName) || `${text(address.firstName)} ${text(address.lastName)}`.trim(),
      address:
        text(address.fullAddress) ||
        [text(address.address1), text(address.address2)].filter(Boolean).join(' '),
      city: text(address.city),
      district: text(address.district),
      phone: text(address.phone),
      country: text(address.countryCode) || 'TR',
      email: text(item.customerEmail),
      taxId: text(invoice.taxNumber ?? invoice.identityNumber),
    },
    lines,
    trackingNumber: text(item.cargoTrackingNumber),
    cargoProvider: text(item.cargoProviderName),
  }
}
