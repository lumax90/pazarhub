import type { Product, ProductPatch, Variant, VariantAxis } from './types'
import { productColorImageOptions } from './product-images'

export const MAX_PRODUCT_VARIANTS = 500
export const MAX_VARIANT_AXES = 3
export const productUnits = ['Adet', 'Paket', 'Koli', 'Set', 'Çift', 'Metre', 'Kilogram', 'Litre']
const normalized = (value: string) => value.trim().toLocaleLowerCase('tr-TR')

export function validateProductStructure(product: Product): string | null {
  const axes = product.variantAxes ?? []
  const colors = productColorImageOptions(product)
  if (
    Object.entries(product.imageMetadata ?? {}).some(
      ([url, data]) =>
        !product.images?.includes(url) ||
        (data.alt?.length ?? 0) > 300 ||
        !!data.axisId !== !!data.valueId ||
        (data.axisId &&
          !colors.some((color) => color.axisId === data.axisId && color.valueId === data.valueId)),
    )
  )
    return 'Görsellerin alternatif metin ve renk ilişkilerini kontrol edin. Renk ürünün mevcut varyantlarından seçilmeli.'
  if (axes.length > MAX_VARIANT_AXES)
    return `En fazla ${MAX_VARIANT_AXES} varyant tipi kullanılabilir.`
  const axisIds = new Set<string>(),
    axisNames = new Set<string>()
  for (const axis of axes) {
    if (
      !axis.id ||
      axisIds.has(axis.id) ||
      !axis.name.trim() ||
      axisNames.has(normalized(axis.name))
    )
      return 'Varyant tipi adları ve kimlikleri benzersiz olmalı.'
    axisIds.add(axis.id)
    axisNames.add(normalized(axis.name))
    if (!axis.values.length || axis.values.length > 100)
      return 'Her varyant tipi için 1–100 değer seçin.'
    if (
      new Set(axis.values.map((v) => v.id)).size !== axis.values.length ||
      new Set(axis.values.map((v) => normalized(v.name))).size !== axis.values.length ||
      axis.values.some((v) => !v.id || !v.name.trim())
    )
      return 'Varyant değerleri boş olamaz veya tekrarlanamaz.'
  }
  const combinations = new Set<string>()
  for (const variant of product.variants) {
    const keys = Object.keys(variant.options ?? {})
    if (keys.some((key) => !axes.some((axis) => axis.id === key)))
      return 'Varyant seçeneği ürünün tanımlı varyant tiplerinden birine ait olmalı.'
    if (axes.length) {
      if (
        axes.some((axis) => !axis.values.some((value) => value.id === variant.options?.[axis.id]))
      )
        return 'Her varyant için tüm tiplerin değerlerini seçin.'
      const key = combinationKey(variant.options!)
      if (combinations.has(key)) return 'Aynı varyant kombinasyonu iki kez kaydedilemez.'
      combinations.add(key)
    }
  }
  const attributes = product.technicalAttributes ?? []
  if (
    attributes.length > 100 ||
    attributes.some((a) => !a.id || !a.name.trim() || !a.value.trim()) ||
    new Set(attributes.map((a) => a.id)).size !== attributes.length ||
    new Set(attributes.map((a) => normalized(a.name))).size !== attributes.length
  )
    return 'Teknik özellikler dolu olmalı; aynı özellik bir kez tanımlanabilir.'
  if (product.origin && !/^[A-Z]{2}$/.test(product.origin))
    return 'Menşei ülke için iki harfli kod kullanın (örn. TR).'
  if (product.gtip && !/^\d{12}$/.test(product.gtip)) return 'GTİP numarası 12 rakamdan oluşmalı.'
  if (
    Object.values(product.dimensions ?? {}).some(
      (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
    )
  )
    return 'Ölçüler ve ağırlık sıfır veya pozitif sayı olmalı.'
  return null
}

export function combinationKey(options: Record<string, string>) {
  return JSON.stringify(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)))
}

export function generateVariants(
  axes: VariantAxis[],
  previous: Variant[],
  prefix: string,
  reservedSkus: string[] = [],
  id: () => string = () => crypto.randomUUID(),
): Variant[] {
  if (
    !axes.length ||
    axes.length > MAX_VARIANT_AXES ||
    axes.some((axis) => !axis.name.trim() || !axis.values.length)
  )
    throw new Error('Varyant tiplerini ve değerlerini tamamlayın.')
  const count = axes.reduce((total, axis) => total * axis.values.length, 1)
  if (count > MAX_PRODUCT_VARIANTS)
    throw new Error(
      `En fazla ${MAX_PRODUCT_VARIANTS} kombinasyon oluşturulabilir; şu an ${count} kombinasyon seçili.`,
    )
  if (!prefix.trim() || prefix.trim().length > 140)
    throw new Error('Stok kodu öneki 1–140 karakter olmalı.')
  let combinations: { options: Record<string, string>; names: string[] }[] = [
    { options: {}, names: [] },
  ]
  for (const axis of axes)
    combinations = combinations.flatMap((combination) =>
      axis.values.map((value) => ({
        options: { ...combination.options, [axis.id]: value.id },
        names: [...combination.names, value.name],
      })),
    )
  const old = new Map(previous.filter((v) => v.options).map((v) => [combinationKey(v.options!), v]))
  const used = new Set([...reservedSkus, ...previous.map((v) => v.sku)])
  let sequence = 1
  const variants = combinations.map((combination) => {
    const existing = old.get(combinationKey(combination.options))
    if (existing) return structuredClone(existing)
    let sku: string
    do {
      sku = `${prefix.trim()}-${String(sequence++).padStart(3, '0')}`
    } while (used.has(sku))
    used.add(sku)
    return {
      id: id(),
      name: combination.names.join(' / ').slice(0, 150),
      sku,
      barcode: '',
      price: previous[0]?.price ?? 0,
      cost: previous[0]?.cost ?? 0,
      stock: 0,
      options: combination.options,
    }
  })
  const problem = validateProductStructure({
    id: 'draft',
    name: 'draft',
    category: 'draft',
    brand: '',
    description: '',
    art: 'bag',
    color: '#aabbcc',
    active: true,
    lowStock: 0,
    taxRate: 20,
    variants,
    variantAxes: axes,
  })
  if (problem) throw new Error(problem)
  return variants
}

export function mergeProductPatch(product: Product, patch: ProductPatch): Product {
  const updates = new Map(patch.variants?.map((variant) => [variant.id, variant]) ?? [])
  const changes = { ...patch.changes }
  for (const [field, reference] of [
    ['category', 'categoryId'],
    ['brand', 'brandId'],
    ['supplier', 'supplierId'],
  ] as const)
    if (changes[field] !== undefined && changes[reference] === undefined)
      changes[reference] = undefined
  return {
    ...product,
    ...changes,
    variants: [
      ...product.variants.map((variant) => ({ ...variant, ...updates.get(variant.id) })),
      ...(patch.newVariants ?? []),
    ],
  }
}

/** Apply the committed response while retaining edits from other product cards. */
export function rebaseProductDraft(
  base: Product,
  draft: Product,
  saved: Product,
  patch: ProductPatch,
): Product {
  const expected = mergeProductPatch(base, patch)
  const merge = (before: unknown, edited: unknown, actual: unknown): unknown => {
    if (JSON.stringify(before) === JSON.stringify(edited)) return structuredClone(actual)
    if (
      before &&
      edited &&
      actual &&
      typeof before === 'object' &&
      typeof edited === 'object' &&
      typeof actual === 'object' &&
      !Array.isArray(before) &&
      !Array.isArray(edited) &&
      !Array.isArray(actual)
    ) {
      const a = before as Record<string, unknown>,
        b = edited as Record<string, unknown>,
        c = actual as Record<string, unknown>
      return Object.fromEntries(
        [...new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])].map((key) => [
          key,
          merge(a[key], b[key], c[key]),
        ]),
      )
    }
    return structuredClone(edited)
  }
  const result = merge(expected, draft, saved) as Product
  result.version = saved.version
  result.updatedAt = saved.updatedAt
  result.variants = [
    ...saved.variants.map(
      (variant) =>
        merge(
          expected.variants.find((v) => v.id === variant.id),
          draft.variants.find((v) => v.id === variant.id) ?? variant,
          variant,
        ) as Variant,
    ),
    ...draft.variants
      .filter((variant) => !saved.variants.some((v) => v.id === variant.id))
      .map((variant) => structuredClone(variant)),
  ]
  return result
}

export function invoiceLineMetadata(product: Product, variant: Variant) {
  return {
    ...(product.invoiceName?.trim()
      ? {
          invoiceTitle: `${product.invoiceName.trim()}${product.variants.length > 1 ? ` · ${variant.name}` : ''}`,
        }
      : {}),
    ...(product.unit ? { unit: product.unit } : {}),
  }
}

export const attributeNameKey = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')

export function productAttributeValues(product: Product, variant: Variant) {
  const values = new Map(
    (product.technicalAttributes ?? []).map((a) => [
      attributeNameKey(a.name),
      { name: a.name, value: a.value, source: 'product' as 'product' | 'variant' },
    ]),
  )
  for (const axis of product.variantAxes ?? []) {
    const value = axis.values.find((v) => v.id === variant.options?.[axis.id])
    if (value)
      values.set(attributeNameKey(axis.name), {
        name: axis.name,
        value: value.name,
        source: 'variant',
      })
  }
  return values
}
