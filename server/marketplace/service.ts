import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState } from '../../src/domain/types'
import type {
  FinancialRecord,
  MarketplaceClaim,
  MarketplaceQuestion,
  RemoteWorkflow,
  ClaimDecision,
} from '../../src/domain/marketplace'
import { financialBreakdown, sumTicks, ticksToCents } from '../../src/domain/marketplace'
import type { IntegrationService } from '../integration-service'
import type { Sql } from '../db'
import { audit, requireAuth, requirePermission } from '../auth'
import type { AuthContext } from '../auth-types'
import { AppError } from '../errors'
import { identifier, uuid } from '../validation'
import { canonicalJson, sha256 } from '../security'
import { enqueue } from '../jobs'
import { jobPermission } from '../../src/domain/permissions'
import { claimDecisionOptions, validateClaimDecision } from './claim-options'
import { ProviderHttp } from '../integrations/http'

export interface ExternalRow {
  id: string
  connection_id: string
  external_id: string
  resource: 'question' | 'claim' | 'settlement'
  document: MarketplaceQuestion | MarketplaceClaim | FinancialRecord
  workflow: RemoteWorkflow | null
}
export async function externalRecord(tx: Sql, workspaceId: string, id: string, lock = false) {
  const row = (
    await tx.query<ExternalRow>(
      `SELECT id,connection_id,external_id,resource,document,workflow FROM external_records WHERE workspace_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
      [workspaceId, id],
    )
  ).rows[0]
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Pazaryeri kaydı bulunamadı.')
  return row
}

export function registerMarketplaceRoutes(app: FastifyInstance, service: IntegrationService) {
  const database = service.database
  app.get('/api/marketplace/records', async (request) => {
    const auth = requireAuth(request)
    const query = z
      .object({
        resource: z.enum(['question', 'claim', 'settlement']),
        connectionId: uuid.optional(),
        query: z.string().max(200).default(''),
        status: z.string().max(60).optional(),
        kind: z.enum(['entry', 'payout']).optional(),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query)
    const rows = await database.query<
      ExternalRow & { name: string; provider: string; seen_at: string }
    >(
      `SELECT e.*,c.name,c.provider FROM external_records e JOIN integration_connections c ON c.id=e.connection_id
      WHERE e.workspace_id=$1 AND e.resource=$2 AND ($3::uuid IS NULL OR e.connection_id=$3)
      AND ($4::text IS NULL OR e.document->>'status'=$4 OR (e.resource='claim' AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.document->'items') item WHERE item->>'status'=$4)))
      AND ($5::text IS NULL OR e.document->>'kind'=$5)
      AND ($6='' OR e.document->>'text' ILIKE $7 OR e.document->>'productName' ILIKE $7 OR e.document->>'orderNumber' ILIKE $7 OR e.document->>'paymentOrderId' ILIKE $7)
      ORDER BY e.seen_at DESC,e.id LIMIT $8 OFFSET $9`,
      [
        auth.workspaceId,
        query.resource,
        query.connectionId ?? null,
        query.status ?? null,
        query.kind ?? null,
        query.query,
        `%${query.query}%`,
        query.limit + 1,
        query.offset,
      ],
    )
    const state = (
      await database.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [auth.workspaceId],
      )
    ).rows[0].document
    return {
      hasMore: rows.rows.length > query.limit,
      records: rows.rows.slice(0, query.limit).map((row) => {
        const orderNumber = 'orderNumber' in row.document ? row.document.orderNumber : undefined
        return {
          id: row.id,
          connectionId: row.connection_id,
          connectionName: row.name,
          provider: row.provider,
          externalId: row.external_id,
          document: row.document,
          workflow: row.workflow,
          seenAt: new Date(row.seen_at).toISOString(),
          localOrderId: orderNumber
            ? (state.orders.find(
                (o) => o.storeId === row.connection_id && o.externalNumber === orderNumber,
              )?.id ?? null)
            : null,
        }
      }),
    }
  })
  app.get('/api/marketplace/records/:id', async (request) => {
    const auth = requireAuth(request),
      id = uuid.parse((request.params as { id: string }).id)
    const row = await externalRecord(database, auth.workspaceId, id),
      connection = await service.connection(auth.workspaceId, row.connection_id)
    return {
      id: row.id,
      connectionId: row.connection_id,
      connectionName: connection.name,
      provider: connection.provider,
      externalId: row.external_id,
      document: row.document,
      workflow: row.workflow,
    }
  })
  app.post('/api/marketplace/sync', async (request, reply) => {
    const input = z
      .strictObject({
        connectionId: uuid,
        operation: z.enum(['questions.pull', 'claims.pull', 'settlements.pull']),
      })
      .parse(request.body)
    const auth = requirePermission(request, jobPermission(input.operation)),
      key = uuid.parse(request.headers['idempotency-key'])
    const connection = await service.connection(auth.workspaceId, input.connectionId)
    if (
      !connection.enabled ||
      connection.status !== 'verified' ||
      !service.capabilities(connection.provider).includes(input.operation)
    )
      throw new AppError(
        409,
        'CONNECTION_NOT_READY',
        'Bu işlem için bağlantıyı test edip etkinleştirin.',
      )
    const jobId = await database.transaction(async (tx) => {
      await tx.query('SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE', [
        auth.workspaceId,
      ])
      const active = await tx.query<{ id: string }>(
        `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND connection_id=$2 AND kind=$3 AND entity_id IS NULL AND status IN ('queued','running','waiting') ORDER BY sequence LIMIT 1`,
        [auth.workspaceId, connection.id, input.operation],
      )
      if (active.rows[0]) return active.rows[0].id
      const id = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: input.operation,
        key: `marketplace-sync:${connection.id}:${input.operation}:${key}`,
      })
      await audit(tx, auth.workspaceId, auth.userId, 'marketplace.sync_requested', connection.id, {
        operation: input.operation,
        jobId: id,
      })
      return id
    })
    return reply.code(202).send({ ok: true, jobId })
  })
  const action = async (
    auth: AuthContext,
    id: string,
    key: string,
    input: {
      text?: string
      itemIds?: string[]
      decision?: ClaimDecision
      reasonId?: string
      description?: string
      reviewType?: string
      reviewDays?: number
      fileIds?: string[]
    },
  ) => {
    const hash = sha256(canonicalJson({ id, input }))
    const source =
      input.decision && input.decision !== 'approve'
        ? await externalRecord(database, auth.workspaceId, id)
        : undefined
    const checkedConnection = source
      ? await service.connection(auth.workspaceId, source.connection_id)
      : undefined
    const checkedState = checkedConnection
      ? (
          await database.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1',
            [auth.workspaceId],
          )
        ).rows[0].document
      : undefined
    const rules = checkedConnection
      ? await claimDecisionOptions(
          {
            workspaceId: auth.workspaceId,
            connectionId: checkedConnection.id,
            provider: checkedConnection.provider,
            credentials: service.credentials(checkedConnection),
            settings: checkedConnection.settings,
            state: checkedState!,
            integrationName: service.config.integrationName,
          },
          new ProviderHttp(service.fetcher),
        )
      : undefined
    return database.transaction(async (tx) => {
      await tx.query('SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE', [
        auth.workspaceId,
      ])
      const previous = (
        await tx.query<{
          user_id: string
          body_hash: string
          result: { jobId: string; ok: boolean }
        }>(
          'SELECT user_id,body_hash,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
          [auth.workspaceId, key],
        )
      ).rows[0]
      if (previous) {
        if (previous.user_id !== auth.userId || previous.body_hash !== hash)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'İstek anahtarı farklı bir işleme ait.')
        return previous.result
      }
      const record = await externalRecord(tx, auth.workspaceId, id, true),
        connection = await service.connection(auth.workspaceId, record.connection_id, tx)
      const active = await tx.query(
        `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind IN ('question.answer','claim.decide') AND status IN ('queued','running','waiting','uncertain') LIMIT 1`,
        [auth.workspaceId, id],
      )
      if (active.rows.length)
        throw new AppError(
          409,
          'ACTION_PENDING',
          'Bu kayıt için bekleyen işlem var; önce sonucunu doğrulayın.',
        )
      const operation = input.text !== undefined ? 'question.answer' : 'claim.decide'
      if (
        !connection.enabled ||
        connection.status !== 'verified' ||
        !service.capabilities(connection.provider).includes(operation)
      )
        throw new AppError(
          409,
          'CONNECTION_NOT_READY',
          'Bağlantı bu işlem için etkin ve doğrulanmış olmalı.',
        )
      if (record.workflow && ['queued', 'pending', 'uncertain'].includes(record.workflow.state))
        throw new AppError(
          409,
          'ACTION_PENDING',
          'Önceki işlemin sonucu bekleniyor. Kaydı sağlayıcıdan yenileyin.',
        )
      let payload: Record<string, unknown>
      if (input.text !== undefined) {
        if (record.document.kind !== 'question')
          throw new AppError(400, 'WRONG_RESOURCE', 'Bu kayıt müşteri sorusu değil.')
        if (record.document.status !== 'WAITING_FOR_ANSWER')
          throw new AppError(409, 'QUESTION_CLOSED', 'Soru yanıt beklemiyor.')
        payload = {
          questionId: record.document.externalId,
          questionText: record.document.text,
          text: input.text,
        }
      } else {
        if (record.document.kind !== 'claim')
          throw new AppError(400, 'WRONG_RESOURCE', 'Bu kayıt iade talebi değil.')
        const items = input.itemIds ?? [],
          claim = record.document
        if (
          new Set(items).size !== items.length ||
          items.some(
            (id) =>
              !claim.items.some((item) => item.id === id && item.status === 'WaitingInAction'),
          )
        )
          throw new AppError(
            409,
            'CLAIM_NOT_ACTIONABLE',
            'Yalnız bu talebin karar bekleyen iade satırları onaylanabilir.',
          )
        if (
          checkedConnection &&
          checkedConnection.credential_version !== connection.credential_version
        )
          throw new AppError(409, 'CONNECTION_CHANGED', 'Karar hazırlanırken bağlantı değişti.')
        const files = input.fileIds?.length
          ? (
              await tx.query<{ id: string; mime: string }>(
                'SELECT f.id,f.mime FROM claim_documents d JOIN stored_files f ON f.workspace_id=d.workspace_id AND f.id=d.file_id WHERE d.workspace_id=$1 AND d.record_id=$2 AND f.id=ANY($3::uuid[])',
                [auth.workspaceId, id, input.fileIds],
              )
            ).rows
          : []
        if (files.length !== (input.fileIds?.length ?? 0))
          throw new AppError(409, 'CLAIM_FILES_CHANGED', 'Kanıt dosyaları bu talebe ait olmalı.')
        if (rules)
          validateClaimDecision(connection.provider, rules, {
            ...input,
            decision: input.decision ?? 'approve',
            files,
          })
        payload = {
          claimId: claim.externalId,
          orderNumber: claim.orderNumber,
          itemIds: items,
          decision: input.decision ?? 'approve',
          reasonId: input.reasonId,
          description: input.description,
          reviewType: input.reviewType,
          reviewDays: input.reviewDays,
          fileIds: input.fileIds,
        }
      }
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: operation,
        entityId: record.id,
        payload,
        key: `marketplace:${id}:${key}`,
      })
      const workflow: RemoteWorkflow = {
        state: 'queued',
        jobId,
        answer: input.text,
        claimItemIds: input.itemIds,
        decision: input.text === undefined ? (input.decision ?? 'approve') : undefined,
        updatedAt: new Date().toISOString(),
        requestedAt: new Date().toISOString(),
      }
      await tx.query('UPDATE external_records SET workflow=$1 WHERE workspace_id=$2 AND id=$3', [
        JSON.stringify(workflow),
        auth.workspaceId,
        id,
      ])
      const result = { ok: true, jobId }
      await tx.query(
        `INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision) SELECT $1,$2,$3,$4,$5,$6,revision FROM workspace_states WHERE workspace_id=$1`,
        [auth.workspaceId, key, auth.userId, operation, hash, JSON.stringify(result)],
      )
      await audit(tx, auth.workspaceId, auth.userId, operation, id, { jobId })
      return result
    })
  }
  app.post('/api/marketplace/questions/:id/answer', async (request, reply) => {
    const auth = requirePermission(request, 'orders.write'),
      id = uuid.parse((request.params as { id: string }).id),
      input = z.strictObject({ text: z.string().trim().min(10).max(2000) }).parse(request.body)
    return reply
      .code(202)
      .send(await action(auth, id, uuid.parse(request.headers['idempotency-key']), input))
  })
  app.post('/api/marketplace/claims/:id/approve', async (request, reply) => {
    const auth = requirePermission(request, 'finance.write'),
      id = uuid.parse((request.params as { id: string }).id),
      input = z.strictObject({ itemIds: z.array(identifier).min(1).max(100) }).parse(request.body)
    return reply
      .code(202)
      .send(await action(auth, id, uuid.parse(request.headers['idempotency-key']), input))
  })
  app.post('/api/marketplace/claims/:id/decision', async (request, reply) => {
    const auth = requirePermission(request, 'finance.write'),
      id = uuid.parse((request.params as { id: string }).id)
    const input = z
      .strictObject({
        itemIds: z.array(identifier).min(1).max(100),
        decision: z.enum(['approve', 'reject', 'investigate']),
        reasonId: identifier.optional(),
        description: z.string().trim().max(500).optional(),
        reviewType: identifier.optional(),
        reviewDays: z.number().int().min(1).max(14).optional(),
        fileIds: z.array(uuid).max(3).optional(),
      })
      .parse(request.body)
    return reply
      .code(202)
      .send(await action(auth, id, uuid.parse(request.headers['idempotency-key']), input))
  })
  app.post('/api/marketplace/records/:id/refresh', async (request, reply) => {
    const auth = requireAuth(request),
      id = uuid.parse((request.params as { id: string }).id),
      key = uuid.parse(request.headers['idempotency-key'])
    const record = await externalRecord(database, auth.workspaceId, id)
    if (!['question', 'claim'].includes(record.resource))
      throw new AppError(
        400,
        'WRONG_RESOURCE',
        'Finans kayıtlarını bağlantı senkronizasyonundan yenileyin.',
      )
    const connection = await service.connection(auth.workspaceId, record.connection_id)
    if (!connection.enabled || connection.status !== 'verified')
      throw new AppError(
        409,
        'CONNECTION_NOT_READY',
        'Kaydı yenilemek için bağlantı etkin ve doğrulanmış olmalı.',
      )
    const jobId = await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: record.connection_id,
      kind: record.resource === 'question' ? 'questions.pull' : 'claims.pull',
      entityId: record.id,
      payload:
        record.resource === 'question'
          ? { questionId: record.document.externalId }
          : {
              claimId: record.document.externalId,
              orderNumber:
                record.document.kind === 'claim' ? record.document.orderNumber : undefined,
            },
      key: `record-refresh:${id}:${key}`,
    })
    return reply.code(202).send({ ok: true, jobId })
  })
  app.get('/api/marketplace/financial-summary', async (request) => {
    const auth = requireAuth(request),
      connectionId = z.object({ connectionId: uuid.optional() }).parse(request.query).connectionId
    const rows = await database.query<{ document: FinancialRecord }>(
      `SELECT document FROM external_records WHERE workspace_id=$1 AND resource='settlement' AND document->>'kind'='payout' AND document->>'status'='PAID' AND ($2::uuid IS NULL OR connection_id=$2)`,
      [auth.workspaceId, connectionId ?? null],
    )
    const state = (
      await database.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [auth.workspaceId],
      )
    ).rows[0].document
    return {
      payoutCount: rows.rows.length,
      payoutCents: ticksToCents(sumTicks(rows.rows.map((r) => r.document.amountTicks))),
      matches: (state.settlementMatches ?? []).filter(
        (m) => !connectionId || m.connectionId === connectionId,
      ),
    }
  })
  app.get('/api/marketplace/payouts/:id', async (request) => {
    const auth = requireAuth(request),
      id = uuid.parse((request.params as { id: string }).id)
    const payout = await externalRecord(database, auth.workspaceId, id)
    if (payout.document.kind !== 'payout')
      throw new AppError(400, 'NOT_A_PAYOUT', 'Ödeme emri seçin.')
    const rows = await database.query<{ id: string; document: FinancialRecord }>(
      `SELECT id,document FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND resource='settlement' AND document->>'kind'='entry' AND document->>'paymentOrderId'=$3 AND ($4::text IS NULL OR workflow->>'jobId'=$4) ORDER BY document->>'transactionDate',id`,
      [
        auth.workspaceId,
        payout.connection_id,
        payout.document.paymentOrderId,
        payout.workflow?.jobId ?? null,
      ],
    )
    const summary = financialBreakdown(rows.rows.map((r) => r.document))
    const complete = payout.workflow?.state === 'confirmed'
    const differenceTicks =
      complete && summary.netTicks !== null
        ? (BigInt(summary.netTicks) - BigInt(payout.document.amountTicks!)).toString()
        : null
    return {
      connectionId: payout.connection_id,
      payout: payout.document,
      workflow: payout.workflow,
      complete,
      summary,
      differenceTicks,
    }
  })
  app.post('/api/marketplace/payouts/:id/refresh', async (request, reply) => {
    const auth = requirePermission(request, 'finance.write'),
      id = uuid.parse((request.params as { id: string }).id),
      key = uuid.parse(request.headers['idempotency-key'])
    const jobId = await database.transaction(async (tx) => {
      await tx.query('SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE', [
        auth.workspaceId,
      ])
      const record = await externalRecord(tx, auth.workspaceId, id, true)
      if (record.document.kind !== 'payout')
        throw new AppError(400, 'NOT_A_PAYOUT', 'Ödeme emri seçin.')
      const connection = await service.connection(auth.workspaceId, record.connection_id, tx)
      if (
        !connection.enabled ||
        connection.status !== 'verified' ||
        !service.capabilities(connection.provider).includes('settlements.pull')
      )
        throw new AppError(409, 'CONNECTION_NOT_READY', 'Bağlantıyı test edip etkinleştirin.')
      const active = await tx.query<{ id: string }>(
        `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind='settlements.pull' AND status IN ('queued','running','waiting') LIMIT 1`,
        [auth.workspaceId, id],
      )
      if (active.rows[0]) return active.rows[0].id
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: record.connection_id,
        kind: 'settlements.pull',
        entityId: id,
        payload: { paymentOrderId: record.document.paymentOrderId },
        key: `payout-details:${id}:${key}`,
      })
      const job = (
        await tx.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
          jobId,
        ])
      ).rows[0]
      if (job.status === 'queued')
        await tx.query('UPDATE external_records SET workflow=$1 WHERE workspace_id=$2 AND id=$3', [
          JSON.stringify({
            state: 'queued',
            jobId,
            updatedAt: new Date().toISOString(),
          } satisfies RemoteWorkflow),
          auth.workspaceId,
          id,
        ])
      await audit(tx, auth.workspaceId, auth.userId, 'settlement.details_requested', id, { jobId })
      return jobId
    })
    return reply.code(202).send({ ok: true, jobId })
  })
  app.post('/api/marketplace/payouts/:id/match', async (request) => {
    const auth = requirePermission(request, 'finance.write'),
      id = uuid.parse((request.params as { id: string }).id),
      { cashEntryId } = z.strictObject({ cashEntryId: identifier }).parse(request.body)
    await database.transaction(async (tx) => {
      const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
            [auth.workspaceId],
          )
        ).rows[0],
        record = await externalRecord(tx, auth.workspaceId, id)
      if (
        record.resource !== 'settlement' ||
        record.document.kind !== 'payout' ||
        record.document.status !== 'PAID' ||
        !record.document.amountTicks
      )
        throw new AppError(409, 'NOT_A_PAYOUT', 'Bu kayıt ödenmiş bir hakediş emri değil.')
      const paymentOrderId = record.document.paymentOrderId!,
        amount = ticksToCents(record.document.amountTicks)
      const cash = row.document.cash.find((c) => c.id === cashEntryId)
      if (
        !cash ||
        cash.kind !== 'in' ||
        cash.transferId ||
        cash.customerId ||
        amount <= 0 ||
        cash.method !== 'transfer' ||
        cash.amount !== amount
      )
        throw new AppError(
          409,
          'CASH_MISMATCH',
          'Aynı tutarlı havale tahsilatı seçin. Virmanlar hakediş tahsilatı sayılmaz.',
        )
      const matches = row.document.settlementMatches ?? []
      const existing = matches.find(
        (m) => m.connectionId === record.connection_id && m.paymentOrderId === paymentOrderId,
      )
      if (existing) {
        if (existing.cashEntryId !== cashEntryId)
          throw new AppError(409, 'ALREADY_MATCHED', 'Hakediş başka bir tahsilatla eşleşmiş.')
        return
      }
      if (matches.some((m) => m.cashEntryId === cashEntryId))
        throw new AppError(
          409,
          'CASH_ALREADY_MATCHED',
          'Bu tahsilat başka bir hakedişte kullanılmış.',
        )
      row.document.settlementMatches = [
        ...matches,
        {
          id: randomUUID(),
          connectionId: record.connection_id,
          paymentOrderId,
          cashEntryId,
          amount,
          matchedAt: new Date().toISOString(),
        },
      ]
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'settlement.matched', id, {
        cashEntryId,
        paymentOrderId,
      })
    })
    return { ok: true }
  })
  app.delete('/api/marketplace/payouts/:id/match', async (request) => {
    const auth = requirePermission(request, 'finance.write'),
      id = uuid.parse((request.params as { id: string }).id),
      { matchId } = z.strictObject({ matchId: uuid }).parse(request.body)
    await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const payout = await externalRecord(tx, auth.workspaceId, id)
      if (payout.document.kind !== 'payout')
        throw new AppError(400, 'NOT_A_PAYOUT', 'Ödeme emri seçin.')
      const selected = row.document.settlementMatches?.find((m) => m.id === matchId)
      if (!selected) return
      if (
        selected.connectionId !== payout.connection_id ||
        selected.paymentOrderId !== payout.document.paymentOrderId
      )
        throw new AppError(409, 'MATCH_CHANGED', 'Hakediş eşlemesi değişti. Güncel kaydı açın.')
      row.document.settlementMatches = row.document.settlementMatches!.filter(
        (m) => m.id !== matchId,
      )
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'settlement.unmatched', id, { matchId })
    })
    return { ok: true }
  })
}
