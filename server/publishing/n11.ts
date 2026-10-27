import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, record, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { ProviderError } from '../errors'
import { soapArray, soapCall } from '../integrations/soap'
import type { PreparedListing, PublicationAdapter, PublicationPlan, Inspection } from './types'
import { leafCategories, numericId, selectionEntries, failureMessages, failField } from './shared'

export class N11Publisher implements PublicationAdapter {
  readonly provider = 'n11' as const
  constructor(private readonly http: ProviderHttp) {}
  private headers(context: AdapterContext) {
    if (context.settings.environment !== 'production')
      throw new ProviderError(
        'SANDBOX_UNAVAILABLE',
        'n11 testleri sağlayıcının verdiği test hesabıyla yapılır; ayrı sandbox adresi tanımlı değil.',
      )
    return {
      appKey: requireCredential(context.credentials, 'appKey'),
      appSecret: requireCredential(context.credentials, 'appSecret'),
    }
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    const headers = this.headers(context)
    if (query.resource === 'shipmentTemplates') {
      const single = !!query.query,
        method = single ? 'GetShipmentTemplate' : 'GetShipmentTemplateList'
      const response = await soapCall(
        this.http,
        'https://api.n11.com/ws/shipmentService/',
        'http://www.n11.com/ws/schemas',
        method,
        {
          auth: headers,
          ...(single
            ? { name: query.query }
            : { pagingData: { currentPage: query.page ?? 0, pageSize: 100 } }),
        },
        { requestName: `${method}Request`, action: '', safe: true },
      )
      if (record(response.result).status !== 'success')
        throw new ProviderError(
          'SHIPMENT_TEMPLATE_INVALID',
          'n11 teslimat şablonu okunamadı. Mağazanın güncel şablonunu seçin.',
        )
      const templates = soapArray(
        single ? response.shipmentTemplate : record(response.shipmentTemplates).shipmentTemplate,
      ).map(record)
      return {
        options: templates
          .map((template) => ({
            id: text(template.templateName),
            name: text(template.templateName),
          }))
          .filter((option) => option.id),
        page: query.page ?? 0,
        hasMore: !single && templates.length === 100,
      }
    }
    if (query.resource === 'categories')
      return {
        options: leafCategories(
          await this.http.request('https://api.n11.com/cdn/categories', { headers }),
        ),
      }
    if (query.resource === 'attributes' || query.resource === 'values') {
      const category = numericId(query.categoryId, 'Kategori')
      const response = record(
        await this.http.request(`https://api.n11.com/cdn/category/${category}/attribute`, {
          headers,
        }),
      )
      if (!Array.isArray(response.categoryAttributes))
        throw new ProviderError('INVALID_METADATA', 'n11 kategori özellikleri okunamadı.')
      const schema: CategorySchema = {
        id: String(category),
        name: text(response.name),
        attributes: response.categoryAttributes.map((raw) => {
          const item = record(raw)
          return {
            id: text(item.attributeId),
            name: text(item.attributeName),
            required: item.isMandatory === true,
            variant: item.isVariant === true,
            slicer: item.isSlicer === true,
            allowCustom: item.isCustomValue === true,
            multiple: false,
            values: array(item.attributeValues).map((v) => ({
              id: text(record(v).id),
              name: text(record(v).value),
            })),
          }
        }),
      }
      if (query.resource === 'values')
        return {
          options: schema.attributes.find((a) => a.id === query.attributeId)?.values ?? [],
          hasMore: false,
          page: 0,
        }
      return { schema }
    }
    throw new ProviderError('UNSUPPORTED_METADATA', 'Bu n11 tanımı desteklenmiyor.')
  }
  build(
    context: AdapterContext,
    item: PreparedListing,
    schema: CategorySchema | null,
  ): Record<string, unknown> {
    if (!item.config.shipmentTemplate?.trim())
      failField('Teslimat şablonu', 'n11 hesabınızdaki şablon adını girin.')
    if (item.config.preparingDay === undefined) failField('Hazırlık süresi', 'Gün sayısını girin.')
    return {
      payload: {
        integrator: context.integrationName,
        skus: [
          {
            title: item.title,
            description: item.description,
            categoryId: numericId(item.config.categoryId, 'Kategori'),
            currencyType: 'TL',
            productMainId: item.config.productMainId || item.product.id,
            preparingDay: item.config.preparingDay,
            shipmentTemplate: item.config.shipmentTemplate,
            stockCode: item.variant.sku,
            ...(item.variant.barcode ? { barcode: item.variant.barcode } : {}),
            quantity: Math.min(999999, item.quantity),
            images: item.images.map((url, order) => ({ url, order })),
            attributes: selectionEntries(item.config, schema).map(({ id, choice }) => ({
              id: Number(id),
              ...(choice.customValue
                ? { customValue: choice.customValue }
                : { valueId: Number(choice.valueIds![0]) }),
            })),
            salePrice: item.price / 100,
            listPrice: (item.listPrice ?? item.price) / 100,
            vatRate: item.product.taxRate,
          },
        ],
      },
    }
  }
  private async find(context: AdapterContext, sku: string) {
    const response = record(
      await this.http.request(
        `https://api.n11.com/ms/product-query?${new URLSearchParams({ stockCode: sku, page: '0', size: '20', sender: 'SELLER' })}`,
        { headers: this.headers(context) },
      ),
    )
    if (!Array.isArray(response.content))
      throw new ProviderError('INVALID_PRODUCT_LOOKUP', 'n11 ürün sorgusu okunamadı.')
    return response.content.map(record).find((p) => text(p.stockCode) === sku)
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    if (await this.find(context, plan.sku))
      throw new ProviderError(
        'REMOTE_LISTING_EXISTS',
        'Bu SKU n11’de mevcut. Önce uzak katalogdan eşleyin.',
      )
    const response = record(
      await this.http.request('https://api.n11.com/ms/product/tasks/product-create', {
        method: 'POST',
        headers: this.headers(context),
        json: plan.body,
      }),
    )
    if (response.status === 'REJECT')
      throw new ProviderError('PUBLICATION_REJECTED', 'n11 ürün gönderimini işleme almadı.')
    const reference = text(response.id)
    if (!reference)
      throw new ProviderError(
        'PUBLICATION_UNCERTAIN',
        'n11 ürün gönderim task kimliği alınamadı.',
        false,
        undefined,
        true,
      )
    return reference
  }
  async inspect(
    context: AdapterContext,
    plan: PublicationPlan,
    reference: string,
    phase = 'batch',
  ): Promise<Inspection> {
    if (phase === 'batch') {
      const response = record(
        await this.http.request('https://api.n11.com/ms/product/task-details/page-query', {
          method: 'POST',
          headers: this.headers(context),
          json: { taskId: numericId(reference, 'Task kimliği'), pageable: { page: 0, size: 1000 } },
          idempotent: true,
        }),
      )
      if (response.status === 'REJECT')
        return {
          state: {
            phase: 'rejected',
            reference,
            message: 'n11 gönderim işi reddedildi.',
            errors: failureMessages(response.reasons),
          },
        }
      if (response.status !== 'PROCESSED')
        return {
          state: { phase: 'submitted', reference, message: 'n11 aktarımı işliyor.' },
          again: true,
          phase: 'batch',
        }
      const line = array(record(response.skus).content)
        .map(record)
        .find((item) => text(item.itemCode) === plan.sku)
      if (!line)
        throw new ProviderError(
          'MISSING_TASK_ITEM',
          'n11 task sonucunda gönderilen SKU bulunamadı.',
        )
      if (line.status !== 'SUCCESS')
        return {
          state: {
            phase: 'rejected',
            reference,
            message: 'n11 ürün satırını reddetti.',
            errors: failureMessages(line.reasons),
          },
        }
    }
    const product = await this.find(context, plan.sku)
    if (!product)
      return {
        state: { phase: 'review', reference, message: 'n11 ürün kaydı kataloğa yansıyor.' },
        again: true,
        phase: 'approval',
      }
    const externalId = text(product.n11ProductId)
    if (!externalId)
      throw new ProviderError(
        'MISSING_PRODUCT_ID',
        'n11 kayıt kimliği henüz doğrulanamadı.',
        true,
        30,
      )
    if (plan.barcode && text(product.barcode) && text(product.barcode) !== plan.barcode)
      throw new ProviderError('BARCODE_MISMATCH', 'n11 stok kodu farklı bir barkoda bağlı.')
    if (product.status === 'Active')
      return {
        externalId,
        state: { phase: 'live', reference, message: 'n11 ürün onayı doğrulandı.' },
      }
    if (['CatalogRejected', 'Prohibited'].includes(text(product.status)))
      return {
        externalId,
        state: {
          phase: 'rejected',
          reference,
          message:
            text(record(product.rejectInfo).reason) || 'n11 katalog kontrolü ürünü reddetti.',
        },
      }
    return {
      externalId,
      state: { phase: 'review', reference, message: 'n11 katalog onayı bekleniyor.' },
      again: true,
      phase: 'approval',
    }
  }
}
