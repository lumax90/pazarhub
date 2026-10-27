import type {
  IntegrationOperation,
  RemoteOrder,
  RemoteProduct,
} from '../../src/domain/integrations'
import { findVariant } from '../../src/domain/selectors'
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
import { accessToken } from './oauth'

export const AMAZON_TR = 'A33AVAJ2PDY3EV'
export class AmazonAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'catalog.pull',
    'orders.pull',
    'inventory.push',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    const token = await accessToken(context, this.http, 'https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      refresh_token: requireCredential(context.credentials, 'refreshToken'),
      client_id: requireCredential(context.credentials, 'clientId'),
      client_secret: requireCredential(context.credentials, 'clientSecret'),
    })
    const base =
      context.settings.environment === 'sandbox'
        ? 'https://sandbox.sellingpartnerapi-eu.amazon.com'
        : 'https://sellingpartnerapi-eu.amazon.com'
    const headers = {
      'x-amz-access-token': token,
      'user-agent': `${context.integrationName}/0.2 (Language=TypeScript)`,
    }
    const seller = pathPart(requireCredential(context.credentials, 'sellerId'))
    if (operation === 'test') {
      const response = record(
        await this.http.request(`${base}/sellers/v1/marketplaceParticipations`, { headers }),
      )
      if (
        !Array.isArray(response.payload) ||
        !response.payload.some((raw) => record(record(raw).marketplace).id === AMAZON_TR)
      )
        throw new ProviderError(
          'MARKETPLACE_NOT_ENABLED',
          'Amazon Türkiye pazaryeri bu hesapta doğrulanamadı.',
        )
      return {
        message:
          'Amazon Türkiye satıcı katılımı doğrulandı. Katalog ve sipariş izinleri kendi işlemlerinde kontrol edilir.',
      }
    }
    if (operation === 'catalog.pull') {
      const query = new URLSearchParams({
        marketplaceIds: AMAZON_TR,
        includedData: 'summaries,attributes,offers,fulfillmentAvailability',
        pageSize: '20',
        ...(payload.nextToken ? { pageToken: text(payload.nextToken) } : {}),
      })
      const response = record(
        await this.http.request(`${base}/listings/2021-08-01/items/${seller}?${query}`, {
          headers,
        }),
      )
      if (!Array.isArray(response.items))
        throw new ProviderError('INVALID_RESPONSE', 'Amazon ilan yanıtı okunamadı.')
      const products = response.items.map(normalizeAmazonProduct)
      const nextToken = text(record(response.pagination).nextToken)
      return {
        message: `${products.length} Amazon teklifi okundu.`,
        products,
        ...(nextToken ? { nextPayload: { ...payload, nextToken }, delaySeconds: 2 } : {}),
      }
    }
    if (operation === 'orders.pull') {
      const to = Math.min(Number(payload.to ?? Date.now() - 180000), Date.now() - 180000),
        from = Number(payload.from ?? to - 7 * 86400000)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
        throw new ProviderError('INVALID_WINDOW', 'Amazon sorgu tarihlerini kontrol edin.')
      const query = new URLSearchParams({
        marketplaceIds: AMAZON_TR,
        fulfilledBy: 'MERCHANT',
        lastUpdatedAfter: new Date(from).toISOString(),
        lastUpdatedBefore: new Date(to).toISOString(),
        maxResultsPerPage: '50',
        includedData: 'BUYER,RECIPIENT,PROCEEDS,FULFILLMENT,TAX,PACKAGES',
        fulfillmentStatuses: 'UNSHIPPED,PARTIALLY_SHIPPED,SHIPPED,CANCELLED',
        ...(payload.nextToken ? { paginationToken: text(payload.nextToken) } : {}),
      })
      const response = record(
        await this.http.request(`${base}/orders/2026-01-01/orders?${query}`, { headers }),
      )
      if (!Array.isArray(response.orders))
        throw new ProviderError('INVALID_RESPONSE', 'Amazon 2026 sipariş yanıtı okunamadı.')
      const orders = response.orders.map(normalizeAmazonOrder),
        nextToken = text(record(response.pagination).nextToken)
      return {
        message: `${orders.length} Amazon satıcı gönderimli sipariş okundu.`,
        orders,
        ...(nextToken
          ? { nextPayload: { ...payload, from, to, nextToken }, delaySeconds: 60 }
          : {}),
      }
    }
    if (operation === 'inventory.push') {
      const listing = context.state.listings.find(
        (item) => item.id === payload.listingId && item.storeId === context.connectionId,
      )
      const found = listing ? findVariant(context.state, listing.variantId) : undefined
      if (!listing?.externalSku || !found)
        throw new ProviderError('MAPPING_REQUIRED', 'Amazon SKU eşlemesi gerekli.')
      if (listing.attributes?.fulfillmentChannel !== 'DEFAULT')
        throw new ProviderError(
          'FBA_STOCK_MANAGED',
          'Yalnız satıcı gönderimli Amazon tekliflerinin stoğu yönetilebilir.',
        )
      const endpoint = `${base}/listings/2021-08-01/items/${seller}/${pathPart(listing.externalSku)}?marketplaceIds=${AMAZON_TR}`
      if (payload.verify) {
        const response = await this.http.request(
          `${endpoint}&includedData=summaries,offers,fulfillmentAvailability`,
          { headers },
        )
        const actual = normalizeAmazonProduct(response)
        if (actual.price === payload.expectedPrice && actual.quantity === payload.expectedQuantity)
          return {
            message: 'Amazon stok/fiyat değerleri yeniden okunarak doğrulandı.',
            reference: text(payload.reference),
            listingStatus: payload.archive ? 'archived' : 'active',
          }
        return {
          message: 'Amazon teklif güncellemesi işleniyor.',
          nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
          delaySeconds: 15,
        }
      }
      const archive =
          record(payload.inventoryPlan).archive ??
          payload.archive ??
          listing.desiredStatus === 'archived',
        values = inventoryValues(context, listing, payload),
        quantity = archive ? 0 : values.quantity,
        price = values.price
      const response = record(
        await this.http.request(endpoint, {
          method: 'PATCH',
          headers,
          idempotent: true,
          json: {
            productType: text(listing.attributes?.productType) || 'PRODUCT',
            patches: [
              {
                op: 'replace',
                path: '/attributes/fulfillment_availability',
                value: [{ fulfillment_channel_code: 'DEFAULT', quantity }],
              },
              {
                op: 'replace',
                path: '/attributes/purchasable_offer',
                value: [
                  {
                    marketplace_id: AMAZON_TR,
                    currency: 'TRY',
                    our_price: [{ schedule: [{ value_with_tax: price / 100 }] }],
                  },
                ],
              },
            ],
          },
        }),
      )
      if (
        response.status !== 'ACCEPTED' ||
        array(response.issues).some((item) => record(item).severity === 'ERROR')
      )
        throw new ProviderError(
          'LISTING_REJECTED',
          'Amazon teklif güncellemesini reddetti. SKU, ürün türü ve fiyat bilgilerini kontrol edin.',
        )
      return {
        message: 'Amazon isteği kabul etti; teklif değerleri doğrulanıyor.',
        reference: text(response.submissionId),
        nextPayload: {
          ...payload,
          verify: true,
          expectedPrice: price,
          expectedQuantity: quantity,
          archive,
          reference: text(response.submissionId),
          polls: 0,
        },
        delaySeconds: 15,
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Amazon işlemi kullanıma açık değil.')
  }
}

export function normalizeAmazonProduct(raw: unknown): RemoteProduct {
  const item = record(raw),
    summary =
      array(item.summaries)
        .map(record)
        .find((s) => s.marketplaceId === AMAZON_TR) ?? {},
    attributes = record(item.attributes)
  const offer =
      array(item.offers)
        .map(record)
        .find((entry) => entry.marketplaceId === AMAZON_TR) ?? {},
    price = cents(record(offer.price).amount)
  const inventory = array(item.fulfillmentAvailability)
    .map(record)
    .find((entry) => entry.fulfillmentChannelCode === 'DEFAULT')
  if (!text(item.sku) || !Number.isFinite(price))
    throw new ProviderError('INVALID_PRODUCT', 'Amazon teklifinin SKU veya TRY fiyatı eksik.')
  if (record(offer.price).currencyCode !== 'TRY')
    throw new ProviderError('CURRENCY_MISMATCH', 'Amazon teklifi TRY para biriminde olmalı.')
  return {
    externalId: text(item.sku),
    sku: text(item.sku),
    barcode: text(record(array(attributes.externally_assigned_product_identifier)[0]).value),
    title: text(summary.itemName) || text(item.sku),
    price,
    quantity: Math.max(0, integer(inventory?.quantity)),
    images: urls([record(summary.mainImage).link]),
    asin: text(summary.asin),
    attributes: {
      productType: text(summary.productType),
      fulfillmentChannel: inventory ? 'DEFAULT' : 'AMAZON',
    },
    status: array(summary.status).includes('BUYABLE') ? 'active' : 'pending',
  }
}
export function normalizeAmazonOrder(raw: unknown): RemoteOrder {
  const item = record(raw),
    address = record(record(item.recipient).deliveryAddress),
    buyer = record(item.buyer),
    fulfillment = record(item.fulfillment)
  const totalMoney = record(record(item.proceeds).grandTotal),
    total = cents(totalMoney.amount)
  if (!text(item.orderId) || !Number.isFinite(total) || totalMoney.currencyCode !== 'TRY')
    throw new ProviderError('INVALID_ORDER', 'Amazon sipariş kimliği veya TRY tutarı okunamadı.')
  const lines = array(item.orderItems).map((raw) => {
    const line = record(raw),
      product = record(line.product),
      proceeds = record(line.proceeds),
      quantity = integer(line.quantityOrdered),
      amount = record(proceeds.proceedsTotal),
      total = cents(amount.amount)
    if (
      quantity < 1 ||
      !text(line.orderItemId) ||
      !Number.isFinite(total) ||
      amount.currencyCode !== 'TRY'
    )
      throw new ProviderError(
        'INVALID_ORDER_LINE',
        'Amazon sipariş kaleminin miktar veya tutarı eksik.',
      )
    return {
      externalId: text(line.orderItemId),
      sku: text(product.sellerSku),
      barcode: '',
      title: text(product.title),
      quantity,
      unitPrice: Math.round(total / quantity),
      total,
    }
  })
  const pkg = record(array(item.packages)[0]),
    status = text(fulfillment.fulfillmentStatus)
  return {
    externalId: text(item.orderId),
    number: text(item.orderId),
    createdAt: iso(item.createdTime),
    modifiedAt: iso(item.lastUpdatedTime),
    status,
    normalizedStatus:
      status === 'CANCELLED' ? 'cancelled' : status === 'SHIPPED' ? 'shipped' : 'pending',
    total,
    shipping: 0,
    recipient: {
      name: text(address.name) || text(buyer.buyerName),
      address: [text(address.addressLine1), text(address.addressLine2), text(address.addressLine3)]
        .filter(Boolean)
        .join(' '),
      city: text(address.city) || text(address.stateOrRegion),
      district: text(address.districtOrCounty),
      phone: text(address.phone),
      country: text(address.countryCode) || 'TR',
      email: text(buyer.buyerEmail),
    },
    lines,
    trackingNumber: text(pkg.trackingNumber),
    cargoProvider: text(pkg.carrier),
  }
}
