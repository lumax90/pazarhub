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
import { ProviderHttp, basicAuth, requireCredential } from './http'
import type { HttpOptions } from './http'
import { accessToken, clearAccessTokens } from './oauth'
import { ProviderError } from '../errors'

export const PAZARAMA_BASE = 'https://isortagimapi.pazarama.com'
export class PazaramaApi {
  constructor(private readonly http: ProviderHttp) {}
  async request(
    context: AdapterContext,
    path: string,
    options: HttpOptions = {},
    again = false,
  ): Promise<Record<string, unknown>> {
    if (context.settings.environment !== 'production')
      throw new ProviderError(
        'SANDBOX_UNAVAILABLE',
        'Pazarama için ayrı sandbox adresi yayımlanmamış; sağlayıcının verdiği test hesabını kullanın.',
      )
    const token = await accessToken(
      context,
      this.http,
      'https://isortagimgiris.pazarama.com/connect/token',
      { grant_type: 'client_credentials', scope: 'merchantgatewayapi.fullaccess' },
      {
        headers: {
          authorization: basicAuth(
            requireCredential(context.credentials, 'clientId'),
            requireCredential(context.credentials, 'clientSecret'),
          ),
        },
      },
    )
    let response: Record<string, unknown>
    try {
      response = record(
        await this.http.request(`${PAZARAMA_BASE}${path}`, {
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
        'PAZARAMA_REJECTED',
        text(response.userMessage ?? response.message) || 'Pazarama işlemi kabul etmedi.',
      )
    return response
  }
  async product(context: AdapterContext, code: string) {
    const response = await this.request(context, '/product/getProductDetail', {
      method: 'POST',
      json: { Code: code },
      idempotent: true,
    })
    const product = record(response.data)
    if (text(product.code) !== code)
      throw new ProviderError('PRODUCT_IDENTITY_MISMATCH', 'Pazarama barkod bilgisi eşleşmedi.')
    return product
  }
  async find(context: AdapterContext, code: string) {
    const approved = await this.request(
      context,
      `/product/products/approved?${new URLSearchParams({ Code: code, Size: '100' })}`,
    )
    const rows = record(approved.data).sellerProducts
    if (!Array.isArray(rows))
      throw new ProviderError('INVALID_CATALOG', 'Pazarama onaylı ürün yanıtı okunamadı.')
    const live = rows.map(record).find((r) => text(r.code) === code)
    if (live) return { product: live, approved: true }
    const unapproved = await this.request(
      context,
      `/product/products/unapproved?${new URLSearchParams({ Code: code, pageIndex: '0', pageSize: '100' })}`,
    )
    if (!Array.isArray(unapproved.data))
      throw new ProviderError('INVALID_CATALOG', 'Pazarama onaysız ürün yanıtı okunamadı.')
    const pending = unapproved.data.map(record).find((r) => text(r.code) === code)
    return pending ? { product: pending, approved: false } : null
  }
}
export function pazaramaMoney(value: unknown) {
  const data = record(value)
  if (
    Object.hasOwn(data, 'valueInt') &&
    Number.isSafeInteger(data.valueInt) &&
    Number(data.valueInt) >= 0
  )
    return Number(data.valueInt)
  return cents(Object.hasOwn(data, 'value') ? data.value : value)
}
function pazaramaDate(value: unknown) {
  let date = text(value).trim().replace(' ', 'T')
  if (date && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date)) date += '+03:00'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime()))
    throw new ProviderError('INVALID_DATE', 'Pazarama tarih alanı okunamadı.')
  return parsed.toISOString()
}
export function normalizePazaramaProduct(raw: unknown, approved: boolean): RemoteProduct {
  const product = record(raw),
    price = pazaramaMoney(product.salePrice),
    id = text(product.code),
    quantity = remoteInteger(product.stockCount)
  if (
    !id ||
    !text(product.name ?? product.displayName) ||
    !Number.isSafeInteger(price) ||
    quantity < 0
  )
    throw new ProviderError(
      'INVALID_PRODUCT',
      'Pazarama ürün kimliği, fiyatı veya stok değeri eksik.',
    )
  return {
    externalId: id,
    sku: text(product.stockCode),
    barcode: id,
    title: text(product.displayName ?? product.name),
    price,
    ...(Number.isSafeInteger(pazaramaMoney(product.listPrice))
      ? { listPrice: pazaramaMoney(product.listPrice) }
      : {}),
    quantity,
    category: text(product.categoryName),
    categoryId: text(product.categoryId),
    brand: text(product.brandName),
    taxRate: product.vatRate == null ? undefined : integer(product.vatRate),
    images: urls(array(product.images).map((v) => record(v).imageUrl)),
    status: approved ? 'active' : 'pending',
    attributes: { groupCode: text(product.groupCode), state: integer(product.state) },
  }
}
export function normalizePazaramaOrder(raw: unknown): RemoteOrder {
  const order = record(raw),
    shipping = record(order.shipmentAddress),
    billing = record(order.billingAddress),
    id = text(order.orderId),
    createdAt = pazaramaDate(order.orderDate),
    items = array(order.items).map(record)
  const statusFor = (value: unknown): RemoteOrder['normalizedStatus'] =>
    [6, 13].includes(integer(value))
      ? 'cancelled'
      : [8, 10].includes(integer(value))
        ? 'returned'
        : integer(value) === 11
          ? 'delivered'
          : integer(value) === 5
            ? 'shipped'
            : 'pending'
  const statuses = items.map((item) => statusFor(item.orderItemStatus)),
    unique = [...new Set(statuses)],
    packages = [...new Set(items.map((i) => text(i.packageNumber)).filter((s) => s && s !== '0'))]
  const currency = text(order.currency)
  if (currency && !['TL', 'TRY'].includes(currency))
    throw new ProviderError('UNSUPPORTED_CURRENCY', 'Pazarama siparişi TL para biriminde değil.')
  const lines = items.map((item) => {
    const product = record(item.product),
      quantity = remoteInteger(item.quantity),
      unitPrice = pazaramaMoney(item.salePrice),
      total = pazaramaMoney(item.totalPrice)
    if (
      !text(item.orderItemId) ||
      quantity <= 0 ||
      !Number.isSafeInteger(unitPrice) ||
      !Number.isSafeInteger(total)
    )
      throw new ProviderError(
        'INVALID_ORDER_LINE',
        'Pazarama sipariş kalemi tutarı veya miktarı geçersiz.',
      )
    return {
      externalId: text(item.orderItemId),
      sku: text(product.stockCode),
      barcode: text(product.code),
      title: text(product.name ?? product.title),
      quantity,
      unitPrice,
      total,
      taxRate: product.vatRate == null ? undefined : integer(product.vatRate),
      status: statusFor(item.orderItemStatus),
    }
  })
  const total = pazaramaMoney(order.orderAmount),
    shippingTotal = pazaramaMoney(order.shipmentAmount ?? 0)
  if (!id || !lines.length || !Number.isSafeInteger(total) || !Number.isSafeInteger(shippingTotal))
    throw new ProviderError('INVALID_ORDER', 'Pazarama sipariş toplamı veya kimliği eksik.')
  const times = items.flatMap((i) =>
    array(i.orderItemStatusHistory).map((h) => pazaramaDate(record(h).historyCreatedDate)),
  )
  const mismatch = lines.reduce((sum, l) => sum + l.total, 0) + shippingTotal !== total
  const reconcile =
    unique.length > 1
      ? 'Pazarama siparişi farklı durumdaki kalemler içeriyor. Paket/kalem uzlaştırması gerekiyor.'
      : mismatch
        ? 'Pazarama kalem toplamı ile sipariş tutarı farklı; indirim/kargo dağılımını uzlaştırın.'
        : undefined
  return {
    externalId: id,
    number: text(order.orderNumber) || id,
    createdAt,
    modifiedAt: [createdAt, ...times].sort().at(-1)!,
    status: text(order.orderStatus),
    normalizedStatus: unique.length === 1 ? unique[0] : 'pending',
    total,
    shipping: shippingTotal,
    lines,
    recipient: {
      name: text(shipping.nameSurname ?? order.customerName),
      address: text(shipping.displayAddressText ?? shipping.addressDetail),
      city: text(shipping.cityName),
      district: text(shipping.districtName),
      phone: text(shipping.phoneNumber),
      country: 'TR',
      email: text(shipping.customerEmail ?? order.customerEmail),
    },
    billing: {
      name: text(billing.companyName) || text(billing.nameSurname),
      address: text(billing.displayAddressText ?? billing.addressDetail),
      city: text(billing.cityName),
      district: text(billing.districtName),
      phone: text(billing.phoneNumber),
      taxId: text(billing.taxNumber) || text(billing.identityNumber),
      taxOffice: text(billing.taxOffice),
    },
    trackingNumber: items.length ? text(record(items[0].cargo).trackingNumber) : undefined,
    cargoProvider: items.length ? text(record(items[0].cargo).companyName) : undefined,
    packageNumbers: packages,
    requiresReconciliation: reconcile,
  }
}
export class PazaramaAdapter implements ProviderAdapter {
  readonly capabilities: IntegrationOperation[] = [
    'test',
    'catalog.pull',
    'orders.pull',
    'inventory.push',
    'invoice.link',
  ]
  private readonly api: PazaramaApi
  constructor(http: ProviderHttp) {
    this.api = new PazaramaApi(http)
  }
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    if (operation === 'test') {
      const response = await this.api.request(context, '/product/products/approved?Size=1')
      if (!Array.isArray(record(response.data).sellerProducts))
        throw new ProviderError('INVALID_CATALOG', 'Pazarama ürün okuma erişimi doğrulanamadı.')
      return { message: 'Pazarama token ve ürün okuma erişimi doğrulandı.' }
    }
    if (operation === 'catalog.pull') {
      const unapproved = payload.phase === 'unapproved',
        page = integer(payload.page),
        params = new URLSearchParams(
          unapproved
            ? { pageIndex: String(page), pageSize: '100' }
            : { Size: '100', ...(payload.cursor ? { Cursor: text(payload.cursor) } : {}) },
        )
      const response = await this.api.request(
        context,
        `/product/products/${unapproved ? 'unapproved' : 'approved'}?${params}`,
      )
      const rows = unapproved ? response.data : record(response.data).sellerProducts
      if (!Array.isArray(rows))
        throw new ProviderError('INVALID_CATALOG', 'Pazarama katalog yanıtı okunamadı.')
      const cursor = text(record(response.data).nextCursor)
      if (cursor && cursor === payload.cursor)
        throw new ProviderError(
          'CURSOR_REPEATED',
          'Pazarama aynı katalog imlecini tekrar döndürdü.',
        )
      const actual = remoteInteger(response.pageIndex, page),
        base = integer(payload.pageBase, page === 0 && actual === 1 ? 1 : 0)
      const hasMore =
        typeof response.hasNextPage === 'boolean'
          ? response.hasNextPage
          : response.totalPages == null
            ? rows.length === 100
            : actual - base + 1 < integer(response.totalPages)
      const next = unapproved
        ? hasMore
          ? { ...payload, page: actual + 1, pageBase: base }
          : undefined
        : cursor
          ? { ...payload, cursor }
          : { phase: 'unapproved', page: 0 }
      return {
        message: `${rows.length} Pazarama ürünü alındı.`,
        products: rows.map((p) => normalizePazaramaProduct(p, !unapproved)),
        ...(next ? { nextPayload: next, delaySeconds: 1 } : {}),
      }
    }
    if (operation === 'orders.pull') {
      const from = Number(payload.from ?? Date.now() - 7 * 86400000),
        to = Number(payload.to ?? Date.now()),
        page = integer(payload.page, 1)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 28 * 86400000)
        throw new ProviderError(
          'INVALID_WINDOW',
          'Pazarama sipariş sorgusunda en fazla 28 günlük aralık kullanın.',
        )
      const local = (value: number) => new Date(value + 3 * 3600000).toISOString().slice(0, 19)
      const response = await this.api.request(context, '/order/getOrdersForApi', {
        method: 'POST',
        json: { startDate: local(from), endDate: local(to), pageNumber: page, pageSize: 100 },
        idempotent: true,
      })
      if (!Array.isArray(response.data))
        throw new ProviderError('INVALID_ORDERS', 'Pazarama sipariş yanıtı okunamadı.')
      return {
        message: `${response.data.length} Pazarama siparişi alındı.`,
        orders: response.data.map(normalizePazaramaOrder),
        ...(response.hasNextPage === true || response.data.length === 100
          ? { nextPayload: { ...payload, from, to, page: page + 1 }, delaySeconds: 1 }
          : {}),
      }
    }
    if (operation === 'inventory.push') {
      const listing = context.state.listings.find(
        (l) => l.id === payload.listingId && l.storeId === context.connectionId,
      )
      if (!listing?.externalId)
        throw new ProviderError('LISTING_REQUIRED', 'Pazarama ilan eşlemesi gerekli.')
      const code = listing.externalBarcode || listing.externalId,
        { price, listPrice, quantity } = inventoryValues(context, listing, payload)
      const wait = (next: Record<string, unknown>) => ({
        message: 'Pazarama stok/fiyat sonucu izleniyor.',
        nextPayload: next,
        delaySeconds: 65,
      })
      const check = async (batch: string, kind: 'price' | 'stock') => {
        const response = await this.api.request(
          context,
          `/listing-state/batch-id/${encodeURIComponent(batch)}/lake-projections?page=1&pageSize=100`,
        )
        const rows = record(response.data).data
        if (!Array.isArray(rows))
          throw new ProviderError('INVALID_BATCH', 'Pazarama stok/fiyat parti yanıtı okunamadı.')
        const line = rows.map(record).find((row) => text(row.code) === code),
          detail = record(line?.[kind]),
          status = text(line?.operationStatusText)
        if (!line) return false
        if (kind === 'price' && status === 'Onaya gönderildi')
          throw new ProviderError(
            'PRICE_APPROVAL_REQUIRED',
            'Stok güncellendi; Pazarama fiyatı incelemeye aldı. Fiyat onayından sonra sonucu tekrar kontrol edin.',
          )
        if (
          ['Tamamlanamadı', 'Hata oluştu'].includes(status) ||
          [1, 2].includes(remoteInteger(detail.status))
        )
          throw new ProviderError(
            'BATCH_FAILED',
            text(detail.operationDetail) || 'Pazarama stok/fiyat işlemi başarısız.',
          )
        return status === 'Başarılı' && remoteInteger(detail.status) === 0
      }
      if (!payload.stockBatch) {
        const response = await this.api.request(context, '/product/updateStock-v2', {
          method: 'POST',
          json: { items: [{ code, stockCount: quantity }] },
          idempotent: true,
        })
        const batch = text(response.data)
        if (!batch)
          throw new ProviderError(
            'BATCH_REQUIRED',
            'Pazarama stok işlem numarası alınamadı.',
            true,
            30,
          )
        return wait({ ...payload, stockBatch: batch, polls: 0 })
      }
      if (!(await check(text(payload.stockBatch), 'stock')))
        return wait({ ...payload, polls: integer(payload.polls) + 1 })
      if (!payload.priceBatch) {
        const response = await this.api.request(context, '/product/updatePrice-v2', {
          method: 'POST',
          json: { items: [{ code, listPrice: listPrice / 100, salePrice: price / 100 }] },
          idempotent: true,
        })
        const batch = text(response.data)
        if (!batch)
          throw new ProviderError(
            'BATCH_REQUIRED',
            'Pazarama fiyat işlem numarası alınamadı.',
            true,
            30,
          )
        return wait({ ...payload, priceBatch: batch, polls: 0 })
      }
      if (!(await check(text(payload.priceBatch), 'price')))
        return wait({ ...payload, polls: integer(payload.polls) + 1 })
      const product = await this.api.product(context, code)
      if (
        pazaramaMoney(product.salePrice) !== price ||
        remoteInteger(product.stockCount) !== quantity
      )
        return wait({ ...payload, polls: integer(payload.polls) + 1 })
      return {
        message: 'Pazarama stok ve fiyat değerleri katalogdan doğrulandı.',
        listingStatus:
          (record(payload.inventoryPlan).archive ??
          payload.archive ??
          listing.desiredStatus === 'archived')
            ? 'archived'
            : 'active',
      }
    }
    if (operation === 'invoice.link') {
      const order = context.state.orders.find(
          (o) => o.id === payload.orderId && o.storeId === context.connectionId,
        ),
        invoice = context.state.invoices.find((i) => i.orderId === order?.id)
      if (!order?.externalId || order.syncError || invoice?.status !== 'issued' || !invoice.url)
        throw new ProviderError(
          'INVOICE_REQUIRED',
          'Uzlaştırılmış sipariş ve resmî fatura bağlantısı gerekli.',
        )
      const response = await this.api.request(context, '/order/invoice-link', {
        method: 'POST',
        json: {
          orderid: order.externalId,
          invoiceLink: invoice.url,
          deliveryCompanyId: null,
          trackingNumber: null,
        },
      })
      if (response.success !== true)
        throw new ProviderError(
          'INVOICE_LINK_UNCERTAIN',
          'Pazarama fatura bağlantısı sonucu doğrulanamadı.',
          false,
          undefined,
          true,
        )
      return { message: 'Fatura bağlantısı Pazarama siparişine iletildi.' }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Pazarama işlemi henüz açık değil.')
  }
}
