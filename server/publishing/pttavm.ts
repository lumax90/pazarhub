import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, cents, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp } from '../integrations/http'
import { PttAvmApi } from '../integrations/pttavm-api'
import { pttVariantPrice, pttVariantValuesMatch } from '../integrations/pttavm-catalog'
import { ProviderError } from '../errors'
import { canonicalJson } from '../security'
import type { Inspection, PreparedListing, PublicationAdapter, PublicationPlan } from './types'
import { failField, numericId } from './shared'
import { gtinProblem, isGtin } from '../../src/domain/barcodes'

export class PttAvmPublisher implements PublicationAdapter {
  readonly provider = 'pttavm' as const
  private readonly api: PttAvmApi
  constructor(http: ProviderHttp) {
    this.api = new PttAvmApi(http)
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    if (query.resource === 'attributes')
      return { schema: { id: query.categoryId!, name: '', attributes: [] } }
    if (query.resource !== 'categories')
      throw new ProviderError(
        'UNSUPPORTED_METADATA',
        'PttAVM varyant açıklamaları yerel varyant tiplerinden alınır.',
      )
    const response = record(await this.api.request(context, '/categories/category-tree'))
    if (response.success !== true || !Array.isArray(response.category_tree))
      throw new ProviderError('INVALID_METADATA', 'PttAVM kategori ağacı okunamadı.')
    const options: NonNullable<MetadataResult['options']> = []
    const walk = (items: unknown[], parents: string[], depth: number) => {
      if (depth > 30)
        throw new ProviderError('INVALID_METADATA', 'PttAVM kategori ağacı çok derin.')
      for (const value of items) {
        const category = record(value),
          path = [...parents, text(category.name)],
          children = array(category.children)
        if (children.length) walk(children, path, depth + 1)
        else if (text(category.id) && text(category.name))
          options.push({
            id: text(category.id),
            name: text(category.name),
            path: path.join(' / '),
            leaf: true,
          })
      }
    }
    walk(response.category_tree, [], 0)
    return { options }
  }
  build(_context: AdapterContext, item: PreparedListing, _schema: CategorySchema | null) {
    if (!/^PH-[a-f0-9]{32}$/.test(item.config.productMainId ?? ''))
      failField('Üst ürün', 'PttAVM için oluşturulmuş üst ürün kimliği gerekli.')
    if (!isGtin(item.variant.barcode))
      failField(
        'EAN',
        gtinProblem(item.variant.barcode) ?? 'Geçerli uzunlukta sayısal global barkod girin.',
      )
    if (item.price <= 100) failField('Fiyat', 'PttAVM fiyatı 1 TL’den büyük olmalı.')
    if (![0, 1, 10, 20].includes(item.product.taxRate))
      failField('KDV', 'PttAVM KDV oranı 0, 1, 10 veya 20 olmalı.')
    const axes = item.product.variantAxes ?? []
    if (axes.length > 2)
      failField('Varyant', 'PttAVM okuma sözleşmesi en fazla iki varyant tipini doğrulayabiliyor.')
    const attributes = axes.map((axis) => ({
      definition: axis.name,
      value: axis.values.find((value) => value.id === item.variant.options?.[axis.id])?.name ?? '',
    }))
    if (attributes.some((attribute) => !attribute.value))
      failField('Varyant', 'Her varyant tipi için değer seçin.')
    return {
      items: [
        {
          categoryId: numericId(item.config.categoryId, 'Kategori'),
          barcode: item.config.productMainId,
          productCode: item.config.productMainId,
          ean: item.product.variants[0].barcode,
          gtin: item.product.variants[0].barcode,
          name: item.title,
          vatRate: item.product.taxRate,
          longDescription: item.description,
          quantity: item.quantity,
          desi: item.config.dimensionalWeight ?? item.product.dimensions?.desi ?? 1,
          images: item.images.map((url) => ({ url })),
          active: true,
          brand: item.product.brand,
          ...(item.product.taxRate === 0
            ? { priceWithoutVat: item.price / 100 }
            : { priceWithVat: item.price / 100 }),
          variants: [
            {
              variantBarcode: item.variant.sku,
              catalogBarcode: item.variant.barcode,
              attributes,
              quantity: item.quantity,
              price: 0,
            },
          ],
        },
      ],
    }
  }
  async combine(_context: AdapterContext, plans: PublicationPlan[]) {
    if (!plans.length || plans.length > 100)
      failField('Varyant', 'PttAVM üst ürünü en fazla 100 varyant içerebilir.')
    const roots = plans.map((plan) => record(array(plan.body.items)[0]))
    const common = (root: Record<string, unknown>) => ({
      categoryId: root.categoryId,
      barcode: root.barcode,
      name: root.name,
      vatRate: root.vatRate,
      longDescription: root.longDescription,
      images: root.images,
      brand: root.brand,
      desi: root.desi,
    })
    if (roots.some((root) => canonicalJson(common(root)) !== canonicalJson(common(roots[0]))))
      failField('Üst ürün', 'PttAVM grubunun ortak ürün alanları aynı olmalı.')
    const quantity = plans.reduce((total, plan) => total + plan.quantity, 0)
    if (quantity > 9999)
      failField('Stok', 'PttAVM üst ürünündeki toplam varyant stoğu 9.999’u geçemez.')
    const price = Math.min(...plans.map((plan) => plan.price))
    const variants: Record<string, unknown>[] = roots.map((root, index) => ({
      ...record(array(root.variants)[0]),
      quantity: plans[index].quantity,
      price: (plans[index].price - price) / 100,
    }))
    const attributes = variants.map((variant) => array(variant.attributes))
    if (plans.length > 1 && attributes.some((attributes) => !attributes.length))
      failField(
        'Varyant',
        'Çoklu varyant için ürün kartında Renk/Beden gibi varyant tiplerini tanımlayın.',
      )
    if (
      new Set(attributes.map((attributes) => canonicalJson(attributes))).size !== attributes.length
    )
      failField('Varyant', 'Her varyantın özellik birleşimi benzersiz olmalı.')
    const root: Record<string, unknown> = {
      ...roots[0],
      quantity,
      variants: plans.length === 1 && !attributes[0].length ? [] : variants,
    }
    if (Number(root.vatRate) === 0) {
      root.priceWithoutVat = price / 100
      delete root.priceWithVat
    } else {
      root.priceWithVat = price / 100
      delete root.priceWithoutVat
    }
    return { items: [root] }
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    if (!plan.group?.length)
      throw new ProviderError('GROUP_REQUIRED', 'PttAVM tüm üst ürün grubunu birlikte göndermeli.')
    const root = record(array(plan.body.items)[0])
    if (await this.api.parent(context, text(root.barcode)))
      throw new ProviderError(
        'REMOTE_RECORD_EXISTS',
        'PttAVM üst ürün kimliği zaten mevcut; yeni ürün isteği gönderilmedi.',
      )
    const response = record(
      await this.api.request(context, '/products/upsert', { method: 'POST', json: plan.body }),
    )
    if (response.success === false)
      throw new ProviderError(
        'PRODUCT_REJECTED',
        text(response.message) || 'PttAVM ürün isteğini reddetti.',
      )
    if (response.success !== true || !text(response.trackingId))
      throw new ProviderError(
        'CREATION_UNCERTAIN',
        'PttAVM oluşturma takip numarası doğrulanamadı.',
        false,
        undefined,
        true,
      )
    return text(response.trackingId)
  }
  async inspect(
    context: AdapterContext,
    plan: PublicationPlan,
    reference: string,
  ): Promise<Inspection> {
    const root = record(array(plan.body.items)[0]),
      sku = text(root.barcode)
    const waiting = {
      phase: 'review' as const,
      reference,
      message: 'PttAVM ürün ve varyantları doğrulanıyor.',
    }
    if (reference) {
      try {
        if (!(await this.api.tracking(context, reference, sku)))
          return {
            state: waiting,
            again: true,
            members: plan.group
              ?.filter((member) => member.listingId !== plan.listingId)
              .map((member) => ({ listingId: member.listingId, state: waiting })),
          }
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code !== 'BATCH_FAILED') throw error
        const rejected = { phase: 'rejected' as const, reference, message: error.message }
        return {
          state: rejected,
          members: plan.group
            ?.filter((member) => member.listingId !== plan.listingId)
            .map((member) => ({ listingId: member.listingId, state: rejected })),
        }
      }
    }
    const parent = await this.api.parent(context, sku)
    if (!parent)
      return {
        state: waiting,
        again: true,
        members: plan.group
          ?.filter((member) => member.listingId !== plan.listingId)
          .map((member) => ({ listingId: member.listingId, state: waiting })),
      }
    if (
      (text(parent.barkod) !== sku && text(parent.urunKodu) !== sku) ||
      (text(parent.gtin) && text(parent.gtin) !== text(root.gtin))
    )
      throw new ProviderError(
        'PRODUCT_IDENTITY_MISMATCH',
        'PttAVM üst ürün SKU/GTIN kimliği uyuşmuyor.',
      )
    const variations = array(root.variants).map(record),
      actualVariants = array(parent.variantListesi).map(record)
    const members: NonNullable<Inspection['members']> = (plan.group ?? [plan]).map((member) => {
      const sent = variations.find((variant) => text(variant.variantBarcode) === member.sku)
      const found = sent
        ? actualVariants.find((variant) => text(variant.variantBarkod) === member.sku)
        : parent
      const attributes = array(sent?.attributes).map(record)
      const identity =
        !!found &&
        actualVariants.length === variations.length &&
        (!sent || pttVariantValuesMatch(found, attributes))
      const price = sent && found ? pttVariantPrice(parent, found) : cents(parent.kdVli)
      const quantity = remoteInteger(found?.miktar)
      const phase =
        identity && quantity >= 0 && Number.isSafeInteger(price) && price > 0
          ? parent.aktif === true
            ? quantity > 0
              ? 'live'
              : 'listed'
            : 'review'
          : 'review'
      return {
        listingId: member.listingId,
        state: {
          phase,
          reference,
          message:
            phase === 'live'
              ? 'PttAVM ilanı aktif.'
              : phase === 'listed'
                ? 'PttAVM ilanı hazır; stok bekliyor.'
                : waiting.message,
        },
        ...(identity
          ? {
              externalId: sent
                ? `${text(parent.urunId)}:${encodeURIComponent(member.sku)}`
                : text(parent.urunId),
              attributes: {
                pttParentSku: sku,
                pttParentId: text(parent.urunId),
                pttSellerSku: sent ? member.sku : sku,
                pttAttributes: JSON.stringify(attributes),
                hasVariants: sent ? 'yes' : 'no',
              },
            }
          : {}),
      }
    })
    const primary = members.find((member) => member.listingId === plan.listingId)!
    return {
      ...primary,
      members: members.filter((member) => member.listingId !== plan.listingId),
      again: members.some((member) => member.state.phase === 'review'),
      pollAfterSeconds: 30,
    }
  }
}
