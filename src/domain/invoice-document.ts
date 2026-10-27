import type { AppState, Invoice } from './types'
import { invoiceSource } from './invoice-source'

export function manualInvoiceUrl(raw: string) {
  try {
    const url = new URL(raw.trim()),
      host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (
      raw.length > 2048 ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== '443') ||
      !host.includes('.') ||
      /^[\d.]+$/.test(host) ||
      host.includes(':') ||
      /(^|\.)(localhost|local|internal|lan)$/.test(host)
    )
      return undefined
    return url.href
  } catch {
    return undefined
  }
}
/** CAS against the invoice's own frozen data and, for order documents, its live source. */
export function invoiceManualSourceKey(state: AppState, invoice: Invoice) {
  const source = invoiceSource(state, invoice)
  if (!source) return ''
  return JSON.stringify({
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    title: invoice.title,
    note: invoice.note,
    categoryId: invoice.categoryId,
    localOnly: invoice.localOnly,
    orderId: invoice.orderId,
    number: source.externalNumber || source.number,
    externalId: source.externalId,
    storeId: source.storeId,
    billing: source.billingAddress,
    currency: source.currency,
    rate: source.currencyRate,
    lines: source.lines,
    shipping: source.shipping,
    total: source.totalOverride,
    shipment: source.shipmentMetadata,
  })
}
export const invoiceDocumentLabel = (invoice: Invoice) =>
  invoice.manualDocument
    ? invoice.status === 'cancelled'
      ? 'Dış belge bağlı · yerel iptal'
      : 'Dışarıda kesildi · elle bağlandı'
    : invoice.localOnly
      ? 'Yalnız iç kayıt'
      : undefined
