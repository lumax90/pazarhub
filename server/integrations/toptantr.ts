import type {
  IntegrationOperation,
  RemoteOrder,
  RemoteProduct,
} from '../../src/domain/integrations'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import {
  array,
  cents,
  integer,
  inventoryValues,
  record,
  remoteInteger,
  text,
  urls,
} from './contracts'
import { ProviderHttp, requireCredential } from './http'
import type { HttpOptions } from './http'
import { accessToken, clearAccessTokens } from './oauth'
import { ProviderError } from '../errors'
import { isToptanSharedStock, synchronizeToptanSharedStock } from './toptantr-stock'

function nextPage(response: Record<string, unknown>, payload: Record<string, unknown>) {
  const sent = integer(payload.page),
    actual = remoteInteger(response.page, sent),
    base = integer(payload.pageBase, sent === 0 && actual === 1 ? 1 : 0),
    total = remoteInteger(response.totalPages)
  if (sent === 0 && !array(response.content).length && total > 0)
    return { ...payload, page: 1, pageBase: 1 }
  if (!array(response.content).length) return undefined
  if (actual < sent || total < 0)
    throw new ProviderError('INVALID_PAGING', 'ToptanTR sayfalama yanıtı doğrulanamadı.')
  return actual - base + 1 < total ? { ...payload, page: actual + 1, pageBase: base } : undefined
}
function numericReference(value: string) {
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    throw new ProviderError('INVALID_REFERENCE', 'ToptanTR kayıt kimliği geçersiz.')
  return Number(value)
}

export class ToptanTrApi {
  constructor(private readonly http: ProviderHttp) {}
  async request(
    context: AdapterContext,
    path: string,
    options: HttpOptions = {},
    again = false,
  ): Promise<Record<string, unknown>> {
    const base =
      context.settings.environment === 'sandbox'
        ? 'https://test.toptantr.com'
        : 'https://sapi.toptantr.com'
    const token = await accessToken(
      context,
      this.http,
      `${base}/sapi/v1/token`,
      {
        username: requireCredential(context.credentials, 'username'),
        password: requireCredential(context.credentials, 'password'),
      },
      { json: true },
    )
    let response: Record<string, unknown>
    try {
      response = record(
        await this.http.request(`${base}/sapi/v1${path}`, {
          ...options,
          headers: { ...options.headers, authorization: `Bearer ${token}` },
        }),
      )
    } catch (error) {
      if (!again && error instanceof ProviderError && error.code === 'AUTH_REJECTED') {
        clearAccessTokens(context)
        return this.request(context, path, options, true)
      }
      throw error
    }
    if (response.success === false)
      throw new ProviderError(
        'TOPTANTR_REJECTED',
        text(response.msg) || 'ToptanTR işlemi kabul etmedi.',
      )
    return response
  }
  async products(context: AdapterContext, barcode: string, page = 0) {
    const response = await this.request(context, '/products/search', {
      method: 'POST',
      json: { productSearch: { barcode, page, size: 100, approved: true, rejected: true } },
      idempotent: true,
    })
    if (!Array.isArray(response.content))
      throw new ProviderError('INVALID_CATALOG', 'ToptanTR katalog yanıtı okunamadı.')
    return response
  }
  async parent(context: AdapterContext, sku: string) {
    let cursor: Record<string, unknown> = { page: 0 }
    for (let page = 0; page < 100; page++) {
      const response = await this.products(context, sku, integer(cursor.page))
      const found = array(response.content)
        .map(record)
        .find((product) => text(product.stock_code) === sku)
      if (found) return found
      const next = nextPage(response, cursor)
      if (!next) return undefined
      cursor = next
    }
    throw new ProviderError('PAGING_LIMIT', 'ToptanTR üst ürün araması tamamlanamadı.')
  }
  async combination(context: AdapterContext, sku: string, id: string) {
    let cursor: Record<string, unknown> = { page: 0 }
    for (let page = 0; page < 20; page++) {
      const response = await this.products(context, sku, integer(cursor.page))
      for (const product of array(response.content).map(record)) {
        const combination = array(product.productAttributeCombinations)
          .map(record)
          .find((c) => text(c.id) === id)
        if (combination) return { product, combination }
      }
      const next = nextPage(response, cursor)
      if (!next) break
      cursor = next
    }
    throw new ProviderError(
      'COMBINATION_NOT_FOUND',
      'ToptanTR varyasyon kimliği bulunamadı; uzak katalog eşlemesini yenileyin.',
    )
  }
}
function utc(value: unknown) {
  let raw = text(value).replace(' ', 'T')
  if (raw && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += 'Z'
  const time = new Date(raw)
  if (Number.isNaN(time.getTime()))
    throw new ProviderError('INVALID_DATE', 'ToptanTR tarih alanı okunamadı.')
  return time.toISOString()
}
export function normalizeToptanTrProducts(raw: unknown): RemoteProduct[] {
  const product = record(raw),
    category = record(array(product.categories)[0]),
    brand = record(array(product.brands)[0])
  if (
    !text(product.productCode) ||
    !text(product.title) ||
    !Array.isArray(product.productAttributeCombinations)
  )
    throw new ProviderError('INVALID_PRODUCT', 'ToptanTR ürün/varyasyon ilişkisi okunamadı.')
  return product.productAttributeCombinations.map((raw) => {
    const variant = record(raw),
      id = text(variant.id),
      price = variant.overriddenPrice == null ? 0 : cents(variant.overriddenPrice),
      quantity = remoteInteger(variant.stockQuantity),
      pack = integer(variant.itemPerPackage, 1)
    if (!id || !Number.isSafeInteger(price) || quantity < 0 || pack < 1)
      throw new ProviderError(
        'INVALID_COMBINATION',
        'ToptanTR varyasyon kimliği, stok veya fiyatı geçersiz.',
      )
    return {
      externalId: id,
      sku: text(variant.barcode),
      barcode: text(variant.gtin),
      title: [text(product.title), text(variant.name)].filter(Boolean).join(' · '),
      price,
      quantity,
      category: text(category.name),
      categoryId: text(category.guid),
      brand: text(brand.name),
      taxRate:
        product.isTaxExempt === true
          ? 0
          : product.taxCategory == null
            ? undefined
            : integer(product.taxCategory),
      images: urls(product.images),
      status:
        product.onSale === true && String(variant.isActive).toLowerCase() === 'true'
          ? 'active'
          : integer(product.approvalStatusId, -1) === 100
            ? 'rejected'
            : integer(product.approvalStatusId, -1) === 0
              ? 'archived'
              : 'pending',
      attributes: {
        productCode: text(product.productCode),
        productId: text(product.id),
        parentSku: text(product.stock_code),
        itemPerPackage: pack,
        combinationName: text(variant.name),
      },
    }
  })
}
export function normalizeToptanTrOrder(
  raw: unknown,
  observedAt = new Date().toISOString(),
): RemoteOrder {
  const order = record(raw),
    shipping = record(order.shipmentAddress),
    billing = record(order.invoiceAddress),
    id = text(order.id),
    createdAt = utc(order.orderDate)
  if (!['TL', 'TRY'].includes(text(order.currencyCode)))
    throw new ProviderError('UNSUPPORTED_CURRENCY', 'ToptanTR siparişi TL para biriminde değil.')
  const normalizedStatus: RemoteOrder['normalizedStatus'] =
    integer(order.orderStatusId) === 40
      ? 'cancelled'
      : integer(order.shippingStatusId) === 50 || integer(order.paymentStatusId) === 40
        ? 'returned'
        : integer(order.shippingStatusId) === 40
          ? 'delivered'
          : integer(order.shippingStatusId) === 30
            ? 'shipped'
            : 'pending'
  const lines = array(order.orderItems).map((raw) => {
    const item = record(raw),
      product = record(item.product),
      quantity = remoteInteger(item.quantity),
      total = cents(item.priceInclTax),
      unitPrice = cents(item.unitPriceInclTax),
      sku = text(item.sku) || text(record(array(item.productAttributes)[0]).combinationSku)
    if (
      !text(item.id) ||
      quantity <= 0 ||
      !Number.isSafeInteger(total) ||
      !Number.isSafeInteger(unitPrice)
    )
      throw new ProviderError(
        'INVALID_ORDER_LINE',
        'ToptanTR sipariş kalemi eksik veya tutarı geçersiz.',
      )
    return {
      externalId: text(item.id),
      sku,
      barcode: '',
      title: text(item.product_name) || text(product.title),
      quantity,
      unitPrice,
      total,
      taxRate: product.taxCategory == null ? undefined : integer(product.taxCategory),
    }
  })
  const total = cents(order.orderTotal),
    shippingTotal = cents(order.orderShippingInclTax ?? 0)
  if (!id || !lines.length || !Number.isSafeInteger(total) || !Number.isSafeInteger(shippingTotal))
    throw new ProviderError('INVALID_ORDER', 'ToptanTR sipariş kimliği veya toplamı eksik.')
  const address = (a: Record<string, unknown>) =>
    [text(a.address1), text(a.address2), text(a.district), text(a.doorNo)].filter(Boolean).join(' ')
  const name = (a: Record<string, unknown>) =>
    [text(a.firstName), text(a.lastName)].filter(Boolean).join(' ')
  const mismatch = lines.reduce((sum, l) => sum + l.total, 0) + shippingTotal !== total
  const reconcile =
    integer(order.shippingStatusId) === 25
      ? 'ToptanTR siparişi kısmen kargolanmış; paket uzlaştırması gerekiyor.'
      : integer(order.paymentStatusId) === 35
        ? 'ToptanTR siparişinde kısmi geri ödeme var; iade/tutar uzlaştırması gerekiyor.'
        : mismatch
          ? 'ToptanTR kalem toplamı ile sipariş tutarı farklı; kesinti dağılımını uzlaştırın.'
          : undefined
  return {
    externalId: id,
    number: id,
    createdAt,
    modifiedAt: observedAt,
    status: text(order.orderStatus),
    normalizedStatus,
    total,
    shipping: shippingTotal,
    lines,
    recipient: {
      name: name(shipping),
      address: address(shipping),
      city: text(shipping.city),
      district: text(shipping.county),
      phone: text(shipping.phoneNumber),
      country: 'TR',
      email: text(shipping.email),
    },
    billing: {
      name: text(billing.company) || name(billing),
      address: address(billing),
      city: text(billing.city),
      district: text(billing.county),
      phone: text(billing.phoneNumber),
      taxId: text(billing.taxNumber),
      taxOffice: text(billing.taxOffice),
    },
    trackingNumber: text(order.cargoTrackingNumber) || undefined,
    cargoProvider: text(order.cargoProviderName) || undefined,
    requiresReconciliation: reconcile,
  }
}
export class ToptanTrAdapter implements ProviderAdapter {
  readonly capabilities: IntegrationOperation[] = [
    'test',
    'catalog.pull',
    'orders.pull',
    'inventory.push',
    'invoice.link',
    'order.update',
  ]
  private readonly api: ToptanTrApi
  constructor(http: ProviderHttp) {
    this.api = new ToptanTrApi(http)
  }
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    if (operation === 'test') {
      await this.api.products(context, '')
      return { message: 'ToptanTR token ve satıcı katalog erişimi doğrulandı.' }
    }
    if (operation === 'catalog.pull') {
      const page = integer(payload.page),
        response = await this.api.products(context, '', page)
      const next = nextPage(response, payload)
      return {
        message: `${array(response.content).length} ToptanTR ürün kartı alındı.`,
        products: array(response.content).flatMap(normalizeToptanTrProducts),
        ...(next ? { nextPayload: next, delaySeconds: 1 } : {}),
      }
    }
    if (operation === 'orders.pull') {
      const from = Number(payload.from ?? Date.now() - 7 * 86400000),
        to = Number(payload.to ?? Date.now()),
        page = integer(payload.page)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 31 * 86400000)
        throw new ProviderError('INVALID_WINDOW', 'ToptanTR sipariş tarih aralığı geçersiz.')
      const response = await this.api.request(context, '/orders/search', {
        method: 'POST',
        json: {
          orderSearch: {
            page,
            size: 100,
            startUpdatedDate: new Date(from).toISOString(),
            endUpdatedDate: new Date(to).toISOString(),
          },
        },
        idempotent: true,
      })
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_ORDERS', 'ToptanTR sipariş yanıtı okunamadı.')
      const next = nextPage(response, { ...payload, from, to })
      return {
        message: `${response.content.length} ToptanTR siparişi alındı.`,
        orders: response.content.map((o) => normalizeToptanTrOrder(o)),
        ...(next ? { nextPayload: next, delaySeconds: 1 } : {}),
      }
    }
    if (operation === 'inventory.push') {
      const listing = context.state.listings.find(
        (l) => l.id === payload.listingId && l.storeId === context.connectionId,
      )
      if (!listing?.externalId || !/^\d+$/.test(listing.externalId))
        throw new ProviderError('LISTING_REQUIRED', 'ToptanTR varyasyon eşlemesi gerekli.')
      const sku = listing.externalSku || listing.externalBarcode || '',
        { price, quantity } = inventoryValues(context, listing, payload)
      const { product, combination } = await this.api.combination(context, sku, listing.externalId)
      if (listing.attributes?.productCode && listing.attributes.productCode !== product.productCode)
        throw new ProviderError('PRODUCT_IDENTITY_MISMATCH', 'ToptanTR üst ürün kimliği değişmiş.')
      if (integer(listing.attributes?.itemPerPackage, 1) !== integer(combination.itemPerPackage, 1))
        throw new ProviderError(
          'PACKAGE_SIZE_CHANGED',
          'ToptanTR paket içi miktarı değişmiş; eşlemeyi yenileyin.',
        )
      if (array(product.productAttributeCombinations).length > 1) {
        const categoryId = text(record(array(product.categories)[0]).guid)
        if (!categoryId)
          throw new ProviderError(
            'CATEGORY_REQUIRED',
            'ToptanTR stok modeli için kategori bilgisi gerekli.',
          )
        const metadata = await this.api.request(
          context,
          `/categories/${encodeURIComponent(categoryId)}/attributes`,
        )
        if (isToptanSharedStock(product, record(metadata.data).combinationAttributes))
          return synchronizeToptanSharedStock(this.api, context, payload, product)
      }
      if (payload.batchId) {
        const result = await this.api.request(
          context,
          `/jobs?batchRequestId=${encodeURIComponent(text(payload.batchId))}`,
        )
        if (!Array.isArray(result.result))
          throw new ProviderError('INVALID_BATCH', 'ToptanTR parti sonucu okunamadı.')
        if (result.result.some((v) => record(v).success === false))
          throw new ProviderError(
            'BATCH_FAILED',
            text(record(result.result.find((v) => record(v).success === false)).msg) ||
              'ToptanTR stok/fiyat satırı başarısız.',
          )
        if (result.result.length !== 1 || record(result.result[0]).success !== true)
          return {
            message: 'ToptanTR parti sonucu bekleniyor.',
            nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
            delaySeconds: 30,
          }
      }
      if (
        cents(combination.overriddenPrice) === price &&
        remoteInteger(combination.stockQuantity) === quantity
      )
        return {
          message: 'ToptanTR varyasyon stok ve fiyatı katalogdan doğrulandı.',
          listingStatus:
            (record(payload.inventoryPlan).archive ??
            payload.archive ??
            listing.desiredStatus === 'archived')
              ? 'archived'
              : 'active',
        }
      if (payload.batchId)
        return {
          message: 'ToptanTR katalog değerlerinin yansıması bekleniyor.',
          nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
          delaySeconds: 30,
        }
      const response = await this.api.request(context, '/combinations', {
        method: 'PUT',
        json: {
          product: {
            combinations: [
              {
                id: numericReference(listing.externalId),
                barcode: sku,
                quantity,
                originalPrice: price / 100,
                sellingPrice: price / 100,
              },
            ],
          },
        },
        idempotent: true,
      })
      const batchId = text(response.batchRequestId)
      if (!batchId)
        throw new ProviderError(
          'BATCH_REQUIRED',
          'ToptanTR parti kimliği alınamadı; sonraki denemede önce katalog değerleri kontrol edilecek.',
          true,
          30,
        )
      return {
        message: 'ToptanTR stok/fiyat isteği sıraya alındı.',
        nextPayload: { ...payload, batchId, polls: 0 },
        delaySeconds: 15,
      }
    }
    if (operation === 'invoice.link') {
      const order = context.state.orders.find(
          (o) => o.id === payload.orderId && o.storeId === context.connectionId,
        ),
        invoice = context.state.invoices.find((i) => i.orderId === order?.id)
      if (
        !order?.externalId ||
        order.syncError ||
        invoice?.status !== 'issued' ||
        !invoice.url ||
        !invoice.documentNumber ||
        !invoice.issuedAt
      )
        throw new ProviderError(
          'INVOICE_REQUIRED',
          'Siparişe ait resmî fatura numarası, bağlantısı ve düzenlenme tarihi gerekli.',
        )
      const response = await this.api.request(context, '/shortInvoceLink', {
        method: 'POST',
        json: {
          orderInvoce: {
            orderId: numericReference(order.externalId),
            invoiceNo: invoice.documentNumber,
            invoiceLink: invoice.url,
            invoiceDate: invoice.issuedAt,
          },
        },
      })
      if (response.success !== true)
        throw new ProviderError(
          'INVOICE_LINK_UNCERTAIN',
          'ToptanTR fatura bağlantısı sonucu doğrulanamadı.',
          false,
          undefined,
          true,
        )
      return { message: 'Resmî fatura bağlantısı ToptanTR siparişine iletildi.' }
    }
    if (operation === 'order.update') {
      const order = context.state.orders.find(
        (o) => o.id === payload.orderId && o.storeId === context.connectionId,
      )
      if (!order?.externalId || payload.action !== 'approve' || order.syncError)
        throw new ProviderError(
          'ORDER_REQUIRED',
          'ToptanTR için uzlaştırılmış sipariş onay işlemi seçin.',
        )
      const current = await this.api.request(context, '/orders/search', {
        method: 'POST',
        json: {
          orderSearch: { orderNumber: numericReference(order.externalId), page: 0, size: 100 },
        },
        idempotent: true,
      })
      const remote = array(current.content)
        .map(record)
        .find((o) => text(o.id) === order.externalId)
      if (!remote)
        throw new ProviderError('ORDER_NOT_FOUND', 'ToptanTR sipariş kimliği doğrulanamadı.')
      if (integer(remote.orderStatusId) === 20)
        return {
          message: 'ToptanTR sipariş onayı doğrulandı.',
          orders: [normalizeToptanTrOrder(remote)],
        }
      if (![10, 15].includes(integer(remote.orderStatusId)))
        throw new ProviderError(
          'ORDER_NOT_ACTIONABLE',
          'ToptanTR siparişi onay bekleyen durumda değil.',
        )
      if (payload.submitted)
        return {
          message: 'ToptanTR onay durumunun yansıması bekleniyor.',
          nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
          delaySeconds: 15,
        }
      const result = await this.api.request(
        context,
        `/orders/${encodeURIComponent(order.externalId)}/approve`,
        { method: 'POST', json: {} },
      )
      if (result.success !== true)
        throw new ProviderError(
          'ORDER_UPDATE_UNCERTAIN',
          'ToptanTR sipariş onay sonucu doğrulanamadı.',
          false,
          undefined,
          true,
        )
      return {
        message: 'ToptanTR sipariş onayı iletildi.',
        nextPayload: { ...payload, submitted: true, polls: 0 },
        delaySeconds: 10,
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu ToptanTR işlemi henüz açık değil.')
  }
}
