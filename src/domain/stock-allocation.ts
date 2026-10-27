import type { AppState, Order, OrderLine, StockAllocation } from './types'
import type { IntegrationSettings } from './integrations'
import { MAIN_WAREHOUSE, warehouses } from './inventory-base'
import { stockDemand, variantAvailable } from './bundles'

export function salesWarehouseIds(state: AppState, warehouseId?: string): string[] {
  if (warehouseId) return [warehouseId]
  if (state.ecommerce?.stockScope === 'all')
    return warehouses(state)
      .filter((warehouse) => warehouse.active)
      .map((warehouse) => warehouse.id)
  if (state.ecommerce?.stockScope === 'selected')
    return [...new Set(state.ecommerce.warehouseIds ?? [])]
  return [MAIN_WAREHOUSE]
}
export const storeWarehouseIds = (
  state: AppState,
  settings: Pick<IntegrationSettings, 'warehouseId'>,
) => salesWarehouseIds(state, settings.warehouseId)

/** Each bundle unit is assembled in a single warehouse; only standalone/complete units span warehouses. */
export function allocateOrderStock(
  state: AppState,
  lines: OrderLine[],
  warehouseIds: string[],
  excludeOrderId?: string,
  allowShortfall = false,
  preferred: StockAllocation[] = [],
): StockAllocation[] {
  const ids = [...new Set(warehouseIds)]
  if (
    !ids.length ||
    ids.some(
      (id) => !warehouses(state).some((warehouse) => warehouse.id === id && warehouse.active),
    )
  )
    throw new Error('Sipariş için etkin e-ticaret depolarını seçin.')
  const balances = new Map<string, number>(),
    allocations = new Map<string, StockAllocation>()
  const preserved = new Map(
    aggregateStockAllocations(preferred).map((item) => [
      JSON.stringify([item.warehouseId, item.variantId]),
      item.quantity,
    ]),
  )
  const preservedAt = (variantId: string, warehouseId: string) =>
    preserved.get(JSON.stringify([warehouseId, variantId])) ?? 0
  const balance = (variantId: string, warehouseId: string) => {
    const key = JSON.stringify([warehouseId, variantId])
    if (!balances.has(key))
      balances.set(key, variantAvailable(state, variantId, warehouseId, excludeOrderId))
    return balances.get(key)!
  }
  const planned = lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter((item) => item.line.kind !== 'free')
    .map(({ line, lineIndex }) => {
      const demand = stockDemand(state, [line], true).map((part) => ({
        variantId: part.variantId,
        units: part.quantity / line.quantity,
      }))
      if (
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        demand.some((part) => !Number.isSafeInteger(part.units) || part.units < 1)
      )
        throw new Error('Siparişin fiziksel bileşen adetlerini kontrol edin.')
      const options = ids.filter((id) =>
        demand.every(
          (part) =>
            Math.max(balance(part.variantId, id), preservedAt(part.variantId, id)) >= part.units,
        ),
      ).length
      return { line, lineIndex, demand, options }
    })
    .sort((a, b) => a.options - b.options || b.demand.length - a.demand.length)
  const assign = (
    demand: { variantId: string; units: number }[],
    warehouseId: string,
    units: number,
    lineIndex: number,
  ) => {
    for (const part of demand) {
      const key = JSON.stringify([warehouseId, part.variantId]),
        allocationKey = JSON.stringify([warehouseId, part.variantId, lineIndex]),
        quantity = part.units * units
      balances.set(key, balance(part.variantId, warehouseId) - quantity)
      preserved.set(key, Math.max(0, preservedAt(part.variantId, warehouseId) - quantity))
      const old = allocations.get(allocationKey)
      allocations.set(allocationKey, {
        warehouseId,
        variantId: part.variantId,
        lineIndex,
        quantity: (old?.quantity ?? 0) + quantity,
      })
    }
  }
  for (const { line, lineIndex, demand } of planned) {
    let remaining = line.quantity
    for (const warehouseId of ids) {
      const capacity = Math.max(
          0,
          Math.min(
            ...demand.map((part) =>
              Math.floor(preservedAt(part.variantId, warehouseId) / part.units),
            ),
          ),
        ),
        units = Math.min(capacity, remaining)
      if (units) {
        assign(demand, warehouseId, units, lineIndex)
        remaining -= units
      }
      if (!remaining) break
    }
    for (const warehouseId of ids) {
      const capacity = Math.max(
          0,
          Math.min(
            ...demand.map((part) => Math.floor(balance(part.variantId, warehouseId) / part.units)),
          ),
        ),
        units = Math.min(capacity, remaining)
      if (units) {
        assign(demand, warehouseId, units, lineIndex)
        remaining -= units
      }
      if (!remaining) break
    }
    if (remaining) {
      if (!allowShortfall && !state.ecommerce?.allowNegativeStock)
        throw new Error(
          `${line.title || line.variantId}: seçilen depolarda tam ürünü/paketi karşılayacak stok yok.`,
        )
      assign(demand, ids[0], remaining, lineIndex)
    }
  }
  return [...allocations.values()]
}

export function aggregateStockAllocations(items: StockAllocation[]) {
  const map = new Map<string, StockAllocation>()
  for (const item of items) {
    const key = JSON.stringify([item.warehouseId, item.variantId]),
      old = map.get(key)
    map.set(key, {
      warehouseId: item.warehouseId,
      variantId: item.variantId,
      quantity: (old?.quantity ?? 0) + item.quantity,
    })
  }
  return [...map.values()]
}

export function returnedOrderAllocations(
  state: AppState,
  order: Order,
  lineIndex: number,
  alreadyReturned: number,
  quantity: number,
): StockAllocation[] {
  const line = order.lines[lineIndex],
    unitParts = stockDemand(state, [{ ...line, quantity: 1 }], true)
  if (!order.stockAllocations)
    return unitParts.map((part) => ({
      ...part,
      quantity: part.quantity * quantity,
      warehouseId: order.warehouseId ?? MAIN_WAREHOUSE,
      lineIndex,
    }))
  let allocations = order.stockAllocations
  if (allocations.some((item) => item.lineIndex === undefined)) {
    const old = aggregateStockAllocations(allocations),
      virtual = structuredClone(state)
    for (const product of virtual.products)
      for (const variant of product.variants) {
        variant.stock = 0
        variant.stockByWarehouse = {}
      }
    for (const part of old) {
      const variant = virtual.products
        .flatMap((product) => product.variants)
        .find((variant) => variant.id === part.variantId)!
      variant.stockByWarehouse![part.warehouseId] = part.quantity
      variant.stock += part.quantity
    }
    virtual.orders = []
    allocations = allocateOrderStock(
      virtual,
      order.lines,
      order.warehouseIds ?? [order.warehouseId ?? MAIN_WAREHOUSE],
      undefined,
      false,
      old,
    )
  }
  const source = allocations.filter((item) => item.lineIndex === lineIndex),
    ids = [...new Set(source.map((item) => item.warehouseId))]
  let skip = alreadyReturned,
    remaining = quantity
  const result: StockAllocation[] = []
  for (const warehouseId of ids) {
    const counts = unitParts.map(
      (part) =>
        source
          .filter((item) => item.warehouseId === warehouseId && item.variantId === part.variantId)
          .reduce((sum, item) => sum + item.quantity, 0) / part.quantity,
    )
    if (
      !counts.length ||
      counts.some((count) => !Number.isSafeInteger(count) || count !== counts[0])
    )
      throw new Error('Siparişin depo/paket dağılımı doğrulanamadı.')
    const ignored = Math.min(skip, counts[0])
    skip -= ignored
    const units = Math.min(remaining, counts[0] - ignored)
    if (units)
      result.push(
        ...unitParts.map((part) => ({
          warehouseId,
          variantId: part.variantId,
          quantity: part.quantity * units,
          lineIndex,
        })),
      )
    remaining -= units
    if (!remaining) break
  }
  if (remaining || skip) throw new Error('İade miktarı kayıtlı depo çıkışını aşıyor.')
  return result
}
export function reserveOrderWarehouses(state: AppState, order: Order, ids: string[]) {
  order.warehouseId = ids[0] ?? MAIN_WAREHOUSE
  if (ids.length <= 1) {
    delete order.warehouseIds
    delete order.stockAllocations
    return
  }
  order.warehouseIds = [...ids]
  if (order.historical || order.inventoryApplied) return
  order.stockAllocations = allocateOrderStock(
    state,
    order.lines.filter((line) => line.kind === 'free' || !!line.variantId),
    ids,
    order.id,
    true,
  )
}
