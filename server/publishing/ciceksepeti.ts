import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, record, text, pathPart } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { ProviderError } from '../errors'
import type { PreparedListing, PublicationAdapter, PublicationPlan, Inspection } from './types'
import { leafCategories, numericId, selectionEntries, failureMessages, failField } from './shared'

export class CiceksepetiPublisher implements PublicationAdapter {
  readonly provider = 'ciceksepeti' as const
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext) {
    return {
      base:
        context.settings.environment === 'sandbox'
          ? 'https://sandbox-apis.ciceksepeti.com/api/v1'
          : 'https://apis.ciceksepeti.com/api/v1',
      headers: {
        'x-api-key': requireCredential(context.credentials, 'apiKey'),
        'user-agent': `${requireCredential(context.credentials, 'sellerId')} - ${context.integrationName}`,
      },
    }
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    const { base, headers } = this.api(context)
    if (query.resource === 'categories')
      return { options: leafCategories(await this.http.request(`${base}/Categories`, { headers })) }
    if (query.resource === 'attributes' || query.resource === 'values') {
      const category = numericId(query.categoryId, 'Kategori'),
        response = record(
          await this.http.request(`${base}/Categories/${category}/attributes`, { headers }),
        )
      if (!Array.isArray(response.categoryAttributes))
        throw new ProviderError('INVALID_METADATA', 'Çiçeksepeti kategori özellikleri okunamadı.')
      const schema: CategorySchema = {
        id: String(category),
        name: text(response.categoryName),
        attributes: response.categoryAttributes.map((raw) => {
          const item = record(raw),
            personalization = text(item.type).toLocaleLowerCase('tr-TR').includes('kişiselleştir')
          return {
            id: text(item.attributeId),
            name: text(item.attributeName),
            required: item.required === true && !personalization,
            variant: item.varianter === true,
            slicer: false,
            allowCustom: false,
            multiple: false,
            personalization,
            values: array(item.attributeValues).map((raw) => ({
              id: text(record(raw).id),
              name: text(record(raw).name),
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
    throw new ProviderError('UNSUPPORTED_METADATA', 'Bu Çiçeksepeti tanımı desteklenmiyor.')
  }
  build(
    _context: AdapterContext,
    item: PreparedListing,
    schema: CategorySchema | null,
  ): Record<string, unknown> {
    const config = item.config
    if (![1, 2, 3].includes(config.deliveryType ?? 0))
      failField('Teslimat tipi', 'Kargo / servis aracı tercihini seçin.')
    if (![1, 4, 5, 6, 7, 13, 18, 19].includes(config.deliveryMessageType ?? 0))
      failField('Teslimat aralığı', 'Sağlayıcının teslimat aralıklarından seçin.')
    if (
      item.description.replace(/<[^>]*>/g, '').trim().length < 30 ||
      item.description.length > 20000
    )
      failField(
        'Açıklama',
        'En az 30 düz metin karakteri, en fazla 20.000 toplam karakter kullanın.',
      )
    if (item.variant.barcode && item.variant.barcode.length < 3)
      failField('Barkod', 'Barkod verilirse en az 3 karakter olmalı.')
    return {
      products: [
        {
          productName: item.title,
          mainProductCode: config.productMainId || item.product.id,
          stockCode: item.variant.sku,
          categoryId: numericId(config.categoryId, 'Kategori'),
          description: item.description,
          deliveryType: config.deliveryType,
          deliveryMessageType: config.deliveryMessageType,
          stockQuantity: item.quantity,
          salesPrice: item.price / 100,
          ...(item.variant.barcode ? { barcode: item.variant.barcode } : {}),
          images: item.images,
          attributes: selectionEntries(config, schema).map(({ id, choice }) => ({
            id: Number(id),
            ...(choice.textLength
              ? { textLength: choice.textLength }
              : { valueId: Number(choice.valueIds![0]) }),
          })),
        },
      ],
    }
  }
  private async find(context: AdapterContext, sku: string) {
    const { base, headers } = this.api(context)
    const response = record(
      await this.http.request(
        `${base}/Products?${new URLSearchParams({ StockCode: sku, Page: '1', PageSize: '60' })}`,
        { headers },
      ),
    )
    if (!Array.isArray(response.products))
      throw new ProviderError('INVALID_PRODUCT_LOOKUP', 'Çiçeksepeti ürün sorgusu okunamadı.')
    return response.products.map(record).find((p) => text(p.stockCode) === sku)
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    if (await this.find(context, plan.sku))
      throw new ProviderError(
        'REMOTE_LISTING_EXISTS',
        'Bu stok kodu Çiçeksepeti’nde mevcut. Uzak ilan havuzundan eşleyin.',
      )
    const { base, headers } = this.api(context),
      response = record(
        await this.http.request(`${base}/Products`, { method: 'POST', headers, json: plan.body }),
      )
    const reference = text(response.batchId)
    if (!reference)
      throw new ProviderError(
        'PUBLICATION_UNCERTAIN',
        'Çiçeksepeti parti numarası alınamadı.',
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
      const { base, headers } = this.api(context),
        response = record(
          await this.http.request(`${base}/Products/batch-status/${pathPart(reference)}`, {
            headers,
          }),
        )
      const item = array(response.items)
        .map(record)
        .find((i) => text(record(i.data).stockCode) === plan.sku)
      if (!item || ['Pending', 'Processing'].includes(text(item.status)))
        return {
          state: { phase: 'submitted', reference, message: 'Çiçeksepeti ürün aktarımını işliyor.' },
          again: true,
          phase: 'batch',
          pollAfterSeconds: 61,
        }
      if (!['Success', 'Warning'].includes(text(item.status)))
        return {
          state: {
            phase: 'rejected',
            reference,
            message: 'Çiçeksepeti ürün satırını reddetti.',
            errors: failureMessages(item.failureReasons),
          },
        }
      // Product queries with identical parameters are limited to one per ten minutes.
      return {
        state: {
          phase: 'review',
          reference,
          message:
            'Aktarım tamamlandı; katalog onayı sağlayıcının sorgu aralığında kontrol edilecek.',
        },
        again: true,
        phase: 'approval',
        pollAfterSeconds: 601,
      }
    }
    const product = await this.find(context, plan.sku)
    if (!product)
      return {
        state: { phase: 'review', reference, message: 'Çiçeksepeti katalog onayı bekleniyor.' },
        again: true,
        phase: 'approval',
        pollAfterSeconds: 601,
      }
    const externalId = text(product.productCode),
      status = text(product.productStatusType).toLocaleLowerCase('tr-TR').replaceAll(' ', '')
    if (!externalId)
      throw new ProviderError(
        'MISSING_PRODUCT_ID',
        'Çiçeksepeti kayıt kimliği henüz doğrulanamadı.',
        true,
        601,
      )
    if (plan.barcode && text(product.barcode) && text(product.barcode) !== plan.barcode)
      throw new ProviderError('BARCODE_MISMATCH', 'Çiçeksepeti stok kodu farklı bir barkoda bağlı.')
    if (status === 'yayında' || status === '3')
      return {
        externalId,
        state: {
          phase: 'live',
          reference,
          message: 'Çiçeksepeti ilanının yayında olduğu doğrulandı.',
        },
      }
    if (['reddedilen', 'reddedilmiş', 'retedilmiş', '4'].includes(status))
      return {
        externalId,
        state: {
          phase: 'rejected',
          reference,
          message:
            text(product.passiveDescription) || 'Çiçeksepeti katalog kontrolü ürünü reddetti.',
        },
      }
    return {
      externalId,
      state: { phase: 'review', reference, message: 'Çiçeksepeti ilanı henüz yayında değil.' },
      again: true,
      phase: 'approval',
      pollAfterSeconds: 601,
    }
  }
}
