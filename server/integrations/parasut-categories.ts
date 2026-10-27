import type { ProviderHttp } from './http'
import { array, record, text } from './contracts'
import { ProviderError } from '../errors'

export async function findParasutInvoiceCategory(
  http: ProviderHttp,
  base: string,
  headers: Record<string, string>,
  name: string,
) {
  const matches: Record<string, unknown>[] = []
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({
      'filter[name]': name,
      'filter[category_type]': 'SalesInvoice',
      'page[number]': String(page),
      'page[size]': '25',
    })
    const response = record(await http.request(`${base}/item_categories?${query}`, { headers }))
    if (!Array.isArray(response.data))
      throw new ProviderError('CATEGORY_RESPONSE_INVALID', 'Paraşüt fatura kategorileri okunamadı.')
    matches.push(
      ...response.data.map(record).filter((item) => {
        const attrs = record(item.attributes)
        return (
          item.type === 'item_categories' &&
          attrs.category_type === 'SalesInvoice' &&
          text(attrs.name).trim().toLocaleLowerCase('tr-TR') ===
            name.trim().toLocaleLowerCase('tr-TR')
        )
      }),
    )
    if (response.data.length < 25 || record(response.meta).total_pages === page) break
    if (page === 100)
      throw new ProviderError('CATEGORY_PAGING_LIMIT', 'Paraşüt kategori araması tamamlanamadı.')
  }
  if (matches.length > 1)
    throw new ProviderError(
      'CATEGORY_AMBIGUOUS',
      'Paraşüt’te aynı adla birden fazla satış faturası kategorisi var. Kayıtları doğrulayın.',
    )
  const match = matches[0]
  if (match && !text(match.id))
    throw new ProviderError('CATEGORY_RESPONSE_INVALID', 'Paraşüt kategori kimliği okunamadı.')
  return match ? { id: text(match.id), name: text(record(match.attributes).name) } : undefined
}
export function parasutInvoiceCategory(response: Record<string, unknown>) {
  const remote = record(response.data),
    ref = record(record(record(remote.relationships).category).data)
  if (!text(ref.id)) return undefined
  if (ref.type !== 'item_categories')
    throw new ProviderError(
      'INVOICE_CATEGORY_UNCONFIRMED',
      'Paraşüt kategori kaynak türü doğrulanamadı.',
    )
  const item = array(response.included)
      .map(record)
      .find((item) => item.type === 'item_categories' && item.id === ref.id),
    attrs = record(item?.attributes)
  if (!item || attrs.category_type !== 'SalesInvoice' || !text(attrs.name))
    throw new ProviderError(
      'INVOICE_CATEGORY_UNCONFIRMED',
      'Paraşüt faturasının kategori ilişkisi doğrulanamadı.',
    )
  return { id: text(ref.id), name: text(attrs.name) }
}
