import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import {
  availableStock,
  findVariant,
  listingPrice,
  listingQuantity,
  netContribution,
  reservedStock,
  variantCost,
  variantPrice,
  variantStock,
} from '../src/domain/selectors'
import { stockAt } from '../src/domain/inventory'
import { snapshotBundle } from '../src/domain/bundles'
import { rebaseProductDraft } from '../src/domain/products'
import type { AppState, Command, ProductPatch } from '../src/domain/types'
import { catalogBundle, catalogParts } from './catalog-workspace-fixture'
import { ingestOrders } from '../server/worker'
import type { RemoteOrder } from '../src/domain/integrations'

const now = '2026-10-23T10:00:00.000Z'
const apply = (state: AppState, command: Command) => {
  const outcome = executeCommand(state, command, now)
  expect(outcome.result.ok, outcome.result.message).toBe(true)
  return outcome.state
}
function workspace() {
  let state = createEmptyState('Paket')
  state.warehouses = [
    { id: 'main', name: 'Merkez', active: true },
    { id: 'shop', name: 'Mağaza', active: true },
  ]
  state.customers = [
    {
      id: 'customer',
      name: 'Test',
      address: 'Örnek sokak',
      city: 'İstanbul',
      phone: '',
      email: '',
    },
  ]
  for (const product of [...catalogParts(), catalogBundle()])
    state = apply(state, { type: 'product.save', product })
  return state
}
const sale = (
  items: { variantId: string; quantity: number; bundleVersion?: number }[],
  warehouseId = 'main',
): Command => ({ type: 'retail.sale', input: { items, method: 'cash', warehouseId } })
const order = (quantity: number): Command => ({
  type: 'order.create',
  input: {
    customerId: 'customer',
    channel: 'manual',
    shipping: 0,
    note: '',
    items: [{ variantId: 'pack', quantity }],
  },
})

describe('shared bundle stock and frozen order contents', () => {
  it('freezes newly imported package orders and keeps historical recipe attribution unknown', async () => {
    let state = workspace()
    const remote: RemoteOrder = {
      externalId: 'remote-1',
      number: 'TR-1',
      status: 'Created',
      normalizedStatus: 'pending',
      createdAt: now,
      modifiedAt: now,
      recipient: {
        name: 'Test',
        address: 'Adres',
        city: 'İstanbul',
        district: 'Kadıköy',
        country: 'TR',
        phone: '',
      },
      shipping: 0,
      total: 3504,
      lines: [
        {
          externalId: 'line-1',
          sku: 'BANYO-PAKET',
          barcode: '000010',
          title: 'Hediye paketi',
          quantity: 1,
          unitPrice: 3504,
        },
      ],
    }
    const sql = { query: async () => ({ rows: [], rowCount: 0 }), exec: async () => {} }
    await ingestOrders(state, [remote], 'store', 'trendyol', sql, 'workspace')
    const frozen = structuredClone(state.orders[0].lines[0].bundleComponents)
    expect(frozen?.map((part) => part.quantity)).toEqual([2, 1])
    state = apply(state, {
      type: 'product.patch',
      id: 'bundle',
      expectedVersion: 1,
      patch: {
        changes: {
          bundle: { ...catalogBundle().bundle!, components: [{ variantId: 'a', quantity: 3 }] },
        },
      },
    })
    await ingestOrders(
      state,
      [
        {
          ...remote,
          status: 'Shipped',
          normalizedStatus: 'shipped',
          trackingNumber: '123',
          cargoProvider: 'PTT',
        },
      ],
      'store',
      'trendyol',
      sql,
      'workspace',
    )
    expect(state.orders[0].lines[0].bundleComponents).toEqual(frozen)
    expect(stockAt(findVariant(state, 'a')!.variant, 'main')).toBe(10)
    const moves = state.movements.length
    await ingestOrders(
      state,
      [{ ...remote, externalId: 'past', status: 'Delivered', normalizedStatus: 'delivered' }],
      'store',
      'trendyol',
      sql,
      'workspace',
    )
    expect(state.orders[0]).toMatchObject({ historical: true, inventoryApplied: false })
    expect(state.orders[0].lines[0]).toMatchObject({ costKnown: false, unitCost: 0 })
    expect(state.orders[0].lines[0].bundleComponents).toBeUndefined()
    expect(state.movements).toHaveLength(moves)
  })
  it('derives warehouse stock and rounded linked prices without creating a second stock balance', () => {
    let state = workspace()
    expect(variantPrice(state, 'pack')).toBe(3504)
    expect(variantCost(state, 'pack')).toBe(311)
    expect(variantStock(state, 'pack')).toBe(7)
    expect(variantStock(state, 'pack', 'main')).toBe(6)
    expect(variantStock(state, 'pack', 'shop')).toBe(1)
    expect(findVariant(state, 'pack')!.variant).toMatchObject({ stock: 0, price: 0, cost: 0 })
    state = apply(state, {
      type: 'stock.adjust',
      variantId: 'a',
      warehouseId: 'main',
      quantity: 1,
      note: 'Dağılım',
    })
    state = apply(state, {
      type: 'stock.adjust',
      variantId: 'a',
      warehouseId: 'shop',
      quantity: 1,
      note: 'Dağılım',
    })
    expect(variantStock(state, 'a')).toBe(2)
    expect(variantStock(state, 'pack')).toBe(0)
    expect(executeCommand(state, sale([{ variantId: 'pack', quantity: 1 }])).result.ok).toBe(false)
  })

  it('aggregates overlapping packages and physical lines before accepting a sale or reservation', () => {
    let state = workspace()
    const other = catalogBundle()
    other.id = 'second-bundle'
    other.name = 'İkili havlu'
    other.bundle!.components = [{ variantId: 'a', quantity: 2 }]
    other.variants = [{ ...other.variants[0], id: 'pair', sku: 'IKILI', barcode: '000011' }]
    state = apply(state, { type: 'product.save', product: other })
    for (const items of [
      [
        { variantId: 'pack', quantity: 4 },
        { variantId: 'pair', quantity: 3 },
      ],
      [
        { variantId: 'pack', quantity: 6 },
        { variantId: 'a', quantity: 1 },
      ],
    ]) {
      const rejected = executeCommand(state, sale(items))
      expect(rejected.result.ok).toBe(false)
      expect(rejected.state).toBe(state)
    }
    state = apply(state, order(4))
    expect(reservedStock(state, 'a')).toBe(8)
    expect(availableStock(state, 'pair', undefined, 'main')).toBe(2)
    expect(executeCommand(state, sale([{ variantId: 'a', quantity: 5 }])).result.ok).toBe(false)
    state = apply(state, sale([{ variantId: 'a', quantity: 4 }]))
    expect(availableStock(state, 'pack', undefined, 'main')).toBe(0)
  })

  it('uses the saved recipe for approval and cancellation after the product recipe has changed', () => {
    let state = apply(workspace(), order(2))
    const id = state.orders[0].id,
      frozen = structuredClone(state.orders[0].lines[0].bundleComponents)
    state = apply(state, {
      type: 'product.patch',
      id: 'bundle',
      expectedVersion: 1,
      patch: {
        changes: {
          bundle: {
            ...state.products.find((p) => p.id === 'bundle')!.bundle!,
            components: [
              { variantId: 'a', quantity: 1 },
              { variantId: 'b', quantity: 2 },
            ],
          },
        },
      },
    })
    state = apply(state, { type: 'order.transition', id, status: 'approved' })
    expect(stockAt(findVariant(state, 'a')!.variant, 'main')).toBe(8)
    expect(stockAt(findVariant(state, 'b')!.variant, 'main')).toBe(4)
    expect(state.orders[0].lines[0].bundleComponents).toEqual(frozen)
    expect(
      state.movements
        .filter((m) => m.reference === state.orders[0].number)
        .map((m) => m.quantity)
        .sort((a, b) => a - b),
    ).toEqual([-4, -2])
    state = apply(state, { type: 'order.transition', id, status: 'cancelled' })
    expect(stockAt(findVariant(state, 'a')!.variant, 'main')).toBe(12)
    expect(stockAt(findVariant(state, 'b')!.variant, 'main')).toBe(6)
    const movements = state.movements.length
    state = apply(state, { type: 'order.transition', id, status: 'cancelled' })
    expect(state.movements).toHaveLength(movements)
  })

  it('restocks partial returns from frozen components, preserves costs and prevents duplicate returns', () => {
    let state = apply(workspace(), sale([{ variantId: 'pack', quantity: 3 }]))
    const id = state.retailSales[0].id
    expect(state.retailSales[0].lines[0]).toMatchObject({
      unitPrice: 3504,
      unitCost: 311,
      costKnown: true,
    })
    state = apply(state, {
      type: 'product.patch',
      id: 'part-a',
      expectedVersion: 1,
      patch: { variants: [{ id: 'a', price: 3000, cost: 250 }] },
    })
    expect(variantPrice(state, 'pack')).toBe(7002)
    expect(state.retailSales[0].lines[0].unitCost).toBe(311)
    for (let i = 0; i < 3; i++)
      state = apply(state, {
        type: 'sale.return',
        source: 'retail',
        id: `return-${i}`,
        saleId: id,
        items: [{ lineIndex: 0, quantity: 1, restock: true }],
        refund: true,
        method: 'cash',
        note: 'İade',
      })
    expect(stockAt(findVariant(state, 'a')!.variant, 'main')).toBe(12)
    expect(stockAt(findVariant(state, 'b')!.variant, 'main')).toBe(6)
    expect(state.returns!.reduce((sum, r) => sum + r.refund, 0)).toBe(10512)
    const repeated = executeCommand(state, {
      type: 'sale.return',
      source: 'retail',
      id: 'return-2',
      saleId: id,
      items: [{ lineIndex: 0, quantity: 1, restock: true }],
      refund: true,
      method: 'cash',
      note: 'İade',
    })
    expect(repeated.state.movements).toHaveLength(state.movements.length)
    expect(
      executeCommand(state, {
        type: 'sale.return',
        source: 'retail',
        id: 'extra',
        saleId: id,
        items: [{ lineIndex: 0, quantity: 1, restock: true }],
        refund: true,
        method: 'cash',
        note: 'İade',
      }).result.ok,
    ).toBe(false)
  })

  it('keeps fixed prices stable and rejects a stale cart after changing package contents', () => {
    let state = workspace()
    const invalidPrice = executeCommand(state, {
      type: 'product.patch',
      id: 'part-a',
      expectedVersion: 1,
      patch: { variants: [{ id: 'a', price: 0 }] },
    })
    expect(invalidPrice.result.ok).toBe(false)
    expect(invalidPrice.state).toBe(state)
    state = apply(state, {
      type: 'product.patch',
      id: 'bundle',
      expectedVersion: 1,
      patch: {
        changes: { bundle: { ...catalogBundle().bundle!, priceMode: 'fixed' } },
        variants: [{ id: 'pack', price: 5000 }],
      },
    })
    state = apply(state, {
      type: 'product.patch',
      id: 'part-a',
      expectedVersion: 1,
      patch: { variants: [{ id: 'a', price: 4000 }] },
    })
    expect(variantPrice(state, 'pack')).toBe(5000)
    expect(
      executeCommand(state, sale([{ variantId: 'pack', quantity: 1, bundleVersion: 1 }])).result.ok,
    ).toBe(false)
    expect(
      executeCommand(state, sale([{ variantId: 'pack', quantity: 1, bundleVersion: 2 }])).result.ok,
    ).toBe(true)
  })

  it('blocks direct stock, transfer, count and purchase writes to a calculated package', () => {
    const state = workspace()
    const commands: Command[] = [
      { type: 'stock.adjust', variantId: 'pack', quantity: 100, note: 'Yazılamaz' },
      {
        type: 'stock.record',
        variantId: 'pack',
        warehouseId: 'main',
        quantity: 1,
        expectedQuantity: 0,
        direction: 'in',
        reason: 'purchase',
        note: '',
      },
      {
        type: 'stock.transfer',
        variantId: 'pack',
        quantity: 1,
        from: 'main',
        to: 'shop',
        note: 'Yazılamaz',
      },
      {
        type: 'stock.count.create',
        id: 'count',
        name: 'Paket sayımı',
        warehouseId: 'main',
        variantIds: ['a', 'pack'],
      },
      {
        type: 'expense.create',
        expense: {
          id: 'expense',
          number: 'AL1',
          supplier: 'Firma',
          category: 'Alış',
          description: 'Paket alış',
          amount: 10000,
          method: 'cash',
          paid: true,
          dueAt: now,
          purchaseLines: [
            { variantId: 'a', quantity: 1, unitCost: 5000 },
            { variantId: 'pack', quantity: 1, unitCost: 5000 },
          ],
        },
      },
    ]
    for (const command of commands) {
      const outcome = executeCommand(state, command)
      expect(outcome.result.ok).toBe(false)
      expect(outcome.state).toBe(state)
    }
  })

  it('does not restock a shipped provider order while its stock deduction is still unresolved', () => {
    const state = apply(workspace(), order(1))
    state.orders[0].status = 'shipped'
    state.orders[0].syncStatus = 'error'
    const result = executeCommand(state, {
      type: 'sale.return',
      source: 'order',
      id: 'unapplied-return',
      saleId: state.orders[0].id,
      items: [{ lineIndex: 0, quantity: 1, restock: true }],
      refund: false,
      method: 'cash',
      note: 'İade',
    })
    expect(result.result.ok).toBe(false)
    expect(result.state).toBe(state)
  })

  it('rejects missing order recipes and invalid nested or single-unit packages without partial writes', () => {
    let state = workspace()
    for (const components of [
      [{ variantId: 'a', quantity: 1 }],
      [{ variantId: 'pack', quantity: 2 }],
      [
        { variantId: 'a', quantity: 2 },
        { variantId: 'a', quantity: 1 },
      ],
    ]) {
      const invalid = { ...catalogBundle(), bundle: { ...catalogBundle().bundle!, components } }
      const outcome = executeCommand(state, { type: 'product.save', product: invalid })
      expect(outcome.result.ok).toBe(false)
      expect(outcome.state).toBe(state)
    }
    state = apply(state, order(1))
    delete state.orders[0].lines[0].bundleComponents
    expect(
      executeCommand(state, {
        type: 'order.transition',
        id: state.orders[0].id,
        status: 'approved',
      }).result.ok,
    ).toBe(false)
    state.orders[0].status = 'approved'
    state.orders[0].inventoryApplied = true
    expect(
      executeCommand(state, {
        type: 'order.transition',
        id: state.orders[0].id,
        status: 'cancelled',
      }).result.ok,
    ).toBe(false)
  })

  it('computes listings from shared availability and keeps explicit store prices ahead of bundle pricing', () => {
    let state = apply(workspace(), order(2))
    const listing = {
      id: 'listing',
      productId: 'bundle',
      variantId: 'pack',
      storeId: 'store',
      channel: 'trendyol' as const,
      status: 'active' as const,
      updatedAt: now,
    }
    expect(listingQuantity(state, listing, 1, 'main')).toBe(3)
    expect(listingPrice(state, listing)).toBe(3504)
    expect(listingPrice(state, { ...listing, priceOverride: 6000 })).toBe(6000)
    state = apply(state, sale([{ variantId: 'a', quantity: 7 }]))
    expect(listingQuantity(state, listing, 0, 'main')).toBe(0)
  })

  it('rebases server-derived description and stock while retaining unsaved edits in other cards', () => {
    const state = workspace(),
      base = structuredClone(findVariant(state, 'pack')!.product),
      draft = structuredClone(base)
    draft.bundle!.discountBps = 2000
    draft.note = 'Henüz kaydedilmedi'
    const patch: ProductPatch = { changes: { bundle: { ...base.bundle!, discountBps: 2000 } } }
    const committed = {
      ...base,
      bundle: draft.bundle,
      description: 'Sunucunun içerik tablosu',
      version: 2,
    }
    const rebased = rebaseProductDraft(base, draft, committed, patch)
    expect(rebased.note).toBe('Henüz kaydedilmedi')
    expect(rebased.description).toBe(committed.description)
    expect(rebased.bundle).toEqual(committed.bundle)
    expect(rebased.version).toBe(2)
  })

  it('uses each frozen component VAT rate when reversing the contribution of a returned package', () => {
    let state = apply(workspace(), order(3))
    const id = state.orders[0].id
    state = apply(state, { type: 'order.transition', id, status: 'approved' })
    state = apply(state, {
      type: 'order.transition',
      id,
      status: 'shipped',
      shipment: { carrier: 'PTT', trackingNumber: 'TEST' },
    })
    state = apply(state, { type: 'order.transition', id, status: 'delivered' })
    expect(snapshotBundle(state, 'pack')?.map((part) => part.taxRate)).toEqual([20, 10])
    expect(netContribution(state, state.orders[0])).toBe(7958)
    for (let index = 0; index < 3; index++)
      state = apply(state, {
        type: 'sale.return',
        source: 'order',
        id: `return-${index}`,
        saleId: id,
        items: [{ lineIndex: 0, quantity: 1, restock: true }],
        refund: false,
        method: 'cash',
        note: 'İade',
      })
    expect(netContribution(state, state.orders[0])).toBe(0)
  })
})
