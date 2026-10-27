import type { AppState, StockMovement } from './types'
import { MAIN_WAREHOUSE } from './inventory-base'
import { variantReserved } from './bundles'
export { MAIN_WAREHOUSE, stockAt, warehouses } from './inventory-base'

export const warehouseReserved = (
  state: AppState,
  variantId: string,
  warehouseId: string,
  excludeOrder?: string,
) => variantReserved(state, variantId, warehouseId, excludeOrder)
export function moveStock(
  state: AppState,
  variantId: string,
  warehouseId: string,
  quantity: number,
  type: StockMovement['type'],
  reference: string,
  now: string,
  id: () => string,
) {
  const product = state.products.find((item) => item.variants.some((v) => v.id === variantId))
  const variant = product?.variants.find((item) => item.id === variantId)
  if (!variant) throw new Error('Varyant bulunamadı.')
  if (product?.bundle)
    throw new Error('Paket stoğu bileşenlerden hesaplanır; fiziksel üründe işlem yapın.')
  const map = variant.stockByWarehouse ?? { [MAIN_WAREHOUSE]: variant.stock }
  map[warehouseId] = (map[warehouseId] ?? 0) + quantity
  variant.stockByWarehouse = map
  variant.stock = Object.values(map).reduce((sum, q) => sum + q, 0)
  product!.updatedAt = now
  if (quantity) {
    const movement: StockMovement = {
      id: id(),
      variantId,
      warehouseId,
      quantity,
      type,
      reference,
      createdAt: now,
      balance: map[warehouseId],
    }
    state.movements.unshift(movement)
    return movement
  }
}
