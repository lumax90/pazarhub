import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import { calculateMargin, defaultMarginSettings, listingPricing } from '../src/domain/margins'
import { catalogDefaults, categoryMappingFor } from '../src/domain/catalog-mappings'
import { catalogParts } from './catalog-workspace-fixture'
import { defaultEcommerceSettings } from '../src/domain/ecommerce'
import { exclusivePrice, fromTry, inclusivePrice, toTry } from '../src/domain/money'
import { parseTcmb } from '../server/exchange-rates'
import { orderDueDate } from '../src/domain/orders'
import type { Listing, MarginRule } from '../src/domain/types'
import { isLowStock, listingQuantity, lowStockProducts } from '../src/domain/selectors'

const rule: MarginRule = {
  id: 'rule',
  storeId: 'store',
  scope: 'all',
  value: '',
  base: 'price',
  markupBps: 5000,
  commissionBps: 2000,
  fixedCost: 1000,
  shippingCost: 2000,
  active: true,
  formula: 'costsBefore',
  version: 0,
}
const listing: Listing = {
  id: 'listing',
  productId: 'part-a',
  variantId: 'a',
  storeId: 'store',
  channel: 'trendyol',
  status: 'active',
  updatedAt: '',
}
function state() {
  const state = createEmptyState('Fiyat')
  state.products = catalogParts()
  state.connections = [{ id: 'store', name: 'Mağaza', channel: 'trendyol', active: true }]
  state.warehouses = [
    { id: 'main', name: 'Merkez', active: true },
    { id: 'shop', name: 'Mağaza', active: true },
  ]
  return state
}
const xml = `<Tarih_Date Tarih="23.10.2026">${[
  ['USD', '1', '49.6540'],
  ['EUR', '1', '55.5997'],
  ['JPY', '100', '31.7316'],
]
  .map(
    ([code, unit, rate]) =>
      `<Currency CurrencyCode="${code}"><Unit>${unit}</Unit><ForexBuying>${rate}</ForexBuying><ForexSelling>${rate}</ForexSelling><BanknoteBuying>${rate}</BanknoteBuying><BanknoteSelling>${rate}</BanknoteSelling></Currency>`,
  )
  .join('')}</Tarih_Date>`

describe('verified margin formulas, mapping defaults and currency boundaries', () => {
  it('sets default shipment deadlines to the end of the Istanbul calendar day', () => {
    expect(orderDueDate('2026-10-24T22:30:00.000Z', 2)).toBe('2026-10-27T20:59:59.999Z')
    expect(orderDueDate('2026-10-24T10:00:00.000Z', 0)).toBe('2026-10-24T20:59:59.999Z')
  })
  it('keeps the last computed price when automatic pricing is disabled and supports an explicit refresh', () => {
    const workspace = state()
    workspace.products[0].variants[0].price = 10000
    workspace.listings = [listing]
    workspace.marginRules = [rule]
    const disabled = executeCommand(workspace, {
      type: 'margin.settings',
      settings: { ...defaultMarginSettings('store'), enabled: false },
    })
    expect(disabled.result.ok).toBe(true)
    disabled.state.products[0].variants[0].price = 20000
    expect(listingPricing(disabled.state, disabled.state.listings[0]).price).toBe(24375)
    const applied = executeCommand(disabled.state, { type: 'margin.apply', storeId: 'store' })
    expect(applied.result.ok).toBe(true)
    expect(listingPricing(applied.state, applied.state.listings[0]).price).toBe(43125)
    expect(applied.state.marginSettings?.[0].enabled).toBe(false)
  })
  it('counts a warehouse threshold even when total stock is sufficient and rejects stale threshold changes', () => {
    const workspace = state()
    const changed = executeCommand(workspace, {
      type: 'stock.thresholds',
      variantId: 'a',
      expected: {},
      thresholds: { shop: 3 },
    })
    expect(changed.result.ok).toBe(true)
    expect(isLowStock(changed.state, 'a')).toBe(true)
    expect(isLowStock(changed.state, 'a', 'main')).toBe(false)
    expect(lowStockProducts(changed.state).map((product) => product.id)).toContain('part-a')
    expect(
      executeCommand(changed.state, {
        type: 'stock.thresholds',
        variantId: 'a',
        expected: {},
        thresholds: { shop: 1 },
      }).result.ok,
    ).toBe(false)
  })
  it('matches the Supsem live 100 + 20 + 10, 50%, 20% example and keeps alternate formulas distinct', () => {
    const settings = defaultMarginSettings('store')
    expect(calculateMargin(10000, rule, settings).price).toBe(24375)
    expect(calculateMargin(10000, rule, { ...settings, formula: 'costsAfter' }).price).toBe(21750)
    expect(calculateMargin(10000, rule, { ...settings, commissionMode: 'add' }).price).toBe(23400)
    expect(calculateMargin(10000, { ...rule, formula: 'legacy' }, settings).price).toBe(22500)
    expect(
      calculateMargin(
        10000,
        { ...rule, kind: 'fixed', amount: 19999 },
        { ...settings, rounding: 'ceil' },
      ).price,
    ).toBe(19999)
    expect(calculateMargin(10000, { ...rule, excluded: true }, settings).price).toBe(10000)
  })
  it('rounds upwards correctly at 99/95 boundaries and supports absolute reductions', () => {
    const bare = { ...rule, markupBps: 0, commissionBps: 0, shippingCost: 0, fixedCost: 0 }
    for (const [base, rounding, result] of [
      [10099, 'up99', 10099],
      [10100, 'up99', 10199],
      [10096, 'up95', 10195],
      [10001, 'ceil', 10100],
      [10050, 'nearest', 10100],
    ] as const)
      expect(
        calculateMargin(base, bare, { ...defaultMarginSettings('store'), rounding }).price,
      ).toBe(result)
    expect(
      calculateMargin(
        10000,
        { ...bare, kind: 'amount', direction: 'decrease', amount: 2500 },
        defaultMarginSettings('store'),
      ).price,
    ).toBe(7500)
  })
  it('selects the narrowest scope and keeps explicit prices, exclusions and unchanged legacy rules stable', () => {
    const workspace = state(),
      product = workspace.products[0]
    product.variants[0].price = 10000
    product.dimensions = { desi: 3 }
    workspace.marginRules = [
      { ...rule, id: 'all' },
      {
        ...rule,
        id: 'band',
        scope: 'priceRange',
        minimum: 9000,
        maximum: 11000,
        kind: 'fixed',
        amount: 25000,
      },
      { ...rule, id: 'desi', scope: 'desi', minimum: 2, maximum: 4, kind: 'fixed', amount: 30000 },
      { ...rule, id: 'product', scope: 'product', value: product.id, excluded: true },
    ]
    expect(listingPricing(workspace, listing).price).toBe(10000)
    workspace.marginRules.pop()
    expect(listingPricing(workspace, listing).price).toBe(30000)
    expect(listingPricing(workspace, { ...listing, priceOverride: 9000 }).price).toBe(9000)
    workspace.marginSettings = [
      { ...defaultMarginSettings('store'), listPriceMode: 'markup', listMarkupBps: 3000 },
    ]
    expect(listingPricing(workspace, listing).listPrice).toBe(39000)
    workspace.marginRules = [
      {
        ...rule,
        formula: undefined,
        shippingCost: 0,
        fixedCost: 1000,
        base: 'cost',
        markupBps: 2000,
      },
    ]
    delete workspace.marginSettings
    product.variants[0].cost = 10000
    expect(listingPricing(workspace, listing).price).toBe(16250)
  })
  it('rejects stale rule edits and overlapping inclusive ranges atomically', () => {
    const workspace = state()
    const first = executeCommand(workspace, {
      type: 'margin.save',
      rule: { ...rule, scope: 'priceRange', minimum: 100, maximum: 200 },
    })
    expect(first.result.ok).toBe(true)
    const stale = executeCommand(first.state, { type: 'margin.save', rule })
    expect(stale.result.ok).toBe(false)
    const overlap = executeCommand(first.state, {
      type: 'margin.save',
      rule: { ...rule, id: 'next', scope: 'priceRange', minimum: 200, maximum: 300 },
    })
    expect(overlap.result.ok).toBe(false)
    expect(overlap.state).toBe(first.state)
  })
  it('shares provider mappings across stores and preserves store and listing overrides', () => {
    const workspace = state(),
      product = workspace.products[0],
      variant = product.variants[0]
    product.categoryId = 'category'
    product.brandId = 'brand'
    product.variantAxes = [
      {
        id: 'axis',
        name: 'Beden',
        definitionId: 'size',
        values: [{ id: 's', name: 'S', definitionValueId: 'small' }],
      },
    ]
    variant.options = { axis: 's' }
    workspace.categoryMappings = [
      {
        id: 'global',
        provider: 'trendyol',
        storeId: 'first-store',
        localCategory: 'Banyo',
        localCategoryId: 'category',
        categoryId: '10',
        categoryName: 'Banyo',
        attributes: { '100': { valueIds: ['7'] } },
        version: 1,
        updatedAt: '',
      },
    ]
    workspace.catalogValueMappings = [
      {
        id: 'b',
        provider: 'trendyol',
        kind: 'brand',
        definitionId: 'brand',
        brandId: '42',
        brandName: 'Marka',
        values: {},
        version: 1,
        updatedAt: '',
      },
      {
        id: 's',
        provider: 'trendyol',
        kind: 'variant',
        definitionId: 'size',
        categoryId: '10',
        attributeId: '101',
        values: { small: { valueIds: ['11'] } },
        version: 1,
        updatedAt: '',
      },
    ]
    expect(categoryMappingFor(workspace, 'other-store', 'trendyol', product)?.id).toBe('global')
    expect(catalogDefaults(workspace, listing, product, variant)).toMatchObject({
      brandId: '42',
      attributes: { '100': { valueIds: ['7'] }, '101': { valueIds: ['11'] } },
    })
    expect(
      catalogDefaults(
        workspace,
        { ...listing, publishConfig: { categoryId: '20', attributes: {} } },
        product,
        variant,
      ).attributes,
    ).toEqual({})
  })
  it('parses TCMB quote units and performs exact currency and VAT conversion', () => {
    const rates = parseTcmb(xml)
    expect(rates.date).toBe('2026-10-23')
    expect(rates.rates.JPY?.forexSelling).toBe('31731600')
    expect(toTry(100, 'JPY', rates)).toBe(32)
    expect(toTry(10000, 'USD', rates)).toBe(496540)
    expect(fromTry(496540, 'USD', rates)).toBe(10000)
    expect(inclusivePrice(10000, 20)).toBe(12000)
    expect(exclusivePrice(12000, 20)).toBe(10000)
    expect(toTry(100, 'EUR')).toBeNaN()
    expect(() => parseTcmb('<Tarih_Date/>')).toThrow()
  })
  it('freezes converted sales and their exchange rate despite later rate changes', () => {
    const workspace = state()
    workspace.exchangeRates = parseTcmb(xml)
    workspace.products[0].currency = 'USD'
    workspace.products[0].variants[0].price = 10000
    const sale = executeCommand(workspace, {
      type: 'retail.sale',
      input: { method: 'cash', items: [{ variantId: 'a', quantity: 1 }] },
    })
    expect(sale.result.ok).toBe(true)
    expect(sale.state.retailSales[0].lines[0]).toMatchObject({
      unitPrice: 496540,
      catalogCurrency: 'USD',
      catalogExchangeRate: '4965400000',
      exchangeRateDate: '2026-10-23',
    })
    sale.state.exchangeRates!.rates.USD!.forexSelling = '5000000000'
    expect(sale.state.retailSales[0].total).toBe(496540)
    const stale = executeCommand(sale.state, {
      type: 'retail.sale',
      input: { method: 'cash', expectedTotal: 496540, items: [{ variantId: 'a', quantity: 1 }] },
    })
    expect(stale.result.ok).toBe(false)
    expect(stale.state).toBe(sale.state)
  })
  it('permits negative physical balances only with the explicit setting and publishes zero inventory', () => {
    const workspace = state(),
      command = {
        type: 'retail.sale' as const,
        input: { method: 'cash' as const, items: [{ variantId: 'a', quantity: 13 }] },
      }
    expect(executeCommand(workspace, command).result.ok).toBe(false)
    workspace.ecommerce = { ...defaultEcommerceSettings, allowNegativeStock: true }
    const sold = executeCommand(workspace, command)
    expect(sold.result.ok).toBe(true)
    expect(sold.state.products[0].variants[0].stockByWarehouse?.main).toBe(-1)
    expect(listingQuantity(sold.state, listing, 0, 'main')).toBe(0)
  })
})
