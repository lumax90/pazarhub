import { randomUUID } from 'node:crypto'
import type { IntegrationJob, IntegrationOperation } from '../src/domain/integrations'
import type { Database, Sql } from './db'
import type { AppState } from '../src/domain/types'

export interface StoredJob {
  id: string
  workspace_id: string
  connection_id: string | null
  kind: IntegrationOperation | 'inventory.reconcile'
  entity_id: string | null
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  status: IntegrationJob['status']
  created_at: Date | string
  result: Record<string, unknown> | null
  last_error: string | null
  sequence: string | number
  credential_version: number | null
}

export const retrySafeJob = (kind: string) =>
  kind === 'test' ||
  kind.endsWith('.pull') ||
  [
    'inventory.push',
    'inventory.reconcile',
    'invoice.status',
    'invoice.reconcile',
    'shipment.track',
    'shipment.reconcile',
    'listing.status',
    'order.fulfillment.status',
    'listing.content.status',
  ].includes(kind)

export async function enqueue(
  tx: Sql,
  input: {
    workspaceId: string
    connectionId?: string
    kind: StoredJob['kind']
    entityId?: string
    payload?: Record<string, unknown>
    key?: string
    delaySeconds?: number
  },
) {
  const id = randomUUID()
  const result = await tx.query<{ id: string }>(
    `
    INSERT INTO integration_jobs(id,workspace_id,connection_id,kind,entity_id,payload,deduplication_key,available_at,credential_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8::double precision * interval '1 second'),(SELECT credential_version FROM integration_connections WHERE workspace_id=$2 AND id=$3))
    ON CONFLICT(workspace_id,deduplication_key) DO NOTHING RETURNING id`,
    [
      id,
      input.workspaceId,
      input.connectionId ?? null,
      input.kind,
      input.entityId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.key ?? null,
      input.delaySeconds ?? 0,
    ],
  )
  if (result.rows[0]) return result.rows[0].id
  return (
    await tx.query<{ id: string }>(
      'SELECT id FROM integration_jobs WHERE workspace_id=$1 AND deduplication_key=$2',
      [input.workspaceId, input.key],
    )
  ).rows[0].id
}

export async function claimJob(database: Database, workerId: string): Promise<StoredJob | null> {
  return database.transaction(async (tx) => {
    const expired = await tx.query<StoredJob>(
      `SELECT * FROM integration_jobs WHERE status='running' AND lease_until<now() ORDER BY lease_until LIMIT 100`,
    )
    for (const job of expired.rows) {
      const workspace = await tx.query(
        'SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE SKIP LOCKED',
        [job.workspace_id],
      )
      if (!workspace.rows.length) continue
      const lease = await tx.query(
        `SELECT id FROM integration_jobs WHERE id=$1 AND status='running' AND lease_until<now() FOR UPDATE SKIP LOCKED`,
        [job.id],
      )
      if (!lease.rows.length) continue
      const status = !retrySafeJob(job.kind)
        ? 'uncertain'
        : job.attempts + 1 >= job.max_attempts
          ? 'failed'
          : 'waiting'
      await tx.query(
        `UPDATE integration_jobs SET status=$1,attempts=attempts+1,worker_id=NULL,lease_until=NULL,available_at=now()+interval '30 seconds',
        finished_at=CASE WHEN $1 IN ('failed','uncertain') THEN now() ELSE NULL END,last_error='İşleyici bağlantısı kesildi. İşlem sonucu yeniden doğrulanmalı.' WHERE id=$2`,
        [status, job.id],
      )
      if (
        job.kind === 'question.answer' ||
        job.kind === 'claim.decide' ||
        (job.kind === 'settlements.pull' && job.payload.paymentOrderId)
      )
        await tx.query(
          `UPDATE external_records SET workflow=workflow||$1::jsonb WHERE workspace_id=$2 AND id=$3 AND workflow->>'jobId'=$4`,
          [
            JSON.stringify({
              state:
                status === 'uncertain' ? 'uncertain' : status === 'failed' ? 'failed' : 'pending',
              message: 'İşleyici kesildi; sağlayıcı sonucu doğrulanmalı.',
              updatedAt: new Date().toISOString(),
            }),
            job.workspace_id,
            job.entity_id,
            job.id,
          ],
        )
      if (job.kind === 'listing.publish') {
        const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
            [job.workspace_id],
          )
        ).rows[0]
        const listings =
          row?.document.listings.filter((item) => item.publication?.jobId === job.id) ?? []
        if (listings.length) {
          for (const listing of listings) {
            listing.publication!.phase = 'uncertain'
            listing.publication!.message = 'İşleyici kesildi; mevcut gönderim sonucu doğrulanmalı.'
            listing.error = listing.publication!.message
          }
          await tx.query(
            'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
            [JSON.stringify(row.document), job.workspace_id],
          )
        }
      }
      if (
        ['invoice.create', 'invoice.finalize', 'shipment.create', 'shipment.cancel'].includes(
          job.kind,
        )
      ) {
        const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1',
            [job.workspace_id],
          )
        ).rows[0]
        const entity = job.kind.startsWith('invoice.')
          ? row.document.invoices.find((item) => item.id === job.entity_id)
          : row.document.shipments?.find((item) => item.id === job.entity_id)
        if (entity) {
          entity.uncertainJobId = job.id
          entity.error = 'İşleyici kesildi; sağlayıcı kaydı uzlaştırılmalı.'
          entity.status = job.kind.startsWith('invoice.') ? 'failed' : 'uncertain'
          await tx.query(
            'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
            [JSON.stringify(row.document), job.workspace_id],
          )
        }
      }
      if (job.kind === 'order.fulfillment') {
        const row = (
            await tx.query<{ document: AppState }>(
              'SELECT document FROM workspace_states WHERE workspace_id=$1',
              [job.workspace_id],
            )
          ).rows[0],
          order = row.document.orders.find((order) => order.id === job.entity_id)
        if (order?.fulfillmentWorkflow?.jobId === job.id) {
          order.fulfillmentWorkflow.state = 'uncertain'
          order.fulfillmentWorkflow.message =
            'İşleyici kesildi; pazaryeri paket sonucunu doğrulayın.'
          await tx.query(
            'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
            [JSON.stringify(row.document), job.workspace_id],
          )
        }
      }
      if (job.kind === 'listing.content') {
        const row = (
            await tx.query<{ document: AppState }>(
              'SELECT document FROM workspace_states WHERE workspace_id=$1',
              [job.workspace_id],
            )
          ).rows[0],
          listing = row.document.listings.find((item) => item.id === job.entity_id)
        if (listing?.contentWorkflow?.jobId === job.id) {
          listing.contentWorkflow.state = 'uncertain'
          listing.contentWorkflow.message =
            'İşleyici kesildi; içerik sonucu sağlayıcıdan doğrulanmalı.'
          await tx.query(
            'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
            [JSON.stringify(row.document), job.workspace_id],
          )
        }
      }
    }
    // The connection lock + partial unique index provide a single durable lane per store.
    const connection = await tx.query<{ id: string }>(`SELECT c.id FROM integration_connections c
      WHERE c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM integration_jobs j WHERE j.connection_id=c.id AND j.status='running')
      AND EXISTS(SELECT 1 FROM integration_jobs j WHERE j.connection_id=c.id AND j.status IN ('queued','waiting') AND j.available_at<=now()
        AND NOT EXISTS(SELECT 1 FROM integration_jobs prior WHERE prior.connection_id=c.id AND prior.entity_id=j.entity_id AND prior.sequence<j.sequence AND prior.status IN ('queued','waiting','running')))
      ORDER BY (SELECT min(j.sequence) FROM integration_jobs j WHERE j.connection_id=c.id AND j.status IN ('queued','waiting'))
      LIMIT 1 FOR UPDATE OF c SKIP LOCKED`)
    if (!connection.rows[0]) return null
    const result = await tx.query<StoredJob>(
      `
      SELECT j.* FROM integration_jobs j WHERE j.status IN ('queued','waiting') AND j.available_at<=now()
      AND j.connection_id=$1 AND NOT EXISTS(SELECT 1 FROM integration_jobs x WHERE x.connection_id=j.connection_id AND x.status='running')
      AND NOT EXISTS(SELECT 1 FROM integration_jobs prior WHERE prior.connection_id=j.connection_id AND prior.entity_id=j.entity_id AND prior.sequence<j.sequence AND prior.status IN ('queued','waiting','running'))
      ORDER BY j.sequence LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
      [connection.rows[0].id],
    )
    const job = result.rows[0]
    if (!job) return null
    await tx.query(
      `UPDATE integration_jobs SET status='running',worker_id=$1,lease_until=now()+interval '90 seconds' WHERE id=$2`,
      [workerId, job.id],
    )
    return job
  })
}

export function publicJob(row: Record<string, unknown>): IntegrationJob {
  const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)
  return {
    id: String(row.id),
    connectionId: row.connection_id ? String(row.connection_id) : null,
    connectionName: row.connection_name ? String(row.connection_name) : undefined,
    kind: row.kind as IntegrationJob['kind'],
    entityId: row.entity_id ? String(row.entity_id) : null,
    status: row.status as IntegrationJob['status'],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastError: row.last_error ? String(row.last_error) : null,
    result: row.result as Record<string, unknown> | null,
    createdAt: iso(row.created_at)!,
    availableAt: iso(row.available_at)!,
    finishedAt: iso(row.finished_at),
  }
}
