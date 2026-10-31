import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, cents, integer, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { hepsiburadaHeaders } from '../integrations/hepsiburada'
import { ProviderError } from '../errors'
import type { Inspection, PreparedListing, PublicationAdapter, PublicationPlan } from './types'
import { failField, numericId } from './shared'
import { gtinProblem, isGtin } from '../../src/domain/barcodes'

const automatic = new Set([
  'merchantSku',
  'VaryantGroupID',
  'Barcode',
  'UrunAdi',
  'UrunAciklamasi',
  'Marka',
  'kg',
  'price',
  'stock',
  'Video1',
  ...Array.from({ length: 10 }, (_, i) => `Image${i + 1}`),
])
export class HepsiburadaPublisher implements PublicationAdapter {
  readonly provider = 'hepsiburada' as const
  constructor(private readonly http: ProviderHttp) {}
  private credentials(context: AdapterContext) {
    const suffix = context.settings.environment === 'sandbox' ? '-sit' : ''
    return {
      base: `https://mpop${suffix}.hepsiburada.com/product`,
      listings: `https://listing-external${suffix}.hepsiburada.com`,
      merchant: requireCredential(context.credentials, 'merchantId'),
      headers: hepsiburadaHeaders(context),
    }
  }
  private async api(context: AdapterContext, path: string) {
    const { base, headers } = this.credentials(context),
      response = record(await this.http.request(base + path, { headers }))
    if (response.success !== true)
      throw new ProviderError(
        'HB_RESPONSE_FAILED',
        text(response.message) || 'Hepsiburada işlemi başarılı olmadı.',
      )
    return response
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    if (query.resource === 'categories') {
      const options: NonNullable<MetadataResult['options']> = []
      for (let page = 0; page < 100; page++) {
        const response = await this.api(
          context,
          `/api/categories/get-all-categories?leaf=true&available=true&status=ACTIVE&version=1&page=${page}&size=1000`,
        )
        if (!Array.isArray(response.data))
          throw new ProviderError('INVALID_METADATA', 'Hepsiburada kategori listesi okunamadı.')
        for (const value of response.data) {
          const row = record(value)
          if (
            row.leaf === true &&
            row.available !== false &&
            !['INACTIVE', 'ARCHIVED'].includes(text(row.status))
          )
            options.push({
              id: text(row.categoryId),
              name: text(row.name),
              path: array(row.paths).map(text).join(' / ') || text(row.name),
              leaf: true,
            })
        }
        if (
          response.last === true ||
          !response.data.length ||
          page + 1 >= integer(response.totalPages, 1)
        )
          return { options }
      }
      throw new ProviderError('PAGING_LIMIT', 'Hepsiburada kategori sayfalaması tamamlanamadı.')
    }
    if (query.resource === 'attributes') {
      const response = await this.api(
          context,
          `/api/categories/${encodeURIComponent(query.categoryId!)}/attributes?version=2`,
        ),
        data = record(response.data)
      const fields = [...array(data.baseAttributes), ...array(data.attributes)]
        .map((value) => ({ value, variant: false }))
        .concat(array(data.variantAttributes).map((value) => ({ value, variant: true })))
      return {
        schema: {
          id: query.categoryId!,
          name: '',
          attributes: fields
            .map(({ value, variant }) => {
              const field = record(value)
              return {
                id: text(field.id),
                name: text(field.name),
                required: field.mandatory === true,
                variant,
                slicer: false,
                allowCustom: text(field.type).toLowerCase() === 'string',
                multiple: field.multiValue === true,
              }
            })
            .filter((field) => !automatic.has(field.id)),
        },
      }
    }
    if (query.resource === 'values') {
      const page = query.page ?? 0,
        response = await this.api(
          context,
          `/api/categories/${encodeURIComponent(query.categoryId!)}/attribute/${encodeURIComponent(query.attributeId!)}/values?version=5&page=${page}&size=1000`,
        )
      if (!Array.isArray(response.data))
        throw new ProviderError('INVALID_METADATA', 'Hepsiburada özellik değerleri okunamadı.')
      return {
        options: response.data.map((value) => {
          const row = record(value)
          return { id: text(row.id), name: text(row.value) }
        }),
        hasMore:
          response.last === false ||
          page + 1 < integer(response.totalPages, 1) ||
          (response.last === undefined &&
            response.totalPages === undefined &&
            response.data.length === 1000),
        page,
      }
    }
    throw new ProviderError('UNSUPPORTED_METADATA', 'Hepsiburada bu tanım türünü sunmuyor.')
  }
  build(context: AdapterContext, item: PreparedListing, schema: CategorySchema | null) {
    if (!/^[A-Z0-9._:/-]+$/.test(item.variant.sku))
      failField('SKU', 'Hepsiburada stok kodunu büyük harf ve boşluksuz bekler.')
    if (item.variant.barcode.length !== 13 || !isGtin(item.variant.barcode))
      failField(
        'Barkod',
        gtinProblem(item.variant.barcode) ?? 'Kontrol haneli 13 haneli EAN barkodu girin.',
      )
    if (!item.product.brand.trim()) failField('Marka', 'Ürün markası gerekli.')
    const attributes: Record<string, unknown> = {}
    for (const field of schema?.attributes ?? []) {
      const selection = item.config.attributes[field.id]
      if (!selection) continue
      const values = selection.labels ?? []
      attributes[field.id] = selection.customValue ?? (field.multiple ? values : values[0])
    }
    Object.assign(attributes, {
      merchantSku: item.variant.sku,
      VaryantGroupID: item.config.productMainId || item.product.id,
      Barcode: item.variant.barcode,
      UrunAdi: item.title,
      UrunAciklamasi: item.description,
      Marka: item.product.brand,
      kg: String(item.config.dimensionalWeight ?? 1),
      price: (item.price / 100).toFixed(2).replace('.', ','),
      stock: String(item.quantity),
    })
    item.images.forEach((url, index) => {
      attributes[`Image${index + 1}`] = url
    })
    return {
      products: [
        {
          categoryId: numericId(item.config.categoryId, 'Kategori'),
          merchant: this.credentials(context).merchant,
          attributes,
        },
      ],
    }
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    const { base, headers, merchant } = this.credentials(context)
    const existing = await this.api(
      context,
      `/api/products/all-products-of-merchant/${encodeURIComponent(merchant)}?merchantSku=${encodeURIComponent(plan.sku)}&page=0&size=100`,
    )
    if (array(existing.data).some((value) => text(record(value).merchantSku) === plan.sku))
      throw new ProviderError(
        'REMOTE_RECORD_EXISTS',
        'Stok kodu Hepsiburada kataloğunda mevcut. Uzak ürün eşleme ekranından mevcut kaydı bağlayın.',
      )
    const file = new FormData()
    file.append(
      'file',
      new Blob([JSON.stringify(plan.body.products)], { type: 'application/json' }),
      'products.json',
    )
    const response = record(
      await this.http.request(`${base}/api/products/import?version=1`, {
        method: 'POST',
        headers,
        body: file,
      }),
    )
    if (response.success !== true)
      throw new ProviderError(
        'PRODUCT_REJECTED',
        text(response.message) || 'Hepsiburada ürün dosyasını reddetti.',
      )
    const id = text(record(response.data).trackingId) || text(response.trackingId)
    if (!id)
      throw new ProviderError(
        'MISSING_TRACKING',
        'Hepsiburada takip numarası dönmedi.',
        false,
        undefined,
        true,
      )
    return id
  }
  async inspect(
    context: AdapterContext,
    plan: PublicationPlan,
    reference: string,
  ): Promise<Inspection> {
    const { headers, listings, merchant } = this.credentials(context)
    if (reference) {
      const response = await this.api(
        context,
        `/api/products/status/${encodeURIComponent(reference)}?version=1&page=0&size=1000`,
      )
      const item = array(response.data)
        .map(record)
        .find((row) => text(row.merchantSku) === plan.sku)
      if (
        item?.importStatus === 'FAILED' ||
        ['REJECTED', 'BLOCKED', 'MISSING_INFO'].includes(text(item?.productStatus))
      )
        return {
          state: {
            phase: 'rejected',
            message: 'Hepsiburada ürün için düzeltme istedi.',
            errors: [
              ...array(item?.validationResults).map((value) => ({
                field: text(record(value).attributeName),
                message: text(record(value).message),
              })),
              ...array(item?.rejectReasonsMessages).map((value) => ({ message: text(value) })),
            ],
          },
        }
    }
    const query = new URLSearchParams({ merchantSkuList: plan.sku, offset: '0', limit: '100' })
    const response = record(
      await this.http.request(
        `${listings}/listings/merchantid/${encodeURIComponent(merchant)}?${query}`,
        { headers },
      ),
    )
    const actual = array(response.listings)
      .map(record)
      .find((row) => text(row.merchantSku) === plan.sku)
    if (actual?.isLocked === true)
      return {
        state: {
          phase: 'rejected',
          message: 'Hepsiburada ilanı kilitli. Platformdaki gerekçeyi kontrol edin.',
        },
      }
    const catalog = await this.api(
      context,
      `/api/products/all-products-of-merchant/${encodeURIComponent(merchant)}?merchantSku=${encodeURIComponent(plan.sku)}&page=0&size=100`,
    )
    const matched = array(catalog.data)
      .map(record)
      .find(
        (row) =>
          text(row.merchantSku) === plan.sku &&
          text(row.barcode) === plan.barcode &&
          text(row.hbSku) === text(actual?.hepsiburadaSku),
      )
    if (
      matched &&
      actual &&
      remoteInteger(actual.availableStock) >= 0 &&
      Number.isSafeInteger(cents(actual.price)) &&
      text(actual.hepsiburadaSku) &&
      (actual.isSalable === true || remoteInteger(actual.availableStock) === 0)
    ) {
      const live =
        actual.isSalable === true &&
        remoteInteger(actual.availableStock) > 0 &&
        cents(actual.price) > 0
      return {
        externalId: `${text(actual.hepsiburadaSku)}:${plan.sku}`,
        state: {
          phase: live ? 'live' : 'listed',
          message: live
            ? 'Hepsiburada ilanı satışa açık.'
            : 'Katalog kaydı hazır; stok/fiyat kontrol edilmeli.',
        },
      }
    }
    return {
      state: {
        phase: 'review',
        message: 'Hepsiburada katalog incelemesi veya eşleştirme onayı bekleniyor.',
      },
      again: true,
      pollAfterSeconds: 120,
    }
  }
}
