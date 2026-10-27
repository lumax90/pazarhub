import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import { customerBalance, listingPrice } from '../src/domain/selectors'
import { stockAt } from '../src/domain/inventory'
import type { AppState, Command } from '../src/domain/types'

function workspace(): AppState {
  const state = createEmptyState('Test')
  state.products = [
    {
      id: 'p1',
      name: 'Ürün',
      category: 'Kategori',
      brand: 'Marka',
      description: '',
      art: 'cup',
      color: '#abcdef',
      taxRate: 20,
      active: true,
      lowStock: 1,
      version: 1,
      variants: [
        {
          id: 'v1',
          name: 'Standart',
          sku: 'SKU1',
          barcode: '1234567890123',
          stock: 5,
          price: 10001,
          cost: 6000,
        },
      ],
    },
  ]
  state.customers = [
    {
      id: 'c1',
      name: 'Müşteri',
      phone: '05555555555',
      email: 'test@example.com',
      city: 'İstanbul',
      address: 'Örnek mahalle sokak no 1',
    },
  ]
  return state
}
const run = (state: AppState, command: Command) =>
  executeCommand(state, command, '2026-10-23T10:00:00.000Z')

describe('shared warehouse and accounting rules', () => {
  it('protects reserved stock during transfers and applies both sides atomically', () => {
    let state = workspace()
    state = run(state, {
      type: 'warehouse.save',
      warehouse: { id: 'branch', name: 'Şube', active: true },
    }).state
    state = run(state, {
      type: 'order.create',
      input: {
        customerId: 'c1',
        channel: 'manual',
        items: [{ variantId: 'v1', quantity: 4 }],
        shipping: 0,
        note: '',
      },
    }).state
    expect(
      run(state, {
        type: 'stock.transfer',
        variantId: 'v1',
        from: 'main',
        to: 'branch',
        quantity: 2,
        note: 'Transfer',
      }).result.ok,
    ).toBe(false)
    const moved = run(state, {
      type: 'stock.transfer',
      variantId: 'v1',
      from: 'main',
      to: 'branch',
      quantity: 1,
      note: 'Transfer',
    })
    expect(moved.result.ok).toBe(true)
    expect(moved.state.products[0].variants[0].stock).toBe(5)
    expect(stockAt(moved.state.products[0].variants[0], 'main')).toBe(4)
    expect(stockAt(moved.state.products[0].variants[0], 'branch')).toBe(1)
    expect(moved.state.movements.slice(0, 2).reduce((sum, m) => sum + m.quantity, 0)).toBe(0)
  })
  it('uses the selected warehouse for retail instead of borrowing another location’s stock', () => {
    let state = workspace()
    state = run(state, {
      type: 'warehouse.save',
      warehouse: { id: 'branch', name: 'Şube', active: true },
    }).state
    const failed = run(state, {
      type: 'retail.sale',
      input: { items: [{ variantId: 'v1', quantity: 1 }], method: 'cash', warehouseId: 'branch' },
    })
    expect(failed.result.ok).toBe(false)
    expect(failed.state.cash).toHaveLength(0)
  })
  it('rejects stale counts and does not overwrite intervening sales', () => {
    let state = workspace()
    state = run(state, {
      type: 'stock.count.create',
      id: 'count1',
      name: 'Sayım',
      warehouseId: 'main',
      variantIds: ['v1'],
    }).state
    state = run(state, {
      type: 'retail.sale',
      input: { items: [{ variantId: 'v1', quantity: 1 }], method: 'cash' },
    }).state
    const result = run(state, { type: 'stock.count.complete', id: 'count1', counts: { v1: 5 } })
    expect(result.result.ok).toBe(false)
    expect(result.state.products[0].variants[0].stock).toBe(4)
    expect(result.state.stockCounts?.[0].status).toBe('open')
  })
  it('handles credit sales, customer cash entries and partial return refunds without double charging', () => {
    const state = run(workspace(), {
      type: 'retail.sale',
      input: {
        customerId: 'c1',
        items: [{ variantId: 'v1', quantity: 2 }],
        method: 'card',
        payments: [{ method: 'card', amount: 10000 }],
      },
    }).state
    expect(customerBalance(state, 'c1')).toBe(10002)
    const returned = run(state, {
      type: 'sale.return',
      id: 'return1',
      source: 'retail',
      saleId: state.retailSales[0].id,
      items: [{ lineIndex: 0, quantity: 1, restock: false }],
      refund: true,
      method: 'card',
      note: 'Hasarlı ürün',
    })
    expect(returned.state.returns?.[0].refund).toBe(10000)
    expect(returned.state.products[0].variants[0].stock).toBe(3)
    expect(customerBalance(returned.state, 'c1')).toBe(10001)
    const paid = run(returned.state, {
      type: 'cash.record',
      id: 'payment1',
      kind: 'in',
      customerId: 'c1',
      method: 'cash',
      amount: 10001,
      description: 'Kalan alacak',
    })
    expect(customerBalance(paid.state, 'c1')).toBe(0)
  })
  it('returns all discounted quantities to exactly the original total in kuruş', () => {
    let state = run(workspace(), {
      type: 'retail.sale',
      input: { items: [{ variantId: 'v1', quantity: 3 }], method: 'cash', discount: 1 },
    }).state
    const saleId = state.retailSales[0].id
    expect(state.retailSales[0].total).toBe(30002)
    for (let index = 0; index < 3; index++)
      state = run(state, {
        type: 'sale.return',
        id: `r${index}`,
        source: 'retail',
        saleId,
        items: [{ lineIndex: 0, quantity: 1, restock: true }],
        refund: true,
        method: 'cash',
        note: 'İade',
      }).state
    expect(state.returns?.reduce((sum, r) => sum + r.refund, 0)).toBe(30002)
    expect(state.products[0].variants[0].stock).toBe(5)
    expect(
      run(state, {
        type: 'sale.return',
        id: 'overflow',
        source: 'retail',
        saleId,
        items: [{ lineIndex: 0, quantity: 1, restock: true }],
        refund: true,
        method: 'cash',
        note: 'İade',
      }).result.ok,
    ).toBe(false)
  })
  it('records an expense payment once and treats a transfer as zero net cash flow', () => {
    let state = run(workspace(), {
      type: 'expense.create',
      expense: {
        id: 'e1',
        number: 'GD1',
        supplier: 'Firma',
        category: 'Kira',
        description: 'Kira',
        amount: 50000,
        paid: false,
        method: 'transfer',
        dueAt: '2026-10-23T00:00:00.000Z',
      },
    }).state
    state = run(state, { type: 'expense.pay', id: 'e1' }).state
    state = run(state, { type: 'expense.pay', id: 'e1' }).state
    expect(state.cash).toHaveLength(1)
    state = run(state, {
      type: 'cash.transfer',
      id: 't1',
      from: 'cash',
      to: 'transfer',
      amount: 10000,
      description: 'Virman',
    }).state
    expect(
      state.cash
        .filter((c) => c.transferId)
        .reduce((sum, c) => sum + (c.kind === 'in' ? c.amount : -c.amount), 0),
    ).toBe(0)
  })
  it('gives explicit listing prices precedence over computed commission-inclusive margins', () => {
    const state = workspace()
    state.connections = [{ id: 'store1', name: 'Mağaza', channel: 'trendyol', active: true }]
    state.products[0].variants[0].cost = 10000
    const updated = run(state, {
      type: 'margin.save',
      rule: {
        id: 'm1',
        storeId: 'store1',
        scope: 'all',
        value: '',
        base: 'cost',
        markupBps: 2000,
        commissionBps: 2000,
        fixedCost: 1000,
        active: true,
      },
    }).state
    const listing = {
      id: 'l1',
      productId: 'p1',
      variantId: 'v1',
      storeId: 'store1',
      channel: 'trendyol' as const,
      status: 'active' as const,
      updatedAt: '2026-10-23T00:00:00.000Z',
    }
    expect(listingPrice(updated, listing)).toBe(16250)
    expect(listingPrice(updated, { ...listing, priceOverride: 12000 })).toBe(12000)
  })
  it('rolls back the whole bulk operation when any previewed version is stale', () => {
    const state = workspace()
    state.products.push({
      ...structuredClone(state.products[0]),
      id: 'p2',
      version: 2,
      variants: [
        { ...state.products[0].variants[0], id: 'v2', sku: 'SKU2', barcode: '2222222222222' },
      ],
    })
    const result = run(state, {
      type: 'product.bulk',
      ids: ['p1', 'p2'],
      expectedVersions: { p1: 1, p2: 1 },
      change: { pricePercent: 10 },
    })
    expect(result.result.ok).toBe(false)
    expect(result.state.products[0].variants[0].price).toBe(10001)
  })
})
