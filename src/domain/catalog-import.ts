export const importFields = [
  { id: 'sku', label: 'Stok kodu (SKU)', required: true },
  { id: 'name', label: 'Ürün adı' },
  { id: 'model', label: 'Ortak model / ürün kodu' },
  { id: 'variant', label: 'Varyant adı' },
  { id: 'barcode', label: 'Barkod' },
  { id: 'category', label: 'Kategori' },
  { id: 'brand', label: 'Marka' },
  { id: 'currency', label: 'Para birimi (TRY, USD, EUR…)' },
  { id: 'price', label: 'Satış fiyatı (KDV dahil)' },
  { id: 'cost', label: 'Alış maliyeti (KDV dahil)' },
  { id: 'stock', label: 'Seçilen depo stoku' },
  { id: 'taxRate', label: 'KDV oranı (%)' },
  { id: 'description', label: 'Açıklama' },
  { id: 'images', label: 'Görseller (| ile ayrılmış)' },
] as const
export type ImportField = (typeof importFields)[number]['id']
export interface ImportOptions {
  mapping: Partial<Record<ImportField, string>>
  mode: 'create' | 'upsert'
  decimal: ',' | '.'
  warehouseId: string
}
export interface ImportInspection {
  id: string
  name: string
  format: 'csv' | 'xml'
  columns: string[]
  count: number
  samples: Record<string, string>[]
  recordPath?: string
  recordPaths: { path: string; count: number }[]
  suggested: Partial<Record<ImportField, string>>
}
export interface ImportPreview {
  id: string
  sourceId: string
  newProducts: number
  updatedProducts: number
  variantCount: number
  stockChanges: number
  rows: {
    id: string
    row: number
    sku: string
    name: string
    action: 'create' | 'update'
    price: number
    currency?: import('./money').CurrencyCode
    stock?: number
  }[]
  errors: { row: number; message: string }[]
  expiresAt: string
}
