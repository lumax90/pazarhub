import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState } from '../../src/domain/types'
import { contentDefinitions } from '../../src/domain/listing-content'
import type { ListingContentFields } from '../../src/domain/listing-content'
import { publicationDefinitions, supportsPublishing } from '../../src/domain/publishing'
import type { IntegrationService, ConnectionRow } from '../integration-service'
import type { AdapterContext } from '../integrations/contracts'
import { ProviderHttp } from '../integrations/http'
import { imagesForVariant } from '../../src/domain/product-images'
import { ListingContentAdapter } from './adapters'
import { contentLocalKey } from './contracts'
import type { ContentPlan, ContentSource } from './contracts'
import { requirePermission, audit } from '../auth'
import { identifier, uuid } from '../validation'
import { AppError } from '../errors'
import { canonicalJson, sha256 } from '../security'
import { enqueue } from '../jobs'
import type { StoredJob } from '../jobs'

export function registerListingContent(app: FastifyInstance, service: IntegrationService) {
  const db = service.database,
    context = (connection: ConnectionRow, state: AppState): AdapterContext => ({
      connectionId: connection.id,
      workspaceId: connection.workspace_id,
      provider: connection.provider,
      credentials: service.credentials(connection),
      settings: connection.settings,
      state,
      integrationName: service.config.integrationName,
    })
  app.get('/api/listing-content/:id', async (request) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = identifier.parse((request.params as { id: string }).id),
      row = (
        await db.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1',
          [auth.workspaceId],
        )
      ).rows[0],
      listing = row.document.listings.find((item) => item.id === id)
    if (!listing?.externalId)
      throw new AppError(404, 'LISTING_REQUIRED', 'Mevcut pazaryeri ilanı bulunamadı.')
    const definition = contentDefinitions[listing.channel]
    if (!definition)
      throw new AppError(
        409,
        'CONTENT_UNAVAILABLE',
        'Bu sağlayıcının katalog içeriği bu API ile değiştirilemiyor.',
      )
    const connection = await service.connection(auth.workspaceId, listing.storeId)
    if (!connection.enabled || connection.status !== 'verified')
      throw new AppError(409, 'CONNECTION_NOT_READY', 'Mağazayı test edip etkinleştirin.')
    const cacheKey = `content-source:${id}:${connection.credential_version}`
    let cached = (
      await db.query<{ document: { source: ContentSource; sourceId: string; fetchedAt: string } }>(
        'SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()',
        [auth.workspaceId, connection.id, cacheKey],
      )
    ).rows[0]?.document
    if (
      !cached ||
      (connection.provider !== 'ciceksepeti' &&
        (request.query as { refresh?: string }).refresh === '1')
    ) {
      cached = {
        source: await new ListingContentAdapter(new ProviderHttp(service.fetcher)).read(
          context(connection, row.document),
          listing,
        ),
        sourceId: randomUUID(),
        fetchedAt: new Date().toISOString(),
      }
      await db.query(
        "INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes') ON CONFLICT(workspace_id,connection_id,cache_key) DO UPDATE SET document=EXCLUDED.document,expires_at=EXCLUDED.expires_at",
        [auth.workspaceId, connection.id, cacheKey, JSON.stringify(cached)],
      )
    }
    const product = row.document.products.find((product) => product.id === listing.productId)!
    return {
      sourceId: cached.sourceId,
      fetchedAt: cached.fetchedAt,
      current: cached.source.fields,
      members: cached.source.members,
      definition,
      listing,
      defaults: {
        title: listing.titleOverride || product.name,
        description: listing.publishConfig?.description ?? product.description,
        images:
          listing.publishConfig?.images ??
          imagesForVariant(
            product,
            supportsPublishing(listing.channel) && publicationDefinitions[listing.channel].grouped
              ? undefined
              : product.variants.find((variant) => variant.id === listing.variantId),
          ),
      } satisfies ListingContentFields,
    }
  })
  app.post('/api/listing-content/:id/preview', async (request) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = identifier.parse((request.params as { id: string }).id)
    const input = z
      .strictObject({
        sourceId: uuid,
        changes: z.strictObject({
          title: z.string().trim().min(2).max(300).optional(),
          description: z.string().min(1).max(30000).optional(),
          images: z
            .array(z.url().refine((url) => url.startsWith('https://')))
            .min(1)
            .max(12)
            .optional(),
        }),
      })
      .parse(request.body)
    const row = (
        await db.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1',
          [auth.workspaceId],
        )
      ).rows[0],
      listing = row.document.listings.find((item) => item.id === id)
    if (!listing?.externalId) throw new AppError(404, 'LISTING_REQUIRED', 'Mevcut ilan bulunamadı.')
    const definition = contentDefinitions[listing.channel],
      connection = await service.connection(auth.workspaceId, listing.storeId)
    if (
      !definition ||
      Object.keys(input.changes).some(
        (key) => !definition.fields.includes(key as keyof ListingContentFields),
      )
    )
      throw new AppError(
        422,
        'CONTENT_FIELD_UNSUPPORTED',
        'Bu sağlayıcı seçilen içerik alanını güncellemiyor.',
      )
    if (input.changes.images && input.changes.images.length > definition.maxImages)
      throw new AppError(422, 'IMAGE_LIMIT', 'Sağlayıcının görsel sayısı sınırı aşıldı.')
    if (
      input.changes.title &&
      supportsPublishing(listing.channel) &&
      input.changes.title.length > publicationDefinitions[listing.channel].maxTitle
    )
      throw new AppError(422, 'TITLE_LIMIT', 'Sağlayıcı başlık uzunluğu sınırı aşıldı.')
    if (
      listing.channel === 'ciceksepeti' &&
      input.changes.description &&
      (input.changes.description.replace(/<[^>]*>/g, '').trim().length < 30 ||
        input.changes.description.length > 20000)
    )
      throw new AppError(
        422,
        'DESCRIPTION_INVALID',
        'Çiçeksepeti açıklaması en az 30 düz metin, en fazla 20.000 toplam karakter olmalı.',
      )
    const source = (
      await db.query<{ document: { source: ContentSource; sourceId: string } }>(
        'SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()',
        [auth.workspaceId, connection.id, `content-source:${id}:${connection.credential_version}`],
      )
    ).rows[0]?.document
    if (!source || source.sourceId !== input.sourceId)
      throw new AppError(409, 'CONTENT_SOURCE_EXPIRED', 'Pazaryeri kaydını yeniden açın.')
    const changes = Object.fromEntries(
      Object.entries(input.changes).filter(
        ([key, value]) =>
          canonicalJson(value) !==
          canonicalJson(source.source.fields[key as keyof ListingContentFields]),
      ),
    ) as Partial<ListingContentFields>
    if (!Object.keys(changes).length)
      throw new AppError(422, 'NO_CHANGES', 'Pazaryerinden farklı en az bir içerik alanı seçin.')
    const plan: ContentPlan = {
        listingId: id,
        provider: listing.channel,
        localKey: contentLocalKey(row.document, listing),
        source: source.source,
        changes,
        createdAt: new Date().toISOString(),
      },
      previewId = randomUUID()
    await db.query(
      "INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
      [
        auth.workspaceId,
        connection.id,
        `content-preview:${previewId}`,
        JSON.stringify({ plan, credentialVersion: connection.credential_version }),
      ],
    )
    return { previewId, changes, members: source.source.members }
  })
  app.post('/api/listing-content/:id/send', async (request, reply) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = identifier.parse((request.params as { id: string }).id),
      { previewId } = z.strictObject({ previewId: uuid }).parse(request.body),
      key = uuid.parse(request.headers['idempotency-key']),
      hash = sha256(canonicalJson({ id, previewId }))
    const result = await db.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const receipt = (
        await tx.query<{ user_id: string; body_hash: string; result: unknown }>(
          'SELECT user_id,body_hash,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
          [auth.workspaceId, key],
        )
      ).rows[0]
      if (receipt) {
        if (receipt.user_id !== auth.userId || receipt.body_hash !== hash)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'İstek anahtarı başka önizlemeye ait.')
        return receipt.result
      }
      const listing = row.document.listings.find((item) => item.id === id)
      if (!listing?.externalId)
        throw new AppError(404, 'LISTING_REQUIRED', 'Mevcut ilan bulunamadı.')
      const connection = await service.connection(auth.workspaceId, listing.storeId, tx)
      const cached = (
        await tx.query<{ document: { plan: ContentPlan; credentialVersion: number } }>(
          'SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()',
          [auth.workspaceId, connection.id, `content-preview:${previewId}`],
        )
      ).rows[0]?.document
      if (
        !cached ||
        cached.plan.listingId !== id ||
        cached.credentialVersion !== connection.credential_version ||
        cached.plan.localKey !== contentLocalKey(row.document, listing)
      )
        throw new AppError(
          409,
          'CONTENT_STALE',
          'İlan, ürün veya bağlantı değişti. İçeriği yeniden önizleyin.',
        )
      if (
        !connection.enabled ||
        connection.status !== 'verified' ||
        !service.capabilities(connection.provider).includes('listing.content')
      )
        throw new AppError(
          409,
          'CONTENT_UNAVAILABLE',
          'Test edilmiş içerik güncelleme bağlantısı gerekli.',
        )
      const active = await tx.query(
        "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND connection_id=$2 AND payload->'plan'->'source'->>'key'=$3 AND kind IN ('listing.content','listing.content.status') AND status IN ('queued','running','waiting','uncertain')",
        [auth.workspaceId, connection.id, cached.plan.source.key],
      )
      if (active.rows.length)
        throw new AppError(
          409,
          'CONTENT_BUSY',
          'Aynı pazaryeri içeriği için devam eden güncelleme var.',
        )
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: 'listing.content',
        entityId: id,
        payload: { plan: cached.plan },
        key: `content:${id}:${key}`,
        delaySeconds: connection.provider === 'ciceksepeti' ? 601 : 0,
      })
      listing.contentWorkflow = {
        jobId,
        state: 'queued',
        resourceKey: cached.plan.source.key,
        changes: cached.plan.changes,
        message: 'İçerik güncellemesi sıraya alındı.',
      }
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      const result = { ok: true, jobId }
      await tx.query(
        "INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision) SELECT $1,$2,$3,'listing.content',$4,$5,revision FROM workspace_states WHERE workspace_id=$1",
        [auth.workspaceId, key, auth.userId, hash, JSON.stringify(result)],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'listing.content_requested', id, {
        jobId,
        fields: Object.keys(cached.plan.changes),
      })
      return result
    })
    return reply.code(202).send(result)
  })
  app.post('/api/listing-content/:id/check', async (request, reply) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = identifier.parse((request.params as { id: string }).id),
      key = uuid.parse(request.headers['idempotency-key'])
    const result = await db.transaction(async (tx) => {
      const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
            [auth.workspaceId],
          )
        ).rows[0],
        listing = row.document.listings.find((item) => item.id === id)
      if (!listing?.contentWorkflow)
        throw new AppError(404, 'CONTENT_JOB_REQUIRED', 'Sorgulanacak içerik işlemi yok.')
      const source = (
        await tx.query<StoredJob>(
          'SELECT * FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND connection_id=$3',
          [auth.workspaceId, listing.contentWorkflow.jobId, listing.storeId],
        )
      ).rows[0]
      if (!source || source.kind !== 'listing.content')
        throw new AppError(409, 'SOURCE_CHANGED', 'İçerik kaynak işlemi değişti.')
      const pending = (
        await tx.query<{ id: string }>(
          "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind IN ('listing.content','listing.content.status') AND status IN ('queued','running','waiting')",
          [auth.workspaceId, id],
        )
      ).rows[0]
      if (pending) return { ok: true, jobId: pending.id }
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: listing.storeId,
        kind: 'listing.content.status',
        entityId: id,
        payload: {
          plan: source.payload.plan,
          reference: source.payload.reference ?? listing.contentWorkflow.reference ?? '',
          sourceJobId: source.id,
        },
        key: `content-check:${id}:${key}`,
      })
      await audit(tx, auth.workspaceId, auth.userId, 'listing.content_check', id, {
        jobId,
        sourceJobId: source.id,
      })
      return { ok: true, jobId }
    })
    return reply.code(202).send(result)
  })
}
