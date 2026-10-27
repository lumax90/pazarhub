import { XMLParser } from 'fast-xml-parser'
import { findVariant } from '../../src/domain/selectors'
import type {
  IntegrationOperation,
  RemoteOrder,
  RemoteProduct,
} from '../../src/domain/integrations'
import { ProviderError } from '../errors'
import { isCancelled, packageStatus } from '../order-fulfillment/contracts'
import { array, cents, integer, iso, record, text, urls } from './contracts'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import { inventoryValues } from './contracts'
import { ProviderHttp, requireCredential } from './http'

export class N11Adapter implements ProviderAdapter {
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
    if (context.settings.environment === 'sandbox')
      throw new ProviderError(
        'SANDBOX_UNAVAILABLE',
        'n11 için tanımlı bir sandbox adresi bulunmuyor; gerçek satıcı API erişimi gerekir.',
      )
    const headers = {
      appKey: requireCredential(context.credentials, 'appKey'),
      appSecret: requireCredential(context.credentials, 'appSecret'),
    }
    if (operation === 'test' || operation === 'catalog.pull') {
      const page = integer(payload.page),
        size = operation === 'test' ? 1 : 100
      const response = record(
        await this.http.request(
          `https://api.n11.com/ms/product-query?page=${page}&size=${size}&sender=SELLER`,
          { headers },
        ),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_RESPONSE', 'n11 katalog yanıtı beklenen biçimde değil.')
      if (operation === 'test')
        return { message: 'n11 kimlik doğrulaması ve satıcı katalog okuması başarılı.' }
      const products = response.content.map((raw): RemoteProduct => {
        const row = record(raw)
        const product = {
          externalId: text(row.n11ProductId),
          sku: text(row.stockCode),
          barcode: text(row.barcode),
          title: text(row.title),
          price: cents(row.salePrice),
          ...(Number.isSafeInteger(cents(row.listPrice))
            ? { listPrice: cents(row.listPrice) }
            : {}),
          quantity: Math.max(0, integer(row.quantity)),
          categoryId: text(row.categoryId),
          brand: text(row.brandName),
          images: urls(row.imageUrls),
          taxRate: integer(row.vatRate),
        }
        if (!product.externalId || !product.title || !Number.isFinite(product.price))
          throw new ProviderError('INVALID_PRODUCT', 'n11 ürün kimliği veya fiyatı okunamadı.')
        return product
      })
      return {
        message: `${products.length} n11 ürünü okundu.`,
        products,
        ...(page + 1 < integer(response.totalPages)
          ? { nextPayload: { ...payload, page: page + 1 }, delaySeconds: 1 }
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
          'n11 sipariş sorgusu en fazla 14 günlük aralıkta yapılır.',
        )
      const query = new URLSearchParams({
        page: String(page),
        size: '100',
        startDate: String(from),
        endDate: String(to),
        orderByField: 'true',
        orderByDirection: 'ASC',
        sender: 'SELLER',
      })
      const response = record(
        await this.http.request(`https://api.n11.com/rest/delivery/v1/shipmentPackages?${query}`, {
          headers,
        }),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_RESPONSE', 'n11 sipariş yanıtı beklenen biçimde değil.')
      const orders = response.content.map(normalizeN11Order)
      return {
        message: `${orders.length} n11 sipariş paketi okundu.`,
        orders,
        ...(page + 1 < integer(response.totalPages)
          ? { nextPayload: { ...payload, page: page + 1, from, to }, delaySeconds: 1 }
          : {}),
      }
    }
    if (operation === 'inventory.push') {
      if (payload.taskId) {
        const response = record(
          await this.http.request('https://api.n11.com/ms/product/task-details/page-query', {
            method: 'POST',
            headers,
            json: { taskId: Number(payload.taskId), pageable: { page: 0, size: 1000 } },
            idempotent: true,
          }),
        )
        if (response.status === 'REJECT')
          throw new ProviderError('TASK_REJECTED', 'n11 stok/fiyat isteğini reddetti.')
        if (response.status !== 'PROCESSED')
          return {
            message: 'n11 işlemi devam ediyor.',
            nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
            delaySeconds: 8,
          }
        const items = array(record(response.skus).content).map(record)
        if (!items.length || items.some((item) => item.status !== 'SUCCESS'))
          throw new ProviderError(
            'TASK_FAILED',
            'n11 işlemindeki ürün satırı başarısız oldu. İlan alanlarını kontrol edin.',
          )
        return {
          message: 'n11 stok/fiyat işlemi tamamlandı.',
          reference: text(payload.taskId),
          listingStatus: payload.archive ? 'archived' : 'active',
        }
      }
      const listing = context.state.listings.find(
        (item) => item.id === payload.listingId && item.storeId === context.connectionId,
      )
      const found = listing ? findVariant(context.state, listing.variantId) : undefined
      if (!listing || !found || !found.variant.sku)
        throw new ProviderError(
          'MAPPING_REQUIRED',
          'n11 ilanının stok koduyla eşleştirilmesi gerekli.',
        )
      const values = inventoryValues(context, listing, payload)
      const price = values.price / 100
      const response = record(
        await this.http.request('https://api.n11.com/ms/product/tasks/price-stock-update', {
          method: 'POST',
          headers,
          json: {
            payload: {
              integrator: context.integrationName,
              skus: [
                {
                  stockCode: listing.externalSku || found.variant.sku,
                  listPrice: values.listPrice / 100,
                  salePrice: price,
                  quantity: payload.archive ? 0 : Math.max(0, values.quantity),
                  currencyType: 'TL',
                },
              ],
            },
          },
          idempotent: true,
        }),
      )
      if (response.status === 'REJECT')
        throw new ProviderError('TASK_REJECTED', 'n11 stok/fiyat isteğini reddetti.')
      const taskId = text(response.id)
      if (!taskId)
        throw new ProviderError(
          'MISSING_TASK_ID',
          'n11 işlem kimliği dönmedi.',
          false,
          undefined,
          true,
        )
      return {
        message: 'n11 isteği aldı; işlem sonucu bekleniyor.',
        reference: taskId,
        nextPayload: { ...payload, taskId, polls: 0 },
        delaySeconds: 5,
      }
    }
    if (operation === 'invoice.link') {
      const order = context.state.orders.find(
        (item) => item.id === payload.orderId && item.storeId === context.connectionId,
      )
      const invoice = context.state.invoices.find((item) => item.id === order?.invoiceId)
      if (!order?.externalNumber || invoice?.status !== 'issued' || !invoice.url)
        throw new ProviderError(
          'INVOICE_REQUIRED',
          'Resmileşmiş fatura ve n11 sipariş numarası gerekli.',
        )
      const xml = (value: string) =>
        value
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&apos;')
      const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.n11.com/ws/schemas"><soapenv:Header/><soapenv:Body><sch:SaveLinkSellerInvoiceRequest><auth><appKey>${xml(headers.appKey)}</appKey><appSecret>${xml(headers.appSecret)}</appSecret></auth><url>${xml(invoice.url)}</url><orderNumber>${xml(order.externalNumber)}</orderNumber></sch:SaveLinkSellerInvoiceRequest></soapenv:Body></soapenv:Envelope>`
      const response = await this.http.request('https://api.n11.com/ws/sellerInvoiceService/', {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8', SOAPAction: '' },
        body,
        responseType: 'text',
        idempotent: true,
      })
      const parsed = new XMLParser({
        ignoreAttributes: false,
        removeNSPrefix: true,
        processEntities: false,
      }).parse(String(response))
      const result = record(
        record(record(record(parsed).Envelope).Body).SaveLinkSellerInvoiceResponse,
      )
      if (record(result.result).status !== 'success')
        throw new ProviderError('INVOICE_LINK_FAILED', 'n11 fatura bağlantısını kabul etmedi.')
      return { message: 'Fatura bağlantısı n11 siparişine iletildi.' }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu n11 işlemi henüz desteklenmiyor.')
  }
}

export function normalizeN11Order(value: unknown): RemoteOrder {
  const item = record(value),
    address = record(item.shippingAddress),
    billing = record(item.billingAddress)
  const lines = array(item.lines).map((raw) => {
    const line = record(raw),
      quantity = integer(line.quantity)
    const total = cents(line.sellerInvoiceAmount)
    const unitPrice =
      Number.isFinite(total) && quantity > 0
        ? Math.round(total / quantity)
        : cents(line.sellerDiscountedPrice ?? line.price)
    if (quantity < 1 || !Number.isFinite(unitPrice))
      throw new ProviderError(
        'INVALID_ORDER_LINE',
        'n11 sipariş satırının fiyat veya miktarı okunamadı.',
      )
    return {
      externalId: text(line.orderLineId),
      sku: text(line.stockCode),
      barcode: text(line.barcode),
      title: text(line.productName),
      quantity,
      unitPrice,
      ...(Number.isFinite(total) ? { total } : {}),
      taxRate: integer(line.vatRate),
      status: isCancelled(line.orderItemLineItemStatusName || item.shipmentPackageStatus)
        ? ('cancelled' as const)
        : packageStatus(line.orderItemLineItemStatusName || item.shipmentPackageStatus) ===
            'delivered'
          ? ('delivered' as const)
          : packageStatus(line.orderItemLineItemStatusName || item.shipmentPackageStatus) ===
              'shipped'
            ? ('shipped' as const)
            : ('pending' as const),
    }
  })
  const externalId = text(item.id)
  if (!externalId || !text(item.orderNumber) || !lines.length)
    throw new ProviderError(
      'UNSUPPORTED_ORDER',
      'Paket kimliği olmayan veya boş n11 siparişi otomatik işlenemedi.',
    )
  const firstHistory = record(array(item.packageHistories)[0])
  return {
    externalId,
    number: text(item.orderNumber),
    createdAt: iso(firstHistory.createdDate ?? item.lastModifiedDate),
    modifiedAt: iso(item.lastModifiedDate),
    status: text(item.shipmentPackageStatus),
    normalizedStatus:
      lines.every((line) => line.status === 'cancelled') ||
      item.shipmentPackageStatus === 'Unpacked'
        ? 'cancelled'
        : lines.every((line) => line.status === 'delivered')
          ? 'delivered'
          : lines.every((line) => ['shipped', 'delivered'].includes(line.status))
            ? 'shipped'
            : 'pending',
    requiresReconciliation:
      lines.some((line) => line.status === 'cancelled') &&
      lines.some((line) => line.status !== 'cancelled')
        ? 'n11 iptal edilen ve açık kalemleri birlikte içeriyor; kalemleri uzlaştırın.'
        : undefined,
    total: lines.reduce((sum, line) => sum + (line.total ?? line.unitPrice * line.quantity), 0),
    shipping: 0,
    recipient: {
      name: text(address.fullName) || text(item.customerfullName),
      address: text(address.address),
      city: text(address.city),
      district: text(address.district),
      phone: text(address.gsm),
      country:
        text(billing.countryCode) && billing.countryCode !== 'null'
          ? text(billing.countryCode)
          : 'TR',
      email: text(item.customerEmail),
      taxId: text(item.taxId ?? item.tcIdentityNumber),
    },
    lines,
    trackingNumber: text(item.cargoTrackingNumber),
    cargoProvider: text(item.cargoProviderName),
  }
}
