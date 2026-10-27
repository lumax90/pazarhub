import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState } from '../../src/domain/types'
import type { OrderFulfillmentPlan, OrderFulfillmentView } from '../../src/domain/order-fulfillment'
import type { IntegrationService } from '../integration-service'
import { requirePermission, audit } from '../auth'
import { AppError } from '../errors'
import { ProviderHttp } from '../integrations/http'
import { identifier, uuid } from '../validation'
import { canonicalJson, sha256 } from '../security'
import { enqueue } from '../jobs'
import type { StoredJob } from '../jobs'
import { orderFulfillment } from './registry'
import { fulfillmentLocalKey } from './contracts'

export function registerOrderFulfillment(app: FastifyInstance, service: IntegrationService) {
  const database = service.database
  app.get('/api/orders/:id/marketplace', async (request) => {
    const auth = requirePermission(request, 'orders.write'),
      id = identifier.parse((request.params as { id: string }).id)
    const row = (
        await database.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1',
          [auth.workspaceId],
        )
      ).rows[0],
      order = row.document.orders.find((order) => order.id === id)
    if (!order?.externalId || !order.storeId)
      throw new AppError(404, 'MARKETPLACE_ORDER_REQUIRED', 'Pazaryeri siparişi bulunamadı.')
    const connection = await service.connection(auth.workspaceId, order.storeId)
    if (
      !connection.enabled ||
      connection.status !== 'verified' ||
      !service.capabilities(connection.provider).includes('order.fulfillment')
    )
      throw new AppError(
        409,
        'FULFILLMENT_UNAVAILABLE',
        'Bu mağazanın paket işlemleri için test edilmiş bağlantı gerekli.',
      )
    const view = await orderFulfillment(
      connection.provider,
      new ProviderHttp(service.fetcher),
    ).load(
      {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        provider: connection.provider,
        credentials: service.credentials(connection),
        settings: connection.settings,
        state: row.document,
        integrationName: service.config.integrationName,
      },
      order,
    )
    const previewId = randomUUID(),
      expiresAt = new Date(Date.now() + 10 * 60000).toISOString()
    await database.query(
      'INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at) VALUES($1,$2,$3,$4,$5)',
      [
        auth.workspaceId,
        connection.id,
        `order-fulfillment:${previewId}`,
        JSON.stringify({
          orderId: id,
          localKey: fulfillmentLocalKey(order),
          credentialVersion: connection.credential_version,
          view,
        }),
        expiresAt,
      ],
    )
    return { previewId, view, expiresAt }
  })
  app.post('/api/orders/:id/marketplace/action', async (request, reply) => {
    const auth = requirePermission(request, 'orders.write'),
      id = identifier.parse((request.params as { id: string }).id),
      key = uuid.parse(request.headers['idempotency-key'])
    const input = z
      .strictObject({
        previewId: uuid,
        action: z.enum(['prepare', 'pack', 'label', 'ship', 'cancel']),
        lines: z
          .array(z.strictObject({ id: identifier, quantity: z.number().int().min(1).max(10000) }))
          .max(100)
          .default([]),
        packageId: identifier.optional(),
        reasonId: identifier.optional(),
        parcels: z.number().int().min(1).max(20).default(1),
        desi: z.number().min(0.1).max(1000).default(1),
        trackingNumber: z.string().trim().min(1).max(150).optional(),
        trackingUrl: z
          .url()
          .refine((value) => /^https?:\/\//.test(value))
          .optional(),
        shippedAt: z.string().datetime().optional(),
        carrierId: identifier.optional(),
        carrierName: z.string().trim().min(1).max(100).optional(),
        warehouseId: identifier.optional(),
        weight: z.number().min(0.01).max(1000).optional(),
        width: z.number().min(0.1).max(1000).optional(),
        height: z.number().min(0.1).max(1000).optional(),
        length: z.number().min(0.1).max(1000).optional(),
      })
      .parse(request.body)
    const hash = sha256(canonicalJson({ id, input }))
    const result = await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const receipt = (
        await tx.query<{ body_hash: string; user_id: string; result: unknown }>(
          'SELECT body_hash,user_id,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
          [auth.workspaceId, key],
        )
      ).rows[0]
      if (receipt) {
        if (receipt.body_hash !== hash || receipt.user_id !== auth.userId)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'İstek anahtarı başka bir işleme ait.')
        return receipt.result
      }
      const order = row.document.orders.find((order) => order.id === id)
      if (!order?.externalId || !order.storeId)
        throw new AppError(404, 'ORDER_NOT_FOUND', 'Pazaryeri siparişi bulunamadı.')
      const connection = await service.connection(auth.workspaceId, order.storeId, tx)
      if (!connection.enabled || connection.status !== 'verified')
        throw new AppError(409, 'CONNECTION_NOT_READY', 'Bağlantıyı test edip etkinleştirin.')
      const cached = (
        await tx.query<{
          document: {
            orderId: string
            localKey: string
            credentialVersion: number
            view: OrderFulfillmentView
          }
        }>(
          'SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()',
          [auth.workspaceId, connection.id, `order-fulfillment:${input.previewId}`],
        )
      ).rows[0]?.document
      if (
        !cached ||
        cached.orderId !== id ||
        cached.localKey !== fulfillmentLocalKey(order) ||
        cached.credentialVersion !== connection.credential_version
      )
        throw new AppError(
          409,
          'FULFILLMENT_STALE',
          'Sipariş veya bağlantı değişti. Pazaryeri bilgilerini yenileyin.',
        )
      if (input.action !== 'label' && order.syncError)
        throw new AppError(
          409,
          'ORDER_RECONCILIATION_REQUIRED',
          'Önce sipariş kalemlerini uzlaştırın.',
        )
      if (
        ['prepare', 'pack', 'ship'].includes(input.action) &&
        (!['approved', 'shipped'].includes(order.status) || !order.inventoryApplied)
      )
        throw new AppError(
          409,
          'ORDER_NOT_READY',
          'Paketleme/gönderim için sipariş onaylanıp stok işlemi tamamlanmalı.',
        )
      const view = cached.view
      if (!view.actions.includes(input.action))
        throw new AppError(
          409,
          'ACTION_UNAVAILABLE',
          'Bu pazaryeri/kargo modeli seçilen işlemi desteklemiyor.',
        )
      if (
        (['prepare', 'pack', 'cancel'].includes(input.action) ||
          (input.action === 'ship' && view.shipCreatesPackage)) &&
        (!input.lines.length ||
          new Set(input.lines.map((line) => line.id)).size !== input.lines.length ||
          input.lines.some(
            (selected) =>
              !view.lines.some(
                (line) =>
                  line.id === selected.id &&
                  line.quantity === selected.quantity &&
                  (input.action === 'cancel'
                    ? line.cancellable
                    : input.action === 'prepare'
                      ? line.preparable
                      : line.packable),
              ),
          ))
      )
        throw new AppError(409, 'LINES_CHANGED', 'Uygun tam sipariş kalemlerini seçin.')
      if (
        (input.action === 'label' || (input.action === 'ship' && !view.shipCreatesPackage)) &&
        !view.packages.some((item) => item.id === input.packageId)
      )
        throw new AppError(409, 'PACKAGE_REQUIRED', 'Bu siparişe ait paket seçin.')
      if (
        input.action === 'cancel' &&
        !view.cancellationReasons.some((reason) => reason.id === input.reasonId)
      )
        throw new AppError(400, 'REASON_REQUIRED', 'Pazaryeri iptal nedeni seçin.')
      const active = await tx.query(
        "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind IN ('order.fulfillment','order.fulfillment.status') AND status IN ('queued','running','waiting','uncertain')",
        [auth.workspaceId, id],
      )
      if (active.rows.length)
        throw new AppError(
          409,
          'FULFILLMENT_BUSY',
          'Bu siparişin önceki pazaryeri işlemi tamamlanmalı veya uzlaştırılmalı.',
        )
      const reference =
        connection.provider === 'amazon'
          ? BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`).toString()
          : `PH${randomUUID().replaceAll('-', '')}`
      const plan: OrderFulfillmentPlan = {
        ...input,
        orderId: id,
        externalId: order.externalId,
        orderNumber: order.externalNumber || order.number,
        localKey: cached.localKey,
        remoteKey: view.fingerprint,
        reference,
      }
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: 'order.fulfillment',
        entityId: id,
        payload: { plan },
        key: `order-fulfillment:${id}:${key}`,
        delaySeconds: connection.provider === 'ciceksepeti' ? 61 : 0,
      })
      order.fulfillmentWorkflow = {
        jobId,
        action: input.action,
        state: 'queued',
        updatedAt: new Date().toISOString(),
        message: 'Pazaryeri işlemi sıraya alındı.',
      }
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      const result = { ok: true, jobId }
      await tx.query(
        "INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision) SELECT $1,$2,$3,'order.fulfillment',$4,$5,revision FROM workspace_states WHERE workspace_id=$1",
        [auth.workspaceId, key, auth.userId, hash, JSON.stringify(result)],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'order.fulfillment_requested', id, {
        action: input.action,
        jobId,
      })
      return result
    })
    return reply.code(202).send(result)
  })
  app.post('/api/orders/:id/marketplace/reconcile', async (request, reply) => {
    const auth = requirePermission(request, 'orders.write'),
      id = identifier.parse((request.params as { id: string }).id),
      key = uuid.parse(request.headers['idempotency-key'])
    const result = await database.transaction(async (tx) => {
      const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
            [auth.workspaceId],
          )
        ).rows[0],
        order = row.document.orders.find((order) => order.id === id)
      if (
        !order?.fulfillmentWorkflow ||
        !['uncertain', 'failed'].includes(order.fulfillmentWorkflow.state)
      )
        throw new AppError(
          409,
          'RECONCILIATION_NOT_REQUIRED',
          'Uzlaştırma bekleyen paket işlemi yok.',
        )
      const source = (
        await tx.query<StoredJob>(
          'SELECT * FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND entity_id=$3',
          [auth.workspaceId, order.fulfillmentWorkflow.jobId, id],
        )
      ).rows[0]
      if (
        !source ||
        source.kind !== 'order.fulfillment' ||
        !['uncertain', 'failed'].includes(source.status)
      )
        throw new AppError(409, 'SOURCE_CHANGED', 'Kaynak pazaryeri işlemi değişti.')
      const pending = (
        await tx.query<{ id: string }>(
          "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind='order.fulfillment.status' AND status IN ('queued','running','waiting')",
          [auth.workspaceId, id],
        )
      ).rows[0]
      if (pending) return { ok: true, jobId: pending.id }
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: order.storeId,
        kind: 'order.fulfillment.status',
        entityId: id,
        payload: { plan: source.payload.plan, sourceJobId: source.id },
        key: `order-fulfillment-reconcile:${source.id}:${key}`,
      })
      await audit(tx, auth.workspaceId, auth.userId, 'order.fulfillment_reconciliation', id, {
        sourceJobId: source.id,
        jobId,
      })
      return { ok: true, jobId }
    })
    return reply.code(202).send(result)
  })
}
