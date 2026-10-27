import type { Order } from '../../src/domain/types'
import type {
  MarketplacePackage,
  OrderFulfillmentPlan,
  OrderFulfillmentView,
} from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import type { ProviderHttp } from '../integrations/http'
import { PttAvmApi } from '../integrations/pttavm-api'
import { normalizePttAvmOrder } from '../integrations/pttavm'
import { ProviderError } from '../errors'
import type { MarketplaceFulfillmentAdapter } from './contracts'
import { fulfillmentRemoteKey } from './contracts'

export class PttAvmFulfillment implements MarketplaceFulfillmentAdapter {
  private readonly api: PttAvmApi
  constructor(http: ProviderHttp) {
    this.api = new PttAvmApi(http)
  }
  private async read(context: AdapterContext, order: Order) {
    const response = await this.api.request(
      context,
      `/orders/${encodeURIComponent(order.externalId!)}`,
    )
    if (
      !Array.isArray(response) ||
      !response.length ||
      response.some((item) => text(record(item).siparisNo) !== order.externalId)
    )
      throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'PttAVM sipariş kimliği doğrulanamadı.')
    const raw = response.map(record),
      lines = raw.flatMap((item) => array(item.siparisUrunler).map(record))
    const barcodeIds = [
      ...new Set(
        raw
          .flatMap((item) => [
            text(item.kargoBarkod),
            ...array(item.barcodes).map((value) => text(record(value).barcode)),
          ])
          .filter(Boolean),
      ),
    ]
    const packages: MarketplacePackage[] = barcodeIds.map((id) => ({
      id,
      number: id,
      status: text(lines[0]?.siparisDurumu),
      carrier: 'PTT Kargo',
      trackingNumber: id,
      lines: [],
    }))
    const warehouses = record(
      await this.api.shipment(context, '/get-warehouse', { method: 'POST', idempotent: true }),
    )
    if (warehouses.status !== true || !Array.isArray(warehouses.data))
      throw new ProviderError('WAREHOUSES_REQUIRED', 'PttAVM depo listesi doğrulanamadı.')
    const view: OrderFulfillmentView = {
      provider: 'pttavm',
      orderNumber: order.externalId!,
      packages,
      lines: lines.map((item) => ({
        id: text(item.lineItemId),
        name: text(item.urun),
        sku: text(item.urunBarkod),
        quantity: remoteInteger(item.toplamIslemAdedi),
        status: text(item.siparisDurumu),
        packable: !packages.length && item.siparisDurumu === 'kargo_yapilmasi_bekleniyor',
        cancellable: false,
      })),
      actions: context.settings.cargoConnectionId ? [] : ['pack', 'label'],
      cancellationReasons: [],
      warehouses: warehouses.data
        .map(record)
        .map((item) => ({ id: text(item.id), label: text(item.name) })),
      fingerprint: fulfillmentRemoteKey(raw),
    }
    return { raw, view }
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
    const { raw, view } = await this.read(context, order)
    const result = (message: string, confirmed: boolean): AdapterResult => ({
      message,
      orderFulfillment: { orderId: order.id, confirmed, packages: view.packages },
      ...(confirmed
        ? {}
        : {
            nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
            delaySeconds: 15,
          }),
    })
    if (plan.action === 'label') {
      const target = view.packages.find((item) => item.id === plan.packageId)
      if (!target)
        throw new ProviderError('PACKAGE_NOT_FOUND', 'PttAVM siparişine ait barkod seçin.')
      const label = String(
        await this.api.shipment(context, '/get-barcode-tag', {
          method: 'POST',
          json: { barcode: target.id, order_id: order.externalId, type: 'zpl' },
          responseType: 'text',
          headers: { accept: 'text/plain' },
          idempotent: true,
        }),
      )
      if (!label.includes('^XA') || !label.includes('^XZ'))
        throw new ProviderError('INVALID_LABEL', 'PttAVM ZPL etiketi okunamadı.')
      return {
        ...result('PttAVM kargo etiketi alındı.', true),
        orderFulfillment: {
          orderId: order.id,
          confirmed: true,
          packages: view.packages,
          labels: [{ packageId: target.id, data: label, mime: 'text/plain', encoding: 'utf8' }],
        },
      }
    }
    if (plan.action !== 'pack')
      throw new ProviderError(
        'ACTION_UNAVAILABLE',
        'PttAVM fiziksel gönderilerinde durum taşıyıcıdan alınır.',
      )
    if (payload.trackingId) {
      const response = record(
        await this.api.shipment(context, '/barcode-status', {
          method: 'POST',
          json: { tracking_id: payload.trackingId },
          idempotent: true,
        }),
      )
      if (response.status === 'error')
        throw new ProviderError(
          'BARCODE_REJECTED',
          text(response.error) || 'PttAVM barkod oluşturamadı.',
        )
      if (response.status !== 'completed')
        return result('PttAVM kargo barkodu hazırlanıyor.', false)
      const ids = array(response.data)
        .map(record)
        .filter((item) => text(item.order_id) === order.externalId)
        .flatMap((item) => array(item.barcodes).map(text))
      if (!ids.length)
        throw new ProviderError(
          'BARCODE_IDENTITY_MISMATCH',
          'PttAVM sonucunda bu siparişin barkodları bulunamadı.',
        )
      if (!ids.every((id) => view.packages.some((item) => item.id === id)))
        return result('PttAVM barkodlarının siparişe yansıması bekleniyor.', false)
    }
    if (view.packages.length) {
      const orders = raw.map(normalizePttAvmOrder),
        first = orders[0]
      first.lines = orders.flatMap((order) => order.lines)
      first.total =
        first.lines.reduce((sum, line) => sum + (line.total ?? line.unitPrice * line.quantity), 0) +
        first.shipping
      return { ...result('PttAVM kargo barkodları siparişten doğrulandı.', true), orders: [first] }
    }
    if (checking) return result('PttAVM barkod sonucu izleniyor; oluşturma tekrarlanmadı.', false)
    if (
      view.fingerprint !== plan.remoteKey ||
      plan.lines.length !== view.lines.length ||
      !view.warehouses?.some((warehouse) => warehouse.id === plan.warehouseId) ||
      view.lines.some((line) => !line.packable)
    )
      throw new ProviderError(
        'FULFILLMENT_STALE',
        'PttAVM siparişinin tüm kalemlerini ve pazaryeri deposunu seçin.',
      )
    const response = record(
      await this.api.shipment(context, '/create-barcode', {
        method: 'POST',
        json: { orders: [{ order_id: order.externalId, warehouse_id: Number(plan.warehouseId) }] },
      }),
    )
    if (response.success !== true || !text(response.tracking_id))
      throw new ProviderError(
        'BARCODE_UNCERTAIN',
        'PttAVM barkod takip kimliği doğrulanamadı.',
        false,
        undefined,
        true,
      )
    return {
      ...result('PttAVM barkod isteği alındı.', false),
      nextPayload: { ...payload, verify: true, trackingId: text(response.tracking_id), polls: 0 },
      delaySeconds: 15,
    }
  }
}
