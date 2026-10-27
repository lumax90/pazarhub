import { describe, expect, it } from 'vitest'
import { cargoLabels } from '../src/domain/cargo-labels'
import type { AppState, Order } from '../src/domain/types'

const order = (patch: Partial<Order>): Order =>
  ({
    id: 'o1',
    number: 'PZ-1',
    externalNumber: '10001',
    channel: 'trendyol',
    status: 'approved',
    createdAt: '2026-10-27T09:00:00.000Z',
    lines: [{ quantity: 2 }, { quantity: 1 }],
    ...patch,
  }) as Order
const state = (orders: Order[], shipments: AppState['shipments'] = []) =>
  ({ orders, shipments }) as AppState

describe('cargo labels', () => {
  it('prints one label per live package with its own tracking code', () => {
    const subject = order({
      cargoProvider: 'Aras Kargo',
      marketplacePackages: [
        { id: 'p1', number: 'P1', status: 'Picking', trackingNumber: '7330001', carrier: 'TEX', lines: [{ id: 'l1', quantity: 2 }] },
        { id: 'p2', number: 'P2', status: 'Picking', trackingNumber: '7330002', lines: [{ id: 'l2', quantity: 1 }] },
        { id: 'p3', number: 'P3', status: 'Cancelled', trackingNumber: '7330003', lines: [] },
      ],
    })
    const { labels, skipped } = cargoLabels(state([subject]), [subject])
    expect(skipped).toEqual([])
    expect(
      labels.map(({ trackingNumber, carrier, part, items, packageNumber }) => ({
        trackingNumber,
        carrier,
        part,
        items,
        packageNumber,
      })),
    ).toEqual([
      { trackingNumber: '7330001', carrier: 'TEX', part: '1/2', items: 2, packageNumber: 'P1' },
      { trackingNumber: '7330002', carrier: 'Aras Kargo', part: '2/2', items: 1, packageNumber: 'P2' },
    ])
    expect(cargoLabels(state([subject]), [subject], 'p2').labels).toHaveLength(1)
  }) // prettier-ignore
  it('falls back to the order tracking code when no package is known', () => {
    const subject = order({ trackingNumber: 'HB123456', cargoProvider: 'HepsiJet' })
    const [label] = cargoLabels(state([subject]), [subject]).labels
    expect(label).toMatchObject({ trackingNumber: 'HB123456', carrier: 'HepsiJet', items: 3 })
  })
  it('skips orders without a code and orders sent with the seller’s own carrier', () => {
    const waiting = order({ id: 'o2' }),
      own = order({ id: 'o3', trackingNumber: '123456' })
    const { labels, skipped } = cargoLabels(
      state([waiting, own], [{ id: 's1', orderId: 'o3', status: 'created' } as never]),
      [waiting, own],
    )
    expect(labels).toEqual([])
    expect(skipped.map(({ order, reason }) => [order.id, reason])).toEqual([
      ['o2', 'Yazdırılabilir pazaryeri kargo kodu yok.'],
      ['o3', 'Kendi kargo gönderisi var; taşıyıcının etiketini kullanın.'],
    ])
  })
})
