import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { IntegrationErrorEntry } from '../src/domain/integrations'
import { requirePermission } from './auth'
import type { Database, Sql } from './db'
import type { ProviderExchange } from './errors'

/**
 * Every failed job attempt, kept apart from the job row so retries don't overwrite the
 * earlier failures. Holds the provider's own answer, which may contain customer data, so it
 * is managers-only and pruned after this many days.
 */
const RETENTION_DAYS = 30

export interface ErrorLogInput {
  workspaceId: string
  jobId: string | null
  connectionId: string | null
  kind: string
  code: string
  message: string
  attempt: number
  exchange?: ProviderExchange
  /** The original error when it wasn't a provider error, i.e. a bug on our side. */
  cause?: unknown
  secrets: Record<string, string>
}

function masked(value: string | undefined, secrets: Record<string, string>) {
  if (!value) return undefined
  for (const secret of Object.values(secrets))
    if (secret.length > 4) value = value.replaceAll(secret, '[gizli]')
  return value
}

export async function recordError(tx: Sql, input: ErrorLogInput) {
  const cause =
    input.cause instanceof Error && input.cause.name !== 'ProviderError'
      ? (input.cause.stack ?? `${input.cause.name}: ${input.cause.message}`)
          .split('\n')
          .slice(0, 6)
          .join('\n')
      : undefined
  const detail = {
    request: masked(input.exchange?.request, input.secrets),
    status: input.exchange?.status,
    response: masked(input.exchange?.response, input.secrets),
    cause: masked(cause, input.secrets),
  }
  await tx.query(
    'INSERT INTO integration_errors(id,workspace_id,job_id,connection_id,kind,code,message,attempt,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      randomUUID(),
      input.workspaceId,
      input.jobId,
      input.connectionId,
      input.kind,
      input.code,
      masked(input.message, input.secrets) ?? '',
      input.attempt,
      JSON.stringify(detail),
    ],
  )
  await tx.query(
    `DELETE FROM integration_errors WHERE workspace_id=$1 AND created_at < now() - interval '${RETENTION_DAYS} days'`,
    [input.workspaceId],
  )
}

function publicError(row: Record<string, unknown>): IntegrationErrorEntry {
  const detail = (row.detail ?? {}) as Partial<IntegrationErrorEntry>
  return {
    id: String(row.id),
    jobId: row.job_id ? String(row.job_id) : null,
    connectionId: row.connection_id ? String(row.connection_id) : null,
    ...(row.connection_name ? { connectionName: String(row.connection_name) } : {}),
    provider: row.provider ? (String(row.provider) as IntegrationErrorEntry['provider']) : null,
    kind: String(row.kind) as IntegrationErrorEntry['kind'],
    code: String(row.code),
    message: String(row.message),
    attempt: Number(row.attempt),
    ...(detail.request ? { request: detail.request } : {}),
    ...(detail.status ? { status: detail.status } : {}),
    ...(detail.response ? { response: detail.response } : {}),
    ...(detail.cause ? { cause: detail.cause } : {}),
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export function registerErrorLogRoutes(app: FastifyInstance, database: Database) {
  app.get('/api/integration-errors', async (request) => {
    const auth = requirePermission(request, 'workspace.manage')
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(300) })
      .parse(request.query)
    const rows = await database.query(
      `SELECT e.*,c.name AS connection_name,c.provider FROM integration_errors e
      LEFT JOIN integration_connections c ON c.workspace_id=e.workspace_id AND c.id=e.connection_id
      WHERE e.workspace_id=$1 ORDER BY e.created_at DESC LIMIT $2`,
      [auth.workspaceId, limit],
    )
    return { errors: rows.rows.map(publicError) }
  })
}
