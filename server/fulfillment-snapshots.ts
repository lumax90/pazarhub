import type { AppState, Invoice, Order } from '../src/domain/types'
import { orderTotal, lineTotal } from '../src/domain/selectors'
import { canonicalJson, sha256 } from './security'
import { invoiceSource } from '../src/domain/invoice-source'
import { invoiceProviderCategoryName } from '../src/domain/invoice-categories'

export interface InvoiceSnapshot {
  invoice: Invoice
  order: Order
  key: string
}
export function invoiceSnapshot(state: AppState, invoiceId: string): InvoiceSnapshot | undefined {
  const invoice = state.invoices.find((invoice) => invoice.id === invoiceId)
  const order = invoice && invoiceSource(state, invoice)
  if (!invoice || !order) return undefined
  const key = sha256(
    canonicalJson({
      invoiceId,
      issueDate: invoice.issueDate ?? invoice.createdAt.slice(0, 10),
      dueDate: invoice.dueDate,
      title: invoice.title,
      note: invoice.note,
      categoryId: invoice.categoryId,
      categoryName: invoiceProviderCategoryName(state, invoice),
      localOnly: invoice.localOnly,
      manualDocument: invoice.manualDocument,
      orderId: order.id,
      orderNumber: order.externalNumber || order.number,
      orderDate: order.createdAt.slice(0, 10),
      billing: order.billingAddress,
      currency: order.currency,
      currencyRate: order.currencyRate,
      currencyShipping: order.currencyShipping,
      lines: order.lines.map((line) => ({
        kind: line.kind,
        id: line.id,
        externalId: line.externalId,
        variantId: line.variantId,
        title: line.invoiceTitle || line.title,
        unit: line.unit,
        quantity: line.quantity,
        amount: lineTotal(line),
        currencyTotal: line.currencyTotal,
        currencyUnitPrice: line.currencyUnitPrice,
        taxRate: line.taxRate,
      })),
      shipping: order.shipping,
      total: orderTotal(order),
      shipment: order.shipmentMetadata,
    }),
  )
  return {
    invoice: {
      ...structuredClone(invoice),
      ...(invoiceProviderCategoryName(state, invoice)
        ? { categoryName: invoiceProviderCategoryName(state, invoice) }
        : {}),
    },
    order: structuredClone(order),
    key,
  }
}
