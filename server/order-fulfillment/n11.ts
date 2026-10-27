import type { Order } from '../../src/domain/types'
import type { OrderFulfillmentPlan, OrderFulfillmentView } from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { normalizeN11Order } from '../integrations/n11'
import { soapArray, soapCall } from '../integrations/soap'
import { ProviderError } from '../errors'
import { n11Headers } from '../integrations/n11-api'
import type { MarketplaceFulfillmentAdapter } from './contracts'
import { fulfillmentRemoteKey, isCancelled, packageStatus } from './contracts'

export class N11Fulfillment implements MarketplaceFulfillmentAdapter {
  constructor(private readonly http: ProviderHttp) {}
  private headers(context: AdapterContext) {
    n11Headers(context)
    return {
      appKey: requireCredential(context.credentials, 'appKey'),
      appSecret: requireCredential(context.credentials, 'appSecret'),
    }
  }
  private soap(
    context: AdapterContext,
    operation: string,
    body: Record<string, unknown> = {},
    safe = false,
  ) {
    return soapCall(
      this.http,
      'https://api.n11.com/ws/claimCancelService/',
      'http://www.n11.com/ws/schemas',
      operation,
      { auth: this.headers(context), ...body },
      { requestName: `${operation}Request`, action: '', safe },
    )
  }
  private async read(context: AdapterContext, order: Order) {
    const all: Record<string, unknown>[] = []
    for (let page = 0; page < 100; page++) {
      const response = record(
        await this.http.request(
          `https://api.n11.com/rest/delivery/v1/shipmentPackages?${new URLSearchParams({ orderNumber: order.externalNumber!, sender: 'SELLER', page: String(page), size: '100' })}`,
          { headers: this.headers(context) },
        ),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_ORDER', 'n11 paket yanıtı okunamadı.')
      all.push(
        ...response.content
          .map(record)
          .filter((item) => text(item.orderNumber) === order.externalNumber),
      )
      if (page + 1 >= remoteInteger(response.totalPages, 1) || !response.content.length) break
      if (page === 99)
        throw new ProviderError('PAGING_LIMIT', 'n11 sipariş paketleri tamamlanamadı.')
    }
    const raw = all.find((item) => text(item.id) === order.externalId)
    if (!raw) throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'n11 sipariş paketi bulunamadı.')
    const lines = array(raw.lines).map(record),
      status = text(raw.shipmentPackageStatus)
    let reasons: { id: string; label: string }[] = []
    if (
      lines.some((line) => line.orderItemLineItemStatusName === 'Picking') ||
      status === 'Picking'
    ) {
      const response = await this.soap(context, 'ClaimCancelPartialReasonType', {}, true)
      if (record(response.result).status !== 'success')
        throw new ProviderError('REASONS_REQUIRED', 'n11 iptal nedenleri alınamadı.')
      reasons = soapArray(record(response.cancelReasonTypeDataList).cancelReasonTypeData)
        .map(record)
        .map((reason) => ({ id: text(reason.id), label: text(reason.value) }))
    }
    const view: OrderFulfillmentView = {
      provider: 'n11',
      orderNumber: text(raw.orderNumber),
      packages: [
        {
          id: text(raw.id),
          number: text(raw.id),
          status,
          trackingNumber: text(raw.cargoSenderNumber) || text(raw.cargoTrackingNumber),
          trackingUrl: text(raw.cargoTrackingLink),
          carrier: text(raw.cargoProviderName),
          lines: lines.map((line) => ({
            id: text(line.orderLineId),
            quantity: remoteInteger(line.quantity),
          })),
        },
      ],
      lines: lines.map((line) => ({
        id: text(line.orderLineId),
        name: text(line.productName),
        sku: text(line.stockCode),
        quantity: remoteInteger(line.quantity),
        status: text(line.orderItemLineItemStatusName) || status,
        packageId: text(raw.id),
        packable: (line.orderItemLineItemStatusName || status) === 'Created',
        cancellable: (line.orderItemLineItemStatusName || status) === 'Picking',
      })),
      actions: ['pack', 'cancel'],
      cancellationReasons: reasons,
      fingerprint: fulfillmentRemoteKey(all),
    }
    return { raw, all, view }
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
    const { raw, all, view } = await this.read(context, order)
    const confirmed =
      plan.action === 'pack'
        ? plan.lines.every((selected) =>
            view.lines.some(
              (line) =>
                line.id === selected.id &&
                ['picking', 'shipped', 'delivered'].includes(packageStatus(line.status)),
            ),
          )
        : plan.action === 'cancel'
          ? plan.lines.every((selected) =>
              all.some((pkg) =>
                array(pkg.lines).some((item) => {
                  const line = record(item)
                  return (
                    text(line.orderLineId) === selected.id &&
                    isCancelled(line.orderItemLineItemStatusName || pkg.shipmentPackageStatus)
                  )
                }),
              ),
            )
          : false
    const result = (message: string, done: boolean): AdapterResult => ({
      message,
      orderFulfillment: { orderId: order.id, confirmed: done, packages: view.packages },
      ...(done
        ? { orders: [normalizeN11Order(raw)] }
        : {
            nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
            delaySeconds: 15,
          }),
    })
    if (confirmed) return result('n11 kalem işlemi güncel siparişten doğrulandı.', true)
    if (checking) return result('n11 işlem sonucu yeniden yazılmadan kontrol ediliyor.', false)
    if (view.fingerprint !== plan.remoteKey)
      throw new ProviderError('FULFILLMENT_STALE', 'n11 sipariş kalemleri değişti.')
    if (plan.action === 'pack') {
      if (
        plan.lines.some(
          (selected) => !view.lines.some((line) => line.id === selected.id && line.packable),
        )
      )
        throw new ProviderError('LINES_CHANGED', 'n11 kalemleri onaylanabilir durumda değil.')
      const response = record(
        await this.http.request('https://api.n11.com/rest/order/v1/update', {
          method: 'PUT',
          headers: this.headers(context),
          json: {
            lines: plan.lines.map((line) => ({ lineId: Number(line.id) })),
            status: 'Picking',
          },
        }),
      )
      const rows = array(response.content).map(record)
      if (rows.length !== plan.lines.length || rows.some((row) => row.status !== 'SUCCESS'))
        throw new ProviderError(
          'PARTIAL_ORDER_RESULT',
          'n11 onay sonucu kısmi veya belirsiz; kalemleri sorgulayarak doğrulayın.',
          false,
          undefined,
          true,
        )
    } else if (plan.action === 'cancel') {
      const selected = plan.lines[0],
        reason = view.cancellationReasons.find((reason) => reason.id === plan.reasonId)
      if (
        plan.lines.length !== 1 ||
        !reason ||
        !view.lines.some(
          (line) =>
            line.id === selected.id && line.quantity === selected.quantity && line.cancellable,
        )
      )
        throw new ProviderError(
          'CANCELLATION_INVALID',
          'n11 için onaylı tek bir tam kalem ve iptal nedeni seçin.',
        )
      const response = await this.soap(context, 'ClaimCancelPartial', {
        orderItemId: Number(selected.id),
        cancelQuantity: selected.quantity,
        cancelReasonTypeId: Number(reason.id),
        cancelReasonDescription: reason.label,
      })
      if (record(response.result).status !== 'success')
        throw new ProviderError(
          'CANCELLATION_REJECTED',
          text(record(response.result).errorMessage) || 'n11 iptal talebini kabul etmedi.',
        )
    } else throw new ProviderError('ACTION_UNAVAILABLE', 'n11 bu paket işlemini sunmuyor.')
    return result('n11 kalem isteğini aldı; sonucu kontrol ediliyor.', false)
  }
}
