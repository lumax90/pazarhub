import type { Order } from '../../src/domain/types'
import type {
  MarketplacePackage,
  OrderFulfillmentPlan,
  OrderFulfillmentView,
} from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { hepsiburadaHeaders, normalizeHepsiburadaOrder } from '../integrations/hepsiburada'
import { ProviderError } from '../errors'
import { fulfillmentRemoteKey, isCancelled, packageStatus } from './contracts'
import type { MarketplaceFulfillmentAdapter } from './contracts'

export class HepsiburadaFulfillment implements MarketplaceFulfillmentAdapter {
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext) {
    return {
      base: `https://oms-external${context.settings.environment === 'sandbox' ? '-sit' : ''}.hepsiburada.com`,
      merchant: encodeURIComponent(requireCredential(context.credentials, 'merchantId')),
      headers: hepsiburadaHeaders(context),
    }
  }
  private async read(context: AdapterContext, order: Order) {
    const { base, merchant, headers } = this.api(context)
    const raw = record(
      await this.http.request(
        `${base}/orders/merchantid/${merchant}/ordernumber/${encodeURIComponent(order.externalId!)}`,
        { headers },
      ),
    )
    if (text(raw.orderNumber) !== order.externalId || !Array.isArray(raw.items))
      throw new ProviderError(
        'ORDER_IDENTITY_MISMATCH',
        'Hepsiburada sipariş kimliği doğrulanamadı.',
      )
    const lines = raw.items
      .map(record)
      .filter(
        (line) => !line.merchantId || text(line.merchantId) === context.credentials.merchantId,
      )
    const packages: MarketplacePackage[] = []
    for (const number of new Set(lines.map((line) => text(line.packageNumber)).filter(Boolean))) {
      const data = record(
        await this.http.request(
          `${base}/packages/merchantid/${merchant}/packagenumber/${encodeURIComponent(number)}`,
          { headers },
        ),
      )
      if (text(data.packageNumber) !== number)
        throw new ProviderError('PACKAGE_IDENTITY_MISMATCH', 'Hepsiburada paket kimliği uyuşmuyor.')
      packages.push({
        id: number,
        number,
        status: text(data.status),
        trackingNumber: text(data.trackingInfoCode || data.barcode),
        trackingUrl: text(data.trackingInfoUrl),
        carrier: text(data.cargoCompany),
        lines: lines
          .filter((line) => text(line.packageNumber) === number)
          .map((line) => ({ id: text(line.id), quantity: remoteInteger(line.quantity) })),
      })
    }
    const view: OrderFulfillmentView = {
      provider: 'hepsiburada',
      orderNumber: text(raw.orderNumber),
      packages,
      lines: lines.map((line) => ({
        id: text(line.id),
        name: text(line.name),
        sku: text(line.merchantSKU || line.merchantSku),
        quantity: remoteInteger(line.quantity),
        status: text(line.status),
        packageId: text(line.packageNumber) || undefined,
        packable:
          ['open', 'unpacked'].includes(packageStatus(line.status)) &&
          line.canCreatePackage !== false,
        cancellable: packageStatus(line.status) === 'open' && line.isCancellable !== false,
      })),
      actions: [
        'pack',
        'label',
        'cancel',
        ...(context.settings.cargoConnectionId ? ['ship' as const] : []),
      ],
      cancellationReasons: [
        { id: '83', label: 'Ürün tedarik edilemedi' },
        { id: '80', label: 'Üründe fiyat hatası' },
        { id: '81', label: 'Yanlış barkod eşleşmesi' },
        { id: '82', label: 'Kargo çıkışı yapılamadı' },
      ],
      fingerprint: fulfillmentRemoteKey({ raw, packages }),
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
    const { base, merchant, headers } = this.api(context),
      { raw, view } = await this.read(context, order)
    const target = view.packages.find((item) => item.id === plan.packageId)
    const matchingPackage = view.packages.find(
      (item) =>
        item.lines.length === plan.lines.length &&
        item.lines.every((line) =>
          plan.lines.some(
            (selected) => selected.id === line.id && selected.quantity === line.quantity,
          ),
        ),
    )
    const confirmed =
      plan.action === 'pack'
        ? !!matchingPackage
        : plan.action === 'cancel'
          ? plan.lines.every((selected) =>
              view.lines.some((line) => line.id === selected.id && isCancelled(line.status)),
            )
          : plan.action === 'ship'
            ? !!target &&
              ['intransit', 'shipped', 'delivered'].includes(packageStatus(target.status)) &&
              target.trackingNumber === plan.trackingNumber
            : false
    const result = (message: string, done: boolean): AdapterResult => ({
      message,
      orderFulfillment: { orderId: order.id, confirmed: done, packages: view.packages },
      ...(done
        ? { orders: [normalizeHepsiburadaOrder(raw, context.credentials.merchantId)] }
        : {
            nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
            delaySeconds: 15,
          }),
    })
    if (confirmed) return result('Hepsiburada paket/sipariş sonucu sağlayıcıdan doğrulandı.', true)
    if (plan.action === 'label') {
      if (!target)
        throw new ProviderError(
          'PACKAGE_NOT_FOUND',
          'Etiket alınacak Hepsiburada paketi bulunamadı.',
        )
      const response = record(
        await this.http.request(
          `${base}/packages/merchantid/${merchant}/packagenumber/${encodeURIComponent(target.id)}/labels?format=zpl`,
          { headers },
        ),
      )
      if (
        String(response.format).toLowerCase() !== 'zpl' ||
        !Array.isArray(response.data) ||
        !response.data.length ||
        response.data.some((label) => typeof label !== 'string' || !label.includes('^XA'))
      )
        throw new ProviderError(
          'LABEL_NOT_READY',
          'Hepsiburada ortak etiketi okunamadı; bu kargo modelinde etiket desteğini kontrol edin.',
        )
      return {
        ...result('Hepsiburada ortak etiketi alındı.', true),
        orderFulfillment: {
          orderId: order.id,
          confirmed: true,
          packages: view.packages,
          labels: [
            {
              packageId: target.id,
              data: response.data.join('\n'),
              mime: 'text/plain',
              encoding: 'utf8',
            },
          ],
        },
      }
    }
    if (checking)
      return result(
        'Hepsiburada işlem sonucu henüz doğrulanamadı; tekrar yazılmadan izleniyor.',
        false,
      )
    if (view.fingerprint !== plan.remoteKey)
      throw new ProviderError(
        'FULFILLMENT_STALE',
        'Hepsiburada siparişi veya paketleri değişti. Güncel bilgilerle tekrar açın.',
      )
    if (plan.action === 'pack') {
      if (
        !plan.lines.length ||
        plan.lines.some(
          (selected) =>
            !view.lines.some(
              (line) =>
                line.id === selected.id && line.packable && line.quantity === selected.quantity,
            ),
        )
      )
        throw new ProviderError('PACKAGE_LINES_CHANGED', 'Paketlenecek tam kalemleri kontrol edin.')
      let others: Record<string, unknown>[] = []
      try {
        const compatible = record(
          await this.http.request(
            `${base}/lineitems/merchantid/${merchant}/packageablewith/lineitemid/${encodeURIComponent(plan.lines[0].id)}`,
            { headers },
          ),
        )
        others = array(compatible.lineItems).map(record)
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code !== 'HTTP_404') throw error
      }
      if (
        plan.lines
          .slice(1)
          .some(
            (line) =>
              !others.some(
                (other) =>
                  text(other.lineItemId) === line.id &&
                  remoteInteger(other.quantity) === line.quantity,
              ),
          )
      )
        throw new ProviderError(
          'NOT_PACKAGEABLE_TOGETHER',
          'Seçilen Hepsiburada kalemleri aynı pakete konulamıyor.',
        )
      await this.http.request(`${base}/packages/merchantid/${merchant}`, {
        method: 'POST',
        headers,
        json: {
          lineItemRequests: plan.lines.map((line) => ({ id: line.id, quantity: line.quantity })),
          parcelQuantity: plan.parcels,
          deci: plan.desi,
        },
      })
    } else if (plan.action === 'cancel') {
      if (
        plan.lines.length !== 1 ||
        !view.cancellationReasons.some((reason) => reason.id === plan.reasonId) ||
        !view.lines.some(
          (line) =>
            line.id === plan.lines[0].id &&
            line.quantity === plan.lines[0].quantity &&
            line.cancellable,
        )
      )
        throw new ProviderError(
          'CANCELLATION_INVALID',
          'İptal edilebilir tek bir tam kalem ve neden seçin.',
        )
      await this.http.request(
        `${base}/lineitems/merchantid/${merchant}/id/${encodeURIComponent(plan.lines[0].id)}/cancelbymerchant`,
        { method: 'POST', headers, json: { reasonId: Number(plan.reasonId) } },
      )
    } else if (plan.action === 'ship') {
      if (!target || !context.settings.cargoConnectionId || !plan.trackingNumber)
        throw new ProviderError(
          'TRACKING_REQUIRED',
          'Kendi kargo modelindeki paket ve takip numarası gerekli.',
        )
      await this.http.request(
        `${base}/packages/merchantid/${merchant}/packagenumber/${encodeURIComponent(target.id)}/intransit`,
        {
          method: 'POST',
          headers,
          json: {
            trackingNumber: plan.trackingNumber,
            trackingUrl: plan.trackingUrl,
            shippedDate: plan.shippedAt,
            deci: plan.desi,
          },
        },
      )
    }
    return result('Hepsiburada işlemi aldı; sonucu doğrulanıyor.', false)
  }
}
