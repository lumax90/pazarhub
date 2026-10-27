import type { RemoteProduct } from '../../src/domain/integrations'
import { array, cents, record, remoteInteger, text, urls } from './contracts'
import { ProviderError } from '../errors'

export function pttVariantPrice(parent: Record<string, unknown>, variant: Record<string, unknown>) {
  if (variant.fiyatFarkiMi === false) return cents(variant.fiyat)
  if (variant.fiyatFarkiMi !== true || !/^-?\d+(\.\d+)?$/.test(String(variant.fiyat))) return NaN
  const difference = Math.round(Number(variant.fiyat) * 100)
  return Number.isSafeInteger(difference) ? cents(parent.kdVli) + difference : NaN
}

export function pttVariantValuesMatch(
  variant: Record<string, unknown>,
  attributes: Record<string, unknown>[],
) {
  return (
    attributes.length > 0 &&
    attributes.length <= 2 &&
    attributes.every(
      (attribute, index) =>
        text(attribute.definition) &&
        text(attribute.value) &&
        text(variant[`variant${index + 1}Deger`]) === text(attribute.value),
    ) &&
    (attributes.length === 2 || !text(variant.variant2Deger))
  )
}

export function pttVariantAttributes(value: unknown): { definition: string; value: string }[] {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2) return []
    const attributes = parsed.map((item) => ({
      definition: text(record(item).definition),
      value: text(record(item).value),
    }))
    return attributes.every((item) => item.definition && item.value) ? attributes : []
  } catch {
    return []
  }
}

export function normalizePttAvmProducts(raw: unknown): RemoteProduct[] {
  const parent = record(raw),
    parentId = text(parent.urunId),
    parentSku = text(parent.barkod)
  if (
    !parentId ||
    !parentSku ||
    !text(parent.urunAdi) ||
    !Number.isSafeInteger(cents(parent.kdVli))
  )
    throw new ProviderError(
      'INVALID_PRODUCT',
      'PttAVM üst ürün kimliği, stok kodu veya fiyatı eksik.',
    )
  const common = {
    title: text(parent.urunAdi),
    category: text(parent.altKategoriAdi),
    categoryId: text(parent.yeniKategoriId ?? parent.altKategoriId),
    taxRate: remoteInteger(parent.kdvOran),
    images: urls(parent.resimListesi),
    status: parent.aktif === true ? ('active' as const) : ('archived' as const),
  }
  const variants = array(parent.variantListesi).map(record)
  if (!variants.length)
    return [
      {
        ...common,
        externalId: parentId,
        sku: parentSku,
        barcode: text(parent.gtin),
        price: cents(parent.kdVli),
        quantity: Math.max(0, remoteInteger(parent.miktar)),
        attributes: {
          hasVariants: 'no',
          pttParentSku: parentSku,
          pttParentId: parentId,
          pttSellerSku: parentSku,
        },
      },
    ]
  return variants.map((variant) => {
    const sku = text(variant.variantBarkod),
      price = pttVariantPrice(parent, variant),
      quantity = remoteInteger(variant.miktar)
    if (!sku || !Number.isSafeInteger(price) || price < 0 || quantity < 0)
      throw new ProviderError(
        'INVALID_VARIANT',
        'PttAVM varyant kimliği, fiyat farkı veya miktarı okunamadı.',
      )
    return {
      ...common,
      externalId: `${parentId}:${encodeURIComponent(sku)}`,
      sku,
      barcode: text(variant.gtin ?? variant.catalogBarcode),
      title: `${common.title} · ${[variant.variant1Deger, variant.variant2Deger].map(text).filter(Boolean).join(' / ')}`,
      price,
      quantity,
      attributes: {
        hasVariants: 'yes',
        pttParentSku: parentSku,
        pttParentId: parentId,
        pttSellerSku: sku,
        pttValue1: text(variant.variant1Deger),
        pttValue2: text(variant.variant2Deger),
      },
    }
  })
}
