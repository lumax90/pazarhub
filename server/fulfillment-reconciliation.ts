import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState } from '../src/domain/types'
import { audit, requirePermission } from './auth'
import type { IntegrationService } from './integration-service'
import { AppError } from './errors'
import { identifier, uuid } from './validation'
import { enqueue, publicJob } from './jobs'
import type { StoredJob } from './jobs'
import { canonicalJson } from './security'

const paramsSchema = z.object({ kind: z.enum(['invoice', 'shipment']), id: identifier })
export function registerFulfillmentReconciliation(
  app: FastifyInstance,
  service: IntegrationService,
) {
  const database = service.database
  app.get('/api/fulfillment/:kind/:id/reconciliation', async (request) => {
    const params = paramsSchema.parse(request.params),
      auth = requirePermission(
        request,
        params.kind === 'invoice' ? 'finance.write' : 'orders.write',
      )
    const row = (
      await database.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [auth.workspaceId],
      )
    ).rows[0]
    const entity =
      params.kind === 'invoice'
        ? row.document.invoices.find((item) => item.id === params.id)
        : row.document.shipments?.find((item) => item.id === params.id)
    if (!entity) throw new AppError(404, 'RECORD_NOT_FOUND', 'Kayıt bulunamadı.')
    const jobs = await database.query<StoredJob & Record<string, unknown>>(
      'SELECT * FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 ORDER BY sequence DESC LIMIT 30',
      [auth.workspaceId, entity.id],
    )
    const connection = entity.connectionId
      ? await service.connection(auth.workspaceId, entity.connectionId)
      : undefined
    return {
      reference:
        params.kind === 'invoice'
          ? `Pazarhub ${entity.id}`
          : 'reference' in entity
            ? entity.reference
            : '',
      supported:
        !!connection &&
        service.capabilities(connection.provider).includes(`${params.kind}.reconcile`),
      jobs: jobs.rows.map(publicJob),
    }
  })
  app.post('/api/fulfillment/:kind/:id/reconcile', async (request, reply) => {
    const params = paramsSchema.parse(request.params),
      auth = requirePermission(
        request,
        params.kind === 'invoice' ? 'finance.write' : 'orders.write',
      )
    const input = z
        .strictObject({
          sourceJobId: uuid,
          externalId: z
            .string()
            .regex(/^[1-9]\d{0,19}$/)
            .optional(),
        })
        .parse(request.body),
      key = uuid.parse(request.headers['idempotency-key'])
    const result = await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const entity =
        params.kind === 'invoice'
          ? row.document.invoices.find((item) => item.id === params.id)
          : row.document.shipments?.find((item) => item.id === params.id)
      if (!entity?.connectionId)
        throw new AppError(404, 'RECORD_NOT_FOUND', 'Bağlantılı kayıt bulunamadı.')
      const source = (
        await tx.query<StoredJob>(
          'SELECT * FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND entity_id=$3 AND connection_id=$4 FOR UPDATE',
          [auth.workspaceId, input.sourceJobId, entity.id, entity.connectionId],
        )
      ).rows[0]
      const expected =
        params.kind === 'invoice'
          ? ['invoice.create', 'invoice.finalize']
          : ['shipment.create', 'shipment.cancel']
      if (
        !source ||
        !expected.includes(source.kind) ||
        !['uncertain', 'failed'].includes(source.status)
      )
        throw new AppError(
          409,
          'SOURCE_NOT_UNCERTAIN',
          'İşlem değişti veya uzlaştırma gerektirmiyor.',
        )
      const connection = await service.connection(auth.workspaceId, entity.connectionId, tx),
        operation = `${params.kind}.reconcile` as const
      if (
        !connection.enabled ||
        connection.status !== 'verified' ||
        !service.capabilities(connection.provider).includes(operation)
      )
        throw new AppError(
          409,
          'RECONCILIATION_UNAVAILABLE',
          'Bu sağlayıcı için test edilmiş uzlaştırma bağlantısı gerekli.',
        )
      const pending = (
        await tx.query<StoredJob>(
          "SELECT * FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind=$3 AND status IN ('queued','running','waiting')",
          [auth.workspaceId, entity.id, operation],
        )
      ).rows[0]
      const payload = {
        sourceJobId: source.id,
        ...(params.kind === 'invoice' ? { invoiceId: entity.id } : { shipmentId: entity.id }),
        ...(input.externalId ? { externalId: input.externalId } : {}),
      }
      if (pending) {
        if (canonicalJson(pending.payload) !== canonicalJson(payload))
          throw new AppError(
            409,
            'RECONCILIATION_BUSY',
            'Bu kayıt için başka bir doğrulama sürüyor.',
          )
        return { ok: true, jobId: pending.id }
      }
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: operation,
        entityId: entity.id,
        payload,
        key: `fulfillment-reconcile:${source.id}:${key}`,
      })
      await audit(
        tx,
        auth.workspaceId,
        auth.userId,
        'fulfillment.reconciliation_requested',
        entity.id,
        { sourceJobId: source.id, jobId, externalId: input.externalId },
      )
      return { ok: true, jobId }
    })
    return reply.code(202).send(result)
  })
}
