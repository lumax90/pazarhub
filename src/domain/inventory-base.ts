import type { AppState, Variant, Warehouse } from './types'

export const MAIN_WAREHOUSE = 'main'
export const stockReasons = {
  in: [
    { id: 'purchase', label: 'Satın alma' },
    { id: 'production', label: 'Üretim' },
    { id: 'customer_return', label: 'Müşteri iadesi' },
    { id: 'count_surplus', label: 'Sayım fazlası' },
    { id: 'other', label: 'Diğer' },
  ],
  out: [
    { id: 'damage', label: 'Hasar / fire' },
    { id: 'loss', label: 'Kayıp' },
    { id: 'sample', label: 'Numune / hediye' },
    { id: 'expired', label: 'Miat dolumu' },
    { id: 'other', label: 'Diğer' },
  ],
}
export const stockMovementLabels = {
  order: 'Satış',
  retail: 'Perakende',
  return: 'İade / iptal',
  adjustment: 'Düzeltme',
  transfer: 'Transfer',
  purchase: 'Alış',
  count: 'Sayım',
  entry: 'Giriş',
  exit: 'Çıkış',
}
export const warehouses = (state: AppState): Warehouse[] =>
  state.warehouses?.length
    ? state.warehouses
    : [{ id: MAIN_WAREHOUSE, name: 'Merkez', active: true }]
export const stockAt = (variant: Variant, warehouseId: string) =>
  variant.stockByWarehouse?.[warehouseId] ??
  (warehouseId === MAIN_WAREHOUSE && !variant.stockByWarehouse ? variant.stock : 0)
export function rawVariant(state: AppState, id: string) {
  for (const product of state.products) {
    const variant = product.variants.find((variant) => variant.id === id)
    if (variant) return { product, variant }
  }
}
