import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import {
  combinationKey,
  generateVariants,
  productAttributeValues,
  validateProductStructure,
} from '../src/domain/products'
import { commandSchema } from '../server/validation'
import type { AppState, Product, VariantAxis } from '../src/domain/types'

const now = '2026-10-23T10:00:00.000Z'
const axes: VariantAxis[] = [
  {
    id: 'color',
    name: 'Renk',
    values: [
      { id: 'white', name: 'Beyaz' },
      { id: 'black', name: 'Siyah' },
    ],
  },
  {
    id: 'size',
    name: 'Beden',
    values: [
      { id: 's', name: 'S' },
      { id: 'm', name: 'M' },
    ],
  },
]
function workspace(): AppState {
  const state = createEmptyState('Ürün Testi')
  state.products = [
    {
      id: 'product',
      name: 'Tişört',
      category: 'Giyim',
      brand: 'Test',
      description: '',
      art: 'bag',
      color: '#aabbcc',
      active: true,
      taxRate: 20,
      lowStock: 1,
      version: 1,
      variants: [
        {
          id: 'variant',
          name: 'Standart',
          sku: 'SKU-1',
          barcode: '0012345',
          price: 14990,
          cost: 7000,
          stock: 5,
          stockByWarehouse: { main: 2, shop: 3 },
        },
      ],
    },
  ]
  state.warehouses = [
    { id: 'main', name: 'Merkez', active: true },
    { id: 'shop', name: 'Mağaza', active: true },
  ]
  return state
}

describe('Ürün çalışma alanı kuralları', () => {
  it('builds combinations without duplicate SKUs and preserves entered data when expanding', () => {
    let sequence = 0
    const variants = generateVariants(axes, [], 'MODEL', ['MODEL-001'], () => `v-${++sequence}`)
    expect(variants).toHaveLength(4)
    expect(new Set(variants.map((v) => v.sku)).size).toBe(4)
    expect(variants[0].sku).toBe('MODEL-002')
    Object.assign(variants[0], { price: 19990, stock: 7, barcode: '00112233' })
    const expanded = structuredClone(axes)
    expanded[0].values.push({ id: 'blue', name: 'Mavi' })
    const result = generateVariants(expanded, variants, 'MODEL', [], () => `v-${++sequence}`)
    expect(result).toHaveLength(6)
    expect(result.find((v) => v.id === variants[0].id)).toEqual(variants[0])
    expect(result.filter((v) => v.options?.color === 'blue').every((v) => v.stock === 0)).toBe(true)
    expect(new Set(result.map((v) => v.sku)).size).toBe(6)
    expect(combinationKey({ 'a:b': 'c' })).not.toBe(combinationKey({ a: 'b:c' }))
  })

  it('rejects excessive or ambiguous option matrices before saving', () => {
    expect(() =>
      generateVariants(
        [
          {
            ...axes[0],
            values: Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: String(i) })),
          },
          {
            ...axes[1],
            values: Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: String(i) })),
          },
        ],
        [],
        'MODEL',
      ),
    ).toThrow('500')
    const product = workspace().products[0]
    product.variantAxes = [axes[0]]
    product.variants[0].options = { color: 'white' }
    product.variants.push({ ...product.variants[0], id: 'duplicate', sku: 'SKU-2' })
    expect(validateProductStructure(product)).toContain('kombinasyonu')
    product.variants = [product.variants[0]]
    product.variantAxes[0] = {
      ...axes[0],
      values: [...axes[0].values, { id: 'white-2', name: ' beyaz ' }],
    }
    expect(validateProductStructure(product)).toContain('tekrarlanamaz')
  })

  it('saves field-specific patches without replacing an intervening warehouse movement', () => {
    const original = workspace()
    const moved = executeCommand(
      original,
      {
        type: 'stock.adjust',
        variantId: 'variant',
        warehouseId: 'shop',
        quantity: 4,
        expectedQuantity: 3,
        note: 'Sayım',
      },
      now,
    ).state
    const saved = executeCommand(
      moved,
      {
        type: 'product.patch',
        id: 'product',
        expectedVersion: 1,
        patch: {
          changes: { subtitle: 'Yeni alt başlık' },
          variants: [{ id: 'variant', price: 17990 }],
        },
      },
      now,
    )
    expect(saved.result).toMatchObject({ ok: true, entityVersion: 2 })
    expect(saved.state.products[0].variants[0]).toMatchObject({
      stock: 6,
      stockByWarehouse: { main: 2, shop: 4 },
      price: 17990,
      cost: 7000,
      barcode: '0012345',
    })
    expect(saved.state.movements).toHaveLength(1)
    const stale = executeCommand(saved.state, {
      type: 'product.patch',
      id: 'product',
      expectedVersion: 1,
      patch: { changes: { name: 'Eski taslak' } },
    })
    expect(stale.result.ok).toBe(false)
    expect(stale.state).toBe(saved.state)
  })

  it('rejects absolute stock corrections after a sale and leaves the ledger untouched', () => {
    const sold = executeCommand(
      workspace(),
      {
        type: 'retail.sale',
        input: {
          warehouseId: 'shop',
          method: 'cash',
          items: [{ variantId: 'variant', quantity: 1 }],
        },
      },
      now,
    ).state
    const corrected = executeCommand(sold, {
      type: 'stock.adjust',
      variantId: 'variant',
      warehouseId: 'shop',
      quantity: 8,
      expectedQuantity: 3,
      note: 'Eski sayım',
    })
    expect(corrected.result.ok).toBe(false)
    expect(corrected.state).toBe(sold)
    expect(corrected.state.products[0].variants[0].stock).toBe(4)
    expect(corrected.state.movements).toHaveLength(1)
  })

  it('records new variant openings per warehouse and rolls back invalid multi-row patches', () => {
    const original = workspace()
    const added = {
      ...original.products[0].variants[0],
      id: 'new',
      sku: 'NEW-SKU',
      barcode: '009988',
      stock: 4,
      stockByWarehouse: { main: 1, shop: 3 },
    }
    const saved = executeCommand(
      original,
      { type: 'product.patch', id: 'product', expectedVersion: 1, patch: { newVariants: [added] } },
      now,
    )
    expect(saved.result.ok).toBe(true)
    expect(saved.state.movements.map((m) => [m.warehouseId, m.quantity]).sort()).toEqual([
      ['main', 1],
      ['shop', 3],
    ])
    const failed = executeCommand(original, {
      type: 'product.patch',
      id: 'product',
      expectedVersion: 1,
      patch: { changes: { name: 'Değişmemeli' }, newVariants: [{ ...added, sku: 'SKU-1' }] },
    })
    expect(failed.result.ok).toBe(false)
    expect(failed.state).toBe(original)
    expect(
      commandSchema.safeParse({
        type: 'product.patch',
        id: 'product',
        expectedVersion: 1,
        patch: { variants: [{ id: 'variant', stock: 999 }] },
      }).success,
    ).toBe(false)
  })

  it('rejects a stale price card after a weighted-cost purchase', () => {
    const purchased = executeCommand(
      workspace(),
      {
        type: 'expense.create',
        warehouseId: 'shop',
        expense: {
          id: 'purchase',
          number: 'AL-1',
          supplier: 'Tedarikçi',
          description: 'Yeni alış',
          category: 'Alış',
          amount: 24000,
          paid: false,
          method: 'transfer',
          dueAt: now,
          purchaseLines: [{ variantId: 'variant', quantity: 2, unitCost: 12000 }],
        },
      },
      now,
    )
    expect(purchased.result.ok).toBe(true)
    const stale = executeCommand(purchased.state, {
      type: 'product.patch',
      id: 'product',
      expectedVersion: 1,
      patch: { variants: [{ id: 'variant', cost: 7000 }] },
    })
    expect(stale.result.ok).toBe(false)
    expect(stale.state.products[0].variants[0].cost).toBe(8429)
  })

  it('snapshots invoice names and units on new sales rather than rewriting historical lines', () => {
    const original = workspace()
    original.products[0].invoiceName = 'Pamuklu tişört'
    original.products[0].unit = 'Set'
    const sale = executeCommand(
      original,
      {
        type: 'retail.sale',
        input: {
          method: 'cash',
          warehouseId: 'shop',
          items: [{ variantId: 'variant', quantity: 1 }],
        },
      },
      now,
    ).state
    const changed = executeCommand(sale, {
      type: 'product.patch',
      id: 'product',
      expectedVersion: 1,
      patch: { changes: { invoiceName: 'Yeni fatura adı', unit: 'Adet' } },
    }).state
    expect(changed.retailSales[0].lines[0]).toMatchObject({
      title: 'Tişört',
      invoiceTitle: 'Pamuklu tişört',
      unit: 'Set',
    })
    const again = executeCommand(
      changed,
      {
        type: 'retail.sale',
        input: {
          method: 'cash',
          warehouseId: 'shop',
          items: [{ variantId: 'variant', quantity: 1 }],
        },
      },
      now,
    ).state
    expect(again.retailSales[0].lines[0]).toMatchObject({
      invoiceTitle: 'Yeni fatura adı',
      unit: 'Adet',
    })
  })

  it('uses the variant axis ahead of a shared technical attribute with the same name', () => {
    const product: Product = {
      ...workspace().products[0],
      variantAxes: axes,
      technicalAttributes: [
        { id: 'material', name: 'Materyal', value: 'Pamuk' },
        { id: 'color-legacy', name: 'Renk', value: 'Genel' },
      ],
    }
    const variant = { ...product.variants[0], options: { color: 'black', size: 'm' } }
    expect([...productAttributeValues(product, variant).values()]).toEqual([
      { name: 'Materyal', value: 'Pamuk', source: 'product' },
      { name: 'Renk', value: 'Siyah', source: 'variant' },
      { name: 'Beden', value: 'M', source: 'variant' },
    ])
  })
})
