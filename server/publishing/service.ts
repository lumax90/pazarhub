import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState, Listing } from '../../src/domain/types'
import type {
  CategorySchema,
  PublishConfig,
  PublishPreview,
  CategoryMapping,
  MetadataQuery,
} from '../../src/domain/publishing'
import { publicationDefinitions, supportsPublishing } from '../../src/domain/publishing'
import {
  findVariant,
  listingPrice,
  listingListPrice,
  listingQuantity,
} from '../../src/domain/selectors'
import { MAX_PRODUCT_VARIANTS } from '../../src/domain/products'
import { catalogDefaults, categoryMappingFor } from '../../src/domain/catalog-mappings'
import { categoryPath } from '../../src/domain/definitions'
import { imagesForVariant } from '../../src/domain/product-images'
import { storeWarehouseIds } from '../../src/domain/stock-allocation'
import type { AuthContext } from '../auth-types'
import { audit, requirePermission } from '../auth'
import type { Sql } from '../db'
import type { IntegrationService, ConnectionRow } from '../integration-service'
import { ProviderHttp } from '../integrations/http'
import type { AdapterContext } from '../integrations/contracts'
import { AppError, ProviderError } from '../errors'
import { canonicalJson, sha256 } from '../security'
import { identifier, uuid } from '../validation'
import { enqueue } from '../jobs'
import { publisher } from './registry'
import { CatalogMetadata } from './metadata'
import {
  attributeMapSchema,
  publishConfigSchema,
  metadataQuerySchema,
  catalogIdSchema,
} from './validation'
import type { PublicationPlan, PreparedListing } from './types'
import { failField } from './shared'

interface StateRow {
  document: AppState
  revision: number | string
}
interface StoredPreview {
  plan: PublicationPlan
  credentialVersion: number
  expiresAt: string
}

export class PublicationService {
  constructor(readonly integrations: IntegrationService) {}
  private get db() {
    return this.integrations.database
  }
  async state(workspaceId: string, tx: Sql = this.db, lock = false) {
    const row = (
      await tx.query<StateRow>(
        `SELECT document,revision FROM workspace_states WHERE workspace_id=$1${lock ? ' FOR UPDATE' : ''}`,
        [workspaceId],
      )
    ).rows[0]
    if (!row) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Çalışma alanı bulunamadı.')
    return row
  }
  private context(connection: ConnectionRow, state: AppState): AdapterContext {
    return {
      workspaceId: connection.workspace_id,
      connectionId: connection.id,
      provider: connection.provider,
      credentials: this.integrations.credentials(connection),
      settings: connection.settings,
      state,
      integrationName: this.integrations.config.integrationName,
    }
  }
  private assertProvider(connection: ConnectionRow) {
    if (
      connection.kind !== 'marketplace' ||
      !supportsPublishing(connection.provider) ||
      !this.integrations.capabilities(connection.provider).includes('listing.publish')
    )
      throw new AppError(
        409,
        'PUBLISHING_UNAVAILABLE',
        'Bu mağazanın yeni ürün yayınlama akışı henüz açık değil.',
      )
    return publicationDefinitions[connection.provider]
  }
  async metadata(auth: AuthContext, connectionId: string, raw: unknown) {
    const query = metadataQuerySchema.parse(raw),
      connection = await this.integrations.connection(auth.workspaceId, connectionId)
    const definition = this.assertProvider(connection)
    if (!definition.metadata.includes(query.resource))
      throw new AppError(400, 'UNSUPPORTED_METADATA', 'Sağlayıcı bu tanımı desteklemiyor.')
    if (connection.status !== 'verified')
      throw new AppError(409, 'TEST_REQUIRED', 'Önce mağaza bağlantısının API testini tamamlayın.')
    const state = (await this.state(auth.workspaceId)).document,
      context = this.context(connection, state)
    const adapter = publisher(connection.provider, new ProviderHttp(this.integrations.fetcher)),
      metadata = new CatalogMetadata(this.db, adapter, connection.credential_version)
    const request: MetadataQuery = {
      resource: query.resource,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.attributeId ? { attributeId: query.attributeId } : {}),
      ...(['brands', 'asin'].includes(query.resource) ? { query: query.query } : {}),
      ...(query.resource === 'shipmentTemplates' ||
      (query.resource === 'values' && ['trendyol', 'hepsiburada'].includes(connection.provider)) ||
      (query.resource === 'brands' && ['pazarama', 'toptantr'].includes(connection.provider))
        ? { page: query.page }
        : {}),
    }
    const result = await metadata.get(context, request)
    if (result.schema)
      return {
        schema: {
          ...result.schema,
          attributes: result.schema.attributes.map((attribute) => ({
            ...attribute,
            values: undefined,
          })),
        },
      }
    const needle = query.query.toLocaleLowerCase('tr-TR')
    const options = (result.options ?? []).filter(
      (option) =>
        !needle ||
        `${option.name} ${option.path ?? ''}`.toLocaleLowerCase('tr-TR').includes(needle) ||
        option.id.toLowerCase().includes(query.query.toLowerCase()),
    )
    return {
      options: options.slice(query.offset, query.offset + 100),
      hasMore: query.offset + 100 < options.length,
      nextOffset: query.offset + 100 < options.length ? query.offset + 100 : null,
      remoteHasMore: result.hasMore ?? false,
      page: query.page,
      total: options.length,
    }
  }
  async create(auth: AuthContext, raw: unknown) {
    const input = z
      .strictObject({
        storeId: uuid,
        productId: identifier,
        variantIds: z.array(identifier).min(1).max(MAX_PRODUCT_VARIANTS),
      })
      .parse(raw)
    return this.db.transaction(async (tx) => {
      const row = await this.state(auth.workspaceId, tx, true),
        connection = await this.integrations.connection(auth.workspaceId, input.storeId, tx)
      const definition = this.assertProvider(connection)
      const product = row.document.products.find((p) => p.id === input.productId)
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Ürün bulunamadı.')
      let model =
        row.document.listings.find((l) => l.storeId === connection.id && l.productId === product.id)
          ?.publishConfig?.productMainId ??
        (definition.immutableMainId
          ? `PH-${randomUUID().replaceAll('-', '')}`
          : product.modelCode && product.modelCode.length <= definition.maxMainId
            ? product.modelCode
            : product.id.replaceAll('-', '').slice(0, definition.maxMainId))
      while (
        row.document.listings.some(
          (l) =>
            l.storeId === connection.id &&
            l.productId !== product.id &&
            l.publishConfig?.productMainId === model,
        )
      )
        model = randomUUID().replaceAll('-', '').slice(0, definition.maxMainId)
      const ids: string[] = []
      for (const variantId of new Set(input.variantIds)) {
        const variant = product.variants.find((v) => v.id === variantId)
        if (!variant) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Varyant bu ürüne ait değil.')
        const existing = row.document.listings.find(
          (l) => l.storeId === connection.id && l.variantId === variantId,
        )
        if (existing) {
          ids.push(existing.id)
          continue
        }
        const id = randomUUID()
        row.document.listings.push({
          id,
          productId: product.id,
          variantId,
          storeId: connection.id,
          channel: connection.provider as Listing['channel'],
          status: 'pending',
          desiredStatus: 'active',
          externalSku: variant.sku,
          externalBarcode: variant.barcode,
          version: 1,
          updatedAt: new Date().toISOString(),
          syncStatus: 'idle',
          publishConfig: {
            attributes: {},
            productMainId: model,
            ...(connection.provider === 'amazon' ? { condition: 'new_new' } : {}),
            ...(connection.provider === 'ciceksepeti'
              ? { deliveryType: 2, deliveryMessageType: 5 }
              : {}),
          },
          publication: { phase: 'draft' },
          ...(connection.provider === 'amazon'
            ? { attributes: { productType: 'PRODUCT', fulfillmentChannel: 'DEFAULT' } }
            : {}),
        })
        ids.push(id)
      }
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'listing.drafts_created', product.id, {
        storeId: connection.id,
        ids,
      })
      return { ids }
    })
  }
  async detail(auth: AuthContext, id: string) {
    const state = (await this.state(auth.workspaceId)).document,
      listing = state.listings.find((l) => l.id === id)
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'İlan bulunamadı.')
    const product = state.products.find((p) => p.id === listing.productId)!
    const connection = await this.integrations.connection(auth.workspaceId, listing.storeId)
    const definition = this.assertProvider(connection)
    return {
      listing,
      product,
      connection: {
        id: connection.id,
        name: connection.name,
        provider: connection.provider,
        enabled: connection.enabled,
        status: connection.status,
      },
      definition,
      defaults: catalogDefaults(
        state,
        listing,
        product,
        product.variants.find((variant) => variant.id === listing.variantId)!,
      ),
      mapping: categoryMappingFor(state, listing.storeId, listing.channel, product) ?? null,
    }
  }
  async save(auth: AuthContext, id: string, raw: unknown) {
    const input = z
      .strictObject({ version: z.number().int().nonnegative(), config: publishConfigSchema })
      .parse(raw)
    await this.db.transaction(async (tx) => {
      const row = await this.state(auth.workspaceId, tx, true),
        listing = row.document.listings.find((l) => l.id === id)
      if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'İlan bulunamadı.')
      if ((listing.version ?? 0) !== input.version)
        throw new AppError(
          409,
          'DRAFT_CHANGED',
          'İlan başka bir işlemle değişti. Düzenleyiciyi yeniden açın.',
        )
      this.assertEditable(listing)
      const definition = this.assertProvider(
        await this.integrations.connection(auth.workspaceId, listing.storeId, tx),
      )
      if (definition.immutableMainId) {
        if (
          input.config.productMainId &&
          input.config.productMainId !== listing.publishConfig?.productMainId
        )
          throw new AppError(
            409,
            'PARENT_ID_IMMUTABLE',
            'PttAVM üst ürün kimliği oluşturulduktan sonra değiştirilemez.',
          )
        input.config.productMainId = listing.publishConfig?.productMainId
      }
      listing.publishConfig = input.config
      listing.version = (listing.version ?? 0) + 1
      listing.updatedAt = new Date().toISOString()
      listing.publication = { phase: 'draft' }
      listing.error = undefined
      if (input.config.asin) listing.asin = input.config.asin
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'listing.draft_saved', id, {
        version: listing.version,
      })
    })
    return this.detail(auth, id)
  }
  private assertEditable(listing: Listing) {
    if (listing.externalId)
      throw new AppError(
        409,
        'REMOTE_LISTING_EXISTS',
        'İlan platformda mevcut. Bu ekran yeni ürün gönderimi içindir; mevcut içerik yeniden oluşturulmaz.',
      )
    if (listing.publication && !['draft', 'rejected'].includes(listing.publication.phase))
      throw new AppError(
        409,
        'PUBLICATION_IN_PROGRESS',
        'Gönderim veya platform incelemesi sürüyor. Önce mevcut işlemin sonucunu doğrulayın.',
      )
  }
  resolve(state: AppState, listing: Listing, connection: ConnectionRow): PreparedListing {
    const found = findVariant(state, listing.variantId)
    if (!found || found.product.id !== listing.productId)
      throw new AppError(409, 'MAPPING_INVALID', 'Yerel ürün ve varyant ilişkisi geçersiz.')
    const mapping = categoryMappingFor(state, connection.id, listing.channel, found.product)
    const defaults = catalogDefaults(state, listing, found.product, found.variant)
    const own = listing.publishConfig ?? { attributes: {} }
    const compatibleMapping =
      !own.categoryId || own.categoryId === mapping?.categoryId ? mapping : undefined
    const config: PublishConfig = {
      ...(found.product.origin ? { origin: found.product.origin } : {}),
      ...(found.product.dimensions?.desi !== undefined
        ? { dimensionalWeight: found.product.dimensions.desi }
        : {}),
      ...defaults,
      ...own,
      attributes: { ...compatibleMapping?.attributes, ...defaults.attributes, ...own.attributes },
    }
    const groupFingerprint = sha256(
      canonicalJson(
        state.listings
          .filter((l) => l.storeId === listing.storeId && l.productId === listing.productId)
          .map((l) => {
            const own = l.publishConfig ?? { attributes: {} }
            const variant = found.product.variants.find((variant) => variant.id === l.variantId)
            const inherited = variant
              ? catalogDefaults(state, l, found.product, variant)
              : { attributes: {} }
            const common =
              !own.categoryId || own.categoryId === mapping?.categoryId ? mapping : undefined
            return {
              id: l.id,
              categoryId: own.categoryId ?? mapping?.categoryId,
              mainId: own.productMainId || found.product.id,
              attributes: Object.fromEntries(
                Object.entries({
                  ...common?.attributes,
                  ...inherited.attributes,
                  ...own.attributes,
                }).map(([id, choice]) => [
                  id,
                  {
                    customValue: choice.customValue ?? '',
                    valueIds: [...(choice.valueIds ?? [])].sort(),
                    textLength: choice.textLength,
                  },
                ]),
              ),
            }
          })
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    )
    return {
      groupFingerprint,
      listing,
      product: found.product,
      variant: found.variant,
      config,
      title: config.title?.trim() || listing.titleOverride || found.product.name,
      description: config.description?.trim() || found.product.description,
      images:
        config.images ??
        imagesForVariant(
          found.product,
          supportsPublishing(connection.provider) &&
            publicationDefinitions[connection.provider].grouped
            ? undefined
            : found.variant,
        ),
      price: listingPrice(state, listing),
      listPrice: listingListPrice(state, listing),
      quantity: listingQuantity(
        state,
        listing,
        connection.settings.stockBuffer,
        storeWarehouseIds(state, connection.settings),
      ),
    }
  }
  fingerprint(item: PreparedListing) {
    return sha256(
      canonicalJson({
        listingVersion: item.listing.version,
        productVersion: item.product.version,
        sku: item.variant.sku,
        barcode: item.variant.barcode,
        active: item.product.active,
        title: item.title,
        description: item.description,
        images: item.images,
        price: item.price,
        listPrice: item.listPrice,
        quantity: item.quantity,
        taxRate: item.product.taxRate,
        config: item.config,
        groupFingerprint: item.groupFingerprint,
      }),
    )
  }
  groupListings(state: AppState, listing: Listing) {
    const key = listing.publishConfig?.productMainId || listing.productId
    return state.listings
      .filter(
        (item) =>
          item.storeId === listing.storeId &&
          (item.publishConfig?.productMainId || item.productId) === key,
      )
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  planFingerprint(state: AppState, plan: PublicationPlan, connection: ConnectionRow) {
    const listing = state.listings.find(
      (item) => item.id === plan.listingId && item.storeId === connection.id,
    )
    if (!listing) return ''
    if (!plan.group) return this.fingerprint(this.resolve(state, listing, connection))
    const current = this.groupListings(state, listing)
    if (
      current.length !== plan.group.length ||
      current.some((item) => !plan.group!.some((member) => member.listingId === item.id))
    )
      return ''
    return sha256(
      canonicalJson(
        current.map((item) => [item.id, this.fingerprint(this.resolve(state, item, connection))]),
      ),
    )
  }
  private async groupPreview(auth: AuthContext, id: string): Promise<PublishPreview> {
    const state = (await this.state(auth.workspaceId)).document,
      listing = state.listings.find((item) => item.id === id)!
    const connection = await this.integrations.connection(auth.workspaceId, listing.storeId)
    const adapter = publisher(connection.provider, new ProviderHttp(this.integrations.fetcher))
    if (!adapter.combine)
      throw new AppError(
        409,
        'GROUP_UNAVAILABLE',
        'Üst ürün yayın akışı bu sağlayıcıda tanımlı değil.',
      )
    const members = this.groupListings(state, listing)
    for (const member of members) this.assertEditable(member)
    const plans: PublicationPlan[] = []
    let primary: PublishPreview | undefined
    for (const member of members) {
      const preview = await this.preview(auth, member.id, true)
      if (member.id === id) primary = preview
      const cached = (
        await this.db.query<{ document: StoredPreview }>(
          'SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3',
          [auth.workspaceId, connection.id, `preview:${preview.id}`],
        )
      ).rows[0]?.document
      if (!cached || cached.credentialVersion !== connection.credential_version)
        throw new AppError(409, 'GROUP_CHANGED', 'Varyant doğrulaması sırasında kaynak değişti.')
      plans.push(cached.plan)
    }
    const selected = plans.find((plan) => plan.listingId === id)!
    const plan: PublicationPlan = {
      ...selected,
      group: plans,
      body: await adapter.combine(this.context(connection, state), plans),
      snapshotHash: sha256(canonicalJson(plans.map((plan) => [plan.listingId, plan.snapshotHash]))),
    }
    const latest = (await this.state(auth.workspaceId)).document
    if (this.planFingerprint(latest, plan, connection) !== plan.snapshotHash)
      throw new AppError(
        409,
        'GROUP_CHANGED',
        'Grup önizlenirken ürün, stok veya fiyat değişti. Tekrar önizleyin.',
      )
    const previewId = randomUUID(),
      expiresAt = new Date(Date.now() + 10 * 60000).toISOString()
    await this.db.query(
      'INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at) VALUES($1,$2,$3,$4,$5)',
      [
        auth.workspaceId,
        connection.id,
        `preview:${previewId}`,
        JSON.stringify({ plan, credentialVersion: connection.credential_version, expiresAt }),
        expiresAt,
      ],
    )
    return {
      ...primary!,
      id: previewId,
      body: plan.body,
      expiresAt,
      members: plans.map((plan) => ({
        listingId: plan.listingId,
        sku: plan.sku,
        barcode: plan.barcode,
        price: plan.price,
        quantity: plan.quantity,
      })),
      warnings: [
        ...(primary?.warnings ?? []),
        `${plans.length} varyant aynı üst ürün altında birlikte gönderilecek.`,
      ],
    }
  }
  async preview(auth: AuthContext, id: string, memberOnly = false): Promise<PublishPreview> {
    const state = (await this.state(auth.workspaceId)).document,
      listing = state.listings.find((l) => l.id === id)
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'İlan bulunamadı.')
    this.assertEditable(listing)
    const connection = await this.integrations.connection(auth.workspaceId, listing.storeId),
      definition = this.assertProvider(connection)
    if (definition.grouped && !memberOnly) return this.groupPreview(auth, id)
    if (connection.status !== 'verified')
      throw new AppError(409, 'TEST_REQUIRED', 'Mağaza API erişimi önce doğrulanmalı.')
    const item = this.resolve(state, listing, connection),
      snapshotHash = this.fingerprint(item),
      context = this.context(connection, state)
    const adapter = publisher(connection.provider, new ProviderHttp(this.integrations.fetcher)),
      metadata = new CatalogMetadata(this.db, adapter, connection.credential_version)
    if (connection.provider === 'n11') {
      if (!item.config.shipmentTemplate)
        failField('Teslimat şablonu', 'Mağazanın teslimat şablonunu seçin.')
      const template = await metadata.get(context, {
        resource: 'shipmentTemplates',
        query: item.config.shipmentTemplate,
      })
      if (!template.options?.some((option) => option.name === item.config.shipmentTemplate))
        failField('Teslimat şablonu', 'Seçim bu n11 mağazasında bulunamadı.')
    }
    if (!item.product.active) failField('Ürün', 'Pasif ürün gönderilemez.')
    if (!Number.isSafeInteger(item.price) || item.price <= 0 || item.price > 1_000_000_000)
      failField('Fiyat', 'Pozitif ve geçerli mağaza fiyatı gerekli.')
    if (![0, 1, 10, 20].includes(item.product.taxRate))
      failField('KDV', '0, 1, 10 veya 20 oranını seçin.')
    if (!item.variant.sku.trim() || item.variant.sku.length > 100)
      failField('SKU', '1–100 karakter kullanın.')
    let schema: CategorySchema | null = null
    const resolvedAttributes: PublicationPlan['attributes'] = []
    if (definition.mode === 'product') {
      if (!item.title || item.title.length > definition.maxTitle)
        failField('Başlık', `1–${definition.maxTitle} karakter kullanın.`)
      if (!item.description?.trim()) failField('Açıklama', 'Ürün açıklamasını tamamlayın.')
      if (item.images.length < 1 || item.images.length > definition.maxImages)
        failField('Görseller', `1–${definition.maxImages} görsel gerekli.`)
      for (const image of item.images) {
        let url: URL
        try {
          url = new URL(image)
        } catch {
          failField('Görseller', 'Geçerli HTTPS görsel adresleri kullanın.')
        }
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )
          failField('Görseller', 'Pazaryerinin erişebildiği HTTPS adresleri kullanın.')
      }
      if (
        item.variant.barcode.length > definition.maxBarcode ||
        (connection.provider === 'trendyol' && !/^[\p{L}\p{N}._-]+$/u.test(item.variant.barcode))
      )
        failField(
          'Barkod',
          `Geçerli, boşluksuz barkod girin (en fazla ${definition.maxBarcode} karakter).`,
        )
      if ((item.config.productMainId || item.product.id).length > definition.maxMainId)
        failField('Model kodu', `En fazla ${definition.maxMainId} karakter girin.`)
      const categories = await metadata.get(context, { resource: 'categories' })
      const category = categories.options?.find((option) => option.id === item.config.categoryId)
      if (!category?.leaf) failField('Kategori', 'Sağlayıcının son seviye kategorisini seçin.')
      schema =
        (await metadata.get(context, { resource: 'attributes', categoryId: category.id })).schema ??
        null
      if (!schema) failField('Kategori', 'Özellik şeması alınamadı.')
      item.config.categoryName = category.path || category.name
      for (const [attributeId, selection] of Object.entries(item.config.attributes)) {
        const attribute = schema.attributes.find((a) => a.id === attributeId)
        if (!attribute) failField('Özellik', `${attributeId} seçilen kategoriye ait değil.`)
        if (selection.textLength !== undefined && !attribute.personalization)
          failField(
            attribute.name,
            'Karakter sınırı yalnız kişiselleştirme alanlarında kullanılabilir.',
          )
        if (attribute.personalization && (selection.valueIds?.length || selection.customValue))
          failField(attribute.name, 'Bu alan için karakter sınırı girin.')
        if (selection.customValue) {
          if (!attribute.allowCustom) failField(attribute.name, 'Serbest metin kabul edilmiyor.')
        } else if (selection.valueIds?.length) {
          if (!attribute.multiple && selection.valueIds.length > 1)
            failField(attribute.name, 'Tek değer seçin.')
          if (new Set(selection.valueIds).size !== selection.valueIds.length)
            failField(attribute.name, 'Aynı değer tekrar seçilemez.')
          const labels: string[] = []
          for (const valueId of selection.valueIds) {
            let value = await metadata.findValue(context, category.id, attribute.id, valueId)
            if (!value) {
              await metadata.get(context, {
                resource: 'values',
                categoryId: category.id,
                attributeId: attribute.id,
                ...(connection.provider === 'trendyol' ? { page: 0 } : {}),
              })
              value = await metadata.findValue(context, category.id, attribute.id, valueId)
            }
            if (!value) failField(attribute.name, 'Değer doğrulanamadı; listeden yeniden seçin.')
            labels.push(value.name)
          }
          selection.labels = labels
        }
      }
      for (const attribute of schema.attributes) {
        const choice = item.config.attributes[attribute.id]
        if (
          attribute.required &&
          !choice?.customValue &&
          !choice?.valueIds?.length &&
          !choice?.textLength
        )
          failField(attribute.name, 'Bu özellik zorunlu.')
        if (choice?.customValue || choice?.valueIds?.length || choice?.textLength)
          resolvedAttributes.push({
            name: attribute.name,
            value:
              choice.customValue ||
              choice.labels?.join(', ') ||
              (choice.textLength ? `${choice.textLength} karakter` : ''),
            source: Object.hasOwn(listing.publishConfig?.attributes ?? {}, attribute.id)
              ? 'listing'
              : 'mapping',
          })
      }
      const axes = schema.attributes.filter((a) => a.variant || a.slicer).map((a) => a.id)
      const siblings = state.listings.filter(
        (l) =>
          l.storeId === listing.storeId && l.productId === listing.productId && l.id !== listing.id,
      )
      const hasAxis = (config: PublishConfig) =>
        axes.some(
          (id) => config.attributes[id]?.customValue || config.attributes[id]?.valueIds?.length,
        )
      const axisKey = (config: PublishConfig) =>
        canonicalJson(
          Object.fromEntries(
            axes.map((id) => [
              id,
              {
                custom: config.attributes[id]?.customValue ?? '',
                ids: [...(config.attributes[id]?.valueIds ?? [])].sort(),
              },
            ]),
          ),
        )
      if (siblings.length && axes.length) {
        if (!hasAxis(item.config))
          failField(
            'Varyant',
            'Ortak modeldeki varyant için en az bir varyant/dilimleyici özellik seçin.',
          )
        for (const sibling of siblings) {
          const other = this.resolve(state, sibling, connection).config
          if (
            other.categoryId === item.config.categoryId &&
            (other.productMainId || item.product.id) ===
              (item.config.productMainId || item.product.id) &&
            hasAxis(other) &&
            axisKey(other) === axisKey(item.config)
          )
            failField(
              'Varyant',
              'Aynı modelde iki stok kodu aynı varyant özelliklerine sahip olamaz.',
            )
        }
      }
      if (['trendyol', 'pazarama', 'toptantr'].includes(connection.provider)) {
        let brand = await metadata.findOption(
          context,
          { resource: 'brands' },
          item.config.brandId ?? '',
        )
        if (!brand) {
          await metadata.get(context, {
            resource: 'brands',
            query: item.config.brandName || item.product.brand,
          })
          brand = await metadata.findOption(
            context,
            { resource: 'brands' },
            item.config.brandId ?? '',
          )
        }
        if (!brand && connection.provider === 'toptantr') {
          let previous = ''
          for (let page = 1; page < 500 && !brand; page++) {
            const result = await metadata.get(context, { resource: 'brands', page })
            const signature = (result.options ?? []).map((option) => option.id).join('|')
            if (signature && signature === previous)
              throw new AppError(422, 'METADATA_PAGING', 'ToptanTR marka sayfası ilerlemiyor.')
            previous = signature
            brand = await metadata.findOption(
              context,
              { resource: 'brands' },
              item.config.brandId ?? '',
            )
            if (!result.hasMore) break
          }
        }
        if (!brand) failField('Marka', `${definition.name} marka aramasından geçerli marka seçin.`)
        item.config.brandName = brand.name
      }
    } else {
      const result = await metadata.get(context, { resource: 'asin', query: item.config.asin })
      const asin = result.options?.find((o) => o.id === item.config.asin)
      if (!asin) failField('ASIN', 'Türkiye kataloğunda doğrulanmış ASIN seçin.')
      item.title = asin.name
    }
    const plan: PublicationPlan = {
      listingId: listing.id,
      productId: item.product.id,
      provider: definition.provider,
      version: listing.version ?? 0,
      snapshotHash,
      title: item.title,
      description: item.description,
      images: item.images,
      sku: item.variant.sku,
      barcode: item.variant.barcode,
      price: item.price,
      listPrice: item.listPrice,
      quantity: item.quantity,
      categoryName: item.config.categoryName,
      config: item.config,
      body: adapter.build(context, item, schema),
      attributes: resolvedAttributes,
    }
    const previewId = randomUUID(),
      expiresAt = new Date(Date.now() + 10 * 60000).toISOString()
    await this.db.query(
      'INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at) VALUES($1,$2,$3,$4,$5)',
      [
        auth.workspaceId,
        connection.id,
        `preview:${previewId}`,
        JSON.stringify({
          plan,
          credentialVersion: connection.credential_version,
          expiresAt,
        } satisfies StoredPreview),
        expiresAt,
      ],
    )
    return {
      id: previewId,
      listingId: id,
      provider: definition.provider,
      title: plan.title,
      sku: plan.sku,
      barcode: plan.barcode,
      price: plan.price,
      listPrice: plan.listPrice,
      quantity: plan.quantity,
      categoryName: plan.categoryName,
      attributes: resolvedAttributes,
      body: plan.body,
      expiresAt,
      warnings: item.quantity === 0 ? ['Gönderim sıfır stokla yapılacak.'] : [],
    }
  }
  async publish(auth: AuthContext, id: string, previewId: string, key: string) {
    const hash = sha256(canonicalJson({ id, previewId }))
    return this.db.transaction(async (tx) => {
      const row = await this.state(auth.workspaceId, tx, true)
      const previous = (
        await tx.query<{
          body_hash: string
          user_id: string
          result: { ok: boolean; jobId: string }
        }>(
          'SELECT body_hash,user_id,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
          [auth.workspaceId, key],
        )
      ).rows[0]
      if (previous) {
        if (previous.user_id !== auth.userId || previous.body_hash !== hash)
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'İstek anahtarı başka bir yayın önizlemesine ait.',
          )
        return previous.result
      }
      const listing = row.document.listings.find((l) => l.id === id)
      if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'İlan bulunamadı.')
      this.assertEditable(listing)
      const connection = await this.integrations.connection(auth.workspaceId, listing.storeId, tx)
      this.assertProvider(connection)
      if (!connection.enabled || connection.status !== 'verified')
        throw new AppError(
          409,
          'CONNECTION_NOT_READY',
          'Test edilmiş mağaza bağlantısını etkinleştirin.',
        )
      const cached = (
        await tx.query<{ document: StoredPreview }>(
          `SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()`,
          [auth.workspaceId, listing.storeId, `preview:${previewId}`],
        )
      ).rows[0]?.document
      if (!cached || cached.plan.listingId !== id)
        throw new AppError(
          409,
          'PREVIEW_EXPIRED',
          'Önizleme bulunamadı veya süresi doldu; yeniden oluşturun.',
        )
      if (
        cached.credentialVersion !== connection.credential_version ||
        cached.plan.snapshotHash !== this.planFingerprint(row.document, cached.plan, connection)
      )
        throw new AppError(
          409,
          'PREVIEW_STALE',
          'Ürün, stok, fiyat, eşleme veya bağlantı değişti. Önizlemeyi yenileyin.',
        )
      if (this.assertProvider(connection).grouped && !cached.plan.group)
        throw new AppError(
          409,
          'GROUP_REQUIRED',
          'Bu sağlayıcıda tüm üst ürün grubu birlikte önizlenmeli.',
        )
      for (const member of cached.plan.group ?? []) {
        const current = row.document.listings.find(
          (item) => item.id === member.listingId && item.storeId === listing.storeId,
        )
        if (!current) throw new AppError(409, 'GROUP_CHANGED', 'Grup üyesi bulunamadı.')
        this.assertEditable(current)
      }
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: 'listing.publish',
        entityId: listing.id,
        payload: { plan: cached.plan },
        key: `publish:${listing.id}:${previewId}`,
      })
      listing.publication = { phase: 'queued', jobId, message: 'Gönderim kuyruğa alındı.' }
      for (const member of cached.plan.group ?? []) {
        const current = row.document.listings.find((item) => item.id === member.listingId)!
        current.publication = {
          phase: 'queued',
          jobId,
          message: 'Üst ürün grubuyla birlikte sıraya alındı.',
        }
        current.syncStatus = 'queued'
        current.error = undefined
      }
      listing.syncStatus = 'queued'
      listing.error = undefined
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      const result = { ok: true, jobId }
      await tx.query(
        `INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision) SELECT $1,$2,$3,'listing.publish',$4,$5,revision FROM workspace_states WHERE workspace_id=$1`,
        [auth.workspaceId, key, auth.userId, hash, JSON.stringify(result)],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'listing.publish_queued', listing.id, {
        jobId,
        previewId,
      })
      return result
    })
  }
  async saveMapping(auth: AuthContext, raw: unknown) {
    const input = z
      .strictObject({
        id: uuid,
        version: z.number().int().nonnegative(),
        storeId: uuid,
        localCategory: z.string().trim().min(1).max(300),
        categoryId: catalogIdSchema,
        attributes: attributeMapSchema,
        shared: z.boolean().optional(),
        localCategoryId: identifier.optional(),
        commissionBps: z.number().int().min(0).max(9999).optional(),
      })
      .parse(raw)
    const connection = await this.integrations.connection(auth.workspaceId, input.storeId),
      definition = this.assertProvider(connection)
    if (definition.mode !== 'product')
      throw new AppError(
        409,
        'OFFER_ONLY',
        'Amazon mevcut ASIN’e teklif kullanır; kategori eşleme gerekmez.',
      )
    if (connection.status !== 'verified')
      throw new AppError(409, 'TEST_REQUIRED', 'Önce mağaza bağlantısını test edin.')
    const state = (await this.state(auth.workspaceId)).document,
      context = this.context(connection, state),
      adapter = publisher(connection.provider, new ProviderHttp(this.integrations.fetcher)),
      metadata = new CatalogMetadata(this.db, adapter, connection.credential_version)
    const category = (await metadata.get(context, { resource: 'categories' })).options?.find(
      (c) => c.id === input.categoryId,
    )
    if (!category?.leaf) failField('Kategori', 'Son seviye kategori seçin.')
    const schema = (
      await metadata.get(context, { resource: 'attributes', categoryId: input.categoryId })
    ).schema!
    for (const id of Object.keys(input.attributes)) {
      const field = schema.attributes.find((a) => a.id === id)
      if (!field || field.variant || field.slicer || field.personalization)
        failField('Özellik', 'Varyant ve dilimleyici özellikler ilan üzerinde seçilir.')
      const selection = input.attributes[id]
      if (selection.customValue && !field.allowCustom)
        failField(field.name, 'Bu özellik liste değeri gerektirir.')
      if (!field.multiple && (selection.valueIds?.length ?? 0) > 1)
        failField(field.name, 'Tek değer seçin.')
      for (const valueId of selection.valueIds ?? [])
        if (!(await metadata.findValue(context, category.id, field.id, valueId)))
          failField(field.name, 'Özellik değeri sağlayıcıda bulunamadı.')
    }
    await this.db.transaction(async (tx) => {
      const row = await this.state(auth.workspaceId, tx, true),
        old = row.document.categoryMappings?.find((m) => m.id === input.id)
      if ((old?.version ?? 0) !== input.version)
        throw new AppError(409, 'MAPPING_CHANGED', 'Eşleme değişti; güncel kaydı açın.')
      const currentConnection = await this.integrations.connection(
        auth.workspaceId,
        input.storeId,
        tx,
      )
      if (
        currentConnection.credential_version !== connection.credential_version ||
        currentConnection.status !== 'verified'
      )
        throw new AppError(
          409,
          'CONNECTION_CHANGED',
          'Bağlantı değişti. Eşlemeyi tekrar doğrulayın.',
        )
      const local = input.localCategoryId
        ? row.document.definitions?.find(
            (item) => item.kind === 'category' && item.id === input.localCategoryId,
          )
        : undefined
      if (input.localCategoryId && !local)
        throw new AppError(409, 'CATEGORY_CHANGED', 'Yerel kategori silindi veya değişti.')
      const localCategory = local
        ? categoryPath(row.document.definitions ?? [], local)
        : input.localCategory
      if (
        row.document.categoryMappings?.some(
          (m) =>
            m.id !== input.id &&
            (input.shared
              ? m.provider === connection.provider
              : !m.provider && m.storeId === input.storeId) &&
            m.localCategory === localCategory,
        )
      )
        throw new AppError(
          409,
          'MAPPING_EXISTS',
          'Bu mağaza ve yerel kategori için eşleme zaten var.',
        )
      const mapping: CategoryMapping = {
        ...input,
        ...(input.shared ? { provider: connection.provider as Listing['channel'] } : {}),
        localCategory,
        categoryName: category.path || category.name,
        version: input.version + 1,
        updatedAt: new Date().toISOString(),
      }
      delete (mapping as CategoryMapping & { shared?: boolean }).shared
      row.document.categoryMappings = [
        ...(row.document.categoryMappings ?? []).filter((m) => m.id !== input.id),
        mapping,
      ]
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'catalog.mapping_saved', input.id, {
        storeId: input.storeId,
      })
    })
    return { ok: true }
  }
}

export function registerPublishingRoutes(app: FastifyInstance, integrations: IntegrationService) {
  const service = new PublicationService(integrations)
  const call = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ProviderError)
        throw new AppError(error.code === 'AUTH_REJECTED' ? 409 : 502, error.code, error.message)
      throw error
    }
  }
  app.get('/api/publishing/definitions', async (request) => {
    requirePermission(request, 'catalog.write')
    return { definitions: Object.values(publicationDefinitions) }
  })
  app.get('/api/publishing/:connectionId/metadata', async (request) =>
    call(() =>
      service.metadata(
        requirePermission(request, 'catalog.write'),
        uuid.parse((request.params as { connectionId: string }).connectionId),
        request.query,
      ),
    ),
  )
  app.post('/api/listing-drafts', async (request, reply) =>
    reply
      .code(201)
      .send(await service.create(requirePermission(request, 'catalog.write'), request.body)),
  )
  app.get('/api/listing-drafts/:id', async (request) =>
    service.detail(
      requirePermission(request, 'catalog.write'),
      identifier.parse((request.params as { id: string }).id),
    ),
  )
  app.patch('/api/listing-drafts/:id', async (request) =>
    service.save(
      requirePermission(request, 'catalog.write'),
      identifier.parse((request.params as { id: string }).id),
      request.body,
    ),
  )
  app.post('/api/listing-drafts/:id/preview', async (request) =>
    call(() =>
      service.preview(
        requirePermission(request, 'catalog.write'),
        identifier.parse((request.params as { id: string }).id),
      ),
    ),
  )
  app.post('/api/listing-drafts/:id/publish', async (request, reply) => {
    const { previewId } = z.strictObject({ previewId: uuid }).parse(request.body)
    return reply
      .code(202)
      .send(
        await service.publish(
          requirePermission(request, 'catalog.write'),
          identifier.parse((request.params as { id: string }).id),
          previewId,
          uuid.parse(request.headers['idempotency-key']),
        ),
      )
  })
  app.post('/api/listing-drafts/:id/status', async (request, reply) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = identifier.parse((request.params as { id: string }).id)
    const key = uuid.parse(request.headers['idempotency-key'])
    const row = await service.state(auth.workspaceId),
      listing = row.document.listings.find((l) => l.id === id)
    if (
      !listing?.publication?.jobId ||
      (!listing.publication.reference && !listing.publication.reconciledByIdentity)
    )
      throw new AppError(409, 'NO_PUBLICATION', 'Sorgulanacak yayın gönderimi bulunamadı.')
    const source = (
      await integrations.database.query<{ payload: { plan: PublicationPlan } }>(
        `SELECT payload FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND connection_id=$3 AND kind='listing.publish'`,
        [auth.workspaceId, listing.publication.jobId, listing.storeId],
      )
    ).rows[0]
    if (!source) throw new AppError(404, 'PUBLICATION_NOT_FOUND', 'Yayın işlemi bulunamadı.')
    const jobId = await enqueue(integrations.database, {
      workspaceId: auth.workspaceId,
      connectionId: listing.storeId,
      kind: 'listing.status',
      entityId: id,
      payload: {
        plan: source.payload.plan,
        reference: listing.publication.reference ?? '',
        polls: 0,
        sourceJobId: listing.publication.jobId,
        phase: listing.publication.phase === 'submitted' ? 'batch' : 'approval',
        ...(listing.publication.reconciledByIdentity ? { reconcile: true, phase: 'approval' } : {}),
      },
      key: `listing.status:${id}:${key}`,
    })
    return reply.code(202).send({ ok: true, jobId })
  })
  app.post('/api/listing-drafts/:id/reconcile', async (request, reply) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = identifier.parse((request.params as { id: string }).id),
      key = uuid.parse(request.headers['idempotency-key'])
    const row = await service.state(auth.workspaceId),
      listing = row.document.listings.find((l) => l.id === id)
    if (listing?.publication?.phase !== 'uncertain' || !listing.publication.jobId)
      throw new AppError(
        409,
        'RECONCILIATION_NOT_REQUIRED',
        'Bu ilanda sonucu belirsiz yayın işlemi yok.',
      )
    const source = (
      await integrations.database.query<{ payload: { plan: PublicationPlan } }>(
        `SELECT payload FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND connection_id=$3 AND kind='listing.publish'`,
        [auth.workspaceId, listing.publication.jobId, listing.storeId],
      )
    ).rows[0]
    if (!source) throw new AppError(404, 'PUBLICATION_NOT_FOUND', 'İlk gönderim kaydı bulunamadı.')
    const jobId = await enqueue(integrations.database, {
      workspaceId: auth.workspaceId,
      connectionId: listing.storeId,
      kind: 'listing.status',
      entityId: id,
      payload: {
        plan: source.payload.plan,
        reference: listing.publication.reference ?? '',
        reconcile: true,
        phase: 'approval',
        polls: 0,
        sourceJobId: listing.publication.jobId,
      },
      key: `reconcile:${listing.id}:${key}`,
    })
    await audit(
      integrations.database,
      auth.workspaceId,
      auth.userId,
      'listing.reconciliation_requested',
      id,
      { jobId },
    )
    return reply.code(202).send({ ok: true, jobId })
  })
  app.post('/api/catalog-mappings', async (request) =>
    call(() => service.saveMapping(requirePermission(request, 'catalog.write'), request.body)),
  )
}
