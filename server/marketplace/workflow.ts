import type {
  MarketplaceQuestion,
  MarketplaceClaim,
  RemoteWorkflow,
} from '../../src/domain/marketplace'
import type { AdapterResult } from '../integrations/contracts'
import type { StoredJob } from '../jobs'
import { enqueue } from '../jobs'
import type { Sql } from '../db'
import { audit } from '../auth'

export async function applyMarketplaceWorkflow(tx: Sql, job: StoredJob, result: AdapterResult) {
  if (job.kind === 'settlements.pull' && job.payload.paymentOrderId) {
    for (const item of result.records ?? [])
      if (item.resource === 'settlement')
        await tx.query(
          `UPDATE external_records SET workflow=$1 WHERE workspace_id=$2 AND connection_id=$3 AND resource='settlement' AND external_id=$4`,
          [
            JSON.stringify({
              state: 'confirmed',
              jobId: job.id,
              updatedAt: new Date().toISOString(),
            } satisfies RemoteWorkflow),
            job.workspace_id,
            job.connection_id,
            item.id,
          ],
        )
    await tx.query(
      `UPDATE external_records SET workflow=workflow||$1::jsonb WHERE workspace_id=$2 AND id=$3 AND workflow->>'jobId'=$4`,
      [
        JSON.stringify({
          state: result.financialDetails ? 'confirmed' : 'pending',
          message: result.financialDetails
            ? 'Hakedişin tüm detay sayfaları alındı.'
            : 'Hakediş detayları alınıyor.',
          updatedAt: new Date().toISOString(),
        }),
        job.workspace_id,
        job.entity_id,
        job.id,
      ],
    )
  }
  for (const item of result.records ?? []) {
    if (!['question', 'claim'].includes(item.resource)) continue
    const row = (
      await tx.query<{ id: string; workflow: RemoteWorkflow | null }>(
        `SELECT id,workflow FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND resource=$3 AND external_id=$4`,
        [job.workspace_id, job.connection_id, item.resource, item.id],
      )
    ).rows[0]
    const workflow = row?.workflow
    if (!workflow || !['pending', 'uncertain'].includes(workflow.state)) continue
    const data = item.data as unknown as MarketplaceQuestion | MarketplaceClaim
    let next: RemoteWorkflow['state'] | undefined
    if (data.kind === 'question' && workflow.answer) {
      if (data.status === 'ANSWERED' && data.answer === workflow.answer) next = 'confirmed'
      else if (
        data.rejectedAnswer === workflow.answer &&
        (data.status === 'REJECTED' ||
          (data.rejectedAt &&
            new Date(data.rejectedAt).getTime() >=
              new Date(workflow.requestedAt ?? workflow.updatedAt).getTime() - 1000))
      )
        next = 'rejected'
      else if (data.status === 'ANSWERED' && data.answer !== workflow.answer) next = 'rejected'
    }
    if (data.kind === 'claim' && workflow.claimItemIds?.length) {
      const selected = workflow.claimItemIds.map((id) => data.items.find((i) => i.id === id))
      const expected =
        workflow.decision === 'reject'
          ? ['Rejected', 'RejectedBySeller']
          : workflow.decision === 'investigate'
            ? ['InAnalysis']
            : ['Accepted']
      if (selected.every((i) => i && expected.includes(i.status))) next = 'confirmed'
      else if (
        selected.some(
          (i) =>
            i &&
            ['Accepted', 'Rejected', 'RejectedBySeller', 'Cancelled'].includes(i.status) &&
            !expected.includes(i.status),
        )
      )
        next = 'rejected'
    }
    if (!next) continue
    const updated = {
      ...workflow,
      state: next,
      message:
        next === 'confirmed'
          ? 'Sonuç sağlayıcıdan doğrulandı.'
          : 'Sağlayıcı işlemi sonuçlandırmadı veya reddetti.',
      updatedAt: new Date().toISOString(),
    }
    await tx.query('UPDATE external_records SET workflow=$1 WHERE workspace_id=$2 AND id=$3', [
      JSON.stringify(updated),
      job.workspace_id,
      row.id,
    ])
    if (next === 'confirmed')
      await tx.query(
        `UPDATE integration_jobs SET status='completed',last_error=NULL,finished_at=now(),result=$1 WHERE workspace_id=$2 AND id=$3 AND status='uncertain'`,
        [
          JSON.stringify({ message: 'Sağlayıcı kaydıyla doğrulandı.', verificationJobId: job.id }),
          job.workspace_id,
          workflow.jobId,
        ],
      )
    else
      await tx.query(
        `UPDATE integration_jobs SET status='failed',last_error='PROVIDER_REJECTED: Sonuç sağlayıcı kaydıyla doğrulandı.',finished_at=now(),result=$1 WHERE workspace_id=$2 AND id=$3 AND status IN ('uncertain','completed')`,
        [
          JSON.stringify({ message: updated.message, verificationJobId: job.id }),
          job.workspace_id,
          workflow.jobId,
        ],
      )
    await audit(tx, job.workspace_id, null, 'marketplace.action_verified', row.id, {
      state: next,
      sourceJobId: workflow.jobId,
    })
  }
  const action = result.marketplaceAction
  if (!action) return
  const row = (
    await tx.query<{ id: string; workflow: RemoteWorkflow | null }>(
      `SELECT id,workflow FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND resource=$3 AND external_id=$4`,
      [job.workspace_id, job.connection_id, action.resource, action.externalId],
    )
  ).rows[0]
  if (!row || row.workflow?.jobId !== job.id) return
  const workflow: RemoteWorkflow = {
    state: action.confirmed ? 'confirmed' : 'pending',
    jobId: job.id,
    answer: action.answer,
    claimItemIds: action.itemIds,
    decision: action.decision ?? row.workflow.decision,
    message: result.message,
    updatedAt: new Date().toISOString(),
    requestedAt: row.workflow.requestedAt ?? row.workflow.updatedAt,
  }
  await tx.query('UPDATE external_records SET workflow=$1 WHERE workspace_id=$2 AND id=$3', [
    JSON.stringify(workflow),
    job.workspace_id,
    row.id,
  ])
  if (!action.confirmed)
    await enqueue(tx, {
      workspaceId: job.workspace_id,
      connectionId: job.connection_id!,
      kind: action.resource === 'question' ? 'questions.pull' : 'claims.pull',
      entityId: row.id,
      payload:
        action.resource === 'question'
          ? { questionId: action.externalId }
          : { claimId: action.externalId, orderNumber: job.payload.orderNumber },
      key: `verify-marketplace:${job.id}`,
      delaySeconds: 15,
    })
}
