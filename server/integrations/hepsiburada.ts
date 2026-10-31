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
import { basicAuth, ProviderHttp, requireCredential } from './http'

/**
 * Hepsiburada's current authentication, for every service: Basic merchant ID : service key
 * (the key the seller creates for an integrator under Bilgilerim → Entegrasyon → Entegratör
 * Bilgileri) and that integrator's username as the required User-Agent.
 */
export function hepsiburadaHeaders(context: AdapterContext) {
  return {
    authorization: basicAuth(
      requireCredential(context.credentials, 'merchantId'),
      requireCredential(context.credentials, 'password'),
    ),
    'user-agent': requireCredential(context.credentials, 'username'),
  }
}

export class HepsiburadaAdapter implements ProviderAdapter {
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
    const merchant = pathPart(requireCredential(context.credentials, 'merchantId'))
    const suffix = context.settings.environment === 'sandbox' ? '-sit' : ''
    const listingBase = `https://listing-external${suffix}.hepsiburada.com`
    const orderBase = `https://oms-external${suffix}.hepsiburada.com`
    const catalogBase = `https://mpop${suffix}.hepsiburada.com/product`
    const headers = hepsiburadaHeaders(context)
    if (operation === 'test' || operation === 'catalog.pull') {
      const page = integer(payload.page),
        size = operation === 'test' ? 1 : 50
      const response = record(
        await this.http.request(
          `${catalogBase}/api/products/all-products-of-merchant/${merchant}?page=${page}&size=${size}`,
          { headers },
        ),
      )
      if (response.success !== true || !Array.isArray(response.data))
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Hepsiburada katalog yanıtı başarısız veya beklenen biçimde değil.',
        )
      if (operation === 'test')
        return { message: 'Hepsiburada kimlik doğrulaması ve mağaza katalog okuması başarılı.' }
      const items = response.data.map(record)
      const query = new URLSearchParams({
        offset: '0',
        limit: '100',
        merchantSkuList: items.map((item) => text(item.merchantSku)).join(','),
      })
      const stockResponse = items.length
        ? record(
            await this.http.request(`${listingBase}/listings/merchantid/${merchant}?${query}`, {
              headers,
            }),
          )
        : { listings: [] }
      if (!Array.isArray(stockResponse.listings))
        throw new ProviderError('INVALID_RESPONSE', 'Hepsiburada ilan stokları okunamadı.')
      const listings = stockResponse.listings.map(record)
      const products = items.map((item): RemoteProduct => {
        const stock = listings.find(
          (entry) => entry.merchantSku === item.merchantSku && entry.hepsiburadaSku === item.hbSku,
        )
        const price = cents(stock?.price ?? item.price)
        if (!text(item.hbSku) || !text(item.productName) || !Number.isFinite(price))
          throw new ProviderError(
            'INVALID_PRODUCT',
            'Hepsiburada ürün kodu, adı veya fiyatı eksik.',
          )
        return {
          externalId: `${text(item.hbSku)}:${text(item.merchantSku)}`,
          sku: text(item.merchantSku),
          barcode: text(item.barcode),
          title: text(item.productName),
          price,
          quantity: Math.max(0, integer(stock?.availableStock)),
          brand: text(item.brand),
          category: text(item.categoryName),
          categoryId: text(item.categoryId),
          images: urls(item.images),
          taxRate: item.tax === undefined ? undefined : integer(item.tax),
          attributes: { hepsiburadaSku: text(item.hbSku) },
          status: stock?.isSalable
            ? 'active'
            : stock?.isLocked || item.status === 'REJECTED'
              ? 'rejected'
              : 'pending',
        }
      })
      return {
        message: `${products.length} Hepsiburada ürünü okundu.`,
        products,
        ...(response.last === false || page + 1 < integer(response.totalPages)
          ? { nextPayload: { ...payload, page: page + 1 }, delaySeconds: 2 }
          : {}),
      }
    }
    if (operation === 'inventory.push') {
      const listing = context.state.listings.find(
        (item) => item.id === payload.listingId && item.storeId === context.connectionId,
      )
      const found = listing ? findVariant(context.state, listing.variantId) : undefined
      const hbSku = text(listing?.attributes?.hepsiburadaSku)
      if (!listing?.externalSku || !hbSku || !found)
        throw new ProviderError('MAPPING_REQUIRED', 'Hepsiburada ve satıcı stok kodları eşlenmeli.')
      if (payload.verify) {
        const query = new URLSearchParams({
          offset: '0',
          limit: '10',
          merchantSkuList: listing.externalSku,
          hbSkuList: hbSku,
        })
        const response = record(
          await this.http.request(`${listingBase}/listings/merchantid/${merchant}?${query}`, {
            headers,
          }),
        )
        const actual = array(response.listings)
          .map(record)
          .find((item) => item.merchantSku === listing.externalSku && item.hepsiburadaSku === hbSku)
        if (
          actual &&
          integer(actual.availableStock, -1) === payload.expectedQuantity &&
          cents(actual.price) === payload.expectedPrice
        )
          return {
            message: 'Hepsiburada stok ve fiyatı yeniden okunarak doğrulandı.',
            reference: text(payload.reference),
            listingStatus: payload.archive ? 'archived' : 'active',
          }
        return {
          message: 'Hepsiburada stok/fiyat yansıması bekleniyor.',
          nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
          delaySeconds: 8,
        }
      }
      const archive =
        record(payload.inventoryPlan).archive ??
        payload.archive ??
        listing.desiredStatus === 'archived'
      const values = inventoryValues(context, listing, payload),
        quantity = archive ? 0 : values.quantity,
        price = values.price
      const response = record(
        await this.http.request(
          `${listingBase}/listings/merchantid/${merchant}/inventory-uploads`,
          {
            method: 'POST',
            headers,
            json: [
              {
                hepsiburadaSku: hbSku,
                merchantSku: listing.externalSku,
                availableStock: quantity,
                price: price / 100,
              },
            ],
            idempotent: true,
          },
        ),
      )
      return {
        message: 'Hepsiburada envanter isteği alındı; gerçek değerler doğrulanıyor.',
        reference: text(response.id),
        nextPayload: {
          ...payload,
          verify: true,
          expectedQuantity: quantity,
          expectedPrice: price,
          archive,
          reference: text(response.id),
          polls: 0,
        },
        delaySeconds: 5,
      }
    }
    if (operation === 'orders.pull') {
      if (payload.stage === 'detail') {
        const numbers = array(payload.numbers).map(text),
          index = integer(payload.index)
        const response = await this.http.request(
          `${orderBase}/orders/merchantid/${merchant}/ordernumber/${pathPart(numbers[index])}`,
          { headers },
        )
        const order = normalizeHepsiburadaOrder(response, context.credentials.merchantId)
        return {
          message: 'Hepsiburada sipariş detayı alındı.',
          orders: [order],
          nextPayload:
            index + 1 < numbers.length ? { ...payload, index: index + 1 } : record(payload.after),
          delaySeconds: 2,
        }
      }
      const source = integer(payload.source),
        offset = integer(payload.offset),
        to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - 7 * 86400000)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 14 * 86400000)
        throw new ProviderError(
          'INVALID_WINDOW',
          'Hepsiburada sorgusu en fazla 14 günlük aralıkta yapılır.',
        )
      const sources = [
        `orders/merchantid/${merchant}`,
        `orders/merchantid/${merchant}/cancelled`,
        `packages/merchantid/${merchant}`,
        `packages/merchantid/${merchant}/shipped`,
        `packages/merchantid/${merchant}/delivered`,
      ]
      if (source >= sources.length)
        return { message: 'Hepsiburada sipariş ve paket taraması tamamlandı.' }
      const size = source === 2 ? 10 : 100
      const query = new URLSearchParams({
        begindate: new Date(from).toISOString(),
        enddate: new Date(to).toISOString(),
        limit: String(size),
        offset: String(offset),
      })
      const raw = await this.http.request(`${orderBase}/${sources[source]}?${query}`, { headers })
      const response = record(raw),
        items = Array.isArray(raw) ? raw : array(response.items)
      if (!Array.isArray(raw) && !Array.isArray(response.items))
        throw new ProviderError('INVALID_RESPONSE', 'Hepsiburada sipariş listesi okunamadı.')
      const numbers = [
        ...new Set(
          items
            .flatMap((raw) => {
              const item = record(raw)
              return [
                text(item.orderNumber ?? item.OrderNumber),
                ...array(item.OrderNumbers ?? item.orderNumbers).map(text),
                ...array(item.items).map((line) => text(record(line).orderNumber)),
              ]
            })
            .filter(Boolean),
        ),
      ]
      const hasMore =
        items.length === size &&
        (Array.isArray(raw) || offset + items.length < integer(response.totalCount))
      const after = {
        from,
        to,
        source: hasMore ? source : source + 1,
        offset: hasMore ? offset + size : 0,
      }
      return {
        message: `${numbers.length} siparişin güncel detayı okunacak.`,
        nextPayload: numbers.length
          ? { ...payload, from, to, stage: 'detail', numbers, index: 0, after }
          : after,
        delaySeconds: 2,
      }
    }
    if (operation === 'invoice.link') {
      const order = context.state.orders.find(
        (item) => item.id === payload.orderId && item.storeId === context.connectionId,
      )
      const invoice = context.state.invoices.find((item) => item.id === order?.invoiceId)
      if (!order?.packageNumbers?.length || invoice?.status !== 'issued' || !invoice.url)
        throw new ProviderError(
          'PACKAGE_REQUIRED',
          'Hepsiburada paket numarası ve resmileşmiş fatura PDF’i gerekli.',
        )
      const index = integer(payload.index)
      await this.http.request(
        `${orderBase}/packages/merchantid/${merchant}/packagenumber/${pathPart(order.packageNumbers[index])}/invoice`,
        { method: 'PUT', headers, json: { invoiceLink: invoice.url }, idempotent: true },
      )
      return {
        message: 'Fatura Hepsiburada paketine iletildi.',
        ...(index + 1 < order.packageNumbers.length
          ? { nextPayload: { ...payload, index: index + 1 }, delaySeconds: 2 }
          : {}),
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Hepsiburada işlemi kullanıma açık değil.')
  }
}

export function normalizeHepsiburadaOrder(raw: unknown, merchantId: string): RemoteOrder {
  const data = record(raw),
    all = array(data.items)
      .map(record)
      .filter((item) => !item.merchantId || text(item.merchantId) === merchantId)
  if (!text(data.orderNumber) || !all.length)
    throw new ProviderError('INVALID_ORDER', 'Hepsiburada siparişi veya satıcı kalemleri eksik.')
  const notCancelled = all.filter((line) => !/^cancelled|^canceled/i.test(text(line.status)))
  const items = notCancelled.length ? notCancelled : all
  const address = record(data.deliveryAddress ?? items[0].shippingAddress),
    billing = record(data.invoice ?? items[0].invoice),
    ba = record(billing.address)
  const statuses = items.map((item) => text(item.status).toLowerCase())
  const status =
    notCancelled.length === 0
      ? 'cancelled'
      : statuses.every((s) => s === 'delivered')
        ? 'delivered'
        : statuses.every((s) => ['shipped', 'intransit', 'delivered'].includes(s))
          ? 'shipped'
          : 'pending'
  const lines = items.map((line) => {
    const amount = record(line.totalPrice),
      unit = record(line.unitPrice),
      quantity = integer(line.quantity),
      total = cents(amount.amount),
      unitPrice = cents(unit.amount)
    if (
      quantity < 1 ||
      !Number.isFinite(total) ||
      !Number.isFinite(unitPrice) ||
      (amount.currency && amount.currency !== 'TRY')
    )
      throw new ProviderError(
        'INVALID_ORDER_LINE',
        'Hepsiburada kaleminin miktarı veya TL tutarı okunamadı.',
      )
    return {
      externalId: text(line.id),
      sku: text(line.merchantSKU ?? line.merchantSku),
      barcode: text(line.productBarcode),
      title: text(line.name),
      quantity,
      unitPrice,
      total,
      taxRate: integer(line.vatRate),
      status: /^cancelled|^canceled/i.test(text(line.status))
        ? ('cancelled' as const)
        : text(line.status).toLowerCase() === 'delivered'
          ? ('delivered' as const)
          : ['shipped', 'intransit'].includes(text(line.status).toLowerCase())
            ? ('shipped' as const)
            : ('pending' as const),
    }
  })
  return {
    externalId: text(data.orderNumber),
    number: text(data.orderNumber),
    createdAt: iso(data.orderDate ?? data.createdDate),
    modifiedAt: items
      .map((item) => iso(item.lastStatusUpdateDate ?? data.orderDate))
      .sort()
      .at(-1)!,
    status,
    normalizedStatus: status,
    total: lines.reduce((sum, line) => sum + line.total, 0),
    shipping: 0,
    recipient: {
      name: text(address.name) || text(record(data.customer).name),
      address: text(address.address),
      city: text(address.city),
      district: text(address.town),
      phone: text(address.phoneNumber),
      country: text(address.countryCode) || 'TR',
      email: text(address.email),
    },
    billing: {
      name: text(ba.name),
      address: text(ba.address),
      city: text(ba.city),
      district: text(ba.town),
      phone: text(ba.phoneNumber),
      taxId: text(billing.taxNumber ?? billing.turkishIdentityNumber),
      taxOffice: text(billing.taxOffice),
    },
    lines,
    trackingNumber: text(items[0].barcode),
    cargoProvider: text(items[0].cargoCompany),
    packageNumbers: [...new Set(items.map((item) => text(item.packageNumber)).filter(Boolean))],
  }
}
