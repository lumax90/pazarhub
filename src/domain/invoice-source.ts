import type { AppState, Invoice, Order } from './types'

export function nextInvoiceNumber(state: AppState) {
  let sequence = Math.max(
    1000,
    state.invoiceSequence ?? 0,
    ...state.invoices.map((invoice) => Number(/^FT-(\d+)$/.exec(invoice.number)?.[1] ?? 0)),
  )
  let number: string
  do {
    number = `FT-${String(++sequence).padStart(6, '0')}`
  } while (state.invoices.some((invoice) => invoice.number === number))
  state.invoiceSequence = sequence
  return number
}

/** Accounting/adaptor view only: a standalone invoice never inserts a synthetic order. */
export function invoiceSource(state: AppState, invoice: Invoice): Order | undefined {
  if (invoice.orderId) return state.orders.find((order) => order.id === invoice.orderId)
  const data = invoice.document
  if (!data) return undefined
  return {
    id: invoice.id,
    number: invoice.number,
    externalNumber: data.sourceNumber,
    customerId: data.customerId,
    billingAddress: data.billingAddress,
    channel: 'manual',
    status: invoice.status === 'cancelled' ? 'cancelled' : 'approved',
    createdAt: `${invoice.issueDate ?? invoice.createdAt.slice(0, 10)}T12:00:00+03:00`,
    dueAt: invoice.dueDate ? `${invoice.dueDate}T23:59:59+03:00` : invoice.createdAt,
    lines: data.lines,
    shipping: 0,
    currency: data.currency,
    currencyRate: data.currencyRate,
    currencyShipping: 0,
    warehouseId: data.warehouseIds[0],
    warehouseIds: data.warehouseIds,
    stockAllocations: data.stockAllocations,
    inventoryApplied: invoice.status !== 'cancelled',
    paid: !!invoice.paymentCashId,
    note: invoice.note ?? '',
    events: invoice.events ?? [],
    invoicePreference: invoice.localOnly ? 'draft' : 'default',
  }
}
export const invoiceTryTotal = (state: AppState, invoice: Invoice) => {
  const source = invoiceSource(state, invoice)
  return source
    ? (source.totalOverride ??
        source.lines.reduce(
          (sum, line) => sum + (line.lineTotalOverride ?? line.quantity * line.unitPrice),
          0,
        ) + source.shipping)
    : NaN
}
export const invoicePayment = (state: AppState, invoice: Invoice) => {
  const source = invoiceSource(state, invoice)
  if (invoice.orderId)
    return {
      paid: !!source?.paid,
      cash:
        state.cash.find((entry) => entry.id === invoice.paymentCashId) ??
        state.cash.find(
          (entry) =>
            entry.reference === invoice.orderId && entry.kind === 'in' && !entry.transferId,
        ),
    }
  return {
    paid: !!invoice.paymentCashId,
    cash: state.cash.find((entry) => entry.id === invoice.paymentCashId),
  }
}

/** Only receipts explicitly linked to this document/order are attributable to its balance. */
export function invoiceAmountDue(state: AppState, invoice: Invoice) {
  if (invoicePayment(state, invoice).paid) return 0
  const total = invoiceTryTotal(state, invoice)
  const receipts = state.cash.filter(
    (entry) =>
      !entry.transferId &&
      (entry.reference === invoice.id || (invoice.orderId && entry.reference === invoice.orderId)),
  )
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    receipts.some((entry) => !Number.isSafeInteger(entry.amount) || entry.amount < 0)
  )
    return NaN
  const received = receipts.reduce(
    (sum, entry) => sum + (entry.kind === 'in' ? entry.amount : -entry.amount),
    0,
  )
  return Number.isSafeInteger(received) ? Math.max(0, total - Math.max(0, received)) : NaN
}
