import type { AppState, Listing, MarginRule, MarginSettings } from './types'
import { rawVariant } from './inventory-base'
import { variantCost, variantPrice } from './bundles'
import { categoryMappingFor } from './catalog-mappings'

export const marginScopes = [
  { id: 'all', label: 'Toplu marj' },
  { id: 'category', label: 'Kategori marjı' },
  { id: 'brand', label: 'Marka marjı' },
  { id: 'priceRange', label: 'Fiyat aralığı marjı' },
  { id: 'desi', label: 'Desi bazlı marj' },
  { id: 'product', label: 'Ürün bazlı marj' },
] as const
export const defaultMarginSettings = (storeId: string): MarginSettings => ({
  storeId,
  version: 0,
  enabled: true,
  base: 'price',
  formula: 'costsBefore',
  commissionMode: 'inside',
  rounding: 'none',
  listPriceMode: 'same',
  listMarkupBps: 3000,
})
const priorities = { product: 6, desi: 5, priceRange: 4, brand: 3, category: 2, all: 1 }
const money = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
type Fraction = { n: bigint; d: bigint }
const value = (n: number): Fraction => ({ n: BigInt(n), d: 1n })
const add = (a: Fraction, n: number): Fraction => ({ n: a.n + BigInt(n) * a.d, d: a.d })
const ratio = (a: Fraction, n: number, d = 10000): Fraction => ({
  n: a.n * BigInt(n),
  d: a.d * BigInt(d),
})
const round = (a: Fraction) => Number((a.n * 2n + a.d) / (a.d * 2n))
const ceil = (a: Fraction) => Number((a.n + a.d - 1n) / a.d)
export function calculateMargin(
  base: number,
  rule: MarginRule | undefined,
  settings: MarginSettings,
) {
  if (!money(base))
    return {
      price: NaN,
      base,
      costs: 0,
      afterMargin: NaN,
      afterCommission: NaN,
      beforeRounding: NaN,
    }
  const kind = rule?.kind ?? 'percent',
    costs = (rule?.shippingCost ?? 0) + (rule?.fixedCost ?? 0)
  if (!rule || rule.excluded || !settings.enabled)
    return {
      price: base,
      base,
      costs: 0,
      afterMargin: base,
      afterCommission: base,
      beforeRounding: base,
    }
  if (kind === 'fixed')
    return {
      price: rule.amount ?? 0,
      base,
      costs: 0,
      afterMargin: rule.amount ?? 0,
      afterCommission: rule.amount ?? 0,
      beforeRounding: rule.amount ?? 0,
    }
  const formula = (rule.formula ?? 'legacy') === 'legacy' ? 'legacy' : settings.formula
  let amount = value(base)
  if (formula === 'costsBefore') amount = add(amount, costs)
  const direction = rule.direction === 'decrease' ? -1 : 1
  amount =
    kind === 'amount'
      ? add(amount, direction * (rule.amount ?? 0))
      : ratio(
          amount,
          10000 + (rule.direction ? direction * Math.abs(rule.markupBps) : rule.markupBps),
        )
  if (amount.n < 0n) amount = value(0)
  const afterMargin = round(amount)
  if (formula === 'legacy') amount = add(amount, costs)
  amount =
    settings.commissionMode === 'add' && formula !== 'legacy'
      ? ratio(amount, 10000 + (rule.commissionBps ?? 0))
      : ratio(amount, 10000, 10000 - (rule.commissionBps ?? 0))
  const afterCommission = round(amount)
  if (formula === 'costsAfter') amount = add(amount, costs)
  let price = round(amount)
  if (settings.rounding === 'ceil') price = ceil({ n: amount.n, d: amount.d * 100n }) * 100
  else if (settings.rounding === 'nearest') price = round({ n: amount.n, d: amount.d * 100n }) * 100
  else if (settings.rounding === 'up99' || settings.rounding === 'up95') {
    const end = settings.rounding === 'up99' ? 99 : 95
    price = Number(amount.n / (amount.d * 100n)) * 100 + end
    if (BigInt(price) * amount.d < amount.n) price += 100
  }
  return { price, base, costs, afterMargin, afterCommission, beforeRounding: round(amount) }
}

export function listingPricing(state: AppState, listing: Listing) {
  const found = rawVariant(state, listing.variantId)
  const template = state.marginSettings?.find((settings) => settings.storeId === listing.storeId)
  const settings = template ?? defaultMarginSettings(listing.storeId)
  const retail = variantPrice(state, listing.variantId)
  const desi = listing.publishConfig?.dimensionalWeight ?? found?.product.dimensions?.desi
  const rule = found
    ? state.marginRules
        ?.filter((rule) => {
          if (!rule.active || rule.storeId !== listing.storeId) return false
          const price =
            (template?.base ?? rule.base) === 'cost'
              ? variantCost(state, listing.variantId)
              : retail
          return (
            rule.scope === 'all' ||
            (rule.scope === 'product' && rule.value === found.product.id) ||
            (rule.scope === 'brand' && rule.value === found.product.brand) ||
            (rule.scope === 'category' && rule.value === found.product.category) ||
            (rule.scope === 'desi' &&
              desi !== undefined &&
              desi >= (rule.minimum ?? 0) &&
              desi <= (rule.maximum ?? 0)) ||
            (rule.scope === 'priceRange' &&
              price >= (rule.minimum ?? 0) &&
              price <= (rule.maximum ?? 0))
          )
        })
        .sort((a, b) => priorities[b.scope] - priorities[a.scope] || a.id.localeCompare(b.id))[0]
    : undefined
  const effective = template ?? {
    ...settings,
    base: rule?.base ?? 'price',
    formula: 'costsBefore' as const,
  }
  const ruledBase =
    (template?.base ?? rule?.base) === 'cost' ? variantCost(state, listing.variantId) : retail
  const category = found
    ? categoryMappingFor(state, listing.storeId, listing.channel, found.product)
    : undefined
  const calculated = calculateMargin(
    ruledBase,
    rule
      ? { ...rule, commissionBps: rule.commissionBps ?? category?.commissionBps ?? 0 }
      : undefined,
    effective,
  )
  const price =
    listing.priceOverride ??
    (listing.marginExcluded
      ? retail
      : template?.enabled === false
        ? (listing.marginPriceSnapshot?.price ?? listing.lastSent?.price ?? retail)
        : rule?.excluded || !rule
          ? retail
          : calculated.price)
  let listPrice = listing.listPriceOverride ?? price
  if (
    listing.listPriceOverride === undefined &&
    template?.enabled === false &&
    listing.marginPriceSnapshot
  )
    return {
      ...calculated,
      price,
      listPrice: Math.max(
        price,
        listing.marginPriceSnapshot.listPrice ??
          listing.lastSent?.listPrice ??
          listing.remoteListPrice ??
          (listing.externalId ? NaN : price),
      ),
      rule,
      settings: effective,
      source:
        listing.priceOverride !== undefined
          ? 'manual'
          : listing.marginExcluded
            ? 'excluded'
            : 'frozen',
    }
  if (
    Number.isSafeInteger(price) &&
    listing.listPriceOverride === undefined &&
    template?.listPriceMode === 'markup'
  )
    listPrice = round(ratio(value(price), 10000 + template.listMarkupBps))
  if (listing.listPriceOverride === undefined && template?.listPriceMode === 'keep')
    listPrice =
      listing.lastSent?.listPrice ?? listing.remoteListPrice ?? (listing.externalId ? NaN : price)
  return {
    ...calculated,
    price,
    listPrice: Math.max(price, listPrice),
    rule,
    settings: effective,
    source:
      listing.priceOverride !== undefined
        ? 'manual'
        : listing.marginExcluded || rule?.excluded
          ? 'excluded'
          : rule && settings.enabled
            ? 'rule'
            : 'product',
  }
}

export function validateMarginRule(state: AppState, rule: MarginRule) {
  if (!state.connections.some((store) => store.id === rule.storeId)) return 'Geçerli mağaza seçin.'
  const previous = state.marginRules?.find((item) => item.id === rule.id)
  if (previous && (previous.version ?? 0) !== (rule.version ?? 0))
    return 'Marj kuralı değişti. Güncel kaydı açın.'
  if (
    !money(rule.fixedCost) ||
    !money(rule.shippingCost ?? 0) ||
    !money(rule.amount ?? 0) ||
    !Number.isInteger(rule.markupBps) ||
    Math.abs(rule.markupBps) > 100000 ||
    (rule.commissionBps !== undefined &&
      (!Number.isInteger(rule.commissionBps) ||
        rule.commissionBps < 0 ||
        rule.commissionBps >= 10000))
  )
    return 'Marj, gider ve komisyon değerlerini kontrol edin.'
  if (
    (rule.kind ?? 'percent') === 'percent' &&
    (rule.direction === 'decrease'
      ? Math.abs(rule.markupBps) >= 10000
      : !rule.direction && rule.markupBps <= -10000)
  )
    return 'Azalış oranı %100’den küçük olmalı.'
  if (rule.kind === 'fixed' && !rule.excluded && !rule.amount)
    return 'Sabit fiyat sıfırdan büyük olmalı.'
  if (['desi', 'priceRange'].includes(rule.scope)) {
    if (
      !Number.isFinite(rule.minimum) ||
      !Number.isFinite(rule.maximum) ||
      rule.minimum! < 0 ||
      rule.maximum! < rule.minimum! ||
      rule.maximum! > (rule.scope === 'desi' ? 10000 : 1_000_000_000) ||
      (rule.scope === 'priceRange' &&
        (!Number.isInteger(rule.minimum) || !Number.isInteger(rule.maximum)))
    )
      return 'Alt ve üst aralık sınırlarını kontrol edin.'
  } else if (rule.scope !== 'all' && !rule.value.trim()) return 'Kural kapsamını seçin.'
  if (rule.scope === 'product' && !state.products.some((product) => product.id === rule.value))
    return 'Kapsamdaki ürün bulunamadı.'
  const collision = state.marginRules?.some(
    (other) =>
      other.id !== rule.id &&
      other.active &&
      rule.active &&
      other.storeId === rule.storeId &&
      other.scope === rule.scope &&
      (['desi', 'priceRange'].includes(rule.scope)
        ? rule.minimum! <= other.maximum! && other.minimum! <= rule.maximum!
        : other.value === rule.value || rule.scope === 'all'),
  )
  if (collision)
    return 'Aynı kapsamda etkin kural veya çakışan fiyat/desi aralığı var. Mevcut kuralı düzenleyin.'
  return null
}
