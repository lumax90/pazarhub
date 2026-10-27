import { productSymbology } from './barcodes'
import type { Product, Variant } from './types'

export interface ProductLabel {
  id: string
  product: Product
  variant: Variant
  symbology: ReturnType<typeof productSymbology>
}

export const productLabelFormats = [
  { id: '50x30', label: 'Termal 50 × 30 mm' },
  { id: '60x40', label: 'Termal 60 × 40 mm' },
  { id: 'a4', label: 'A4 · sayfada 24 etiket (70 × 37 mm)' },
] as const
export type ProductLabelFormat = (typeof productLabelFormats)[number]['id']

/** Most labels one print run produces, so a typo in a copy count cannot jam a printer. */
export const MAX_PRODUCT_LABELS = 1000

/** One label per variant with a barcode a scanner can read back unchanged. */
export function productLabels(products: Product[], variantIds?: string[]) {
  const labels: ProductLabel[] = [],
    skipped: { product: Product; variant: Variant; reason: string }[] = []
  for (const product of products)
    for (const variant of product.variants) {
      if (variantIds && !variantIds.includes(variant.id)) continue
      if (!variant.barcode.trim())
        skipped.push({ product, variant, reason: 'Barkodu yok; Barkodlar sekmesinden üretin.' })
      else if (!/^[\x20-\x7e]+$/.test(variant.barcode))
        skipped.push({ product, variant, reason: 'Barkod yalnız Latin harf ve rakam içermeli.' })
      else
        labels.push({
          id: variant.id,
          product,
          variant,
          symbology: productSymbology(variant.barcode),
        })
    }
  return { labels, skipped }
}
