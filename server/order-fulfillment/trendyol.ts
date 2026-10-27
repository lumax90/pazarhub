import type { Order } from '../../src/domain/types'
import type {
  MarketplacePackage,
  OrderFulfillmentPlan,
  OrderFulfillmentView,
} from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import { basicAuth, ProviderHttp, requireCredential } from '../integrations/http'
import { normalizeTrendyolOrder } from '../integrations/trendyol'
import { ProviderError } from '../errors'
import type { MarketplaceFulfillmentAdapter } from './contracts'
import { fulfillmentRemoteKey, isCancelled, packageStatus } from './contracts'

export class TrendyolFulfillment implements MarketplaceFulfillmentAdapter {
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext) {
    const seller = requireCredential(context.credentials, 'sellerId')
    return {
      base: `https://${context.settings.environment === 'sandbox' ? 'stageapigw' : 'apigw'}.trendyol.com/integration`,
      seller: encodeURIComponent(seller),
      headers: {
        authorization: basicAuth(
          requireCredential(context.credentials, 'apiKey'),
          requireCredential(context.credentials, 'apiSecret'),
        ),
        'user-agent': `${seller} - ${context.integrationName}`,
      },
    }
  }
  private async read(context: AdapterContext, order: Order) {
    const { base, seller, headers } = this.api(context),
      all: Record<string, unknown>[] = []
    for (let page = 0; page < 20; page++) {
      const response = record(
        await this.http.request(
          `${base}/order/sellers/${seller}/orders?${new URLSearchParams({ orderNumber: order.externalNumber!, page: String(page), size: '200' })}`,
          { headers },
        ),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_ORDER', 'Trendyol paket yanıtı okunamadı.')
      all.push(
        ...response.content
          .map(record)
          .filter((item) => text(item.orderNumber) === order.externalNumber),
      )
      if (page + 1 >= remoteInteger(response.totalPages, 1)) break
      if (page === 19)
        throw new ProviderError('PAGING_LIMIT', 'Trendyol paket araması tamamlanamadı.')
    }
    const raw = all.find((item) => text(item.id) === order.externalId)
    if (!raw)
      throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'Trendyol sipariş paketi bulunamadı.')
    const lines = array(raw.lines).map(record),
      status = text(raw.status)
    const target: MarketplacePackage = {
      id: text(raw.id),
      number: text(raw.shipmentNumber) || text(raw.id),
      status,
      trackingNumber: text(raw.cargoTrackingNumber),
      trackingUrl: text(raw.cargoTrackingLink),
      carrier: text(raw.cargoProviderName),
      lines: lines.map((line) => ({ id: text(line.id), quantity: remoteInteger(line.quantity) })),
    }
    const view: OrderFulfillmentView = {
      provider: 'trendyol',
      orderNumber: text(raw.orderNumber),
      packages: [target],
      lines: lines.map((line) => ({
        id: text(line.id),
        name: text(line.productName),
        sku: text(line.merchantSku || line.sku),
        quantity: remoteInteger(line.quantity),
        status: text(line.orderLineItemStatusName) || status,
        packageId: target.id,
        packable: status === 'Created',
        cancellable:
          ['Created', 'Picking', 'Invoiced'].includes(status) &&
          !isCancelled(line.orderLineItemStatusName),
      })),
      actions: [
        'pack',
        'label',
        'cancel',
        ...(context.settings.cargoConnectionId ? ['ship' as const] : []),
      ],
      cancellationReasons: [
        { id: '500', label: 'Stok tükendi' },
        { id: '501', label: 'Kusurlu / defolu ürün' },
        { id: '502', label: 'Hatalı fiyat' },
        { id: '504', label: 'Entegrasyon hatası' },
        { id: '505', label: 'Toplu alım' },
        { id: '506', label: 'Mücbir sebep' },
      ],
      fingerprint: fulfillmentRemoteKey(all),
    }
    return { view, raw, all }
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
    const { base, seller, headers } = this.api(context),
      { view, raw, all } = await this.read(context, order),
      target = view.packages[0]
    if (plan.packageId && plan.packageId !== order.externalId)
      throw new ProviderError('PACKAGE_IDENTITY_MISMATCH', 'Paket bu yerel siparişe ait değil.')
    const currentStatus = packageStatus(target.status),
      active = all.filter((item) => !isCancelled(item.status))
    const cancellationConfirmed =
      isCancelled(currentStatus) &&
      plan.lines.every(
        (selected) =>
          !active.some((item) =>
            array(item.lines).some((value) => text(record(value).id) === selected.id),
          ),
      ) &&
      array(raw.lines)
        .map(record)
        .filter((line) => !plan.lines.some((selected) => selected.id === text(line.id)))
        .every((line) =>
          active.some((item) =>
            array(item.lines).some((value) => {
              const remaining = record(value)
              return (
                (text(remaining.id) === text(line.id) ||
                  text(remaining.barcode) === text(line.barcode)) &&
                remoteInteger(remaining.quantity) === remoteInteger(line.quantity)
              )
            }),
          ),
        )
    const confirmed =
      plan.action === 'pack'
        ? ['picking', 'invoiced', 'shipped', 'delivered'].includes(currentStatus)
        : plan.action === 'cancel'
          ? cancellationConfirmed
          : plan.action === 'ship'
            ? ['shipped', 'delivered'].includes(currentStatus) &&
              target.trackingUrl === plan.trackingUrl
            : false
    const result = (message: string, done: boolean): AdapterResult => ({
      message,
      orderFulfillment: { orderId: order.id, confirmed: done, packages: view.packages },
      ...(done
        ? {
            orders: [...all]
              .sort((a, b) => Number(isCancelled(b.status)) - Number(isCancelled(a.status)))
              .map(normalizeTrendyolOrder),
          }
        : {
            nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
            delaySeconds: 15,
          }),
    })
    if (confirmed) return result('Trendyol paket işlemi sağlayıcıdan doğrulandı.', true)
    if (plan.action === 'label') {
      if (!target.trackingNumber)
        throw new ProviderError('TRACKING_REQUIRED', 'Paketin Trendyol kargo kodu gerekli.')
      const endpoint = `${base}/sellers/${seller}/common-label/${encodeURIComponent(target.trackingNumber)}`
      let labels: Record<string, unknown>[] = []
      try {
        const response = record(await this.http.request(endpoint, { headers }))
        labels = array(response.data).map(record)
      } catch (error) {
        if (!(error instanceof ProviderError) || !['HTTP_404', 'HTTP_400'].includes(error.code))
          throw error
      }
      if (
        labels.length &&
        labels.every((label) => label.format === 'ZPL' && text(label.label).includes('^XA'))
      )
        return {
          ...result('Trendyol ortak kargo etiketleri alındı.', true),
          orderFulfillment: {
            orderId: order.id,
            confirmed: true,
            packages: view.packages,
            labels: [
              {
                packageId: target.id,
                data: labels.map((label) => text(label.label)).join('\n'),
                mime: 'text/plain',
                encoding: 'utf8',
              },
            ],
          },
        }
      if (!checking) {
        if (view.fingerprint !== plan.remoteKey)
          throw new ProviderError(
            'FULFILLMENT_STALE',
            'Trendyol paketi değişti. Güncel kaydı açın.',
          )
        await this.http.request(endpoint, {
          method: 'POST',
          headers,
          json: { format: 'ZPL', boxQuantity: plan.parcels, volumetricHeight: plan.desi },
        })
      }
      return result('Trendyol ortak etiketi hazırlanıyor.', false)
    }
    if (checking)
      return result('Trendyol sonucu henüz doğrulanamadı; tekrar yazılmadan izleniyor.', false)
    if (view.fingerprint !== plan.remoteKey)
      throw new ProviderError(
        'FULFILLMENT_STALE',
        'Trendyol siparişi değişti. Güncel bilgilerle tekrar açın.',
      )
    const endpoint = `${base}/order/sellers/${seller}/shipment-packages/${encodeURIComponent(order.externalId!)}`
    if (plan.action === 'pack') {
      if (currentStatus !== 'created')
        throw new ProviderError(
          'PACKAGE_NOT_READY',
          'Trendyol paketi hazırlanabilir durumda değil.',
        )
      await this.http.request(endpoint, {
        method: 'PUT',
        headers,
        json: {
          status: 'Picking',
          lines: view.lines.map((line) => ({ lineId: Number(line.id), quantity: line.quantity })),
          params: {},
        },
      })
    } else if (plan.action === 'cancel') {
      if (
        !plan.lines.length ||
        plan.lines.some(
          (selected) =>
            !view.lines.some(
              (line) =>
                line.id === selected.id && line.quantity === selected.quantity && line.cancellable,
            ),
        ) ||
        !view.cancellationReasons.some((reason) => reason.id === plan.reasonId)
      )
        throw new ProviderError(
          'CANCELLATION_INVALID',
          'İptal edilecek kalemleri ve nedeni kontrol edin.',
        )
      await this.http.request(`${endpoint}/items/unsupplied`, {
        method: 'PUT',
        headers,
        json: {
          lines: plan.lines.map((line) => ({ lineId: Number(line.id), quantity: line.quantity })),
          reasonId: Number(plan.reasonId),
        },
      })
    } else if (plan.action === 'ship') {
      if (
        !context.settings.cargoConnectionId ||
        !plan.trackingUrl ||
        !['created', 'picking', 'invoiced'].includes(currentStatus)
      )
        throw new ProviderError(
          'TRACKING_REQUIRED',
          'Kendi kargo modeline ait takip bağlantısı ve gönderime hazır paket gerekli.',
        )
      await this.http.request(`${endpoint}/alternative-delivery`, {
        method: 'PUT',
        headers,
        json: {
          isPhoneNumber: false,
          trackingInfo: plan.trackingUrl,
          params: {},
          boxQuantity: plan.parcels,
          deci: plan.desi,
        },
      })
    }
    return result('Trendyol işlemi aldı; paket sonucu doğrulanıyor.', false)
  }
}
