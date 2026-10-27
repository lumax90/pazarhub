import type { OrderFilters, OrderStatus } from '../domain/types'
import { defaultOrderDates } from '../domain/orders'
import { channelNames } from '../domain/channels'

const statuses: OrderStatus[] = [
  'pending',
  'approved',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
]
export function readOrderFilters(params: URLSearchParams, days = 7): OrderFilters {
  const dates = defaultOrderDates(new Date(), days)
  const bool = (key: string) =>
    params.get(key) === '1' ? true : params.get(key) === '0' ? false : undefined
  return {
    from: params.has('from') ? params.get('from') || undefined : dates.from,
    to: params.has('to') ? params.get('to') || undefined : dates.to,
    query: params.get('q') || undefined,
    statuses: (params.get('status') ?? '')
      .split(',')
      .filter((status): status is OrderStatus => statuses.includes(status as OrderStatus)),
    channel: Object.hasOwn(channelNames, params.get('channel') ?? '')
      ? (params.get('channel') as OrderFilters['channel'])
      : undefined,
    storeId: params.get('store') || undefined,
    cargoProvider: params.get('cargo') || undefined,
    paid: bool('paid'),
    invoiced: bool('invoiced'),
    unmapped: bool('unmapped'),
    ownShipment: bool('ownShipment'),
    printed: bool('printed'),
  }
}
export function orderFilterParams(filters: OrderFilters, view?: string) {
  const params = new URLSearchParams({ from: filters.from ?? '', to: filters.to ?? '' })
  for (const [key, value] of Object.entries({
    q: filters.query,
    status: filters.statuses?.join(','),
    channel: filters.channel,
    store: filters.storeId,
    cargo: filters.cargoProvider,
    view,
  }))
    if (value) params.set(key, value)
  for (const key of ['paid', 'invoiced', 'unmapped', 'ownShipment', 'printed'] as const)
    if (filters[key] !== undefined) params.set(key, filters[key] ? '1' : '0')
  return params
}
