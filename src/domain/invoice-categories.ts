import type { AppState, Invoice, Channel } from './types'

export const invoiceCategoryUsage = (state: AppState, id: string) =>
  state.invoices.filter((invoice) => invoice.categoryId === id).length
export const invoiceCategoryName = (state: AppState, invoice: Invoice) =>
  state.invoiceCategories?.find((category) => category.id === invoice.categoryId)?.name ??
  invoice.categoryName
export const invoiceProviderCategoryName = (state: AppState, invoice: Invoice) =>
  invoice.remoteCategoryName ?? invoiceCategoryName(state, invoice)
export function defaultInvoiceCategory(state: AppState, channel: Channel) {
  if (channel === 'manual') return undefined
  const existing =
    state.invoiceCategories?.find((category) => category.id === 'invoice-marketplace') ??
    state.invoiceCategories?.find(
      (category) => category.name.trim().toLocaleLowerCase('tr-TR') === 'pazaryeri',
    )
  if (existing) return existing.active ? existing : undefined
  const category = { id: 'invoice-marketplace', name: 'Pazaryeri', active: true, version: 1 }
  state.invoiceCategories = [...(state.invoiceCategories ?? []), category]
  return category
}
