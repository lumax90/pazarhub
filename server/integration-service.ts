import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { defaultIntegrationSettings, providers } from '../src/domain/integrations'
import type {
  IntegrationOperation,
  IntegrationSettings,
  ProviderId,
  PublicIntegration,
} from '../src/domain/integrations'
import type { AppState } from '../src/domain/types'
import { listingPrice, listingListPrice, listingQuantity } from '../src/domain/selectors'
import { storeWarehouseIds } from '../src/domain/stock-allocation'
import { freshRequestJobs, jobPermission } from '../src/domain/permissions'
import type { AuthContext } from './auth-types'
import { audit, requireAuth, requirePermission, assertPermission } from './auth'
import type { ServerConfig } from './config'
import type { Database, Sql } from './db'
import { AppError } from './errors'
import { ProviderHttp } from './integrations/http'
import { createAdapter } from './integrations/registry'
import type { AdapterFactory } from './integrations/registry'
import { enqueue, publicJob } from './jobs'
import { canonicalJson, sha256, seal, unseal } from './security'
import { connectionInputSchema, uuid } from './validation'

export interface ConnectionRow {
  id: string
  workspace_id: string
  provider: ProviderId
  kind: PublicIntegration['kind']
  name: string
  credentials: string
  settings: IntegrationSettings
  enabled: boolean
  is_default?: boolean
  status: PublicIntegration['status']
  last_test_at: Date | string | null
  last_error: string | null
  created_at: Date | string
  credential_version: number
}

export class IntegrationService {
  constructor(
    readonly database: Database,
    readonly config: ServerConfig,
    readonly factory: AdapterFactory = createAdapter,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  credentials(row: ConnectionRow) {
    return unseal(row.credentials, this.config.encryptionKey, `${row.workspace_id}:${row.id}`)
  }
  capabilities(provider: ProviderId) {
    return this.factory(provider, new ProviderHttp(this.fetcher)).capabilities
  }
  async connection(workspaceId: string, id: string, tx: Sql = this.database) {
    const row = (
      await tx.query<ConnectionRow>(
        'SELECT * FROM integration_connections WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
        [workspaceId, id],
      )
    ).rows[0]
    if (!row) throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Bağlantı bulunamadı.')
    return row
  }
  public(row: ConnectionRow): PublicIntegration {
    const definition = providers.find((provider) => provider.id === row.provider)!
    const credentials = this.credentials(row)
    return {
      id: row.id,
      provider: row.provider,
      kind: row.kind,
      name: row.name,
      enabled: row.enabled,
      isDefault: !!row.is_default,
      status: row.status,
      settings: { ...defaultIntegrationSettings, ...row.settings },
      configuredFields: Object.keys(credentials).filter((key) => !!credentials[key]),
      identity: Object.fromEntries(
        definition.fields
          .filter((field) => !field.secret)
          .map((field) => [field.key, credentials[field.key] ?? '']),
      ),
      capabilities: [...this.capabilities(row.provider)],
      lastTestAt: row.last_test_at ? new Date(row.last_test_at).toISOString() : null,
      lastError: row.last_error,
      createdAt: new Date(row.created_at).toISOString(),
    }
  }
  async save(auth: AuthContext, raw: unknown, existingId?: string, requestKey?: string) {
    const input = connectionInputSchema.parse(raw)
    const definition = providers.find((provider) => provider.id === input.provider)!
    if (input.isDefault && definition.kind !== 'invoice')
      throw new AppError(
        400,
        'DEFAULT_INVOICE_ONLY',
        'Varsayılan seçimi yalnız fatura sağlayıcısı içindir.',
      )
    if (!this.capabilities(definition.id).length)
      throw new AppError(
        409,
        'PROVIDER_NOT_READY',
        'Bu sağlayıcının API bağlantısı henüz kullanıma açık değil.',
      )
    return this.database.transaction(async (tx) => {
      await tx.query('SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE', [
        auth.workspaceId,
      ])
      const bodyHash = sha256(canonicalJson({ input, existingId }))
      if (requestKey) {
        const receipt = (
          await tx.query<{ body_hash: string; user_id: string; result: PublicIntegration }>(
            'SELECT body_hash,user_id,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
            [auth.workspaceId, requestKey],
          )
        ).rows[0]
        if (receipt) {
          if (receipt.body_hash !== bodyHash || receipt.user_id !== auth.userId)
            throw new AppError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'İşlem anahtarı farklı bir bağlantı isteğinde kullanılmış.',
            )
          return receipt.result
        }
      }
      const existing = existingId ? await this.connection(auth.workspaceId, existingId, tx) : null
      if (existing && existing.provider !== input.provider)
        throw new AppError(
          400,
          'PROVIDER_IMMUTABLE',
          'Mevcut bağlantının sağlayıcısı değiştirilemez.',
        )
      const id = existingId ?? randomUUID()
      const credentials = existing ? this.credentials(existing) : {}
      let changed = false
      for (const key of Object.keys(input.credentials)) {
        if (!definition.fields.some((field) => field.key === key))
          throw new AppError(400, 'UNKNOWN_CREDENTIAL', 'Tanınmayan bağlantı alanı.')
        if (input.credentials[key]) {
          changed ||= credentials[key] !== input.credentials[key]
          credentials[key] = input.credentials[key]
        }
      }
      for (const field of definition.fields)
        if (field.required && !credentials[field.key]?.trim())
          throw new AppError(400, 'CREDENTIAL_REQUIRED', `${field.label} gerekli.`)
      for (const [linkedId, kind] of [
        [input.settings.invoiceConnectionId, 'invoice'],
        [input.settings.cargoConnectionId, 'cargo'],
      ] as const) {
        if (linkedId) {
          const linked = await this.connection(auth.workspaceId, linkedId, tx)
          if (linked.kind !== kind)
            throw new AppError(400, 'INVALID_LINKED_CONNECTION', 'Bağlantı türü uygun değil.')
        }
      }
      const capabilitySettings: [keyof IntegrationSettings, IntegrationOperation][] = [
        ['pullOrders', 'orders.pull'],
        ['pullCatalog', 'catalog.pull'],
        ['pushInventory', 'inventory.push'],
        ['pullQuestions', 'questions.pull'],
        ['pullClaims', 'claims.pull'],
        ['pullSettlements', 'settlements.pull'],
      ]
      for (const [setting, operation] of capabilitySettings)
        if (input.settings[setting] && !this.capabilities(definition.id).includes(operation))
          throw new AppError(
            400,
            'UNSUPPORTED_SETTING',
            `Bu sağlayıcıda ${operation} kullanıma açık değil.`,
          )
      const environmentChanged = existing?.settings.environment !== input.settings.environment
      const status = changed || environmentChanged || !existing ? 'configured' : existing.status
      if (input.enabled && status !== 'verified')
        throw new AppError(
          409,
          'TEST_REQUIRED',
          'Otomasyonu açmadan önce bağlantı testi başarılı olmalı.',
        )
      const encrypted = seal(credentials, this.config.encryptionKey, `${auth.workspaceId}:${id}`)
      const invoiceCount =
        definition.kind === 'invoice' && !existing
          ? (
              await tx.query(
                "SELECT id FROM integration_connections WHERE workspace_id=$1 AND kind='invoice' AND deleted_at IS NULL",
                [auth.workspaceId],
              )
            ).rows.length
          : 1
      const isDefault =
        definition.kind === 'invoice' &&
        (input.isDefault ?? existing?.is_default ?? invoiceCount === 0)
      if (isDefault)
        await tx.query(
          "UPDATE integration_connections SET is_default=false WHERE workspace_id=$1 AND kind='invoice' AND id<>$2 AND is_default",
          [auth.workspaceId, id],
        )
      await tx.query(
        `INSERT INTO integration_connections(id,workspace_id,provider,kind,name,credentials,settings,enabled,status,is_default)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$11) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,credentials=EXCLUDED.credentials,settings=EXCLUDED.settings,enabled=EXCLUDED.enabled,status=EXCLUDED.status,is_default=EXCLUDED.is_default,updated_at=now(),last_error=NULL,credential_version=integration_connections.credential_version+CASE WHEN $10 THEN 1 ELSE 0 END`,
        [
          id,
          auth.workspaceId,
          definition.id,
          definition.kind,
          input.name,
          encrypted,
          JSON.stringify(input.settings),
          input.enabled,
          status,
          changed || environmentChanged,
          isDefault,
        ],
      )
      if (definition.kind === 'marketplace' && !input.settings.sendInvoiceLink)
        await tx.query(
          "UPDATE integration_jobs SET status='cancelled',finished_at=now() WHERE workspace_id=$1 AND connection_id=$2 AND kind='invoice.link' AND status IN ('queued','waiting') AND COALESCE(payload->>'automaticInvoiceLink','true')<>'false' AND NOT(payload ? 'invoiceLinkWriteStartedAt')",
          [auth.workspaceId, id],
        )
      const workspace = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      if (definition.kind === 'marketplace') {
        const connection = {
          id,
          channel: definition.id as AppState['connections'][number]['channel'],
          name: input.name,
          active: input.enabled,
        }
        workspace.document.connections = workspace.document.connections.some(
          (item) => item.id === id,
        )
          ? workspace.document.connections.map((item) => (item.id === id ? connection : item))
          : [...workspace.document.connections, connection]
      }
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(workspace.document), auth.workspaceId],
      )
      await audit(
        tx,
        auth.workspaceId,
        auth.userId,
        existing ? 'integration.updated' : 'integration.created',
        id,
        { provider: definition.id, credentialsChanged: changed },
      )
      const result = this.public(await this.connection(auth.workspaceId, id, tx))
      if (requestKey)
        await tx.query(
          `INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision)
        SELECT $1,$2,$3,'integration.save',$4,$5,revision FROM workspace_states WHERE workspace_id=$1`,
          [auth.workspaceId, requestKey, auth.userId, bodyHash, JSON.stringify(result)],
        )
      return result
    })
  }
}

const operationNames = [
  'test',
  'catalog.pull',
  'orders.pull',
  'inventory.push',
  'listing.publish',
  'order.update',
  'invoice.link',
  'questions.pull',
  'question.answer',
  'claims.pull',
  'claim.decide',
  'settlements.pull',
  'shipment.create',
  'shipment.track',
  'shipment.cancel',
  'invoice.create',
  'invoice.finalize',
  'invoice.status',
] as const

export function registerIntegrationRoutes(app: FastifyInstance, service: IntegrationService) {
  const database = service.database
  app.get('/api/providers', async (request) => {
    requireAuth(request)
    return {
      providers: providers.map((provider) => ({
        ...provider,
        capabilities: service.capabilities(provider.id),
      })),
    }
  })
  app.get('/api/integrations', async (request) => {
    const auth = requirePermission(request, 'integrations.manage')
    const rows = await database.query<ConnectionRow>(
      'SELECT * FROM integration_connections WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at',
      [auth.workspaceId],
    )
    return { connections: rows.rows.map((row) => service.public(row)) }
  })
  app.post('/api/integrations', async (request, reply) =>
    reply
      .code(201)
      .send(
        await service.save(
          requirePermission(request, 'integrations.manage'),
          request.body,
          undefined,
          uuid.parse(request.headers['idempotency-key']),
        ),
      ),
  )
  app.patch('/api/integrations/:id', async (request) =>
    service.save(
      requirePermission(request, 'integrations.manage'),
      request.body,
      uuid.parse((request.params as { id: string }).id),
      uuid.parse(request.headers['idempotency-key']),
    ),
  )
  app.post('/api/integrations/:id/default', async (request) => {
    z.strictObject({}).parse(request.body ?? {})
    const auth = requirePermission(request, 'integrations.manage'),
      id = uuid.parse((request.params as { id: string }).id),
      key = uuid.parse(request.headers['idempotency-key']),
      hash = sha256(canonicalJson({ id, action: 'invoice.default' }))
    return database.transaction(async (tx) => {
      await tx.query('SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE', [
        auth.workspaceId,
      ])
      const receipt = (
        await tx.query<{ body_hash: string; user_id: string; result: PublicIntegration }>(
          'SELECT body_hash,user_id,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
          [auth.workspaceId, key],
        )
      ).rows[0]
      if (receipt) {
        if (receipt.body_hash !== hash || receipt.user_id !== auth.userId)
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'İşlem anahtarı başka bir istek için kullanılmış.',
          )
        return receipt.result
      }
      const connection = await service.connection(auth.workspaceId, id, tx)
      if (connection.kind !== 'invoice')
        throw new AppError(
          400,
          'DEFAULT_INVOICE_ONLY',
          'Yalnız fatura sağlayıcısı varsayılan seçilebilir.',
        )
      await tx.query(
        "UPDATE integration_connections SET is_default=false WHERE workspace_id=$1 AND kind='invoice' AND is_default",
        [auth.workspaceId],
      )
      await tx.query(
        'UPDATE integration_connections SET is_default=true,updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [auth.workspaceId, id],
      )
      await tx.query(
        'UPDATE workspace_states SET revision=revision+1,updated_at=now() WHERE workspace_id=$1',
        [auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'invoice.default_changed', id)
      const result = service.public(await service.connection(auth.workspaceId, id, tx))
      await tx.query(
        "INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision) SELECT $1,$2,$3,'invoice.default',$4,$5,revision FROM workspace_states WHERE workspace_id=$1",
        [auth.workspaceId, key, auth.userId, hash, JSON.stringify(result)],
      )
      return result
    })
  })
  app.delete('/api/integrations/:id', async (request) => {
    const auth = requirePermission(request, 'integrations.manage'),
      id = uuid.parse((request.params as { id: string }).id)
    await service.connection(auth.workspaceId, id)
    await database.transaction(async (tx) => {
      await tx.query('SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE', [
        auth.workspaceId,
      ])
      const running = await tx.query(
        `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND connection_id=$2 AND status='running'`,
        [auth.workspaceId, id],
      )
      if (running.rows.length)
        throw new AppError(
          409,
          'CONNECTION_BUSY',
          'Çalışan işlem tamamlanınca bağlantıyı kaldırın.',
        )
      await tx.query(
        'UPDATE integration_connections SET deleted_at=now(),enabled=false,is_default=false,credentials=$1 WHERE workspace_id=$2 AND id=$3',
        [seal({}, service.config.encryptionKey, `${auth.workspaceId}:${id}`), auth.workspaceId, id],
      )
      await tx.query(
        `UPDATE integration_jobs SET status='cancelled',finished_at=now() WHERE workspace_id=$1 AND connection_id=$2 AND status IN ('queued','waiting')`,
        [auth.workspaceId, id],
      )
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      row.document.connections = row.document.connections.filter((item) => item.id !== id)
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1 WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'integration.removed', id)
    })
    return { ok: true }
  })
  app.post('/api/integrations/:id/jobs', async (request, reply) => {
    const auth = requirePermission(request, 'integrations.manage'),
      id = uuid.parse((request.params as { id: string }).id)
    const connection = await service.connection(auth.workspaceId, id)
    const input = z
      .strictObject({
        operation: z.enum(operationNames),
        entityId: z.string().max(160).optional(),
        from: z.number().int().optional(),
        to: z.number().int().optional(),
      })
      .parse(request.body)
    if (!service.capabilities(connection.provider).includes(input.operation))
      throw new AppError(
        409,
        'UNSUPPORTED_OPERATION',
        'Bu sağlayıcıda seçilen işlem henüz kullanıma açık değil.',
      )
    if (input.operation !== 'test' && (!connection.enabled || connection.status !== 'verified'))
      throw new AppError(409, 'CONNECTION_NOT_VERIFIED', 'Bağlantıyı test edip etkinleştirin.')
    const key = uuid.parse(request.headers['idempotency-key'])
    if (freshRequestJobs.includes(input.operation))
      throw new AppError(
        409,
        'RECORD_ACTION_REQUIRED',
        'Bu gönderimi ilgili ilan, soru veya iade kaydının ekranından başlatın.',
      )
    const payload: Record<string, unknown> = {}
    if (input.from !== undefined) payload.from = input.from
    if (input.to !== undefined) payload.to = input.to
    if (input.operation === 'inventory.push') payload.listingId = input.entityId
    if (input.operation.startsWith('invoice.') && input.operation !== 'invoice.link')
      payload.invoiceId = input.entityId
    if (input.operation === 'invoice.link' || input.operation === 'order.update')
      payload.orderId = input.entityId
    if (input.operation === 'invoice.link') payload.automaticInvoiceLink = false
    if (input.operation.startsWith('shipment.')) payload.shipmentId = input.entityId
    if (
      ![
        'test',
        'catalog.pull',
        'orders.pull',
        'questions.pull',
        'claims.pull',
        'settlements.pull',
      ].includes(input.operation) &&
      !input.entityId
    )
      throw new AppError(400, 'ENTITY_REQUIRED', 'İşlem için ilgili kayıt seçilmeli.')
    const jobId = await database.transaction(async (tx) => {
      if (input.operation === 'test')
        await tx.query(
          `UPDATE integration_connections SET status='testing',last_error=NULL WHERE workspace_id=$1 AND id=$2`,
          [auth.workspaceId, id],
        )
      const job = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: id,
        kind: input.operation,
        entityId: input.entityId,
        payload,
        key:
          input.operation.startsWith('invoice.') && input.entityId
            ? `${input.operation}:${input.entityId}`
            : `${id}:${key}`,
      })
      await audit(tx, auth.workspaceId, auth.userId, 'integration.job_enqueued', job, {
        operation: input.operation,
      })
      return job
    })
    return reply.code(202).send({ ok: true, jobId })
  })
  app.get('/api/jobs', async (request) => {
    const auth = requireAuth(request)
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        status: z
          .enum(['queued', 'running', 'waiting', 'completed', 'failed', 'uncertain', 'cancelled'])
          .optional(),
      })
      .parse(request.query)
    const jobs = await database.query(
      `SELECT j.*,c.name AS connection_name FROM integration_jobs j LEFT JOIN integration_connections c ON c.id=j.connection_id
      WHERE j.workspace_id=$1 AND ($2::text IS NULL OR j.status=$2) ORDER BY j.created_at DESC LIMIT $3`,
      [auth.workspaceId, query.status ?? null, query.limit],
    )
    return { jobs: jobs.rows.map(publicJob) }
  })
  app.post('/api/jobs/:id/retry', async (request) => {
    const auth = requireAuth(request),
      id = uuid.parse((request.params as { id: string }).id)
    const row = (
      await database.query<{
        status: string
        connection_id: string
        kind: string
        entity_id: string
        payload: {
          inventoryPlan?: { price: number; listPrice?: number; quantity: number; archive: boolean }
        }
      }>(
        'SELECT status,connection_id,kind,entity_id,payload FROM integration_jobs WHERE workspace_id=$1 AND id=$2',
        [auth.workspaceId, id],
      )
    ).rows[0]
    if (!row) throw new AppError(404, 'NOT_FOUND', 'İşlem bulunamadı.')
    assertPermission(auth, jobPermission(row.kind))
    if (freshRequestJobs.includes(row.kind))
      throw new AppError(
        409,
        'FRESH_REQUEST_REQUIRED',
        'Güncel kaydı açıp yeni bir gönderim başlatın; eski yazma isteği tekrar kullanılmaz.',
      )
    if (row.status === 'uncertain')
      throw new AppError(
        409,
        'RECONCILIATION_REQUIRED',
        'Sonucu belirsiz işlem yeniden oluşturulmaz. Önce sağlayıcı kaydıyla eşleştirilmelidir.',
      )
    if (!['failed', 'waiting'].includes(row.status))
      throw new AppError(409, 'NOT_RETRYABLE', 'Bu işlem yeniden denemeye uygun değil.')
    const connection = await service.connection(auth.workspaceId, row.connection_id)
    const changed = await database.transaction(async (tx) => {
      const state = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0].document
      if (row.kind === 'inventory.push' && row.payload.inventoryPlan) {
        const listing = state.listings.find(
            (l) => l.id === row.entity_id && l.storeId === connection.id,
          ),
          plan = row.payload.inventoryPlan
        if (
          !listing ||
          Boolean(plan.archive) !== (listing.desiredStatus === 'archived') ||
          listingPrice(state, listing) !== plan.price ||
          (['trendyol', 'n11', 'pazarama'].includes(listing.channel) &&
            listingListPrice(state, listing) !== (plan.listPrice ?? plan.price)) ||
          (plan.archive
            ? 0
            : listingQuantity(
                state,
                listing,
                connection.settings.stockBuffer,
                storeWarehouseIds(state, connection.settings),
              )) !== plan.quantity
        )
          throw new AppError(
            409,
            'INVENTORY_PLAN_STALE',
            'İlanın stok/fiyatı değişti. Eski işlem yerine güncel değerlerle yeni bir eşitleme başlatın.',
          )
      }
      return tx.query(
        `UPDATE integration_jobs SET status='queued',attempts=0,available_at=now(),last_error=NULL,finished_at=NULL,credential_version=$3 WHERE workspace_id=$1 AND id=$2 AND status IN ('failed','waiting') AND worker_id IS NULL RETURNING id`,
        [auth.workspaceId, id, connection.credential_version],
      )
    })
    if (!changed.rows.length)
      throw new AppError(409, 'JOB_CHANGED', 'İşlem durumu değişti. Listeyi yenileyin.')
    await audit(database, auth.workspaceId, auth.userId, 'integration.job_retried', id)
    return { ok: true }
  })
  app.get('/api/remote-products', async (request) => {
    const auth = requirePermission(request, 'catalog.write')
    const { connectionId, query, limit, offset } = z
      .object({
        connectionId: uuid,
        query: z.string().max(200).default(''),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().nonnegative().default(0),
      })
      .parse(request.query)
    await service.connection(auth.workspaceId, connectionId)
    const rows = await database.query(
      `SELECT id,external_id,document,local_id,seen_at FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND resource='product'
      AND ($3='' OR document->>'title' ILIKE $4 OR document->>'sku' ILIKE $4 OR document->>'barcode' ILIKE $4) ORDER BY seen_at DESC,id LIMIT $5 OFFSET $6`,
      [auth.workspaceId, connectionId, query, `%${query}%`, limit, offset],
    )
    return { products: rows.rows }
  })
}
