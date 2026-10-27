import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AppState, Product, Variant } from '../../src/domain/types'
import type { ImportField, ImportOptions, ImportPreview } from '../../src/domain/catalog-import'
import { importFields } from '../../src/domain/catalog-import'
import { executeCommand } from '../../src/domain/operations'
import { stockAt, warehouses } from '../../src/domain/inventory'
import { AppError } from '../errors'
import { identifier } from '../validation'
import { parseImportNumber } from './parsing'
import { currencyCodes } from '../../src/domain/money'
import type { CurrencyCode } from '../../src/domain/money'
import type { ImportData } from './parsing'

const fields = importFields.map((f) => f.id) as [ImportField, ...ImportField[]]
export const optionsSchema = z.strictObject({
  mapping: z.partialRecord(z.enum(fields), z.string().max(160)),
  mode: z.enum(['create', 'upsert']),
  decimal: z.enum([',', '.']),
  warehouseId: identifier,
})
export interface ImportPlan {
  id: string
  revision: number
  products: Product[]
  stock: { row: number; variantId: string; quantity: number }[]
  options: ImportOptions
  preview: ImportPreview
}
export function applyImportPlan(state: AppState, plan: ImportPlan, name: string) {
  let next = state
  for (const product of plan.products) {
    const result = executeCommand(next, { type: 'product.save', product })
    if (!result.result.ok) throw new AppError(422, 'IMPORT_INVALID', result.result.message)
    next = result.state
  }
  for (const item of plan.stock) {
    const result = executeCommand(next, {
      type: 'stock.adjust',
      variantId: item.variantId,
      warehouseId: plan.options.warehouseId,
      quantity: item.quantity,
      note: `Dosya içe aktarma: ${name}`,
    })
    if (!result.result.ok)
      throw new AppError(
        422,
        'IMPORT_STOCK_INVALID',
        `${item.row}. kayıt: ${result.result.message}`,
      )
    next = result.state
  }
  return next
}
export function planImport(
  state: AppState,
  revision: number,
  data: ImportData,
  options: ImportOptions,
  sourceId: string,
  name: string,
): ImportPlan {
  if (
    !options.mapping.sku ||
    Object.values(options.mapping).some((c) => c && !data.columns.includes(c))
  )
    throw new AppError(422, 'MAPPING_REQUIRED', 'Geçerli SKU sütununu ve alan eşlemelerini seçin.')
  if (!warehouses(state).some((w) => w.active && w.id === options.warehouseId))
    throw new AppError(422, 'WAREHOUSE_REQUIRED', 'Etkin depo seçin.')
  const preview: ImportPreview = {
    id: randomUUID(),
    sourceId,
    newProducts: 0,
    updatedProducts: 0,
    variantCount: data.rows.length,
    stockChanges: 0,
    rows: [],
    errors: [],
    expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
  }
  const products = new Map<string, Product>(),
    stock: ImportPlan['stock'] = [],
    seenSkus = new Set<string>(),
    shared = new Map<string, string>()
  const lookup = new Map(
    state.products.flatMap((p) =>
      p.variants.map((v) => [v.sku, { product: p, variant: v }] as const),
    ),
  )
  const modelLookup = new Map<string, Product>()
  for (const product of state.products)
    if (product.modelCode) {
      if (modelLookup.has(product.modelCode))
        throw new AppError(
          409,
          'MODEL_DUPLICATE',
          'Katalogda aynı model koduna sahip ürünler var. Önce ürün kodlarını düzeltin.',
        )
      modelLookup.set(product.modelCode, product)
    }
  const conflicts = new Set<string>()
  for (const row of data.rows) {
    const model = options.mapping.model ? row[options.mapping.model]?.trim() : undefined,
      sku = row[options.mapping.sku]?.trim(),
      existing = sku ? lookup.get(sku)?.product : undefined
    if (model && existing) {
      const target = modelLookup.get(model)
      if (target && target.id !== existing.id) conflicts.add(model)
      else modelLookup.set(model, existing)
    }
  }
  for (const [index, row] of data.rows.entries()) {
    const number = index + 1
    const get = (field: ImportField) =>
      options.mapping[field] ? row[options.mapping[field]!]?.trim() || undefined : undefined
    const sku = get('sku') ?? ''
    try {
      if (!sku || sku.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(sku))
        throw new Error('Geçerli stok kodu gerekli.')
      if (seenSkus.has(sku)) throw new Error('Dosyada aynı SKU birden fazla kez kullanılmış.')
      seenSkus.add(sku)
      const existing = lookup.get(sku),
        model = get('model'),
        modelProduct = model ? modelLookup.get(model) : undefined
      if (model && conflicts.has(model))
        throw new Error('Aynı model grubu farklı mevcut ürünlere ait SKU içeriyor.')
      if (existing && options.mode === 'create')
        throw new Error('SKU katalogda mevcut. Güncelleme modunu seçin.')
      if (model && !identifier.safeParse(model).success)
        throw new Error(
          'Model kodu en fazla 160 karakter olmalı ve geçerli bir kayıt kodu içermeli.',
        )
      if (existing?.product.modelCode && model && existing.product.modelCode !== model)
        throw new Error('Mevcut varyant başka bir modele taşınamaz.')
      if (existing && modelProduct && existing.product.id !== modelProduct.id)
        throw new Error('Model kodu başka bir ürüne bağlı.')
      const original = existing?.product ?? modelProduct
      if (
        original?.currency &&
        original.currency !== 'TRY' &&
        (get('price') !== undefined || get('cost') !== undefined) &&
        !get('currency')
      )
        throw new Error('Dövizli üründe fiyat güncellerken para birimi sütununu da eşleyin.')
      const groupKey = original ? `id:${original.id}` : `new:${model ?? sku}`
      let product = products.get(groupKey)
      if (!product) {
        product = original
          ? structuredClone(original)
          : {
              id: randomUUID(),
              name: '',
              category: 'Sınıflandırılmamış',
              brand: '',
              description: '',
              art: 'bag',
              color: '#aab8cc',
              taxRate: 20,
              active: true,
              lowStock: 5,
              variants: [],
              modelCode: model ?? sku,
            }
        product.version = (product.version ?? 0) + 1
        products.set(groupKey, product)
      }
      if (model) product.modelCode = model
      for (const field of [
        'name',
        'category',
        'brand',
        'currency',
        'description',
        'taxRate',
        'images',
      ] as const) {
        const value = get(field)
        if (value === undefined) continue
        const sharedKey = `${groupKey}:${field}`
        if (shared.has(sharedKey) && shared.get(sharedKey) !== value)
          throw new Error(
            `Aynı ürünün ${importFields.find((f) => f.id === field)!.label} alanı varyantlar arasında farklı.`,
          )
        shared.set(sharedKey, value)
        if (field === 'currency') {
          if (!currencyCodes.includes(value as CurrencyCode))
            throw new Error('Geçerli ISO para birimi kodu girin (TRY, USD, EUR…).')
          product.currency = value as CurrencyCode
        } else if (field === 'taxRate') {
          const rate = parseImportNumber(value, options.decimal)
          if (!Number.isInteger(rate) || rate > 100)
            throw new Error('KDV oranı 0–100 arasında tam sayı olmalı.')
          product.taxRate = rate
        } else if (field === 'images') {
          const images = value
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean)
          if (
            images.length > 12 ||
            images.some((url) => {
              try {
                const parsed = new URL(url)
                return parsed.protocol !== 'https:' || url.length > 2048
              } catch {
                return true
              }
            })
          )
            throw new Error('En fazla 12 geçerli HTTPS görsel adresi kullanın.')
          product.images = images
        } else {
          const max = field === 'description' ? 30000 : field === 'brand' ? 200 : 300
          if (value.length > max) throw new Error(`${field} alanı çok uzun.`)
          product[field] = value
          if (field === 'category') delete product.categoryId
          if (field === 'brand') delete product.brandId
        }
      }
      if (!product.name) throw new Error('Yeni ürün için ürün adı sütununu eşleyin.')
      const old = existing?.variant,
        variant: Variant = old
          ? structuredClone(old)
          : {
              id: randomUUID(),
              sku,
              name: get('variant') ?? 'Standart',
              barcode: '',
              price: 0,
              cost: 0,
              stock: 0,
            }
      if (get('variant')) variant.name = get('variant')!
      if (get('barcode')) variant.barcode = get('barcode')!
      if (variant.name.length > 150 || variant.barcode.length > 80)
        throw new Error('Varyant adı veya barkod çok uzun.')
      for (const field of ['price', 'cost'] as const) {
        const value = get(field)
        if (value !== undefined) variant[field] = parseImportNumber(value, options.decimal, true)
        else if (field === 'price' && !old)
          throw new Error('Yeni varyant için satış fiyatı gerekli.')
      }
      const quantity =
        get('stock') === undefined ? undefined : parseImportNumber(get('stock')!, options.decimal)
      if (quantity !== undefined && !Number.isInteger(quantity))
        throw new Error('Depo stoku tam sayı olmalı.')
      product.variants = old
        ? product.variants.map((v) => (v.id === old.id ? variant : v))
        : [...product.variants, variant]
      if (product.variants.length > 500)
        throw new Error('Bir ürün en fazla 500 varyant içerebilir.')
      if (quantity !== undefined && quantity !== stockAt(variant, options.warehouseId))
        stock.push({ row: number, variantId: variant.id, quantity })
      preview.rows.push({
        id: String(number),
        row: number,
        sku,
        name: product.name,
        action: old ? 'update' : 'create',
        price: variant.price,
        currency: product.currency,
        stock: quantity,
      })
    } catch (error) {
      preview.errors.push({
        row: number,
        message: error instanceof Error ? error.message : 'Kayıt okunamadı.',
      })
    }
  }
  const planned = [...products.values()]
  preview.newProducts = planned.filter((p) => !state.products.some((old) => old.id === p.id)).length
  preview.updatedProducts = planned.length - preview.newProducts
  preview.stockChanges = stock.length
  const plan: ImportPlan = { id: preview.id, revision, products: planned, stock, options, preview }
  if (!preview.errors.length)
    try {
      applyImportPlan(state, plan, name)
    } catch (error) {
      preview.errors.push({
        row: 0,
        message: error instanceof Error ? error.message : 'Dosya doğrulanamadı.',
      })
    }
  return plan
}
