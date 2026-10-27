import { describe, expect, it } from 'vitest'
import { productLabels } from '../src/domain/product-labels'
import type { Product } from '../src/domain/types'

const product = {
  id: 'p1',
  name: 'Aura Vazo',
  variants: [
    { id: 'v1', name: 'Kum', sku: 'AV-1', barcode: '4006381333931' },
    { id: 'v2', name: 'Adaçayı', sku: 'AV-2', barcode: 'MARKA000001' },
    { id: 'v3', name: 'Siyah', sku: 'AV-3', barcode: '' },
    { id: 'v4', name: 'Beyaz', sku: 'AV-4', barcode: 'ŞİŞLİ-1' },
  ],
} as Product

describe('product labels', () => {
  it('prints GTINs in their own symbology and other codes as Code 128', () => {
    const { labels } = productLabels([product])
    expect(labels.map((label) => [label.variant.sku, label.symbology])).toEqual([
      ['AV-1', 'ean13'],
      ['AV-2', 'code128'],
    ])
  })
  it('explains variants it cannot print', () => {
    expect(productLabels([product]).skipped.map((item) => [item.variant.sku, item.reason])).toEqual(
      [
        ['AV-3', 'Barkodu yok; Barkodlar sekmesinden üretin.'],
        ['AV-4', 'Barkod yalnız Latin harf ve rakam içermeli.'],
      ],
    )
  })
  it('limits the run to the chosen variants', () => {
    expect(productLabels([product], ['v2']).labels.map((label) => label.id)).toEqual(['v2'])
  })
})
