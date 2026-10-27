import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultEcommerceSettings } from '../src/domain/ecommerce'
import { catalogParts, catalogBundle } from './catalog-workspace-fixture'
import { executeCommand } from '../src/domain/operations'
import {
  allocateOrderStock,
  reserveOrderWarehouses,
  storeWarehouseIds,
} from '../src/domain/stock-allocation'
import { availableStock, listingQuantity, reservedStock } from '../src/domain/selectors'
import { warehouseReserved } from '../src/domain/inventory'
import { reconcileOrderState } from '../server/order-reconciliation'
import type { Order, OrderLine, Listing } from '../src/domain/types'
import type { RemoteOrder } from '../src/domain/integrations'

function fixture() {
  const state = createEmptyState('Depolar')
  state.warehouses = [
    { id: 'main', name: 'Merkez', active: true },
    { id: 'shop', name: 'Mağaza', active: true },
  ]
  state.ecommerce = {
    ...defaultEcommerceSettings,
    stockScope: 'selected',
    warehouseIds: ['main', 'shop'],
  }
  state.products = [...catalogParts(), catalogBundle()]
  state.customers = [
    {
      id: 'c',
      name: 'Müşteri',
      email: '',
      phone: '5551234567',
      address: 'Test Mahallesi Sokak 1',
      city: 'İstanbul',
      district: 'Kadıköy',
    },
  ]
  return state
}
function balances(state: ReturnType<typeof fixture>, id: string, main: number, shop: number) {
  const variant = state.products
    .flatMap((product) => product.variants)
    .find((variant) => variant.id === id)!
  variant.stockByWarehouse = { main, shop }
  variant.stock = main + shop
}
const listing: Listing = {
  id: 'l',
  productId: 'bundle',
  variantId: 'pack',
  channel: 'trendyol',
  storeId: 's',
  status: 'active',
  updatedAt: '',
}
describe('multi-warehouse ecommerce stock', () => {
  it('returns complete bundle units to their original warehouses and excludes previously unstocked returned units', () => {
    const state = fixture()
    balances(state, 'a', 2, 4)
    balances(state, 'b', 1, 2)
    let result = executeCommand(state, {
      type: 'order.create',
      input: {
        customerId: 'c',
        channel: 'manual',
        items: [{ variantId: 'pack', quantity: 3 }],
        shipping: 0,
        note: '',
      },
    })
    const id = result.result.id!
    result = executeCommand(result.state, { type: 'order.transition', id, status: 'approved' })
    result = executeCommand(result.state, {
      type: 'order.transition',
      id,
      status: 'shipped',
      shipment: { carrier: 'Aras', trackingNumber: 'TRACK' },
    })
    result = executeCommand(result.state, {
      type: 'sale.return',
      id: 'return1',
      source: 'order',
      saleId: id,
      items: [{ lineIndex: 0, quantity: 1, restock: false }],
      refund: false,
      method: 'cash',
      note: 'İlk paket hasarlı.',
    })
    expect(result.result.ok, result.result.message).toBe(true)
    result = executeCommand(result.state, {
      type: 'sale.return',
      id: 'return2',
      source: 'order',
      saleId: id,
      items: [{ lineIndex: 0, quantity: 2, restock: true }],
      refund: false,
      method: 'cash',
      note: 'Mağazadan çıkan iki paket döndü.',
    })
    expect(result.result.ok, result.result.message).toBe(true)
    expect(result.state.products[0].variants[0].stockByWarehouse).toEqual({ main: 0, shop: 4 })
    expect(result.state.products[1].variants[0].stockByWarehouse).toEqual({ main: 0, shop: 2 })
  })
  it('does not assemble a bundle from components in different warehouses', () => {
    const state = fixture()
    balances(state, 'a', 2, 0)
    balances(state, 'b', 0, 1)
    expect(listingQuantity(state, listing)).toBe(0)
    const created = executeCommand(state, {
      type: 'order.create',
      input: {
        customerId: 'c',
        channel: 'manual',
        shipping: 0,
        note: '',
        items: [{ variantId: 'pack', quantity: 1 }],
      },
    })
    expect(created.result.ok).toBe(false)
    expect(created.state).toBe(state)
  })
  it('reserves overlapping packages and standalone components, consumes their assigned warehouses and cancels using the frozen allocation', () => {
    const state = fixture()
    balances(state, 'a', 3, 4)
    balances(state, 'b', 0, 2)
    const created = executeCommand(state, {
      type: 'order.create',
      input: {
        customerId: 'c',
        channel: 'manual',
        shipping: 0,
        note: '',
        items: [
          { variantId: 'a', quantity: 3 },
          { variantId: 'pack', quantity: 2 },
        ],
      },
    })
    expect(created.result.ok, created.result.message).toBe(true)
    const id = created.state.orders[0].id
    expect(reservedStock(created.state, 'a')).toBe(7)
    expect(warehouseReserved(created.state, 'a', 'main')).toBe(3)
    expect(warehouseReserved(created.state, 'a', 'shop')).toBe(4)
    expect(availableStock(created.state, 'pack')).toBe(0)
    const approved = executeCommand(created.state, {
      type: 'order.transition',
      id,
      status: 'approved',
    })
    expect(approved.result.ok, approved.result.message).toBe(true)
    expect(approved.state.products[0].variants[0].stock).toBe(0)
    approved.state.products[2].bundle!.components = [{ variantId: 'b', quantity: 9 }]
    approved.state.ecommerce!.warehouseIds = ['main']
    const cancelled = executeCommand(approved.state, {
      type: 'order.transition',
      id,
      status: 'cancelled',
    })
    expect(cancelled.result.ok).toBe(true)
    expect(cancelled.state.products[0].variants[0].stockByWarehouse).toEqual({ main: 3, shop: 4 })
    expect(cancelled.state.products[1].variants[0].stockByWarehouse).toEqual({ main: 0, shop: 2 })
  })
  it('keeps the first pending order reserved before accepting another order', () => {
    const state = fixture()
    balances(state, 'a', 2, 2)
    const first = executeCommand(state, {
      type: 'order.create',
      input: {
        customerId: 'c',
        channel: 'manual',
        shipping: 0,
        note: '',
        items: [{ variantId: 'a', quantity: 3 }],
      },
    })
    expect(first.result.ok).toBe(true)
    const second = executeCommand(first.state, {
      type: 'order.create',
      input: {
        customerId: 'c',
        channel: 'manual',
        shipping: 0,
        note: '',
        items: [{ variantId: 'a', quantity: 2 }],
      },
    })
    expect(second.result.ok).toBe(false)
    expect(second.state).toBe(first.state)
    expect(availableStock(first.state, 'a')).toBe(1)
  })
  it('preserves the already consumed allocation during quantity reconciliation even after a different warehouse is replenished', () => {
    const state = fixture()
    balances(state, 'a', 1, 2)
    const created = executeCommand(state, {
      type: 'order.create',
      input: {
        customerId: 'c',
        channel: 'manual',
        shipping: 0,
        note: '',
        items: [{ variantId: 'a', quantity: 3 }],
      },
    })
    const approved = executeCommand(created.state, {
      type: 'order.transition',
      id: created.result.id!,
      status: 'approved',
    })
    const next = approved.state,
      order = next.orders[0]
    order.externalId = 'remote'
    order.storeId = 's'
    order.externalNumber = '100'
    order.channel = 'pazarama'
    order.lines[0].externalId = 'line'
    balances(next, 'a', 10, 0)
    const remote: RemoteOrder = {
      externalId: 'remote',
      number: '100',
      createdAt: order.createdAt,
      modifiedAt: order.createdAt,
      status: '12',
      total: order.lines[0].unitPrice * 2,
      shipping: 0,
      normalizedStatus: 'pending',
      recipient: {
        name: 'Müşteri',
        address: 'Adres',
        city: 'İstanbul',
        district: 'Kadıköy',
        phone: '5551234567',
        country: 'TR',
      },
      lines: [
        {
          externalId: 'line',
          sku: 'HAVLU',
          barcode: '',
          title: 'Havlu',
          quantity: 2,
          unitPrice: order.lines[0].unitPrice,
          taxRate: order.lines[0].taxRate,
        },
      ],
    }
    const result = reconcileOrderState(
      next,
      order.id,
      remote,
      { mappings: { line: 'a' }, restockRemoved: true, note: 'Azalan miktar doğrulandı.' },
      'Sorumlu',
    )
    expect(result.summary.movements).toMatchObject([
      { warehouseId: 'shop', variantId: 'a', quantity: 1 },
    ])
    expect(result.state.products[0].variants[0].stockByWarehouse).toEqual({ main: 10, shop: 1 })
  })
  it('reserves mapped lines in the actual warehouse while another line is not mapped yet', () => {
    const state = fixture()
    balances(state, 'a', 0, 3)
    const order = {
      id: 'o',
      status: 'pending',
      inventoryApplied: false,
      historical: false,
      lines: [
        { variantId: 'a', quantity: 2 },
        { variantId: '', quantity: 1 },
      ],
    } as Order
    state.orders = [order]
    reserveOrderWarehouses(state, order, ['main', 'shop'])
    expect(warehouseReserved(state, 'a', 'shop')).toBe(2)
    expect(warehouseReserved(state, 'a', 'main')).toBe(0)
    expect(storeWarehouseIds(state, { warehouseId: 'shop' })).toEqual(['shop'])
    expect(storeWarehouseIds(state, {})).toEqual(['main', 'shop'])
    expect(
      allocateOrderStock(state, [{ variantId: 'a', quantity: 1 } as OrderLine], ['main', 'shop']),
    ).toEqual([{ warehouseId: 'shop', variantId: 'a', quantity: 1, lineIndex: 0 }])
  })
})
