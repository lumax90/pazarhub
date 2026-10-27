import type { Order } from '../../src/domain/types'
import type {
  MarketplacePackage,
  OrderFulfillmentPlan,
  OrderFulfillmentView,
} from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { PazaramaApi, normalizePazaramaOrder } from '../integrations/pazarama'
import { ProviderError } from '../errors'
import type { MarketplaceFulfillmentAdapter } from './contracts'
import { fulfillmentRemoteKey } from './contracts'

export class PazaramaFulfillment implements MarketplaceFulfillmentAdapter {
  private readonly api: PazaramaApi
  constructor(http: ProviderHttp) {
    this.api = new PazaramaApi(http)
  }
  private async read(context: AdapterContext, order: Order) {
    if (!Number.isSafeInteger(Number(order.externalNumber)))
      throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'Pazarama sipariş numarası geçersiz.')
    const response = await this.api.request(context, '/order/getOrdersForApi', {
      method: 'POST',
      json: { orderNumber: Number(order.externalNumber), pageSize: 100, pageNumber: 1 },
      idempotent: true,
    })
    const raw = array(response.data)
      .map(record)
      .find(
        (item) =>
          text(item.orderId) === order.externalId &&
          text(item.orderNumber) === order.externalNumber,
      )
    if (!raw)
      throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'Pazarama sipariş kimliği doğrulanamadı.')
    // This unusual path is the literal path in Pazarama's October 2026 package contract.
    const packagesResponse = await this.api.request(
        context,
        `/order/api/shipment-packages/orderId=${encodeURIComponent(order.externalId!)}`,
      ),
      dtos = array(record(packagesResponse.data).shipmentPackageDtos).map(record),
      items = array(raw.items).map(record)
    const packages: MarketplacePackage[] = dtos
      .filter(
        (pkg) => text(pkg.packageNumber) !== '0' && /^10(?:\D|$)/.test(text(pkg.packageStatus)),
      )
      .map((pkg) => ({
        id: text(pkg.packageNumber),
        number: text(pkg.packageNumber),
        status: text(pkg.packageStatus),
        carrier: text(pkg.cargoCompanyName),
        trackingNumber: text(pkg.shipmentNumber),
        lines: array(pkg.shipmentOrderItems)
          .flatMap((group) => array(record(group).orderItemIds))
          .map((id) => ({
            id: text(id),
            quantity: remoteInteger(
              items.find((item) => text(item.orderItemId) === text(id))?.quantity,
            ),
          })),
      }))
    const carrierMap = new Map<string, string>()
    for (const item of items) {
      const cargo = record(item.cargo)
      if (text(cargo.companyId)) carrierMap.set(text(cargo.companyId), text(cargo.companyName))
    }
    for (const pkg of dtos)
      if (text(pkg.cargoCompanyId))
        carrierMap.set(text(pkg.cargoCompanyId), text(pkg.cargoCompanyName))
    const view: OrderFulfillmentView = {
      provider: 'pazarama',
      orderNumber: order.externalNumber!,
      packages,
      lines: items.map((item) => ({
        id: text(item.orderItemId),
        name: text(record(item.product).name),
        sku: text(record(item.product).stockCode),
        quantity: remoteInteger(item.quantity),
        status: String(item.orderItemStatus),
        preparable: item.orderItemStatus === 3,
        packable:
          item.orderItemStatus === 12 &&
          !packages.some((pkg) => pkg.lines.some((line) => line.id === text(item.orderItemId))),
        cancellable: [3, 12].includes(remoteInteger(item.orderItemStatus)),
      })),
      actions: [
        'prepare',
        'pack',
        'cancel',
        ...(context.settings.cargoConnectionId ? ['ship' as const] : []),
      ],
      cancellationReasons: [{ id: '13', label: 'Tedarik edilemedi' }],
      carriers: [...carrierMap].map(([id, label]) => ({
        id,
        label,
        contracted: !context.settings.cargoConnectionId,
      })),
      fingerprint: fulfillmentRemoteKey({ raw, dtos }),
    }
    return { raw, view, items }
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
    const { raw, view, items } = await this.read(context, order),
      target = view.packages.find((pkg) => pkg.id === plan.packageId),
      selectedIds =
        plan.action === 'ship'
          ? (target?.lines.map((line) => line.id) ?? [])
          : plan.lines.map((line) => line.id)
    const selected = items.filter((item) => selectedIds.includes(text(item.orderItemId)))
    const confirmed =
      plan.action === 'prepare'
        ? selected.length === selectedIds.length &&
          selected.every((item) => [12, 5, 11].includes(remoteInteger(item.orderItemStatus)))
        : plan.action === 'pack'
          ? view.packages.some(
              (pkg) =>
                pkg.lines.length === plan.lines.length &&
                pkg.lines.every((line) =>
                  plan.lines.some(
                    (selected) => selected.id === line.id && selected.quantity === line.quantity,
                  ),
                ),
            )
          : plan.action === 'cancel'
            ? selected.length === selectedIds.length &&
              selected.every((item) => [6, 13].includes(remoteInteger(item.orderItemStatus)))
            : plan.action === 'ship'
              ? !!target &&
                selected.length > 0 &&
                selected.every(
                  (item) =>
                    [5, 11].includes(remoteInteger(item.orderItemStatus)) &&
                    text(record(item.cargo).trackingNumber) === plan.trackingNumber,
                )
              : false
    const result = (message: string, done: boolean): AdapterResult => ({
      message,
      orderFulfillment: { orderId: order.id, confirmed: done, packages: view.packages },
      ...(done
        ? { orders: [normalizePazaramaOrder(raw)] }
        : {
            nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
            delaySeconds: 20,
          }),
    })
    if (confirmed) return result('Pazarama paket/kalem sonucu güncel kayıttan doğrulandı.', true)
    if (checking) return result('Pazarama paket işlemi tekrar yazılmadan izleniyor.', false)
    if (view.fingerprint !== plan.remoteKey || !view.actions.includes(plan.action))
      throw new ProviderError('FULFILLMENT_STALE', 'Pazarama sipariş/paket kaydı değişti.')
    if (plan.action === 'pack') {
      const sellerId = requireCredential(context.credentials, 'sellerId')
      if (
        !/^[0-9a-f-]{36}$/i.test(sellerId) ||
        !view.carriers?.some((carrier) => carrier.id === plan.carrierId) ||
        plan.lines.some(
          (selected) => !view.lines.some((line) => line.id === selected.id && line.packable),
        )
      )
        throw new ProviderError(
          'PACKAGE_FIELDS_REQUIRED',
          'Pazarama Satıcı ID (GUID), kargo firması ve hazırlanmış kalemler gerekli.',
        )
      await this.api.request(context, '/order/api/packages-split', {
        method: 'POST',
        json: {
          orderId: order.externalId,
          sellerId,
          apiOrderItemPackages: [{ orderItemIds: selectedIds, cargoCompanyId: plan.carrierId }],
        },
      })
    } else if (['prepare', 'cancel', 'ship'].includes(plan.action)) {
      if (!selectedIds.length || selectedIds.length !== selected.length)
        throw new ProviderError('LINES_CHANGED', 'Pazarama kalem kimlikleri eşleşmiyor.')
      if (
        plan.action === 'ship' &&
        (!target ||
          !context.settings.cargoConnectionId ||
          !plan.trackingNumber ||
          !view.carriers?.some((carrier) => carrier.id === plan.carrierId))
      )
        throw new ProviderError(
          'TRACKING_REQUIRED',
          'Kendi kargo modeline ait paket, firma ve takip numarası gerekli.',
        )
      await this.api.request(context, '/order/api/bulk-status-update', {
        method: 'POST',
        json: {
          orderNumber: Number(order.externalNumber),
          orderItemIds: selectedIds,
          updateShipmentDto: {
            status: plan.action === 'prepare' ? 12 : plan.action === 'cancel' ? 13 : 5,
            subStatus: 0,
            deliveryType: 1,
            ...(plan.action === 'ship'
              ? {
                  cargoCompanyId: plan.carrierId,
                  shippingTrackingNumber: plan.trackingNumber,
                  trackingUrl: plan.trackingUrl,
                  shipmentNumber: target!.trackingNumber,
                }
              : {}),
          },
        },
      })
    }
    return result('Pazarama işlemi aldı; sonucu kontrol ediliyor.', false)
  }
}
