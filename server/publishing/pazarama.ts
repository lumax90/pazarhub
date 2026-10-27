import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, integer, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp } from '../integrations/http'
import { PazaramaApi } from '../integrations/pazarama'
import { ProviderError } from '../errors'
import { failField, selectionEntries } from './shared'
import type { Inspection, PreparedListing, PublicationAdapter, PublicationPlan } from './types'

const emptyBatch = '00000000-0000-0000-0000-000000000000'
export class PazaramaPublisher implements PublicationAdapter {
  readonly provider = 'pazarama' as const
  private readonly api: PazaramaApi
  constructor(http: ProviderHttp) {
    this.api = new PazaramaApi(http)
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    if (query.resource === 'categories') {
      const response = await this.api.request(context, '/category/getCategoryTree')
      if (!Array.isArray(response.data))
        throw new ProviderError('INVALID_METADATA', 'Pazarama kategori listesi okunamadı.')
      return {
        options: response.data
          .map(record)
          .filter((c) => c.leaf === true)
          .map((c) => ({
            id: text(c.id),
            name: text(c.name),
            path:
              array(c.parentCategories)
                .map(text)
                .map((s) => s.trim())
                .join(' / ') || text(c.name),
            leaf: true,
          })),
      }
    }
    if (query.resource === 'brands') {
      if (!query.query?.trim()) return { options: [] }
      const response = await this.api.request(
        context,
        `/brand/getBrands?${new URLSearchParams({ Page: String((query.page ?? 0) + 1), Size: '100', name: query.query })}`,
      )
      if (!Array.isArray(response.data))
        throw new ProviderError('INVALID_METADATA', 'Pazarama marka araması okunamadı.')
      return {
        options: response.data.map((b) => ({ id: text(record(b).id), name: text(record(b).name) })),
        hasMore: response.data.length === 100,
        page: query.page ?? 0,
      }
    }
    if (query.resource === 'attributes' || query.resource === 'values') {
      const response = await this.api.request(
          context,
          `/category/getCategoryWithAttributes?Id=${encodeURIComponent(query.categoryId ?? '')}`,
        ),
        data = record(response.data)
      if (text(data.id) !== query.categoryId || !Array.isArray(data.attributes))
        throw new ProviderError('INVALID_METADATA', 'Pazarama kategori özellikleri doğrulanamadı.')
      const schema: CategorySchema = {
        id: text(data.id),
        name: text(data.name),
        attributes: data.attributes.map((raw) => {
          const a = record(raw)
          return {
            id: text(a.id),
            name: text(a.name),
            required: a.isRequired === true,
            variant: a.isVariantable === true,
            slicer: false,
            allowCustom: false,
            multiple: false,
            values: array(a.attributeValues).map((v) => ({
              id: text(record(v).id),
              name: text(record(v).value),
            })),
          }
        }),
      }
      return query.resource === 'values'
        ? {
            options: schema.attributes.find((a) => a.id === query.attributeId)?.values ?? [],
            hasMore: false,
          }
        : { schema }
    }
    throw new ProviderError('UNSUPPORTED_METADATA', 'Bu Pazarama tanımı desteklenmiyor.')
  }
  build(_context: AdapterContext, item: PreparedListing, schema: CategorySchema | null) {
    if (!Number.isSafeInteger(item.config.dimensionalWeight) || item.config.dimensionalWeight! < 1)
      failField('Desi', 'Pazarama için en az 1 olan tam sayı desi girin.')
    if (!item.variant.barcode) failField('Barkod', 'Pazarama ürün barkodu gerekli.')
    if (item.images.some((url) => url.length > 500))
      failField('Görseller', 'Pazarama görsel adresi en fazla 500 karakter olmalı.')
    return {
      products: [
        {
          name: item.title,
          displayName: item.title,
          description: item.description,
          brandId: item.config.brandId,
          categoryId: item.config.categoryId,
          desi: item.config.dimensionalWeight,
          code: item.variant.barcode,
          groupCode: item.config.productMainId,
          stockCode: item.variant.sku,
          stockCount: item.quantity,
          vatRate: item.product.taxRate,
          listPrice: (item.listPrice ?? item.price) / 100,
          salePrice: item.price / 100,
          currencyType: 'TRY',
          images: item.images.map((imageUrl) => ({ imageUrl })),
          attributes: selectionEntries(item.config, schema).map(({ id, choice }) => ({
            attributeId: id,
            attributeValueId: choice.valueIds![0],
          })),
          deliveries: [],
        },
      ],
    }
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    if (await this.api.find(context, plan.barcode))
      throw new ProviderError(
        'REMOTE_LISTING_EXISTS',
        'Bu barkod Pazarama’da var. Uzak katalogdan eşleyin.',
      )
    const result = await this.api.request(context, '/product/create', {
        method: 'POST',
        json: plan.body,
      }),
      data = record(result.data),
      errors = array(record(data.error).errors)
    if (errors.length)
      throw new ProviderError(
        'PUBLICATION_REJECTED',
        'Pazarama ürün alanlarını reddetti. Kategori ve zorunlu bilgileri kontrol edin.',
      )
    const reference = text(data.batchRequestId)
    if (result.success !== true || !reference)
      throw new ProviderError(
        'PUBLICATION_UNCERTAIN',
        'Pazarama ürün gönderim sonucu doğrulanamadı.',
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
    if (phase === 'batch' && reference && reference !== emptyBatch) {
      const response = await this.api.request(
          context,
          `/product/getProductBatchResult?BatchRequestId=${encodeURIComponent(reference)}`,
        ),
        data = record(response.data)
      if (integer(data.status) === 1)
        return {
          state: { phase: 'submitted', reference, message: 'Pazarama aktarımı işliyor.' },
          again: true,
          phase: 'batch',
          pollAfterSeconds: 30,
        }
      const failed = array(data.failedProducts)
        .map(record)
        .filter((p) => text(p.productCode) === plan.barcode)
      if (integer(data.status) === 3 || integer(data.failedCount) > 0 || failed.length)
        return {
          state: {
            phase: 'rejected',
            reference,
            message: 'Pazarama ürün aktarımını reddetti.',
            errors: failed.map((p) => ({ message: text(p.errorReason) })),
          },
        }
      if (integer(data.status) !== 2 || integer(data.successfulCount) !== 1)
        throw new ProviderError('INVALID_BATCH', 'Pazarama tek ürün parti sonucu doğrulanamadı.')
    }
    const current = await this.api.find(context, plan.barcode)
    if (!current)
      return {
        state: {
          phase: 'review',
          reference,
          message: 'Pazarama ürününün kataloğa yansıması bekleniyor.',
        },
        again: true,
        phase: 'approval',
        pollAfterSeconds: 60,
      }
    if (text(current.product.stockCode) && text(current.product.stockCode) !== plan.sku)
      throw new ProviderError('SKU_MISMATCH', 'Pazarama barkodu farklı bir stok koduna bağlı.')
    if (current.approved && remoteInteger(current.product.stockCount) < 0)
      throw new ProviderError('MISSING_STOCK', 'Pazarama onaylı kaydın stok değeri doğrulanamadı.')
    if (current.approved)
      return {
        externalId: plan.barcode,
        state: {
          phase: integer(current.product.stockCount) > 0 ? 'live' : 'listed',
          reference,
          message:
            integer(current.product.stockCount) > 0
              ? 'Pazarama onaylı ilanı katalogdan doğrulandı.'
              : 'Pazarama ilanı onaylı; stok bekliyor.',
        },
      }
    return {
      externalId: plan.barcode,
      state: {
        phase: 'review',
        reference,
        message: text(current.product.waitingApproveExp) || 'Pazarama ürün onayı bekleniyor.',
      },
      again: true,
      phase: 'approval',
      pollAfterSeconds: 60,
    }
  }
}
