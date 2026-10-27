import type { Order } from '../../src/domain/types'
import type {
  MarketplacePackage,
  OrderFulfillmentPlan,
  OrderFulfillmentView,
} from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { accessToken } from '../integrations/oauth'
import { AMAZON_TR, normalizeAmazonOrder } from '../integrations/amazon'
import { ProviderError } from '../errors'
import type { MarketplaceFulfillmentAdapter } from './contracts'
import { fulfillmentRemoteKey } from './contracts'

export class AmazonFulfillment implements MarketplaceFulfillmentAdapter {
  constructor(private readonly http: ProviderHttp) {}
  private async api(context: AdapterContext) {
    const token = await accessToken(context, this.http, 'https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      refresh_token: requireCredential(context.credentials, 'refreshToken'),
      client_id: requireCredential(context.credentials, 'clientId'),
      client_secret: requireCredential(context.credentials, 'clientSecret'),
    })
    return {
      base: `https://${context.settings.environment === 'sandbox' ? 'sandbox.' : ''}sellingpartnerapi-eu.amazon.com`,
      headers: { 'x-amz-access-token': token, 'user-agent': `${context.integrationName}/0.3` },
    }
  }
  private async read(context: AdapterContext, order: Order) {
    const { base, headers } = await this.api(context),
      response = record(
        await this.http.request(
          `${base}/orders/2026-01-01/orders/${encodeURIComponent(order.externalId!)}?includedData=BUYER,RECIPIENT,PROCEEDS,FULFILLMENT,TAX,PACKAGES`,
          { headers },
        ),
      ),
      raw = record(response.order),
      fulfillment = record(raw.fulfillment)
    if (
      text(raw.orderId) !== order.externalId ||
      fulfillment.fulfilledBy !== 'MERCHANT' ||
      record(raw.salesChannel).marketplaceId !== AMAZON_TR
    )
      throw new ProviderError(
        'ORDER_IDENTITY_MISMATCH',
        'Amazon Türkiye satıcı gönderimli siparişi doğrulanamadı.',
      )
    const packages: MarketplacePackage[] = array(raw.packages)
      .map(record)
      .map((item) => ({
        id: text(item.packageReferenceId),
        number: text(item.packageReferenceId),
        status: text(record(item.packageStatus).status),
        carrier: text(item.carrier),
        trackingNumber: text(item.trackingNumber),
        lines: array(item.packageItems)
          .map(record)
          .map((line) => ({ id: text(line.orderItemId), quantity: remoteInteger(line.quantity) })),
      }))
    const view: OrderFulfillmentView = {
      provider: 'amazon',
      orderNumber: order.externalId!,
      packages,
      lines: array(raw.orderItems)
        .map(record)
        .map((item) => {
          const unfulfilled = remoteInteger(record(item.fulfillment).quantityUnfulfilled),
            quantity =
              unfulfilled >= 0
                ? unfulfilled
                : remoteInteger(item.quantityOrdered) -
                  packages.reduce(
                    (sum, pkg) =>
                      sum +
                      pkg.lines
                        .filter((line) => line.id === text(item.orderItemId))
                        .reduce((n, line) => n + line.quantity, 0),
                    0,
                  )
          return {
            id: text(item.orderItemId),
            name: text(record(item.product).title),
            sku: text(record(item.product).sellerSku),
            quantity: Math.max(0, quantity),
            status: text(fulfillment.fulfillmentStatus),
            packable:
              ['UNSHIPPED', 'PARTIALLY_SHIPPED'].includes(text(fulfillment.fulfillmentStatus)) &&
              quantity > 0,
            cancellable: false,
          }
        }),
      actions: ['ship'],
      shipCreatesPackage: true,
      cancellationReasons: [],
      fingerprint: fulfillmentRemoteKey(raw),
    }
    return { raw, view, base, headers }
  }
  async load(context: AdapterContext, order: Order) {
    return (await this.read(context, order)).view
  }
  async execute(
    context: AdapterContext,
    order: Order,
    plan: OrderFulfillmentPlan,
    checking: boolean,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    const { raw, view, base, headers } = await this.read(context, order),
      matched = view.packages.find(
        (item) =>
          item.id === plan.reference &&
          item.trackingNumber === plan.trackingNumber &&
          item.lines.length === plan.lines.length &&
          item.lines.every((line) =>
            plan.lines.some(
              (selected) => selected.id === line.id && selected.quantity === line.quantity,
            ),
          ),
      )
    if (matched)
      return {
        message: 'Amazon paket ve takip bildirimi 2026 sipariş kaydından doğrulandı.',
        orderFulfillment: { orderId: order.id, confirmed: true, packages: view.packages },
        orders: [normalizeAmazonOrder(raw)],
      }
    const waiting: AdapterResult = {
      message: 'Amazon kargo bildirimi işleniyor; yeniden gönderilmeden doğrulanacak.',
      orderFulfillment: { orderId: order.id, confirmed: false, packages: view.packages },
      nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
      delaySeconds: 30,
    }
    if (checking) return waiting
    if (
      plan.action !== 'ship' ||
      view.fingerprint !== plan.remoteKey ||
      !plan.trackingNumber ||
      !plan.shippedAt ||
      !plan.carrierName ||
      !/^\d+$/.test(plan.reference) ||
      view.packages.some((item) => item.id === plan.reference) ||
      !plan.lines.length ||
      plan.lines.some(
        (selected) =>
          !view.lines.some(
            (line) =>
              line.id === selected.id && line.packable && line.quantity === selected.quantity,
          ),
      )
    )
      throw new ProviderError(
        'SHIPMENT_INVALID',
        'Amazon gönderim kalemleri, kargo firması, takip numarası ve tarihini kontrol edin.',
      )
    await this.http.request(
      `${base}/orders/v0/orders/${encodeURIComponent(order.externalId!)}/shipmentConfirmation`,
      {
        method: 'POST',
        headers,
        json: {
          marketplaceId: AMAZON_TR,
          packageDetail: {
            packageReferenceId: plan.reference,
            carrierCode: 'Other',
            carrierName: plan.carrierName,
            trackingNumber: plan.trackingNumber,
            shipDate: plan.shippedAt,
            orderItems: plan.lines.map((line) => ({
              orderItemId: line.id,
              quantity: line.quantity,
            })),
          },
        },
      },
    )
    return waiting
  }
}
