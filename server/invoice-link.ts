import type { AppState } from '../src/domain/types'
import { canonicalJson, sha256 } from './security'
import { invoiceManualSourceKey } from '../src/domain/invoice-document'

export function invoiceLinkRequestContainsUrl(body: string, url: string) {
  return (
    body.includes(url) ||
    body
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .includes(url)
  )
}

export function invoiceLinkKey(state: AppState, orderId: string) {
  const order = state.orders.find((order) => order.id === orderId),
    invoice = state.invoices.find((invoice) => invoice.orderId === orderId)
  if (
    !order ||
    !invoice ||
    invoice.status !== 'issued' ||
    !invoice.url ||
    order.syncError ||
    ['cancelled', 'returned'].includes(order.status)
  )
    return undefined
  return sha256(
    canonicalJson({
      invoiceId: invoice.id,
      url: invoice.url,
      number: invoice.documentNumber,
      manualDocument: invoice.manualDocument
        ? {
            url: invoice.manualDocument.url,
            number: invoice.manualDocument.number ?? null,
            linkedAt: invoice.manualDocument.linkedAt,
            linkedBy: invoice.manualDocument.linkedBy ?? null,
            previousStatus: invoice.manualDocument.previousStatus,
          }
        : null,
      source: invoiceManualSourceKey(state, invoice),
      order: {
        externalId: order.externalId,
        number: order.externalNumber,
        storeId: order.storeId,
        packages: order.packageNumbers,
        status: order.status,
      },
    }),
  )
}
