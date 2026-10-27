import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, integer, record, text, pathPart } from '../integrations/contracts'
import { basicAuth, ProviderHttp, requireCredential } from '../integrations/http'
import { ProviderError } from '../errors'
import type { PreparedListing, PublicationAdapter, PublicationPlan, Inspection } from './types'
import { leafCategories, numericId, selectionEntries, failureMessages } from './shared'

export class TrendyolPublisher implements PublicationAdapter {
  readonly provider = 'trendyol' as const
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext) {
    const seller = requireCredential(context.credentials, 'sellerId')
    if (!/^\d+$/.test(seller))
      throw new ProviderError('INVALID_SELLER', 'Trendyol satıcı kimliği sayısal olmalı.')
    return {
      seller: pathPart(seller),
      base:
        context.settings.environment === 'sandbox'
          ? 'https://stageapigw.trendyol.com/integration'
          : 'https://apigw.trendyol.com/integration',
      headers: {
        authorization: basicAuth(
          requireCredential(context.credentials, 'apiKey'),
          requireCredential(context.credentials, 'apiSecret'),
        ),
        'user-agent': `${seller} - ${context.integrationName}`,
      },
    }
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    const { base, headers } = this.api(context)
    if (query.resource === 'categories')
      return {
        options: leafCategories(
          await this.http.request(`${base}/product/product-categories`, { headers }),
        ),
      }
    if (query.resource === 'brands') {
      if (!query.query?.trim()) return { options: [] }
      const response = await this.http.request(
        `${base}/product/brands/by-name?${new URLSearchParams({ name: query.query })}`,
        { headers },
      )
      if (!Array.isArray(response))
        throw new ProviderError('INVALID_METADATA', 'Trendyol marka listesi okunamadı.')
      return {
        options: response.map((item) => ({
          id: text(record(item).id),
          name: text(record(item).name),
        })),
      }
    }
    if (query.resource === 'attributes') {
      const category = numericId(query.categoryId, 'Kategori')
      const response = record(
        await this.http.request(`${base}/product/categories/${category}/attributes`, { headers }),
      )
      if (!Array.isArray(response.categoryAttributes))
        throw new ProviderError('INVALID_METADATA', 'Trendyol kategori özellikleri okunamadı.')
      return {
        schema: {
          id: String(category),
          name: text(response.name),
          attributes: response.categoryAttributes.map((raw) => {
            const item = record(raw),
              attribute = record(item.attribute)
            return {
              id: text(attribute.id),
              name: text(attribute.name),
              required: item.required === true,
              variant: item.varianter === true,
              slicer: item.slicer === true,
              allowCustom: item.allowCustom === true,
              multiple: item.allowMultipleAttributeValues === true,
            }
          }),
        },
      }
    }
    if (query.resource === 'values') {
      const category = numericId(query.categoryId, 'Kategori'),
        attribute = numericId(query.attributeId, 'Özellik'),
        page = query.page ?? 0
      const response = record(
        await this.http.request(
          `${base}/product/categories/${category}/attributes/${attribute}/values?page=${page}&size=1000`,
          { headers },
        ),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_METADATA', 'Trendyol özellik değerleri okunamadı.')
      return {
        options: response.content.map((raw) => {
          const item = record(raw)
          return { id: text(item.attributeValueId), name: text(item.attributeValue) }
        }),
        page,
        hasMore: page + 1 < integer(response.totalPages),
      }
    }
    throw new ProviderError('UNSUPPORTED_METADATA', 'Bu Trendyol tanımı desteklenmiyor.')
  }
  build(
    _context: AdapterContext,
    item: PreparedListing,
    schema: CategorySchema | null,
  ): Record<string, unknown> {
    const config = item.config
    return {
      items: [
        {
          barcode: item.variant.barcode,
          title: item.title,
          description: item.description,
          productMainId: config.productMainId || item.product.id,
          brandId: numericId(config.brandId, 'Marka'),
          categoryId: numericId(config.categoryId, 'Kategori'),
          quantity: item.quantity,
          stockCode: item.variant.sku,
          listPrice: (item.listPrice ?? item.price) / 100,
          salePrice: item.price / 100,
          vatRate: item.product.taxRate,
          ...(config.origin ? { origin: config.origin } : {}),
          ...(config.dimensionalWeight !== undefined
            ? { dimensionalWeight: config.dimensionalWeight }
            : {}),
          ...(config.shipmentAddressId
            ? { shipmentAddressId: numericId(config.shipmentAddressId, 'Sevkiyat adresi') }
            : {}),
          ...(config.returningAddressId
            ? { returningAddressId: numericId(config.returningAddressId, 'İade adresi') }
            : {}),
          ...(config.deliveryDuration !== undefined
            ? { deliveryOption: { deliveryDuration: config.deliveryDuration } }
            : {}),
          images: item.images.map((url) => ({ url })),
          attributes: selectionEntries(config, schema).map(({ id, choice }) => ({
            attributeId: Number(id),
            ...(choice.customValue
              ? { attributeValue: choice.customValue }
              : { attributeValueIds: choice.valueIds!.map(Number) }),
          })),
        },
      ],
    }
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    const { base, headers, seller } = this.api(context)
    try {
      await this.http.request(
        `${base}/product/sellers/${seller}/product/${pathPart(plan.barcode)}`,
        { headers },
      )
      throw new ProviderError(
        'REMOTE_LISTING_EXISTS',
        'Bu barkod Trendyol’da var. Uzak katalogdan eşleyin; mevcut ilan üzerine yeni ürün yazılmaz.',
      )
    } catch (error) {
      if (!(error instanceof ProviderError && error.code === 'HTTP_404')) throw error
    }
    const response = record(
      await this.http.request(`${base}/product/sellers/${seller}/v2/products`, {
        method: 'POST',
        headers,
        json: plan.body,
      }),
    )
    const reference = text(response.batchRequestId)
    if (!reference)
      throw new ProviderError(
        'PUBLICATION_UNCERTAIN',
        'Trendyol gönderimi için parti numarası alınamadı.',
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
    const { base, headers, seller } = this.api(context)
    if (phase === 'batch') {
      const response = record(
        await this.http.request(
          `${base}/product/sellers/${seller}/products/batch-requests/${pathPart(reference)}`,
          { headers },
        ),
      )
      if (response.status !== 'COMPLETED')
        return {
          state: { phase: 'submitted', reference, message: 'Trendyol aktarım partisini işliyor.' },
          again: true,
          phase: 'batch',
        }
      const line = array(response.items)
        .map(record)
        .find(
          (item) =>
            text(record(item.requestItem).barcode) === plan.barcode ||
            text(record(record(item.requestItem).product).barcode) === plan.barcode,
        )
      if (!line)
        throw new ProviderError(
          'MISSING_BATCH_ITEM',
          'Trendyol sonucunda gönderilen barkod bulunamadı.',
        )
      if (line.status !== 'SUCCESS' || array(line.failureReasons).length)
        return {
          state: {
            phase: 'rejected',
            reference,
            message: 'Trendyol ürün aktarımını reddetti.',
            errors: failureMessages(line.failureReasons),
          },
        }
    }
    let product: Record<string, unknown>
    try {
      product = record(
        await this.http.request(
          `${base}/product/sellers/${seller}/product/${pathPart(plan.barcode)}`,
          { headers },
        ),
      )
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'HTTP_404')
        return {
          state: {
            phase: 'review',
            reference,
            message: 'Ürün kataloğa yansıyor; onay bekleniyor.',
          },
          again: true,
          phase: 'approval',
        }
      throw error
    }
    if (text(product.barcode) !== plan.barcode)
      throw new ProviderError('INVALID_PRODUCT_IDENTITY', 'Trendyol farklı bir barkod döndürdü.')
    const externalId = text(product.listingId) || plan.barcode
    if (product.approved === true && product.archived === false)
      return {
        externalId,
        state: { phase: 'live', reference, message: 'Trendyol ürün onayı katalogdan doğrulandı.' },
      }
    if (product.archived === true)
      return {
        externalId,
        state: {
          phase: 'rejected',
          reference,
          message: 'Ürün Trendyol’da arşivli. Satıcı panelindeki nedeni kontrol edin.',
        },
      }
    return {
      externalId,
      state: { phase: 'review', reference, message: 'Trendyol ürün onayı bekleniyor.' },
      again: true,
      phase: 'approval',
    }
  }
}
