import type { IntegrationOperation } from '../../src/domain/integrations'
import { channelNames } from '../../src/domain/channels'
import { lineTotal, orderTotal } from '../../src/domain/selectors'
import { ProviderError } from '../errors'
import { array, integer, pathPart, record, text } from './contracts'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import { ProviderHttp, requireCredential } from './http'
import { accessToken } from './oauth'
import { parasutLines, reconcileParasut } from './parasut-reconciliation'
import { parasutCurrencyAttributes, parasutMoneyMatches } from './parasut-money'
import { invoiceSource } from '../../src/domain/invoice-source'
import { invoiceProviderCategoryName } from '../../src/domain/invoice-categories'
import { findParasutInvoiceCategory, parasutInvoiceCategory } from './parasut-categories'

export class ParasutAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'invoice.create',
    'invoice.finalize',
    'invoice.status',
    'invoice.reconcile',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    if (
      operation !== 'test' &&
      context.state.invoices.find((invoice) => invoice.id === payload.invoiceId)?.manualDocument
    )
      throw new ProviderError(
        'INVOICE_EXTERNAL_DOCUMENT',
        'Elle bağlanan dış fatura için Paraşüt işlemi çalıştırılmaz.',
      )
    if (context.settings.environment === 'sandbox')
      throw new ProviderError(
        'SANDBOX_ACCOUNT_REQUIRED',
        'Paraşüt testleri ayrı bir test firmasıyla yapılır. API ortamını canlı seçip test firma hesabını girin.',
      )
    const token = await accessToken(context, this.http, 'https://api.parasut.com/oauth/token', {
      grant_type: 'password',
      client_id: requireCredential(context.credentials, 'clientId'),
      client_secret: requireCredential(context.credentials, 'clientSecret'),
      username: requireCredential(context.credentials, 'email'),
      password: requireCredential(context.credentials, 'password'),
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    })
    const company = requireCredential(context.credentials, 'companyId')
    if (!/^\d+$/.test(company))
      throw new ProviderError('COMPANY_ID_INVALID', 'Paraşüt Company ID sayısal olmalı.')
    const base = `https://api.parasut.com/v4/${pathPart(company)}`,
      headers = { authorization: `Bearer ${token}` }
    if (operation === 'test') {
      const response = record(await this.http.request(`${base}/contacts?page[size]=1`, { headers }))
      if (!Array.isArray(response.data))
        throw new ProviderError('INVALID_RESPONSE', 'Paraşüt firma erişimi doğrulanamadı.')
      return { message: 'Paraşüt firma erişimi ve müşteri okuma yetkisi doğrulandı.' }
    }
    const invoice = context.state.invoices.find((item) => item.id === payload.invoiceId)
    const order = invoice && invoiceSource(context.state, invoice)
    if (!invoice || !order)
      throw new ProviderError('INVOICE_NOT_FOUND', 'Fatura veya sipariş bulunamadı.')
    if (invoice.connectionId && invoice.connectionId !== context.connectionId)
      throw new ProviderError(
        'INVOICE_CONNECTION_MISMATCH',
        'Bu fatura başka bir Paraşüt hesabıyla ilişkili.',
      )
    if (operation === 'invoice.reconcile')
      return reconcileParasut(this.http, base, headers, context, payload, (checked, payload) =>
        this.execute('invoice.status', checked, payload),
      )
    if (operation === 'invoice.create' && !invoice.externalId) {
      if (invoice.localOnly)
        throw new ProviderError(
          'INVOICE_LOCAL_ONLY',
          'Fatura yalnız iç kayıt için seçilmiş; sağlayıcıya aktarım kapalı.',
        )
      parasutCurrencyAttributes(order)
      if (['cancelled', 'returned'].includes(order.status) || invoice.status === 'cancelled')
        throw new ProviderError(
          'INVOICE_CANCELLED',
          'İptal/iade siparişi için satış faturası oluşturulamaz.',
        )
      if (order.syncError)
        throw new ProviderError(
          'ORDER_RECONCILIATION_REQUIRED',
          'Sipariş kalemleri pazaryeriyle uzlaştırılmalı.',
        )
      const billing = order.billingAddress
      if (!billing?.name || !billing.address || !billing.city)
        throw new ProviderError(
          'BILLING_REQUIRED',
          'Siparişin fatura adı, adresi ve il bilgilerini tamamlayın.',
        )
      if (order.lines.some((line) => line.taxKnown === false))
        throw new ProviderError(
          'TAX_REQUIRED',
          'Siparişin KDV oranları bilinmiyor. Ürün eşlemesini ve vergi bilgilerini tamamlayın.',
        )
      const expected = order.lines.reduce((sum, line) => sum + lineTotal(line), 0) + order.shipping
      if (expected !== orderTotal(order))
        throw new ProviderError(
          'TOTAL_MISMATCH',
          'Sipariş toplamı ile kalem toplamı uyuşmuyor. Fatura öncesinde indirim/kargo tutarlarını uzlaştırın.',
        )
      const categoryName = invoiceProviderCategoryName(context.state, invoice)
      if (categoryName && !payload.categoryId) {
        const existing = await findParasutInvoiceCategory(this.http, base, headers, categoryName)
        const category =
          existing ??
          record(
            record(
              await this.http.request(`${base}/item_categories`, {
                method: 'POST',
                headers,
                json: {
                  data: {
                    type: 'item_categories',
                    attributes: { name: categoryName, category_type: 'SalesInvoice' },
                  },
                },
              }),
            ).data,
          )
        const categoryId = text(category.id)
        const attrs = record(record(category).attributes)
        if (
          !categoryId ||
          (!existing &&
            (record(category).type !== 'item_categories' ||
              attrs.category_type !== 'SalesInvoice' ||
              text(attrs.name).trim().toLocaleLowerCase('tr-TR') !==
                categoryName.trim().toLocaleLowerCase('tr-TR')))
        )
          throw new ProviderError(
            'CATEGORY_UNCERTAIN',
            'Paraşüt kategori yanıtı doğrulanamadı; yeni kategori oluşturmadan önce kaydı uzlaştırın.',
            false,
            undefined,
            true,
          )
        return {
          message: 'Paraşüt satış faturası kategorisi hazırlandı.',
          nextPayload: { ...payload, categoryId, categoryName },
          delaySeconds: 2,
        }
      }
      if (categoryName && payload.categoryName !== categoryName)
        throw new ProviderError(
          'CATEGORY_SOURCE_CHANGED',
          'Faturanın kategori kaynağı değişti. Güncel kaydı kontrol edin.',
        )
      if (!payload.contactId) {
        const query = new URLSearchParams({ 'filter[name]': billing.name, 'page[size]': '25' })
        const response = record(await this.http.request(`${base}/contacts?${query}`, { headers }))
        if (!Array.isArray(response.data))
          throw new ProviderError('INVALID_RESPONSE', 'Paraşüt müşteri listesi okunamadı.')
        let contact = response.data.map(record).find((item) => {
          const attrs = record(item.attributes)
          return (
            attrs.name === billing.name &&
            attrs.address === billing.address &&
            text(attrs.tax_number) === text(billing.taxId)
          )
        })
        if (!contact)
          contact = record(
            record(
              await this.http.request(`${base}/contacts`, {
                method: 'POST',
                headers,
                json: {
                  data: {
                    type: 'contacts',
                    attributes: {
                      name: billing.name,
                      account_type: 'customer',
                      contact_type: billing.taxId?.length === 10 ? 'company' : 'person',
                      address: billing.address,
                      city: billing.city,
                      district: billing.district,
                      phone: billing.phone,
                      tax_number: billing.taxId || undefined,
                      tax_office: billing.taxOffice,
                      country: 'Türkiye',
                      is_abroad: false,
                    },
                  },
                },
              }),
            ).data,
          )
        const contactId = text(contact.id)
        if (!contactId)
          throw new ProviderError(
            'CONTACT_UNCERTAIN',
            'Paraşüt müşteri işlem numarası dönmedi.',
            false,
            undefined,
            true,
          )
        return {
          message: 'Paraşüt müşteri kaydı hazırlandı.',
          nextPayload: { ...payload, contactId, productIds: [] },
          delaySeconds: 2,
        }
      }
      const lines = parasutLines(context, order)
      const productIds = array(payload.productIds).map(text)
      if (productIds.length < lines.length) {
        const line = lines[productIds.length]
        const query = new URLSearchParams({ 'filter[code]': line.code, 'page[size]': '25' })
        const response = record(await this.http.request(`${base}/products?${query}`, { headers }))
        if (!Array.isArray(response.data))
          throw new ProviderError('INVALID_RESPONSE', 'Paraşüt ürün listesi okunamadı.')
        let product = response.data
          .map(record)
          .find((item) => record(item.attributes).code === line.code)
        const remoteUnit = text(record(product?.attributes).unit)
        if (
          remoteUnit &&
          remoteUnit.toLocaleLowerCase('tr-TR') !== line.unit.toLocaleLowerCase('tr-TR')
        )
          throw new ProviderError(
            'PRODUCT_UNIT_MISMATCH',
            `${line.title}: Paraşüt ürün birimi (${remoteUnit}) satışın kayıtlı birimiyle (${line.unit}) uyuşmuyor. Paraşüt ürün kartını kontrol edin.`,
          )
        if (!product)
          product = record(
            record(
              await this.http.request(`${base}/products`, {
                method: 'POST',
                headers,
                json: {
                  data: {
                    type: 'products',
                    attributes: {
                      name: line.title,
                      code: line.code,
                      vat_rate: line.taxRate,
                      unit: line.unit,
                      inventory_tracking: false,
                    },
                  },
                },
              }),
            ).data,
          )
        const productId = text(product.id)
        if (!productId)
          throw new ProviderError(
            'PRODUCT_UNCERTAIN',
            'Paraşüt ürün işlem numarası dönmedi.',
            false,
            undefined,
            true,
          )
        return {
          message: 'Paraşüt fatura kalemi hazırlandı.',
          nextPayload: { ...payload, productIds: [...productIds, productId] },
          delaySeconds: 2,
        }
      }
      const response = record(
        await this.http.request(`${base}/sales_invoices`, {
          method: 'POST',
          headers,
          json: {
            data: {
              type: 'sales_invoices',
              attributes: {
                item_type: 'invoice',
                description: `Pazarhub ${invoice.id}${invoice.title ? ` · ${invoice.title}` : ''}${invoice.note ? `\n${invoice.note}` : ''}`,
                issue_date: invoice.issueDate ?? invoice.createdAt.slice(0, 10),
                due_date: invoice.dueDate ?? invoice.issueDate ?? invoice.createdAt.slice(0, 10),
                ...parasutCurrencyAttributes(order),
                billing_address: billing.address,
                billing_phone: billing.phone,
                city: billing.city,
                district: billing.district,
                country: 'Türkiye',
                tax_number: billing.taxId || undefined,
                tax_office: billing.taxOffice,
                order_no: order.externalNumber || order.number,
                order_date: order.createdAt.slice(0, 10),
              },
              relationships: {
                ...(payload.categoryId
                  ? {
                      category: { data: { type: 'item_categories', id: text(payload.categoryId) } },
                    }
                  : {}),
                contact: { data: { id: text(payload.contactId), type: 'contacts' } },
                details: {
                  data: lines.map((line, index) => ({
                    type: 'sales_invoice_details',
                    attributes: {
                      quantity: line.quantity,
                      unit_price: Number(
                        (line.amount / 100 / line.quantity / (1 + line.taxRate / 100)).toFixed(6),
                      ),
                      vat_rate: line.taxRate,
                      description: line.title,
                    },
                    relationships: {
                      product: { data: { type: 'products', id: productIds[index] } },
                    },
                  })),
                },
              },
            },
          },
        }),
      )
      const externalId = text(record(response.data).id)
      if (!externalId)
        throw new ProviderError(
          'INVOICE_UNCERTAIN',
          'Paraşüt fatura kimliği dönmedi. Yeniden oluşturmadan önce sağlayıcı kaydını doğrulayın.',
          false,
          undefined,
          true,
        )
      return {
        message: 'Paraşüt taslağı oluşturuldu; tutar doğrulanıyor.',
        invoice: {
          externalId,
          status: 'draft',
          ...(payload.categoryId
            ? { remoteCategoryId: text(payload.categoryId), remoteCategoryName: categoryName }
            : {}),
        },
        nextPayload: { invoiceId: invoice.id, stage: 'verify' },
        delaySeconds: 2,
      }
    }
    if (!invoice.externalId)
      throw new ProviderError('DRAFT_REQUIRED', 'Önce faturayı Paraşüt’e taslak olarak aktarın.')
    const response = record(
      await this.http.request(
        `${base}/sales_invoices/${pathPart(invoice.externalId)}?include=active_e_document${invoiceProviderCategoryName(context.state, invoice) ? ',category' : ''}`,
        { headers },
      ),
    )
    const remote = record(response.data),
      attributes = record(remote.attributes)
    const expectedCategory = invoiceProviderCategoryName(context.state, invoice)
    if (expectedCategory) {
      const category = parasutInvoiceCategory(response)
      if (
        !category ||
        (invoice.remoteCategoryId && invoice.remoteCategoryId !== category.id) ||
        category.name.trim().toLocaleLowerCase('tr-TR') !==
          expectedCategory.trim().toLocaleLowerCase('tr-TR')
      )
        throw new ProviderError(
          'INVOICE_CATEGORY_MISMATCH',
          'Paraşüt faturası beklenen kategoriyle eşleşmiyor.',
        )
    }
    if (!parasutMoneyMatches(order, attributes))
      throw new ProviderError(
        'INVOICE_TOTAL_MISMATCH',
        'Paraşüt fatura tutarı, para birimi veya kuru siparişle uyuşmuyor. Taslağı Paraşüt’te kontrol edin.',
      )
    const document = record(record(record(remote.relationships).active_e_document).data)
    if (text(document.id) && ['e_archives', 'e_invoices'].includes(text(document.type))) {
      const type = text(document.type) as 'e_archives' | 'e_invoices'
      const detail = record(
        record(
          await this.http.request(`${base}/${type}/${pathPart(text(document.id))}`, { headers }),
        ).data,
      )
      const attrs = record(detail.attributes)
      if (attrs.status === 'bounced' || attrs.status === 'error')
        throw new ProviderError(
          'DOCUMENT_REJECTED',
          'Paraşüt e-belge işlemi başarısız. Sağlayıcı hata ayrıntısını kontrol edin.',
        )
      const pdf = record(
        record(
          await this.http.request(`${base}/${type}/${pathPart(text(document.id))}/pdf`, {
            headers,
          }),
        ).data,
      )
      const pdfUrl = text(record(pdf.attributes).url)
      if (!pdfUrl)
        return {
          message: 'Paraşüt belge PDF’i hazırlanıyor.',
          nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
          delaySeconds: 15,
          invoice: {
            externalId: invoice.externalId,
            status: 'processing',
            documentType: type,
            documentId: text(document.id),
          },
        }
      return {
        message: 'Paraşüt e-belgesi ve PDF’i hazır.',
        invoice: {
          externalId: invoice.externalId,
          status: 'issued',
          documentType: type,
          documentId: text(document.id),
          documentNumber: text(attrs.invoice_number) || text(attributes.invoice_no),
          issuedAt: new Date().toISOString(),
          pdfUrl,
        },
      }
    }
    if (operation === 'invoice.create')
      return {
        message: 'Paraşüt taslağı ve toplamı doğrulandı.',
        invoice: {
          externalId: invoice.externalId,
          status: 'draft',
          ...((context.settings.finalizeInvoices || order.invoicePreference === 'immediate') &&
          order.invoicePreference !== 'draft'
            ? {
                finalizeAfterSeconds:
                  order.invoicePreference === 'immediate'
                    ? 0
                    : context.settings.finalizeDelayMinutes * 60,
              }
            : {}),
        },
      }
    if (operation === 'invoice.status')
      return {
        message: 'Fatura Paraşüt’te taslak durumunda.',
        invoice: { externalId: invoice.externalId, status: 'draft' },
      }
    if (operation === 'invoice.finalize') {
      if (['cancelled', 'returned'].includes(order.status) || order.invoicePreference === 'draft')
        throw new ProviderError('FINALIZATION_DISABLED', 'Bu sipariş için resmileştirme kapalı.')
      if (payload.trackableId) {
        const job = record(
          record(
            await this.http.request(
              `${base}/trackable_jobs/${pathPart(text(payload.trackableId))}`,
              { headers },
            ),
          ).data,
        )
        if (record(job.attributes).status === 'error')
          throw new ProviderError(
            'FINALIZATION_FAILED',
            'Paraşüt resmileştirme işini tamamlayamadı. Fatura ve alıcı bilgilerini kontrol edin.',
          )
        return {
          message: 'Paraşüt e-belge sonucu bekleniyor.',
          nextPayload: { ...payload, polls: integer(payload.polls) + 1 },
          delaySeconds: 15,
        }
      }
      const taxId = order.billingAddress?.taxId
      if (!taxId || !/^\d{10,11}$/.test(taxId))
        throw new ProviderError(
          'TAX_ID_REQUIRED',
          'Alıcının VKN/TCKN bilgisi fatura bilgilerinde tamamlanmalı.',
        )
      const inboxes = record(
        await this.http.request(
          `${base}/e_invoice_inboxes?${new URLSearchParams({ 'filter[vkn]': taxId })}`,
          { headers },
        ),
      )
      if (!Array.isArray(inboxes.data))
        throw new ProviderError('INBOX_LOOKUP_FAILED', 'Alıcının e-fatura durumu doğrulanamadı.')
      const inbox = record(record(inboxes.data[0]).attributes)
      const type = inboxes.data.length ? 'e_invoices' : 'e_archives'
      const attrs: Record<string, unknown> =
        type === 'e_invoices' ? { scenario: 'basic', to: text(inbox.e_invoice_address) } : {}
      if (type === 'e_archives' && order.channel !== 'manual') {
        const websites: Record<string, string> = {
          trendyol: 'https://www.trendyol.com',
          hepsiburada: 'https://www.hepsiburada.com',
          n11: 'https://www.n11.com',
          amazon: 'https://www.amazon.com.tr',
          ciceksepeti: 'https://www.ciceksepeti.com',
          pazarama: 'https://www.pazarama.com',
          pttavm: 'https://www.pttavm.com',
          toptantr: 'https://www.toptantr.com',
        }
        const shipment = order.shipmentMetadata
        if (!shipment?.carrierTaxId || !shipment.carrierName || !shipment.date)
          throw new ProviderError(
            'SHIPMENT_INFO_REQUIRED',
            'E-arşiv için kargo şirketi, VKN ve gönderim tarihi fatura bilgilerinde tamamlanmalı.',
          )
        attrs.internet_sale = {
          url: websites[order.channel],
          payment_type: 'ODEMEARACISI',
          payment_platform: channelNames[order.channel],
          payment_date: order.createdAt.slice(0, 10),
        }
        attrs.shipment = {
          title: shipment.carrierName,
          vkn: shipment.carrierTaxId,
          date: shipment.date,
        }
      }
      const result = record(
        await this.http.request(`${base}/${type}`, {
          method: 'POST',
          headers,
          json: {
            data: {
              type,
              attributes: attrs,
              relationships: {
                sales_invoice: { data: { type: 'sales_invoices', id: invoice.externalId } },
              },
            },
          },
        }),
      )
      const trackableId = text(record(result.data).id)
      if (!trackableId)
        throw new ProviderError(
          'FINALIZATION_UNCERTAIN',
          'Paraşüt resmileştirme iş kimliği dönmedi.',
          false,
          undefined,
          true,
        )
      return {
        message: 'Paraşüt resmileştirmeyi başlattı.',
        reference: trackableId,
        invoice: { externalId: invoice.externalId, status: 'processing' },
        nextPayload: { ...payload, trackableId, polls: 0 },
        delaySeconds: 15,
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Paraşüt işlemi kullanıma açık değil.')
  }
}
