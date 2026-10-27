import type {
  AppState,
  Order,
  OrderFilters,
  OrderItemInput,
  OrderLine,
  OrderDiscount,
  Invoice,
} from './types'
import { findVariant } from './selectors'
import { invoiceLineMetadata } from './products'
import { warehouses } from './inventory'
import {
  snapshotBundle,
  validateStockDemand,
  variantCost,
  variantCostKnown,
  variantPrice,
} from './bundles'
import { dayKey, matches } from '../lib/format'
import {
  currencySnapshot,
  fromTry,
  toTry,
  inclusivePrice,
  exclusivePrice,
  multiplyMoney,
} from './money'
import type { CurrencyCode } from './money'
import { salesWarehouseIds, allocateOrderStock } from './stock-allocation'
import { nextInvoiceNumber } from './invoice-source'
import { defaultInvoiceCategory } from './invoice-categories'

export const orderColumnIds = [
  'customer',
  'products',
  'date',
  'due',
  'channel',
  'status',
  'preparation',
  'invoice',
  'print',
  'total',
] as const
export const defaultOrderColumns = [...orderColumnIds]
export const inventoryLines = (lines: OrderLine[]) => lines.filter((line) => line.kind !== 'free')
export const orderLineKey = (line: OrderLine, index: number) =>
  line.id ?? `${line.externalId || line.variantId || 'line'}:${index}`
export const orderContentKey = (order: Order) =>
  JSON.stringify(
    order.lines.map((line, index) => [
      orderLineKey(line, index),
      line.kind ?? 'catalog',
      line.variantId,
      line.quantity,
      line.unitPrice,
      line.taxRate,
      line.lineTotalOverride,
      line.title,
      line.bundleComponents,
    ]),
  )
export const orderPreparation = (order: Order) => ({
  ready: order.syncError ? 0 : order.lines.filter((line) => line.prepared).length,
  total: order.lines.length,
})
export const orderPrintKey = (order: Order) =>
  JSON.stringify({
    number: order.number,
    externalNumber: order.externalNumber,
    lines: order.lines.map((line) => {
      const copy = { ...line }
      delete copy.prepared
      return copy
    }),
    shipping: order.shipping,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    currency: order.currency,
    currencyRate: order.currencyRate,
    currencyShipping: order.currencyShipping,
    totalOverride: order.totalOverride,
    note: order.note,
    trackingNumber: order.trackingNumber,
    cargoProvider: order.cargoProvider,
  })
export const orderPrinted = (order: Order) =>
  !!order.printStatus?.printed && order.printStatus.contentKey === orderPrintKey(order)
export const hasUnmappedLines = (state: AppState, order: Order) =>
  inventoryLines(order.lines).some((line) => !findVariant(state, line.variantId))

export function discountedOrderAmount(
  quantity: number,
  price: number,
  discount?: OrderLine['discount'],
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(price) || price < 0)
    throw new Error('Miktar ve birim fiyatı kontrol edin.')
  const gross = BigInt(quantity) * BigInt(price)
  if (gross > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Satır tutarı sınırın dışında.')
  let deduction = 0n
  if (discount) {
    if (
      !Number.isSafeInteger(discount.value) ||
      discount.value < 0 ||
      (discount.kind === 'percent' && discount.value > 10000)
    )
      throw new Error('İndirim oranı veya tutarı geçersiz.')
    deduction =
      discount.kind === 'amount'
        ? BigInt(discount.value)
        : (gross * BigInt(discount.value) + 5000n) / 10000n
  }
  if (deduction > gross) throw new Error('İndirim satır tutarını aşamaz.')
  return Number(gross - deduction)
}

export function orderInputAmounts(
  quantity: number,
  price: number,
  taxRate: number,
  discount?: OrderDiscount,
  includesVat = true,
) {
  const discounted = discountedOrderAmount(quantity, price, discount)
  const unitPrice = includesVat ? price : inclusivePrice(price, taxRate)
  const total = includesVat ? discounted : inclusivePrice(discounted, taxRate)
  if (!Number.isSafeInteger(unitPrice) || !Number.isSafeInteger(total))
    throw new Error('KDV dahil satır tutarı sınırın dışında.')
  return { unitPrice, total }
}

export function manualOrderLines(
  state: AppState,
  items: OrderItemInput[],
  warehouseId?: string,
  id: () => string = () => crypto.randomUUID(),
  pricing: {
    currency?: CurrencyCode
    includesVat?: boolean
    rate?: string
    preservedLines?: OrderLine[]
  } = {},
): OrderLine[] | string {
  const currency = pricing.currency ?? 'TRY',
    includesVat = pricing.includesVat !== false
  if (!items.length || items.length > 200) return 'Siparişe 1–200 satır ekleyin.'
  const warehouseIds = salesWarehouseIds(state, warehouseId)
  if (
    !warehouseIds.length ||
    warehouseIds.some((id) => !warehouses(state).some((w) => w.id === id && w.active))
  )
    return 'Etkin bir depo seçin.'
  const lines: OrderLine[] = []
  for (const item of items) {
    const found = item.kind === 'free' ? undefined : findVariant(state, item.variantId)
    const preserved = found
      ? pricing.preservedLines?.find(
          (line) => line.variantId === found.variant.id && line.kind !== 'free',
        )
      : undefined
    if (item.kind !== 'free' && (!found || !found.product.active))
      return 'Sipariş ürünü bulunamadı veya satışa kapalı.'
    if (
      found &&
      !preserved &&
      (!Number.isSafeInteger(variantPrice(state, found.variant.id)) ||
        !Number.isSafeInteger(variantCost(state, found.variant.id)))
    )
      return 'Sipariş ürününün döviz kuru gerekli.'
    if (
      item.kind !== 'free' &&
      found?.product.bundle &&
      !preserved &&
      item.bundleVersion !== undefined &&
      item.bundleVersion !== (found.product.version ?? 0)
    )
      return 'Paket kartı değişti. İçeriği kontrol edip sipariş satırını yeniden ekleyin.'
    if (item.kind === 'free' && (!item.title.trim() || item.title.length > 300))
      return 'Serbest satıra bir ürün/hizmet adı yazın.'
    const taxRate = item.taxRate ?? found!.product.taxRate
    const catalogPrice =
      item.unitPrice === undefined
        ? pricing.rate
          ? multiplyMoney(variantPrice(state, found!.variant.id), 100000000n, BigInt(pricing.rate))
          : fromTry(
              variantPrice(state, found!.variant.id),
              currency,
              state.exchangeRates,
              state.ecommerce?.exchangeRateType,
            )
        : 0
    const inputPrice =
      item.unitPrice ?? (includesVat ? catalogPrice : exclusivePrice(catalogPrice, taxRate))
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10000 ||
      !Number.isInteger(taxRate) ||
      taxRate < 0 ||
      taxRate > 100 ||
      inputPrice > 1000000000
    )
      return 'Satır miktarı, fiyatı ve KDV oranını kontrol edin.'
    let total: number, unitPrice: number, currencyUnitPrice: number, currencyTotal: number
    try {
      const amounts = orderInputAmounts(
        item.quantity,
        inputPrice,
        taxRate,
        item.discount,
        includesVat,
      )
      currencyUnitPrice = amounts.unitPrice
      currencyTotal = amounts.total
      unitPrice = pricing.rate
        ? multiplyMoney(currencyUnitPrice, BigInt(pricing.rate), 100000000n)
        : toTry(currencyUnitPrice, currency, state.exchangeRates, state.ecommerce?.exchangeRateType)
      total = pricing.rate
        ? multiplyMoney(currencyTotal, BigInt(pricing.rate), 100000000n)
        : toTry(currencyTotal, currency, state.exchangeRates, state.ecommerce?.exchangeRateType)
      if (!Number.isSafeInteger(unitPrice) || !Number.isSafeInteger(total))
        throw new Error('Sipariş döviz kuru veya tutarı geçersiz.')
    } catch (error) {
      return (error as Error).message
    }
    const line: OrderLine = {
      id: id(),
      kind: item.kind ?? 'catalog',
      variantId: found?.variant.id ?? '',
      quantity: item.quantity,
      unitPrice,
      ...(currency !== 'TRY'
        ? { currencyUnitPrice, currencyTotal, currencyDiscount: item.discount }
        : {}),
      unitCost: preserved?.unitCost ?? (found ? variantCost(state, found.variant.id) : 0),
      taxRate,
      taxKnown: true,
      title: item.kind === 'free' ? item.title.trim() : found!.product.name,
      costKnown: !!found && variantCostKnown(state, found.variant.id),
      ...(found
        ? currencySnapshot(
            found.product.currency,
            state.exchangeRates,
            state.ecommerce?.exchangeRateType,
          )
        : {}),
      ...(found?.product.bundle
        ? {
            bundleComponents:
              preserved?.bundleComponents ?? snapshotBundle(state, found.variant.id),
          }
        : {}),
      ...(found
        ? {
            sku: found.variant.sku,
            barcode: found.variant.barcode,
            variantName: found.variant.name,
            ...invoiceLineMetadata(found.product, found.variant),
          }
        : { unit: item.kind === 'free' ? item.unit || 'Adet' : 'Adet' }),
      ...(item.discount || !includesVat || currency !== 'TRY' ? { lineTotalOverride: total } : {}),
      ...(item.discount
        ? {
            discount:
              item.discount.kind === 'percent'
                ? item.discount
                : {
                    kind: 'amount' as const,
                    value: toTry(
                      includesVat
                        ? item.discount.value
                        : inclusivePrice(item.discount.value, taxRate),
                      currency,
                      state.exchangeRates,
                      state.ecommerce?.exchangeRateType,
                    ),
                  },
          }
        : {}),
    }
    if (preserved) {
      line.unitCost = preserved.unitCost
      line.costKnown = preserved.costKnown
      line.catalogCurrency = preserved.catalogCurrency
      line.catalogExchangeRate = preserved.catalogExchangeRate
      line.exchangeRateDate = preserved.exchangeRateDate
      line.bundleComponents = preserved.bundleComponents
    }
    if (item.discount?.kind === 'amount' && pricing.rate)
      line.discount = {
        kind: 'amount',
        value: multiplyMoney(
          includesVat ? item.discount.value : inclusivePrice(item.discount.value, taxRate),
          BigInt(pricing.rate),
          100000000n,
        ),
      }
    lines.push(line)
  }
  if (warehouseIds.length === 1) {
    const stockError = validateStockDemand(state, lines, warehouseIds[0])
    if (stockError) return stockError
  } else
    try {
      allocateOrderStock(state, lines, warehouseIds)
    } catch (error) {
      return (error as Error).message
    }
  return lines
}

export function ensureOrderInvoice(
  state: AppState,
  order: Order,
  now: string,
  id: () => string,
): Invoice {
  const current = state.invoices.find((invoice) => invoice.orderId === order.id)
  if (current) {
    order.invoiceId = current.id
    return current
  }
  const category = defaultInvoiceCategory(state, order.channel)
  const invoice = {
    id: id(),
    number: nextInvoiceNumber(state),
    orderId: order.id,
    createdAt: now,
    status: 'draft' as const,
    ...(category ? { categoryId: category.id, categoryName: category.name } : {}),
  }
  order.invoiceId = invoice.id
  state.invoices.unshift(invoice)
  return invoice
}

export function ensureAutomaticOrderInvoice(
  state: AppState,
  order: Order,
  now: string,
  id: () => string,
) {
  const timing = order.invoiceTiming ?? 'on_approval',
    rank = { pending: 0, approved: 1, shipped: 2, delivered: 3, cancelled: -1, returned: -1 }[
      order.status
    ]
  const threshold = { on_created: 0, on_approval: 1, on_shipped: 2, on_delivered: 3 }
  if (
    timing === 'manual' ||
    !Object.hasOwn(threshold, timing) ||
    order.historical ||
    order.syncError ||
    order.syncStatus === 'error' ||
    (rank >= 1 && !order.inventoryApplied) ||
    rank < threshold[timing] ||
    hasUnmappedLines(state, order)
  )
    return undefined
  const previous = state.invoices.find((invoice) => invoice.orderId === order.id)
  const invoice = ensureOrderInvoice(state, order, now, id)
  if (!previous) invoice.automatic = true
  return invoice
}

export function filterOrders(state: AppState, filters: OrderFilters, ignoreStatus = false) {
  return state.orders.filter((order) => {
    const date = dayKey(order.createdAt)
    if (filters.printed !== undefined && filters.printed !== orderPrinted(order)) return false
    const customer = state.customers.find((c) => c.id === order.customerId)
    const invoiced = !!state.invoices.find(
      (i) => i.orderId === order.id && i.status !== 'cancelled',
    )
    const shipment = !!state.shipments?.some(
      (s) => s.orderId === order.id && s.status !== 'cancelled',
    )
    return (
      (!filters.from || date >= filters.from) &&
      (!filters.to || date <= filters.to) &&
      (ignoreStatus || !filters.statuses?.length || filters.statuses.includes(order.status)) &&
      (!filters.channel || order.channel === filters.channel) &&
      (!filters.storeId || order.storeId === filters.storeId) &&
      (!filters.cargoProvider || order.cargoProvider === filters.cargoProvider) &&
      (filters.paid === undefined || order.paid === filters.paid) &&
      (filters.invoiced === undefined || invoiced === filters.invoiced) &&
      (filters.unmapped === undefined || hasUnmappedLines(state, order) === filters.unmapped) &&
      (filters.ownShipment === undefined || shipment === filters.ownShipment) &&
      matches(
        `${order.number} ${order.externalNumber ?? ''} ${customer?.name ?? ''} ${order.shippingAddress?.name ?? ''} ${order.trackingNumber ?? ''}`,
        filters.query ?? '',
      )
    )
  })
}

export function defaultOrderDates(now = new Date(), days = 7) {
  const to = dayKey(now),
    start = new Date(`${to}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return { from: dayKey(start), to }
}
export function orderDueDate(createdAt: string, days: number) {
  const day = dayKey(new Date(Date.parse(createdAt) + days * 86400000))
  return new Date(`${day}T23:59:59.999+03:00`).toISOString()
}
