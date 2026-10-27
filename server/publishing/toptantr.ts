import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, cents, integer, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp } from '../integrations/http'
import { ToptanTrApi } from '../integrations/toptantr'
import { planToptanSharedStock } from '../integrations/toptantr-stock'
import { ProviderError } from '../errors'
import { canonicalJson } from '../security'
import type { Inspection, PreparedListing, PublicationAdapter, PublicationPlan } from './types'
import { failField } from './shared'

export class ToptanTrPublisher implements PublicationAdapter {
  readonly provider = 'toptantr' as const
  private readonly api: ToptanTrApi
  constructor(http: ProviderHttp) {
    this.api = new ToptanTrApi(http)
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    if (query.resource === 'categories' || query.resource === 'brands') {
      const key = query.resource,
        options: NonNullable<MetadataResult['options']> = [],
        seen = new Set<string>()
      if (key === 'brands') {
        const page = query.page ?? 0,
          response = await this.api.request(context, `/brands?page=${page}&size=500`)
        if (!Array.isArray(response.brands))
          throw new ProviderError('INVALID_METADATA', 'ToptanTR marka listesi okunamadı.')
        return {
          options: response.brands.map((value) => ({
            id: text(record(value).guid),
            name: text(record(value).name),
          })),
          hasMore: response.brands.length > 0,
          page,
        }
      }
      let previous = ''
      for (let page = 0; page < 500; page++) {
        const response = await this.api.request(context, `/${key}?page=${page}&size=500`)
        if (!Array.isArray(response[key]))
          throw new ProviderError('INVALID_METADATA', 'ToptanTR tanım listesi okunamadı.')
        const rows = array(response[key]).map(record)
        if (!rows.length) return { options }
        const signature = rows.map((row) => text(row.guid)).join('|')
        if (signature === previous && page > 1)
          throw new ProviderError('PAGING_NOT_ADVANCING', 'ToptanTR tanım sayfası ilerlemiyor.')
        previous = signature
        for (const row of rows)
          if (!seen.has(text(row.guid))) {
            seen.add(text(row.guid))
            options.push({
              id: text(row.guid),
              name: text(row.name),
              ...(key === 'categories'
                ? { path: text(row.breadcrumb) || text(row.name), leaf: true }
                : {}),
            })
          }
      }
      throw new ProviderError('PAGING_LIMIT', 'ToptanTR tanım listesi tamamlanamadı.')
    }
    const response = await this.api.request(
        context,
        `/categories/${encodeURIComponent(query.categoryId!)}/attributes`,
      ),
      data = record(response.data)
    if (
      !Object.hasOwn(data, 'combinationAttributes') ||
      !Object.hasOwn(data, 'specificationAttributes')
    )
      throw new ProviderError('INVALID_METADATA', 'ToptanTR kategori özellik şeması eksik.')
    const fields = [
      ...array(data.combinationAttributes).map((value) => ({ value, variant: true, prefix: 'v' })),
      ...array(data.specificationAttributes).map((value) => ({
        value,
        variant: false,
        prefix: 's',
      })),
    ].map(({ value, variant, prefix }) => {
      const item = record(value)
      return {
        id: `${prefix}:${text(item.id)}`,
        name: text(item.name),
        required: item.required === true,
        variant,
        slicer: false,
        allowCustom: false,
        multiple: !variant,
        values: array(item.options).map((option) => ({
          id: text(record(option).id),
          name: text(record(option).name),
        })),
      }
    })
    if (query.resource === 'values')
      return { options: fields.find((field) => field.id === query.attributeId)?.values ?? [] }
    return { schema: { id: query.categoryId!, name: text(data.name), attributes: fields } }
  }
  build(_context: AdapterContext, item: PreparedListing, schema: CategorySchema | null) {
    if (!/^\d{8}$|^\d{12,14}$/.test(item.variant.barcode))
      failField('GTIN', '8, 12, 13 veya 14 haneli global barkod girin.')
    if (!item.config.brandId) failField('Marka', 'ToptanTR marka eşlemesini tamamlayın.')
    if (item.description.length > 4000)
      failField('Açıklama', 'ToptanTR için en fazla 4.000 karakter girin.')
    const attributes: { id: number; name: string }[] = [],
      specs: number[] = []
    for (const field of schema?.attributes ?? [])
      for (const [index, id] of (item.config.attributes[field.id]?.valueIds ?? []).entries()) {
        if (!/^\d+$/.test(id) || Number(id) <= 0)
          failField(field.name, 'Geçerli özellik değeri seçin.')
        if (field.variant)
          attributes.push({
            id: Number(id),
            name: item.config.attributes[field.id]?.labels?.[index] ?? '',
          })
        else specs.push(Number(id))
      }
    return {
      product: {
        productCode: '00000000-0000-0000-0000-000000000000',
        stock_code: item.config.productMainId || item.product.id,
        barcode: item.product.variants[0].barcode,
        title: item.title,
        shortDescription: (item.product.shortDescription ?? '').slice(0, 500),
        fullDescription: item.description,
        taxCategory: item.product.taxRate,
        isTaxExempt: item.product.taxRate === 0,
        brands: [{ guid: item.config.brandId, name: item.config.brandName }],
        categories: [{ guid: item.config.categoryId, name: item.config.categoryName }],
        images: item.images.map((url, position) => ({ id: 0, position: position + 1, url })),
        productSpecificationOptions: specs.sort((a, b) => a - b),
        productAttributeCombinations: [
          {
            name: item.variant.name,
            barcode: item.variant.sku,
            gtin: item.variant.barcode,
            stockQuantity: item.quantity,
            overriddenPrice: item.price / 100,
            overriddenOldPrice: (item.listPrice ?? item.price) / 100,
            itemPerPackage: item.config.itemPerPackage ?? 1,
            attributes,
          },
        ],
      },
    }
  }
  async combine(context: AdapterContext, plans: PublicationPlan[]) {
    if (!plans.length) failField('Varyant', 'En az bir varyant gerekli.')
    const base = [...plans].sort(
      (a, b) =>
        (a.config.itemPerPackage ?? 1) - (b.config.itemPerPackage ?? 1) ||
        a.sku.localeCompare(b.sku),
    )[0]
    const first = record(base.body.product)
    const common = (product: Record<string, unknown>) => ({
      stock_code: product.stock_code,
      title: product.title,
      shortDescription: product.shortDescription,
      fullDescription: product.fullDescription,
      taxCategory: product.taxCategory,
      brands: product.brands,
      categories: product.categories,
      images: product.images,
      productSpecificationOptions: product.productSpecificationOptions,
    })
    for (const plan of plans)
      if (canonicalJson(common(record(plan.body.product))) !== canonicalJson(common(first)))
        failField(
          'Üst ürün',
          'Grupta üst ürün kodu, başlık, açıklama, marka, kategori, görsel ve teknik özellikler aynı olmalı.',
        )
    const combinations = plans
      .flatMap((plan) => array(record(plan.body.product).productAttributeCombinations))
      .map(record)
    const keys = combinations.map((combination) =>
      canonicalJson(
        array(combination.attributes)
          .map((value) => integer(record(value).id))
          .sort((a, b) => a - b),
      ),
    )
    if (new Set(keys).size !== keys.length)
      failField('Varyant', 'Gruptaki her stok kodu farklı varyant özellikleriyle eşlenmeli.')
    const schema = (
      await this.metadata(context, {
        resource: 'attributes',
        categoryId: plans[0].config.categoryId,
      })
    ).schema!
    const used = schema.attributes.filter(
      (field) =>
        field.variant && plans.some((plan) => plan.config.attributes[field.id]?.valueIds?.length),
    )
    if (
      combinations.length > 1 &&
      used.length === 1 &&
      used[0].name.toLocaleLowerCase('tr-TR') === 'seçenekler'
    ) {
      const state = structuredClone(context.state),
        productCode = `new:${text(first.stock_code)}`
      const remote = {
        productCode,
        productAttributeCombinations: combinations.map((combination, index) => ({
          ...combination,
          id: index + 1,
        })),
      }
      state.listings = plans.map((plan, index) => {
        const listing = state.listings.find((listing) => listing.id === plan.listingId)!
        listing.externalId = String(index + 1)
        listing.externalSku = plan.sku
        listing.externalBarcode = plan.barcode
        listing.attributes = { productCode, itemPerPackage: plan.config.itemPerPackage ?? 1 }
        return listing
      })
      const shared = planToptanSharedStock({ ...context, state }, remote)
      for (const [index, combination] of combinations.entries())
        combination.stockQuantity = shared.members.find(
          (member) => member.externalId === String(index + 1),
        )!.quantity
    }
    return { product: { ...first, productAttributeCombinations: combinations } }
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    if (!plan.group?.length)
      throw new ProviderError(
        'GROUP_REQUIRED',
        'ToptanTR üst ürününün tüm varyantları birlikte gönderilmeli.',
      )
    const sku = text(record(plan.body.product).stock_code)
    if (await this.api.parent(context, sku))
      throw new ProviderError(
        'REMOTE_RECORD_EXISTS',
        'Üst ürün zaten mevcut; uzak katalog eşlemesini kullanın.',
      )
    const response = await this.api.request(context, '/products/new', {
      method: 'POST',
      json: plan.body,
    })
    const created = array(response.content)
      .map(record)
      .find((product) => text(product.stock_code) === sku)
    if (created && text(created.productCode)) return text(created.productCode)
    if (response.success === true) return `catalog:${sku}`
    throw new ProviderError(
      'CREATION_UNCERTAIN',
      'ToptanTR yeni ürün sonucu doğrulanamadı; katalogdan kontrol edilmeli.',
      false,
      undefined,
      true,
    )
  }
  async inspect(
    context: AdapterContext,
    plan: PublicationPlan,
    reference: string,
  ): Promise<Inspection> {
    const product = await this.api.parent(context, text(record(plan.body.product).stock_code))
    const waiting = {
      phase: 'review' as const,
      message: 'ToptanTR üst ürün ve varyant onayı bekleniyor.',
    }
    if (!product)
      return {
        state: waiting,
        again: true,
        members: plan.group
          ?.filter((member) => member.listingId !== plan.listingId)
          .map((member) => ({ listingId: member.listingId, state: waiting })),
      }
    if (reference && !reference.startsWith('catalog:') && text(product.productCode) !== reference)
      throw new ProviderError('PRODUCT_IDENTITY_MISMATCH', 'ToptanTR üst ürün kimliği değişmiş.')
    const members: NonNullable<Inspection['members']> = (plan.group ?? [plan]).map((member) => {
      const combination = array(product.productAttributeCombinations)
        .map(record)
        .find(
          (value) =>
            text(value.barcode) === member.sku &&
            text(value.gtin) === member.barcode &&
            integer(value.itemPerPackage, 1) === (member.config.itemPerPackage ?? 1),
        )
      const approval = remoteInteger(product.approvalStatusId)
      const phase =
        approval === 100
          ? 'rejected'
          : approval === 0 &&
              combination &&
              remoteInteger(combination.stockQuantity) >= 0 &&
              Number.isSafeInteger(cents(combination.overriddenPrice))
            ? product.onSale === true &&
              text(combination.isActive).toLowerCase() === 'true' &&
              remoteInteger(combination.stockQuantity) > 0 &&
              cents(combination.overriddenPrice) > 0
              ? 'live'
              : 'listed'
            : 'review'
      return {
        listingId: member.listingId,
        state: {
          phase,
          reference,
          message:
            phase === 'live'
              ? 'ToptanTR varyasyonu yayında.'
              : phase === 'listed'
                ? 'Varyasyon onaylı; satışa açılma koşulları bekleniyor.'
                : phase === 'rejected'
                  ? 'ToptanTR ürünü onaylamadı.'
                  : waiting.message,
        },
        ...(combination && text(combination.id)
          ? {
              externalId: text(combination.id),
              attributes: {
                productCode: text(product.productCode),
                productId: text(product.id),
                parentSku: text(product.stock_code),
                itemPerPackage: integer(combination.itemPerPackage, 1),
              },
            }
          : {}),
      }
    })
    const primary = members.find((member) => member.listingId === plan.listingId)!
    return {
      ...primary,
      state: primary.state,
      members: members.filter((member) => member.listingId !== plan.listingId),
      again: members.some((member) => member.state.phase === 'review'),
      pollAfterSeconds: 120,
    }
  }
}
