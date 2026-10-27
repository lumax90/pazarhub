import type { AdapterContext, AdapterResult } from './contracts'
import { array, record, text } from './contracts'
import { ProviderError } from '../errors'
import type { ProviderHttp } from './http'
import type { InvoiceSnapshot } from '../fulfillment-snapshots'
import { invoiceSnapshot } from '../fulfillment-snapshots'
import { findVariant } from '../../src/domain/selectors'
import { orderLineCurrencyTotal, orderCurrencyShipping } from '../../src/domain/order-currency'
import { parasutMoneyMatches } from './parasut-money'
import { findParasutInvoiceCategory, parasutInvoiceCategory } from './parasut-categories'
import { canonicalJson } from '../security'

export function parasutLines(context: AdapterContext, order: InvoiceSnapshot['order']) {
  const lines = order.lines.map((line, index) => ({
    code:
      line.kind === 'free'
        ? `PH-SERVICE-${line.id || `${order.id}-${index}`}`
        : `PH-${line.variantId || line.externalId}`,
    title:
      line.invoiceTitle ||
      line.title ||
      findVariant(context.state, line.variantId)?.product.name ||
      'Ürün',
    unit: line.unit || 'Adet',
    quantity: line.quantity,
    amount: orderLineCurrencyTotal(order, line),
    taxRate: line.taxRate,
  }))
  if (orderCurrencyShipping(order))
    lines.push({
      code: 'PH-SHIPPING',
      title: 'Kargo bedeli',
      unit: 'Adet',
      quantity: 1,
      amount: orderCurrencyShipping(order),
      taxRate: 20,
    })
  return lines
}

export async function reconcileParasut(
  http: ProviderHttp,
  base: string,
  headers: Record<string, string>,
  context: AdapterContext,
  payload: Record<string, unknown>,
  status: (context: AdapterContext, payload: Record<string, unknown>) => Promise<AdapterResult>,
): Promise<AdapterResult> {
  const source = record(payload.sourcePayload),
    snapshot = (source.invoiceSnapshot ??
      invoiceSnapshot(context.state, text(payload.invoiceId))) as InvoiceSnapshot | undefined
  if (!snapshot) throw new ProviderError('INVOICE_NOT_FOUND', 'Fatura kaydı bulunamadı.')
  const { invoice, order } = snapshot,
    marker = `Pazarhub ${invoice.id}`
  let externalId =
    text(payload.externalId) ||
    context.state.invoices.find((item) => item.id === invoice.id)?.externalId ||
    invoice.externalId
  if (!externalId) {
    const candidates: string[] = []
    for (let page = 1; page <= 100; page++) {
      const query = new URLSearchParams({
        'filter[issue_date]': invoice.issueDate ?? invoice.createdAt.slice(0, 10),
        'page[size]': '25',
        'page[number]': String(page),
      })
      const response = record(await http.request(`${base}/sales_invoices?${query}`, { headers }))
      if (!Array.isArray(response.data))
        throw new ProviderError('INVALID_RESPONSE', 'Paraşüt fatura araması okunamadı.')
      for (const value of response.data) {
        const item = record(value)
        const description = text(record(item.attributes).description)
        if (
          description === marker ||
          description.startsWith(`${marker} · `) ||
          description.startsWith(`${marker}\n`)
        )
          candidates.push(text(item.id))
      }
      if (response.data.length < 25 || record(response.meta).total_pages === page) break
      if (page === 100)
        throw new ProviderError(
          'PAGING_LIMIT',
          'Fatura aramasında çok kayıt var; Paraşüt fatura kimliğini girin.',
        )
    }
    if (candidates.length > 1)
      throw new ProviderError(
        'DUPLICATE_INVOICE',
        'Aynı yerel referansla birden fazla Paraşüt faturası bulundu. Sağlayıcı kayıtlarını kontrol edin.',
      )
    externalId = candidates[0]
  }
  if (!externalId && payload.sourceOperation === 'invoice.create') {
    const categoryName =
      text(source.categoryName) || invoice.remoteCategoryName || invoice.categoryName
    if (categoryName && !source.categoryId) {
      const category = await findParasutInvoiceCategory(http, base, headers, categoryName)
      if (category)
        return {
          message: 'Paraşüt kategori kaydı doğrulandı; hazırlık bu adımdan sürdürülecek.',
          resolution: {
            outcome: 'resume',
            nextPayload: {
              ...source,
              invoiceSnapshot: snapshot,
              categoryId: category.id,
              categoryName,
            },
          },
        }
      throw new ProviderError(
        'CATEGORY_NOT_CONFIRMED',
        'Paraşüt kategori kaydı henüz doğrulanamadı; kategori yeniden oluşturulmadı.',
      )
    }
    const billing = order.billingAddress,
      productIds = array(source.productIds).map(text),
      lines = parasutLines(context, order)
    if (!source.contactId && billing) {
      const response = record(
        await http.request(
          `${base}/contacts?${new URLSearchParams({ 'filter[name]': billing.name, 'page[size]': '25' })}`,
          { headers },
        ),
      )
      const contacts = array(response.data)
        .map(record)
        .filter((item) => {
          const attrs = record(item.attributes)
          return (
            attrs.name === billing.name &&
            attrs.address === billing.address &&
            text(attrs.tax_number) === text(billing.taxId)
          )
        })
      if (contacts.length === 1)
        return {
          message:
            'Paraşüt müşteri kaydı doğrulandı; fatura hazırlığı kaldığı adımdan sürdürülecek.',
          resolution: {
            outcome: 'resume',
            nextPayload: {
              ...source,
              invoiceSnapshot: snapshot,
              contactId: text(contacts[0].id),
              productIds: [],
            },
          },
        }
    } else if (productIds.length < lines.length) {
      const line = lines[productIds.length],
        response = record(
          await http.request(
            `${base}/products?${new URLSearchParams({ 'filter[code]': line.code, 'page[size]': '25' })}`,
            { headers },
          ),
        )
      const products = array(response.data)
        .map(record)
        .filter(
          (item) =>
            record(item.attributes).code === line.code &&
            text(record(item.attributes).unit).toLocaleLowerCase('tr-TR') ===
              line.unit.toLocaleLowerCase('tr-TR'),
        )
      if (products.length === 1)
        return {
          message: 'Paraşüt ürün kaydı doğrulandı; fatura hazırlığı bu adımdan sürdürülecek.',
          resolution: {
            outcome: 'resume',
            nextPayload: {
              ...source,
              invoiceSnapshot: snapshot,
              productIds: [...productIds, text(products[0].id)],
            },
          },
        }
    }
    throw new ProviderError(
      'INVOICE_NOT_CONFIRMED',
      'Paraşüt kaydı henüz doğrulanamadı. Mevcut işlemi yeniden oluşturmak yerine daha sonra sorgulayın veya fatura kimliğini girin.',
    )
  }
  if (!externalId)
    throw new ProviderError('INVOICE_NOT_CONFIRMED', 'Paraşüt fatura kimliği doğrulanamadı.')
  const response = record(
      await http.request(
        `${base}/sales_invoices/${encodeURIComponent(externalId)}?include=contact,details,details.product,active_e_document,category`,
        { headers },
      ),
    ),
    remote = record(response.data),
    attrs = record(remote.attributes)
  if (
    text(remote.id) !== externalId ||
    !(
      attrs.description === marker ||
      text(attrs.description).startsWith(`${marker} · `) ||
      text(attrs.description).startsWith(`${marker}\n`)
    ) ||
    text(attrs.order_no) !== (order.externalNumber || order.number) ||
    text(attrs.issue_date) !== (invoice.issueDate ?? invoice.createdAt.slice(0, 10)) ||
    text(attrs.tax_number) !== text(order.billingAddress?.taxId) ||
    !parasutMoneyMatches(order, attrs, true) ||
    attrs.cancelled === true
  )
    throw new ProviderError(
      'INVOICE_IDENTITY_MISMATCH',
      'Paraşüt faturası yerel referans, sipariş, tarih, VKN/TCKN, para birimi veya toplamla uyuşmuyor.',
    )
  const included = array(response.included).map(record),
    detailRefs = array(record(record(remote.relationships).details).data).map(record)
  const categoryName =
    text(source.categoryName) || invoice.remoteCategoryName || invoice.categoryName
  const category = categoryName ? parasutInvoiceCategory(response) : undefined
  if (
    categoryName &&
    (!category ||
      (text(source.categoryId) && text(source.categoryId) !== category.id) ||
      category.name.trim().toLocaleLowerCase('tr-TR') !==
        categoryName.trim().toLocaleLowerCase('tr-TR'))
  )
    throw new ProviderError(
      'INVOICE_CATEGORY_MISMATCH',
      'Paraşüt faturasının kategori ilişkisi kaynakla eşleşmiyor.',
    )
  const lines = parasutLines(context, order)
  const remoteLines = detailRefs
    .map((ref) => included.find((item) => item.type === ref.type && item.id === ref.id))
    .map((item) => {
      const data = record(item),
        attributes = record(data.attributes),
        productRef = record(record(record(data.relationships).product).data),
        product = included.find((item) => item.type === 'products' && item.id === productRef.id)
      return {
        code: text(record(product?.attributes).code),
        title: text(attributes.description),
        quantity: Number(attributes.quantity),
        taxRate: Number(attributes.vat_rate),
        amount:
          Number(attributes.discount_value ?? 0) === 0
            ? Math.round(
                Number(attributes.unit_price) *
                  Number(attributes.quantity) *
                  (100 + Number(attributes.vat_rate)),
              )
            : NaN,
      }
    })
  const ordered = (items: { code: string; title: string; quantity: number; taxRate: number }[]) =>
    items
      .map(({ code, title, quantity, taxRate }) => ({ code, title, quantity, taxRate }))
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
  if (canonicalJson(ordered(remoteLines)) !== canonicalJson(ordered(lines)))
    throw new ProviderError(
      'INVOICE_LINES_MISMATCH',
      'Paraşüt faturasının ürün, adet, açıklama veya KDV satırları uyuşmuyor.',
    )
  const expectedAmounts = [...lines].sort(
    (a, b) => a.code.localeCompare(b.code) || a.amount - b.amount,
  )
  const actualAmounts = [...remoteLines].sort(
    (a, b) => a.code.localeCompare(b.code) || a.amount - b.amount,
  )
  if (
    actualAmounts.some(
      (line, index) =>
        !Number.isSafeInteger(line.amount) ||
        Math.abs(line.amount - expectedAmounts[index].amount) > 1,
    )
  )
    throw new ProviderError('INVOICE_LINES_MISMATCH', 'Paraşüt fatura satır tutarları eşleşmiyor.')
  const contactRef = record(record(record(remote.relationships).contact).data),
    contact = included.find((item) => item.type === 'contacts' && item.id === contactRef.id)
  if (
    record(contact?.attributes).name !== order.billingAddress?.name ||
    (source.contactId && text(contactRef.id) !== text(source.contactId))
  )
    throw new ProviderError('INVOICE_CUSTOMER_MISMATCH', 'Paraşüt fatura müşterisi eşleşmiyor.')
  const restored = structuredClone(context.state)
  restored.invoices = restored.invoices.map((item) =>
    item.id === invoice.id
      ? {
          ...invoice,
          externalId,
          ...(category ? { remoteCategoryId: category.id, remoteCategoryName: category.name } : {}),
        }
      : item,
  )
  restored.orders = restored.orders.map((item) => (item.id === order.id ? order : item))
  const result = await status({ ...context, state: restored }, { ...payload, externalId })
  if (payload.sourceOperation === 'invoice.finalize' && result.invoice?.status !== 'issued') {
    if (result.invoice?.status === 'processing')
      return {
        ...result,
        nextPayload: { ...payload, externalId, polls: Number(payload.polls ?? 0) + 1 },
        delaySeconds: 30,
      }
    throw new ProviderError(
      'FINALIZATION_NOT_CONFIRMED',
      'Resmileştirme henüz doğrulanamadı. Taslak tekrar resmileştirilmedi; sağlayıcı işlemini yeniden sorgulayın.',
    )
  }
  if (
    payload.sourceOperation === 'invoice.create' &&
    result.invoice?.status === 'draft' &&
    order.invoicePreference !== 'draft' &&
    (context.settings.finalizeInvoices || order.invoicePreference === 'immediate')
  )
    result.invoice.finalizeAfterSeconds =
      order.invoicePreference === 'immediate' ? 0 : context.settings.finalizeDelayMinutes * 60
  return {
    ...result,
    ...(result.invoice && category
      ? {
          invoice: {
            ...result.invoice,
            remoteCategoryId: category.id,
            remoteCategoryName: category.name,
          },
        }
      : {}),
    resolution: { outcome: 'confirmed' },
  }
}
