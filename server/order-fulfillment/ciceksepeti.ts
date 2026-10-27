import type { Order } from '../../src/domain/types'
import type { OrderFulfillmentPlan, OrderFulfillmentView } from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { normalizeCiceksepetiOrder } from '../integrations/ciceksepeti'
import { ProviderError } from '../errors'
import type { MarketplaceFulfillmentAdapter } from './contracts'
import { fulfillmentRemoteKey } from './contracts'

export class CiceksepetiFulfillment implements MarketplaceFulfillmentAdapter {
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext) {
    return {
      base: `https://${context.settings.environment === 'sandbox' ? 'sandbox-apis' : 'apis'}.ciceksepeti.com/api/v1`,
      headers: {
        'x-api-key': requireCredential(context.credentials, 'apiKey'),
        'user-agent': `${requireCredential(context.credentials, 'sellerId')}-${context.integrationName}`,
      },
    }
  }
  private async read(context: AdapterContext, order: Order) {
    const { base, headers } = this.api(context),
      response = record(
        await this.http.request(`${base}/Order/GetOrders`, {
          method: 'POST',
          headers,
          json: { orderItemNo: Number(order.externalId), pageSize: 100, page: 0 },
          idempotent: true,
        }),
      )
    const matches = array(response.supplierOrderListWithBranch)
      .map(record)
      .filter((item) => text(item.orderItemId) === order.externalId)
    if (matches.length !== 1)
      throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'Çiçeksepeti alt siparişi doğrulanamadı.')
    const raw = matches[0],
      own = raw.cargoModelType === 2,
      market = raw.cargoModelType === 1,
      number = text(raw.partialNumber) || text(raw.cargoNumber),
      status = remoteInteger(raw.orderItemStatusId)
    const view: OrderFulfillmentView = {
      provider: 'ciceksepeti',
      orderNumber: text(raw.orderId),
      packages: number
        ? [
            {
              id: number,
              number,
              status: text(raw.orderProductStatus) || String(status),
              carrier: text(raw.cargoCompany),
              trackingNumber: text(raw.cargoNumber) || number,
              trackingUrl: text(raw.shipmentTrackingUrl),
              lines: [{ id: text(raw.orderItemId), quantity: remoteInteger(raw.quantity) }],
            },
          ]
        : [],
      lines: [
        {
          id: text(raw.orderItemId),
          name: text(raw.name),
          sku: text(raw.code),
          quantity: remoteInteger(raw.quantity),
          status: String(status),
          packable:
            raw.isOrderStatusActive !== false &&
            (market ? status === 1 : own && [1, 2, 11].includes(status)),
          cancellable: false,
        },
      ],
      actions:
        market && !context.settings.cargoConnectionId
          ? ['pack']
          : own && context.settings.cargoConnectionId
            ? ['ship']
            : [],
      shipCreatesPackage: own,
      cancellationReasons: [],
      carriers: own
        ? [
            { id: '1', label: 'DHL eCommerce / MNG', contracted: false },
            { id: '2', label: 'Yurtiçi Kargo', contracted: false },
            { id: '43', label: 'Aras Kargo', contracted: false },
            { id: '44', label: 'PTT Kargo', contracted: false },
          ]
        : undefined,
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
      status = remoteInteger(raw.orderItemStatusId)
    const confirmed =
      plan.action === 'pack'
        ? !!raw.partialNumber && [11, 5, 7].includes(status)
        : plan.action === 'ship'
          ? [5, 7].includes(status) &&
            text(raw.cargoNumber) === plan.trackingNumber &&
            text(raw.shipmentTrackingUrl) === plan.trackingUrl
          : false
    const result = (message: string, done: boolean): AdapterResult => ({
      message,
      orderFulfillment: { orderId: order.id, confirmed: done, packages: view.packages },
      ...(done
        ? { orders: [normalizeCiceksepetiOrder(raw)] }
        : {
            nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
            delaySeconds: 61,
          }),
    })
    if (confirmed) return result('Çiçeksepeti kargo kodu/durumu alt siparişten doğrulandı.', true)
    if (checking) return result('Çiçeksepeti kargo sonucu izleniyor.', false)
    if (
      view.fingerprint !== plan.remoteKey ||
      !view.actions.includes(plan.action) ||
      !view.lines[0].packable
    )
      throw new ProviderError(
        'FULFILLMENT_STALE',
        'Çiçeksepeti alt siparişi veya kargo modeli değişti.',
      )
    if (plan.action === 'pack') {
      const response = record(
        await this.http.request(`${base}/Order/readyforcargowithcsintegration`, {
          method: 'PUT',
          headers,
          json: { orderItemsGroup: [{ orderItemIds: [Number(order.externalId)] }] },
        }),
      )
      const rows = array(response.statusUpdateResponse).map(record)
      if (
        rows.length !== 1 ||
        rows[0].isSuccess !== true ||
        !array(rows[0].orderItems).some(
          (item) => text(record(item).orderItemId) === order.externalId,
        )
      )
        throw new ProviderError(
          'CARGO_RESULT_UNCERTAIN',
          'Çiçeksepeti kargo oluşturma satırı doğrulanamadı.',
          false,
          undefined,
          true,
        )
    } else if (plan.action === 'ship') {
      if (
        !plan.trackingNumber ||
        !plan.trackingUrl ||
        !view.carriers?.some((carrier) => carrier.id === plan.carrierId)
      )
        throw new ProviderError(
          'TRACKING_REQUIRED',
          'Çiçeksepeti kargo firması, takip numarası ve bağlantısı gerekli.',
        )
      const response = record(
        await this.http.request(`${base}/Order/statusupdatewithsupplierintegration`, {
          method: 'PUT',
          headers,
          json: {
            orderItems: [
              {
                orderItemId: Number(order.externalId),
                orderItemStatusId: 5,
                cargoBusinessId: Number(plan.carrierId),
                shipmentNumber: plan.trackingNumber,
                shipmentTrackingUrl: plan.trackingUrl,
              },
            ],
          },
        }),
      )
      if (
        response.isSuccess === false ||
        array(response.statusUpdateResponse).some((row) => record(row).isSuccess === false)
      )
        throw new ProviderError('SHIPMENT_REJECTED', 'Çiçeksepeti kargo bildirimini reddetti.')
    } else throw new ProviderError('ACTION_UNAVAILABLE', 'Çiçeksepeti bu kargo işlemini sunmuyor.')
    return result('Çiçeksepeti isteği aldı; dakikalık sipariş sorgusuyla doğrulanacak.', false)
  }
}
