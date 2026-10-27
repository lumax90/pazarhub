import type { AppState, Order } from './types'

/** Printable ASCII: what every carrier's Code 128 scanner reads back unchanged. */
const encodable = (code: string) => /^[\x20-\x7e]+$/.test(code)

export interface CargoLabel {
  key: string
  order: Order
  carrier: string
  trackingNumber: string
  /** Marketplace package number when it differs from the order number. */
  packageNumber?: string
  /** "1/2" when the order ships in several packages. */
  part?: string
  items: number
}

export const cargoLabelFormats = [
  { id: '100x100', label: 'Termal 100 × 100 mm' },
  { id: '100x150', label: 'Termal 100 × 150 mm' },
  { id: 'a4', label: 'A4 · sayfada 4 etiket' },
] as const
export type CargoLabelFormat = (typeof cargoLabelFormats)[number]['id']

const cancelled = (status: string) =>
  /^(cancel|unsupplied)/.test(status.toLocaleLowerCase('en-US').replace(/[ _-]/g, ''))

/**
 * Labels carrying the marketplace's own tracking code, one per live package. Orders sent
 * with the seller's own carrier are left out: that carrier's label is the one to use.
 */
export function cargoLabels(state: AppState, orders: Order[], packageId?: string) {
  const labels: CargoLabel[] = [],
    skipped: { order: Order; reason: string }[] = []
  for (const order of orders) {
    if (state.shipments?.some((item) => item.orderId === order.id && item.status !== 'cancelled')) {
      skipped.push({ order, reason: 'Kendi kargo gönderisi var; taşıyıcının etiketini kullanın.' })
      continue
    }
    const live = (order.marketplacePackages ?? []).filter(
      (item) => item.trackingNumber && !cancelled(item.status),
    )
    const number = order.externalNumber || order.number,
      orderItems = order.lines.reduce((sum, line) => sum + line.quantity, 0),
      carrier = order.cargoProvider || 'Pazaryeri kargosu'
    const wanted: Omit<CargoLabel, 'order'>[] = live.length
      ? live
          .filter((item) => !packageId || item.id === packageId)
          .map((item) => ({
            key: `${order.id}:${item.id}`,
            trackingNumber: item.trackingNumber!,
            carrier: item.carrier || carrier,
            packageNumber: item.number !== number ? item.number : undefined,
            part: live.length > 1 ? `${live.indexOf(item) + 1}/${live.length}` : undefined,
            items: item.lines.reduce((sum, line) => sum + line.quantity, 0) || orderItems,
          }))
      : !packageId && order.trackingNumber
        ? [{ key: order.id, trackingNumber: order.trackingNumber, carrier, items: orderItems }]
        : []
    if (!wanted.length) {
      skipped.push({ order, reason: 'Yazdırılabilir pazaryeri kargo kodu yok.' })
      continue
    }
    for (const item of wanted)
      if (encodable(item.trackingNumber)) labels.push({ order, ...item })
      else skipped.push({ order, reason: 'Kargo kodu barkoda dönüştürülemiyor.' })
  }
  return { labels, skipped }
}
