import type { AppState, Invoice } from '../src/domain/types'
import type { IntegrationSettings } from '../src/domain/integrations'
import { invoiceSource } from '../src/domain/invoice-source'
import type { Sql } from './db'
import { enqueue } from './jobs'

export async function queueAutomaticInvoice(
  tx: Sql,
  workspaceId: string,
  state: AppState,
  invoice: Invoice,
  explicit = false,
) {
  if (
    invoice.status !== 'draft' ||
    invoice.connectionId ||
    invoice.externalId ||
    invoice.manualDocument ||
    invoice.localOnly ||
    invoice.uncertainJobId
  )
    return undefined
  const order = invoiceSource(state, invoice)
  if (
    !order ||
    order.historical ||
    order.syncError ||
    order.syncStatus === 'error' ||
    (order.status !== 'pending' && !order.inventoryApplied) ||
    ['cancelled', 'returned'].includes(order.status)
  )
    return undefined
  const store = order.storeId
    ? (
        await tx.query<{ enabled: boolean; settings: IntegrationSettings }>(
          'SELECT enabled,settings FROM integration_connections WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
          [workspaceId, order.storeId],
        )
      ).rows[0]
    : undefined
  if (order.storeId && !store?.enabled) return undefined
  if (
    store?.settings.invoiceMode === 'manual' ||
    (store?.settings.invoiceMode === 'on_approval' && order.status === 'pending')
  )
    return undefined
  if (!invoice.automatic && !explicit && store?.settings.invoiceMode !== 'on_approval')
    return undefined
  const selected = store?.settings.invoiceConnectionId
  const target = (
    await tx.query<{ id: string; enabled: boolean; status: string }>(
      `SELECT id,enabled,status FROM integration_connections WHERE workspace_id=$1 AND kind='invoice' AND provider='parasut' AND deleted_at IS NULL AND ${selected ? 'id=$2' : 'is_default'} LIMIT 1`,
      selected ? [workspaceId, selected] : [workspaceId],
    )
  ).rows[0]
  if (!target?.enabled || target.status !== 'verified') return undefined
  const jobId = await enqueue(tx, {
    workspaceId,
    connectionId: target.id,
    kind: 'invoice.create',
    entityId: invoice.id,
    payload: { invoiceId: invoice.id },
    key: `invoice.create:${invoice.id}`,
  })
  invoice.status = 'queued'
  invoice.connectionId = target.id
  return jobId
}
