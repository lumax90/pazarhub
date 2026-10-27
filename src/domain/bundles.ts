import type { AppState, BundleComponentSnapshot, OrderLine, Product } from './types'
import { MAIN_WAREHOUSE, rawVariant, stockAt, warehouses } from './inventory-base'
import { currencySnapshot, toTry } from './money'

export const MAX_BUNDLE_COMPONENTS = 50

export function validateBundle(
  state: AppState,
  product: Product,
  previous?: Product,
): string | null {
  if (previous && !!previous.bundle !== !!product.bundle)
    return 'Ürünün paket türü değiştirilemez. Ayrı bir ürün kartı oluşturun.'
  if (!product.bundle) return null
  const bundle = product.bundle
  if (product.variants.length !== 1 || product.variantAxes?.length)
    return 'Paket tek stok koduyla kaydedilir.'
  if (
    !bundle.components.length ||
    bundle.components.length > MAX_BUNDLE_COMPONENTS ||
    bundle.components.reduce((sum, item) => sum + item.quantity, 0) < 2
  )
    return 'Paket en az iki adet ürün içermeli; en fazla 50 farklı bileşen seçilebilir.'
  if (new Set(bundle.components.map((item) => item.variantId)).size !== bundle.components.length)
    return 'Aynı varyantı pakete iki kez eklemeyin; miktarını düzenleyin.'
  if (
    !['linked', 'fixed'].includes(bundle.priceMode) ||
    !Number.isInteger(bundle.discountBps) ||
    bundle.discountBps < 0 ||
    bundle.discountBps > 10000
  )
    return 'Paket fiyat tercihini ve indirimini kontrol edin.'
  for (const component of bundle.components) {
    const found = rawVariant(state, component.variantId)
    if (!found || found.product.id === product.id || found.product.bundle)
      return 'Paket bileşenleri mevcut fiziksel ürün varyantları olmalı.'
    if (
      !Number.isInteger(component.quantity) ||
      component.quantity < 1 ||
      component.quantity > 10000
    )
      return 'Bileşen adedi 1–10.000 arasında tam sayı olmalı.'
    if (bundle.priceMode === 'linked' && found.variant.price <= 0)
      return `${found.product.name}: bağlı fiyat için satış fiyatını tamamlayın.`
  }
  const variant = product.variants[0]
  if (
    variant.stock !== 0 ||
    Object.values(variant.stockByWarehouse ?? {}).some((quantity) => quantity !== 0)
  )
    return 'Paket stoğu bileşenlerden hesaplanır; açılış stoğu yazılamaz.'
  if (variant.cost !== 0 || (bundle.priceMode === 'linked' && variant.price !== 0))
    return 'Paketin bağlı fiyatı ve maliyeti bileşenlerden hesaplanır.'
  if (!/^\d{1,80}$/.test(variant.barcode)) return 'Paket için rakamlardan oluşan bir barkod girin.'
  const totals = bundleTotals(state, product)
  if (
    !Number.isSafeInteger(totals.cost) ||
    !Number.isSafeInteger(totals.price) ||
    totals.cost > 1000000000 ||
    totals.price > 1000000000
  )
    return 'Paketin toplam fiyatı veya maliyeti sınırı aşıyor.'
  return null
}

export function bundleTotals(state: AppState, product: Product) {
  let cost = 0,
    price = 0,
    costKnown = true
  for (const component of product.bundle?.components ?? []) {
    const found = rawVariant(state, component.variantId)
    if (!found || found.product.bundle) {
      costKnown = false
      continue
    }
    cost +=
      toTry(
        found.variant.cost,
        found.product.currency,
        state.exchangeRates,
        state.ecommerce?.exchangeRateType,
      ) * component.quantity
    price +=
      toTry(
        found.variant.price,
        found.product.currency,
        state.exchangeRates,
        state.ecommerce?.exchangeRateType,
      ) * component.quantity
    costKnown &&=
      found.variant.cost > 0 &&
      Number.isSafeInteger(
        toTry(
          found.variant.cost,
          found.product.currency,
          state.exchangeRates,
          state.ecommerce?.exchangeRateType,
        ),
      )
  }
  return { cost, price, costKnown }
}
export function validateAffectedBundles(state: AppState, variantIds: string[]) {
  const changed = new Set(variantIds)
  for (const product of state.products)
    if (product.bundle?.components.some((component) => changed.has(component.variantId))) {
      const error = validateBundle(state, product)
      if (error) return `${product.name}: ${error}`
    }
  return null
}
export function variantPrice(state: AppState, variantId: string): number {
  const found = rawVariant(state, variantId)
  if (!found) return 0
  if (found.product.bundle?.priceMode !== 'linked')
    return toTry(
      found.variant.price,
      found.product.currency,
      state.exchangeRates,
      state.ecommerce?.exchangeRateType,
    )
  const total = bundleTotals(state, found.product).price
  if (!Number.isSafeInteger(total)) return NaN
  return Number((BigInt(total) * BigInt(10000 - found.product.bundle.discountBps) + 5000n) / 10000n)
}
export function variantCost(state: AppState, variantId: string): number {
  const found = rawVariant(state, variantId)
  return found?.product.bundle
    ? bundleTotals(state, found.product).cost
    : found
      ? toTry(
          found.variant.cost,
          found.product.currency,
          state.exchangeRates,
          state.ecommerce?.exchangeRateType,
        )
      : 0
}
export function variantCostKnown(state: AppState, variantId: string) {
  const found = rawVariant(state, variantId)
  return (
    !!found &&
    (found.product.bundle
      ? bundleTotals(state, found.product).costKnown
      : found.variant.cost > 0 && Number.isSafeInteger(variantCost(state, variantId)))
  )
}
export function snapshotBundle(
  state: AppState,
  variantId: string,
): BundleComponentSnapshot[] | undefined {
  const product = rawVariant(state, variantId)?.product
  if (!product?.bundle) return undefined
  return product.bundle.components.map((component) => {
    const found = rawVariant(state, component.variantId)
    if (!found || found.product.bundle) throw new Error('Paketin fiziksel bileşeni bulunamadı.')
    const cost = toTry(
      found.variant.cost,
      found.product.currency,
      state.exchangeRates,
      state.ecommerce?.exchangeRateType,
    )
    return {
      ...component,
      title: found.product.name,
      sku: found.variant.sku,
      variantName: found.variant.name,
      unitCost: Number.isSafeInteger(cost) ? cost : 0,
      taxRate: found.product.taxRate,
      costKnown: found.variant.cost > 0 && Number.isSafeInteger(cost),
      ...currencySnapshot(
        found.product.currency,
        state.exchangeRates,
        state.ecommerce?.exchangeRateType,
      ),
    }
  })
}

type StockLine = Pick<OrderLine, 'variantId' | 'quantity' | 'kind' | 'bundleComponents'>
export function lineStockParts(state: AppState, line: StockLine, strict = false) {
  if (line.kind === 'free') return []
  const found = rawVariant(state, line.variantId)
  if (found?.product.bundle) {
    if (!line.bundleComponents && strict)
      throw new Error(
        'Siparişin kayıtlı paket içeriği eksik; stok işlemi öncesinde eşlemeyi kontrol edin.',
      )
    const parts = line.bundleComponents ?? snapshotBundle(state, line.variantId) ?? []
    if (
      strict &&
      (!parts.length ||
        new Set(parts.map((part) => part.variantId)).size !== parts.length ||
        parts.some(
          (part) =>
            !Number.isSafeInteger(part.quantity) ||
            part.quantity < 1 ||
            !rawVariant(state, part.variantId) ||
            rawVariant(state, part.variantId)?.product.bundle,
        ))
    )
      throw new Error('Siparişin paket bileşenleri geçersiz.')
    return parts.map((part) => ({
      variantId: part.variantId,
      quantity: part.quantity * line.quantity,
    }))
  }
  return [{ variantId: line.variantId, quantity: line.quantity }]
}
export function stockDemand(state: AppState, lines: StockLine[], strict = false) {
  const amounts = new Map<string, number>()
  for (const line of lines)
    for (const part of lineStockParts(state, line, strict)) {
      const quantity = (amounts.get(part.variantId) ?? 0) + part.quantity
      if (!Number.isSafeInteger(quantity) || quantity < 0)
        throw new Error('Stok bileşen miktarı geçersiz.')
      amounts.set(part.variantId, quantity)
    }
  return [...amounts].map(([variantId, quantity]) => ({ variantId, quantity }))
}
function reservedPhysical(
  state: AppState,
  variantId: string,
  warehouseId?: string,
  excludeOrderId?: string,
) {
  let quantity = 0
  const bundles = state.products.filter((product) => product.bundle)
  for (const order of state.orders) {
    if (
      order.id === excludeOrderId ||
      order.historical ||
      order.inventoryApplied ||
      ['cancelled', 'returned'].includes(order.status) ||
      (warehouseId &&
        !order.stockAllocations &&
        (order.warehouseId ?? MAIN_WAREHOUSE) !== warehouseId)
    )
      continue
    if (order.stockAllocations) {
      quantity += order.stockAllocations
        .filter(
          (part) =>
            part.variantId === variantId && (!warehouseId || part.warehouseId === warehouseId),
        )
        .reduce((sum, part) => sum + part.quantity, 0)
      continue
    }
    for (const line of order.lines) {
      if (line.kind === 'free') continue
      const parts =
        line.bundleComponents ??
        bundles.find((product) => product.variants[0]?.id === line.variantId)?.bundle?.components
      if (parts)
        for (const part of parts) {
          if (part.variantId === variantId) quantity += part.quantity * line.quantity
        }
      else if (line.variantId === variantId) quantity += line.quantity
    }
  }
  return quantity
}
export function variantStock(state: AppState, variantId: string, warehouseId?: string): number {
  const found = rawVariant(state, variantId)
  if (!found) return 0
  if (!found.product.bundle)
    return warehouseId ? stockAt(found.variant, warehouseId) : found.variant.stock
  const parts = found.product.bundle.components
  if (
    !parts.length ||
    parts.some((part) => !Number.isSafeInteger(part.quantity) || part.quantity < 1)
  )
    return 0
  if (!warehouseId)
    return warehouses(state).reduce(
      (sum, warehouse) => sum + variantStock(state, variantId, warehouse.id),
      0,
    )
  return Math.max(
    0,
    Math.min(
      ...parts.map((part) => {
        const component = rawVariant(state, part.variantId)
        return component && !component.product.bundle
          ? Math.floor(stockAt(component.variant, warehouseId) / part.quantity)
          : 0
      }),
    ),
  )
}
export function variantAvailable(
  state: AppState,
  variantId: string,
  warehouseId?: string,
  excludeOrderId?: string,
): number {
  const found = rawVariant(state, variantId)
  if (!found) return 0
  if (!found.product.bundle)
    return (
      variantStock(state, variantId, warehouseId) -
      reservedPhysical(state, variantId, warehouseId, excludeOrderId)
    )
  if (!warehouseId)
    return warehouses(state).reduce(
      (sum, warehouse) => sum + variantAvailable(state, variantId, warehouse.id, excludeOrderId),
      0,
    )
  const parts = found.product.bundle.components
  return parts.length &&
    parts.every((part) => Number.isSafeInteger(part.quantity) && part.quantity > 0)
    ? Math.max(
        0,
        Math.min(
          ...parts.map((part) => {
            const component = rawVariant(state, part.variantId)
            return component && !component.product.bundle
              ? Math.floor(
                  (stockAt(component.variant, warehouseId) -
                    reservedPhysical(state, part.variantId, warehouseId, excludeOrderId)) /
                    part.quantity,
                )
              : 0
          }),
        ),
      )
    : 0
}
export function variantReserved(
  state: AppState,
  variantId: string,
  warehouseId?: string,
  excludeOrderId?: string,
) {
  return rawVariant(state, variantId)?.product.bundle
    ? variantStock(state, variantId, warehouseId) -
        variantAvailable(state, variantId, warehouseId, excludeOrderId)
    : reservedPhysical(state, variantId, warehouseId, excludeOrderId)
}
export function validateStockDemand(
  state: AppState,
  lines: StockLine[],
  warehouseId = MAIN_WAREHOUSE,
  excludeOrderId?: string,
  strict = true,
): string | null {
  try {
    for (const part of stockDemand(state, lines, strict)) {
      const found = rawVariant(state, part.variantId)
      if (!found || found.product.bundle) return 'Stok işlemi için fiziksel ürün eşlemesi gerekli.'
      if (state.ecommerce?.allowNegativeStock) continue
      if (variantAvailable(state, part.variantId, warehouseId, excludeOrderId) < part.quantity)
        return `${found.product.name} için seçili depoda yeterli satılabilir stok yok.`
    }
  } catch (error) {
    return (error as Error).message
  }
  return null
}
export function lineCostExcludingTax(line: OrderLine, quantity = line.quantity) {
  return line.bundleComponents
    ? line.bundleComponents.reduce(
        (sum, part) =>
          sum + Math.round((part.unitCost * part.quantity * quantity) / (1 + part.taxRate / 100)),
        0,
      )
    : Math.round((line.unitCost * quantity) / (1 + line.taxRate / 100))
}

const START = '<!-- pazarhub-bundle:start -->',
  END = '<!-- pazarhub-bundle:end -->'
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
export function withBundleDescription(state: AppState, product: Product) {
  const description = product.description
    .replace(/\n?<!-- pazarhub-bundle:start -->[\s\S]*?<!-- pazarhub-bundle:end -->/g, '')
    .trimEnd()
  if (!product.bundle?.includeContents) return description
  const rows = product.bundle.components
    .map((component) => {
      const found = rawVariant(state, component.variantId)!
      return `<tr><td>${escapeHtml(found.variant.sku)}</td><td>${escapeHtml(found.product.name)}${found.product.variants.length > 1 ? ` · ${escapeHtml(found.variant.name)}` : ''}</td><td>${component.quantity}</td></tr>`
    })
    .join('')
  return `${description}\n${START}<h3>Paket içeriği</h3><table><thead><tr><th>Stok kodu</th><th>Ürün</th><th>Adet</th></tr></thead><tbody>${rows}</tbody></table>${END}`.trim()
}
