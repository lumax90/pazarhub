import type { AppState, Order, OrderLine, Product, Variant } from './types'
import type { Listing } from './types'
import { warehouses } from './inventory'
import { rawVariant } from './inventory-base'
import { listingPricing } from './margins'
import { salesWarehouseIds } from './stock-allocation'
import { invoiceTryTotal } from './invoice-source'
import {
  lineCostExcludingTax,
  variantAvailable,
  variantPrice,
  variantReserved,
  variantStock,
} from './bundles'
export { variantCost, variantPrice, variantStock } from './bundles'

export const lineTotal = (line: OrderLine) =>
  line.lineTotalOverride ?? line.quantity * line.unitPrice
export function discountLines(lines: OrderLine[], discount: number): OrderLine[] {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  let assigned = 0
  return lines.map((line, index) => {
    const part =
      index === lines.length - 1
        ? discount - assigned
        : Math.round((discount * (line.quantity * line.unitPrice)) / Math.max(1, total))
    assigned += part
    return { ...line, lineTotalOverride: line.quantity * line.unitPrice - part }
  })
}
export const netOrderTotal = (state: AppState, order: Order) =>
  orderTotal(order) -
  (state.returns ?? [])
    .filter((item) => item.source === 'order' && item.saleId === order.id)
    .flatMap((item) => item.items)
    .reduce((sum, item) => sum + item.amount, 0)
export const orderTotal = (order: Pick<Order, 'lines' | 'shipping' | 'totalOverride'>) =>
  order.totalOverride ??
  order.lines.reduce((sum, line) => sum + lineTotal(line), 0) + order.shipping
export const taxTotal = (lines: OrderLine[]) =>
  lines.reduce(
    (sum, line) => sum + Math.round((lineTotal(line) * line.taxRate) / (100 + line.taxRate)),
    0,
  )
export const productStock = (product: Product, state: AppState) =>
  product.variants.reduce((sum, variant) => sum + variantStock(state, variant.id), 0)
export const productPrice = (product: Product, state: AppState) =>
  Math.min(...product.variants.map((variant) => variantPrice(state, variant.id)))
export const activeOrders = (state: AppState) =>
  state.orders.filter((order) => order.status !== 'cancelled' && order.status !== 'returned')

export function findVariant(
  state: AppState,
  id: string,
): { product: Product; variant: Variant } | undefined {
  return rawVariant(state, id)
}

export function reservedStock(state: AppState, variantId: string, excludeOrderId?: string) {
  return variantReserved(state, variantId, undefined, excludeOrderId)
}

export const availableStock = (
  state: AppState,
  variantId: string,
  excludeOrderId?: string,
  warehouseId?: string,
) => variantAvailable(state, variantId, warehouseId, excludeOrderId)

export function listingPrice(state: AppState, listing: Listing) {
  return listingPricing(state, listing).price
}
export const listingListPrice = (state: AppState, listing: Listing) =>
  listingPricing(state, listing).listPrice
export function listingQuantity(
  state: AppState,
  listing: Listing,
  buffer = 0,
  warehouseId: string | string[] = salesWarehouseIds(state),
) {
  const product = state.products.find((p) => p.id === listing.productId)
  if (!product?.active || listing.desiredStatus === 'archived') return 0
  const cap =
    listing.channel === 'trendyol'
      ? 20000
      : listing.channel === 'pttavm'
        ? 9999
        : listing.channel === 'n11'
          ? 999999
          : 100_000_000
  return Math.min(
    cap,
    Math.max(
      0,
      (Array.isArray(warehouseId) ? warehouseId : [warehouseId]).reduce(
        (sum, id) => sum + availableStock(state, listing.variantId, undefined, id),
        0,
      ) - buffer,
    ),
  )
}

export function customerBalance(state: AppState, customerId: string) {
  const orders = state.orders.filter((o) => o.customerId === customerId && o.status !== 'pending')
  const sales = state.retailSales.filter((s) => s.customerId === customerId)
  const orderIds = new Set(orders.map((o) => o.id)),
    saleIds = new Set(sales.map((s) => s.id)),
    invoiceIds = new Set(
      state.invoices
        .filter((invoice) => !invoice.orderId && invoice.document?.customerId === customerId)
        .map((invoice) => invoice.id),
    )
  const debt =
    orders
      .filter((o) => !['cancelled', 'returned'].includes(o.status))
      .reduce((sum, o) => sum + orderTotal(o), 0) +
    sales.reduce((sum, s) => sum + s.total, 0) +
    state.invoices
      .filter(
        (invoice) =>
          !invoice.orderId &&
          invoice.document?.customerId === customerId &&
          invoice.status !== 'cancelled',
      )
      .reduce((sum, invoice) => sum + invoiceTryTotal(state, invoice), 0)
  const returned = (state.returns ?? [])
    .filter((r) => (r.source === 'retail' ? saleIds.has(r.saleId) : orderIds.has(r.saleId)))
    .flatMap((r) => r.items)
    .reduce((sum, item) => sum + item.amount, 0)
  const cash = state.cash
    .filter(
      (entry) =>
        !entry.transferId &&
        (entry.customerId === customerId ||
          orderIds.has(entry.reference) ||
          invoiceIds.has(entry.reference) ||
          saleIds.has(entry.reference)),
    )
    .reduce((sum, entry) => sum + (entry.kind === 'in' ? entry.amount : -entry.amount), 0)
  const entries = (state.customerEntries ?? [])
    .filter((entry) => entry.customerId === customerId)
    .reduce((sum, entry) => sum + (entry.kind === 'debit' ? entry.amount : -entry.amount), 0)
  return debt - returned - cash + entries
}

export function lowStockProducts(state: AppState) {
  return state.products.filter(
    (product) =>
      product.active && product.variants.some((variant) => isLowStock(state, variant.id)),
  )
}

export function isLowStock(state: AppState, variantId: string, warehouseId?: string) {
  const found = findVariant(state, variantId)
  if (!found) return false
  return (
    warehouses(state)
      .filter((warehouse) => warehouse.active && (!warehouseId || warehouse.id === warehouseId))
      .some((warehouse) => {
        const threshold = found.variant.lowStockByWarehouse?.[warehouse.id]
        return threshold !== undefined && variantStock(state, variantId, warehouse.id) <= threshold
      }) ||
    availableStock(state, variantId, undefined, warehouseId) <=
      Math.max(found.product.lowStock, state.ecommerce?.criticalStock ?? 0)
  )
}

export function grossContribution(order: Order) {
  return order.lines.reduce(
    (sum, line) =>
      sum +
      (line.bundleComponents
        ? Math.round(lineTotal(line) / (1 + line.taxRate / 100)) - lineCostExcludingTax(line)
        : Math.round((lineTotal(line) - line.unitCost * line.quantity) / (1 + line.taxRate / 100))),
    0,
  )
}

export function netContribution(state: AppState, order: Order) {
  const entries = (state.returns ?? [])
    .filter((item) => item.source === 'order' && item.saleId === order.id)
    .flatMap((item) => item.items)
  const returned = order.lines.reduce((sum, line, index) => {
    const items = entries.filter((item) => item.lineIndex === index)
    if (line.bundleComponents) {
      const amount = items.reduce((total, item) => total + item.amount, 0)
      const restocked = items.reduce((total, item) => total + (item.restock ? item.quantity : 0), 0)
      return (
        sum + Math.round(amount / (1 + line.taxRate / 100)) - lineCostExcludingTax(line, restocked)
      )
    }
    return (
      sum +
      items.reduce(
        (total, item) =>
          total +
          Math.round(
            (item.amount - (item.restock ? line.unitCost * item.quantity : 0)) /
              (1 + line.taxRate / 100),
          ),
        0,
      )
    )
  }, 0)
  return grossContribution(order) - returned
}
