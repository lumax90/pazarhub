import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { catalogParts, catalogBundle } from './catalog-workspace-fixture'
import { snapshotBundle } from '../src/domain/bundles'
import type { Order } from '../src/domain/types'
import type { RemoteOrder } from '../src/domain/integrations'
import { reconcileOrderState } from '../server/order-reconciliation'

function fixture() {
  const state = createEmptyState('Uzlaştırma')
  state.products = [...catalogParts(), catalogBundle()]
  const order: Order = {
    id: 'order',
    number: 'SP-1',
    customerId: 'customer',
    channel: 'pazarama',
    storeId: 'store',
    externalId: 'remote',
    externalNumber: '100',
    createdAt: '2026-10-24T10:00:00Z',
    dueAt: '2026-10-25T10:00:00Z',
    status: 'approved',
    shipping: 0,
    paid: false,
    note: '',
    events: [],
    inventoryApplied: true,
    lines: [
      {
        externalId: 'line',
        variantId: 'pack',
        quantity: 2,
        unitPrice: 10000,
        unitCost: 5000,
        taxRate: 20,
        bundleComponents: snapshotBundle(state, 'pack'),
      },
    ],
  }
  state.orders = [order]
  const remote: RemoteOrder = {
    externalId: 'remote',
    number: '100',
    createdAt: order.createdAt,
    modifiedAt: '2026-10-24T11:00:00Z',
    status: '12',
    normalizedStatus: 'pending',
    total: 10000,
    shipping: 0,
    recipient: {
      name: 'Test',
      address: 'Adres',
      city: 'İstanbul',
      district: 'Kadıköy',
      phone: '5551234567',
      country: 'TR',
    },
    lines: [
      {
        externalId: 'line',
        sku: '',
        barcode: '',
        title: 'Paket',
        quantity: 1,
        unitPrice: 10000,
        taxRate: 20,
      },
    ],
  }
  return {
    state,
    order,
    remote,
    input: { mappings: { line: 'pack' }, restockRemoved: true, note: 'Adet farkı doğrulandı.' },
  }
}
describe('order reconciliation stock and fiscal invariants', () => {
  it('uses the order’s frozen bundle recipe after the product recipe changes', () => {
    const f = fixture(),
      beforeA = f.state.products[0].variants[0].stock,
      beforeB = f.state.products[1].variants[0].stock
    f.state.products[2].bundle!.components = [
      { variantId: 'a', quantity: 1 },
      { variantId: 'b', quantity: 5 },
    ]
    const result = reconcileOrderState(f.state, 'order', f.remote, f.input, 'Sorumlu')
    expect(result.summary.movements.map((item) => [item.variantId, item.quantity])).toEqual([
      ['a', 2],
      ['b', 1],
    ])
    expect(result.state.products[0].variants[0].stock).toBe(beforeA + 2)
    expect(result.state.products[1].variants[0].stock).toBe(beforeB + 1)
    expect(f.state.orders[0].lines[0].quantity).toBe(2)
    expect(result.state.orderReconciliations?.[0].before.lines[0].quantity).toBe(2)
  })
  it('does not generate warehouse stock for historical imports or when removed units are not restocked', () => {
    const f = fixture()
    f.order.inventoryApplied = false
    f.order.historical = true
    expect(
      reconcileOrderState(f.state, 'order', f.remote, f.input, 'Sorumlu').summary.movements,
    ).toEqual([])
    f.order.inventoryApplied = true
    f.order.historical = false
    expect(
      reconcileOrderState(
        f.state,
        'order',
        f.remote,
        { ...f.input, restockRemoved: false },
        'Sorumlu',
      ).summary.movements,
    ).toEqual([])
  })
  it('keeps committed invoices and inconsistent totals from being silently rewritten', () => {
    const f = fixture()
    f.state.invoices = [
      {
        id: 'invoice',
        number: 'FT-1',
        orderId: 'order',
        createdAt: f.order.createdAt,
        status: 'issued',
        externalId: '9000',
      },
    ]
    expect(() => reconcileOrderState(f.state, 'order', f.remote, f.input, 'Sorumlu')).toThrow(
      'Mali düzeltme',
    )
    f.state.invoices = []
    f.remote.total = 9999
    expect(() => reconcileOrderState(f.state, 'order', f.remote, f.input, 'Sorumlu')).toThrow(
      'kalemler',
    )
  })
})
