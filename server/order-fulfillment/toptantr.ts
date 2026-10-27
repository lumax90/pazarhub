import type { Order } from '../../src/domain/types'
import type {
  MarketplacePackage,
  OrderFulfillmentPlan,
  OrderFulfillmentView,
} from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import type { ProviderHttp } from '../integrations/http'
import { ToptanTrApi, normalizeToptanTrOrder } from '../integrations/toptantr'
import { ProviderError } from '../errors'
import type { MarketplaceFulfillmentAdapter } from './contracts'
import { fulfillmentRemoteKey } from './contracts'

export class ToptanTrFulfillment implements MarketplaceFulfillmentAdapter {
  private readonly api: ToptanTrApi
  constructor(http: ProviderHttp) {
    this.api = new ToptanTrApi(http)
  }
  private async read(context: AdapterContext, order: Order) {
    if (!/^\d+$/.test(order.externalId ?? ''))
      throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'ToptanTR sipariş kimliği sayısal olmalı.')
    const response = await this.api.request(context, '/orders/search', {
      method: 'POST',
      json: { orderSearch: { orderNumber: Number(order.externalId), page: 0, size: 100 } },
      idempotent: true,
    })
    const raw = array(response.content)
      .map(record)
      .find((item) => text(item.id) === order.externalId)
    if (!raw) throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'ToptanTR siparişi doğrulanamadı.')
    const shipments: Record<string, unknown>[] = []
    for (let page = 0; page < 100; page++) {
      const response = await this.api.request(context, '/shipments/search', {
        method: 'POST',
        json: { shipmentSearch: { orderId: Number(order.externalId), page, size: 100 } },
        idempotent: true,
      })
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_SHIPMENTS', 'ToptanTR gönderileri okunamadı.')
      shipments.push(
        ...response.content.map(record).filter((item) => text(item.orderId) === order.externalId),
      )
      if (page + 1 >= remoteInteger(response.totalPages, 1)) break
      if (page === 99)
        throw new ProviderError('PAGING_LIMIT', 'ToptanTR gönderi sayfalaması tamamlanamadı.')
    }
    const cargoes = await this.api.request(context, '/cargoes')
    if (!Array.isArray(cargoes.cargoes))
      throw new ProviderError('INVALID_CARRIERS', 'ToptanTR kargo firmaları okunamadı.')
    const packages: MarketplacePackage[] = shipments.map((shipment) => ({
      id: text(shipment.id),
      number: text(shipment.id),
      status:
        shipment.isReturned === true
          ? 'Returned'
          : shipment.isDelivered === true
            ? 'Delivered'
            : shipment.isShipped === true
              ? 'Shipped'
              : 'Ready',
      carrier: text(shipment.cargoFirm),
      trackingNumber: text(shipment.trackingNumber),
      trackingUrl: text(shipment.trackingUrl),
      lines: array(shipment.shipmentItems)
        .map(record)
        .map((item) => ({
          id: text(item.orderItemId),
          quantity: remoteInteger(item.quantityInThisShipment),
        })),
    }))
    const view: OrderFulfillmentView = {
      provider: 'toptantr',
      orderNumber: text(raw.customOrderNumber) || order.externalNumber!,
      packages,
      lines: array(raw.orderItems)
        .map(record)
        .map((item) => {
          const used = packages.reduce(
              (sum, pkg) =>
                sum +
                pkg.lines
                  .filter((line) => line.id === text(item.id))
                  .reduce((n, line) => n + line.quantity, 0),
              0,
            ),
            quantity = remoteInteger(item.quantity) - used
          return {
            id: text(item.id),
            name: text(item.productName),
            sku: text(item.barcode),
            quantity: Math.max(0, quantity),
            status: String(raw.orderStatusId),
            packable: raw.orderStatusId === 20 && quantity > 0,
            cancellable: [10, 20].includes(remoteInteger(raw.orderStatusId)) && !shipments.length,
          }
        }),
      actions: [
        'pack',
        'label',
        'cancel',
        ...(shipments.some((item) => item.canShip === true) ? ['ship' as const] : []),
      ],
      cancellationReasons: [{ id: 'cancel', label: 'Siparişin tamamını iptal et' }],
      carriers: cargoes.cargoes
        .map(record)
        .filter((cargo) =>
          !context.settings.cargoConnectionId
            ? cargo.isContracted === true
            : cargo.isContracted === false,
        )
        .map((cargo) => ({
          id: text(cargo.id),
          label: `${text(cargo.name)}${cargo.isContracted === true ? ' · Pazaryeri anlaşması' : ' · Kendi anlaşmanız'}`,
          contracted: cargo.isContracted === true,
        })),
      fingerprint: fulfillmentRemoteKey({ raw, shipments }),
    }
    return { raw, shipments, view }
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
    const { raw, shipments, view } = await this.read(context, order),
      target = shipments.find((item) => text(item.id) === plan.packageId)
    const created = shipments.find(
      (item) =>
        text(item.adminComment) === plan.reference &&
        array(item.shipmentItems).length === plan.lines.length &&
        array(item.shipmentItems)
          .map(record)
          .every((item) =>
            plan.lines.some(
              (line) =>
                line.id === text(item.orderItemId) &&
                line.quantity === remoteInteger(item.quantityInThisShipment),
            ),
          ),
    )
    const confirmed =
      plan.action === 'pack'
        ? !!created
        : plan.action === 'ship'
          ? !!target && target.isShipped === true
          : plan.action === 'cancel'
            ? remoteInteger(raw.orderStatusId) === 40
            : false
    const result = (message: string, done: boolean): AdapterResult => ({
      message,
      orderFulfillment: { orderId: order.id, confirmed: done, packages: view.packages },
      ...(done
        ? { orders: [normalizeToptanTrOrder(raw)] }
        : {
            nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
            delaySeconds: 15,
          }),
    })
    if (confirmed) return result('ToptanTR gönderi/sipariş sonucu doğrulandı.', true)
    if (plan.action === 'label') {
      if (!target) throw new ProviderError('PACKAGE_NOT_FOUND', 'ToptanTR gönderisi seçin.')
      const response = await this.api.request(
          context,
          `/shipments/label?${new URLSearchParams({ shipmentId: text(target.id), orderId: order.externalId!, format: 'zpl' })}`,
        ),
        label = record(response.label)
      if (
        text(label.orderId) !== order.externalId ||
        text(label.shipmentId) !== text(target.id) ||
        label.format !== 'zpl' ||
        label.encoding !== 'utf8' ||
        !text(label.content).includes('^XA')
      )
        throw new ProviderError(
          'LABEL_NOT_CONFIRMED',
          'ToptanTR etiket kimliği veya içeriği doğrulanamadı.',
        )
      return {
        ...result('ToptanTR kargo etiketleri alındı.', true),
        orderFulfillment: {
          orderId: order.id,
          confirmed: true,
          packages: view.packages,
          labels: [
            {
              packageId: text(target.id),
              data: text(label.content),
              mime: 'text/plain',
              encoding: 'utf8',
            },
          ],
        },
      }
    }
    if (checking)
      return result('ToptanTR sonucu izleniyor; yeni gönderi isteği tekrarlanmadı.', false)
    if (view.fingerprint !== plan.remoteKey)
      throw new ProviderError('FULFILLMENT_STALE', 'ToptanTR siparişi veya gönderileri değişti.')
    if (plan.action === 'pack') {
      const carrier = view.carriers?.find((item) => item.id === plan.carrierId)
      if (
        !carrier ||
        !plan.weight ||
        !plan.width ||
        !plan.height ||
        !plan.length ||
        plan.lines.some(
          (selected) =>
            !view.lines.some(
              (line) =>
                line.id === selected.id && line.packable && line.quantity === selected.quantity,
            ),
        )
      )
        throw new ProviderError(
          'SHIPMENT_FIELDS_REQUIRED',
          'Kargo firması, koli başına ölçüler/ağırlık ve gönderilecek kalemleri tamamlayın.',
        )
      if (!carrier.contracted && !plan.trackingNumber)
        throw new ProviderError(
          'TRACKING_REQUIRED',
          'Kendi kargo hesabınıza ait takip numarası gerekli.',
        )
      await this.api.request(context, '/addshipment', {
        method: 'POST',
        json: {
          shipment: {
            orderId: Number(order.externalId),
            cargoId: Number(carrier.id),
            isToptanTRContract: carrier.contracted,
            ...(!carrier.contracted ? { trackingNumber: plan.trackingNumber } : {}),
            adminComment: plan.reference,
            shipmentItems: plan.lines.map((line) => ({
              orderItemId: Number(line.id),
              quantityToAdd: line.quantity,
            })),
            shipmentPackages: Array.from({ length: plan.parcels }, () => ({
              weight: plan.weight,
              width: plan.width,
              height: plan.height,
              length: plan.length,
              deci: plan.desi / plan.parcels,
              packageTypeId: 14,
            })),
          },
        },
      })
    } else if (plan.action === 'ship') {
      if (!target || target.canShip !== true)
        throw new ProviderError('SHIPMENT_NOT_READY', 'ToptanTR gönderisi sevke hazır değil.')
      await this.api.request(context, `/setasshipped/${encodeURIComponent(text(target.id))}`, {
        method: 'POST',
      })
    } else if (plan.action === 'cancel') {
      if (
        shipments.length ||
        ![10, 20].includes(remoteInteger(raw.orderStatusId)) ||
        plan.lines.length !== view.lines.length
      )
        throw new ProviderError(
          'CANCELLATION_INVALID',
          'ToptanTR iptali sevk edilmemiş siparişin tamamına uygulanır.',
        )
      await this.api.request(context, `/cancelorder/${encodeURIComponent(order.externalId!)}`, {
        method: 'POST',
      })
    }
    return result('ToptanTR işlemi aldı; güncel kayıt doğrulanıyor.', false)
  }
}
