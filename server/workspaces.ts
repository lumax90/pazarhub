import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { executeCommand } from '../src/domain/operations'
import type { AppState, Command, CommandResult } from '../src/domain/types'
import type { Permission } from '../src/domain/permissions'
import type { AuthContext } from './auth-types'
import type { Database, Sql } from './db'
import { assertPermission, audit, requireAuth } from './auth'
import { AppError } from './errors'
import { canonicalJson, sha256 } from './security'
import { commandSchema, uuid } from './validation'
import { enqueue } from './jobs'
import { createAdapter } from './integrations/registry'
import { ProviderHttp } from './integrations/http'
import type { ProviderId } from '../src/domain/integrations'
import { invoiceLinkKey } from './invoice-link'
import { queueAutomaticInvoice } from './invoice-automation'

interface StateRow {
  document: AppState
  revision: string | number
}
const commandPermissions: Record<Command['type'], Permission> = {
  'order.create': 'orders.write',
  'order.transition': 'orders.write',
  'order.pay': 'finance.write',
  'order.prepare': 'orders.write',
  'order.note.add': 'orders.write',
  'order.invoice': 'finance.write',
  'invoice.create': 'finance.write',
  'invoice.document.link': 'finance.write',
  'invoice.document.unlink': 'finance.write',
  'invoice.category.save': 'finance.write',
  'invoice.category.delete': 'finance.write',
  'invoice.category.set': 'finance.write',
  'invoice.pay.bulk': 'finance.write',
  'invoice.edit': 'finance.write',
  'invoice.pay': 'finance.write',
  'invoice.unpay': 'finance.write',
  'invoice.cancel': 'finance.write',
  'invoice.restore': 'finance.write',
  'invoice.delete': 'finance.write',
  'order.print': 'orders.write',
  'order.tax': 'orders.write',
  'order.invoice.preference': 'finance.write',
  'order.filter.save': 'orders.write',
  'order.filter.delete': 'orders.write',
  'retail.sale': 'retail.write',
  'product.save': 'catalog.write',
  'product.patch': 'catalog.write',
  'definition.save': 'catalog.write',
  'definition.move': 'catalog.write',
  'definition.delete': 'catalog.write',
  'definition.value.delete': 'catalog.write',
  'stock.adjust': 'stock.write',
  'customer.save': 'orders.write',
  'listing.update': 'catalog.write',
  'connection.update': 'integrations.manage',
  'preferences.update': 'workspace.read',
  'ecommerce.settings': 'workspace.manage',
  'business.update': 'workspace.manage',
  'warehouse.save': 'stock.write',
  'warehouse.delete': 'stock.write',
  'stock.record': 'stock.write',
  'stock.thresholds': 'stock.write',
  'stock.transfer': 'stock.write',
  'stock.count.create': 'stock.write',
  'stock.count.complete': 'stock.write',
  'sale.return': 'retail.write',
  'cash.record': 'finance.write',
  'cash.transfer': 'finance.write',
  'customer.entry': 'finance.write',
  'expense.create': 'finance.write',
  'expense.pay': 'finance.write',
  'margin.save': 'catalog.write',
  'margin.delete': 'catalog.write',
  'margin.settings': 'catalog.write',
  'margin.apply': 'catalog.write',
  'product.bulk': 'catalog.write',
}

export async function workspaceSnapshot(database: Sql, auth: AuthContext) {
  const row = (
    await database.query<StateRow>(
      'SELECT document,revision FROM workspace_states WHERE workspace_id=$1',
      [auth.workspaceId],
    )
  ).rows[0]
  if (!row) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Çalışma alanı bulunamadı.')
  const state = structuredClone(row.document)
  const connections = await database.query<{
    id: string
    provider: AppState['connections'][number]['channel']
    name: string
    enabled: boolean
  }>(
    `SELECT id,provider,name,enabled FROM integration_connections WHERE workspace_id=$1 AND kind='marketplace' AND deleted_at IS NULL ORDER BY created_at`,
    [auth.workspaceId],
  )
  state.connections = connections.rows.map((connection) => ({
    id: connection.id,
    channel: connection.provider,
    name: connection.name,
    active: connection.enabled,
  }))
  const membership = (
    await database.query<{ preferences: AuthContext['preferences'] }>(
      'SELECT preferences FROM memberships WHERE workspace_id=$1 AND user_id=$2',
      [auth.workspaceId, auth.userId],
    )
  ).rows[0]
  state.preferences = { ...state.preferences, ...membership?.preferences }
  return { state, revision: Number(row.revision), serverTime: new Date().toISOString() }
}

export async function executeWorkspaceCommand(
  database: Database,
  auth: AuthContext,
  command: Command,
  requestKey: string,
) {
  assertPermission(auth, commandPermissions[command.type])
  if (
    command.type === 'order.create' &&
    (command.input.paid || command.input.invoicePreference === 'immediate')
  )
    assertPermission(auth, 'finance.write')
  if (command.type === 'expense.create' && command.expense.purchaseLines?.length)
    assertPermission(auth, 'stock.write')
  if (command.type === 'connection.update')
    throw new AppError(
      400,
      'USE_CONNECTION_API',
      'Gerçek bağlantılar entegrasyon ekranından yönetilir.',
    )
  const hash = sha256(canonicalJson(command))
  const execution = await database.transaction(async (tx) => {
    const row = (
      await tx.query<StateRow>(
        'SELECT document,revision FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
        [auth.workspaceId],
      )
    ).rows[0]
    if (!row) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Çalışma alanı bulunamadı.')
    const previous = (
      await tx.query<{ body_hash: string; user_id: string; result: CommandResult }>(
        'SELECT body_hash,user_id,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
        [auth.workspaceId, requestKey],
      )
    ).rows[0]
    if (previous) {
      if (previous.body_hash !== hash || previous.user_id !== auth.userId)
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'İşlem anahtarı farklı bir istekte kullanılmış.',
        )
      return previous.result
    }
    let result: CommandResult
    let state = row.document
    const effective = structuredClone(command)
    if (effective.type === 'preferences.update') {
      if (effective.preferences.businessName !== state.preferences.businessName)
        assertPermission(auth, 'workspace.manage')
      await tx.query(
        'UPDATE memberships SET preferences=preferences||$1::jsonb WHERE workspace_id=$2 AND user_id=$3',
        [
          JSON.stringify({
            theme: effective.preferences.theme,
            density: effective.preferences.density,
            orderColumns: effective.preferences.orderColumns,
            notifications: effective.preferences.notifications,
          }),
          auth.workspaceId,
          auth.userId,
        ],
      )
      await tx.query('UPDATE workspaces SET name=$1 WHERE id=$2', [
        effective.preferences.businessName,
        auth.workspaceId,
      ])
      state.preferences.businessName = effective.preferences.businessName
      result = { ok: true, message: 'Tercihleriniz kaydedildi.' }
    } else {
      if (effective.type.startsWith('invoice.')) {
        if (
          [
            'invoice.create',
            'invoice.edit',
            'invoice.cancel',
            'invoice.restore',
            'invoice.delete',
            'invoice.category.set',
            'invoice.document.link',
            'invoice.document.unlink',
          ].includes(effective.type)
        ) {
          const invoice = state.invoices.find(
            (item) => item.id === ('id' in effective ? effective.id : undefined),
          )
          const catalog =
            effective.type === 'invoice.create' || effective.type === 'invoice.edit'
              ? effective.input.items.some((item) => item.kind !== 'free') ||
                invoice?.document?.lines.some((line) => line.kind !== 'free')
              : invoice?.document?.lines.some((line) => line.kind !== 'free')
          if (
            catalog &&
            !['invoice.category.set', 'invoice.document.link', 'invoice.document.unlink'].includes(
              effective.type,
            )
          )
            assertPermission(auth, 'stock.write')
          if (
            invoice &&
            (
              await tx.query(
                "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind LIKE 'invoice.%' AND status IN ('queued','running','waiting','uncertain') LIMIT 1",
                [auth.workspaceId, invoice.id],
              )
            ).rows.length
          )
            throw new AppError(
              409,
              'INVOICE_BUSY',
              'Fatura işlemi sürüyor veya sonucu doğrulanmalı. Önce mevcut işlemi kontrol edin.',
            )
          if (effective.type === 'invoice.document.unlink' && invoice?.orderId) {
            const sent = await tx.query<{
              id: string
              status: string
              payload: Record<string, unknown>
            }>(
              "SELECT id,status,payload FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind='invoice.link' AND (status IN ('queued','waiting','running','completed','uncertain') OR payload ? 'invoiceLinkWriteStartedAt') FOR UPDATE",
              [auth.workspaceId, invoice.orderId],
            )
            if (
              sent.rows.some(
                (job) =>
                  ['running', 'completed', 'uncertain'].includes(job.status) ||
                  job.payload.invoiceLinkWriteStartedAt,
              )
            )
              throw new AppError(
                409,
                'INVOICE_LINK_COMMITTED',
                'Pazaryerine gönderilmiş veya sonucu belirsiz fatura bağlantısı kaldırılamaz. Önce pazaryeri belgesini doğrulayın.',
              )
          }
        }
      }
      if (['margin.save', 'margin.settings', 'margin.apply'].includes(effective.type)) {
        state = structuredClone(state)
        const connections = await tx.query<{
          id: string
          provider: AppState['connections'][number]['channel']
          name: string
          enabled: boolean
        }>(
          "SELECT id,provider,name,enabled FROM integration_connections WHERE workspace_id=$1 AND kind='marketplace' AND deleted_at IS NULL",
          [auth.workspaceId],
        )
        state.connections = connections.rows.map((item) => ({
          id: item.id,
          channel: item.provider,
          name: item.name,
          active: item.enabled,
        }))
      }
      if (
        effective.type === 'warehouse.delete' &&
        (
          await tx.query(
            `SELECT id FROM integration_connections WHERE workspace_id=$1 AND deleted_at IS NULL AND settings->>'warehouseId'=$2 LIMIT 1`,
            [auth.workspaceId, effective.id],
          )
        ).rows.length
      )
        throw new AppError(
          409,
          'WAREHOUSE_IN_USE',
          'Mağaza bağlantısında kullanılan depo silinemez.',
        )
      if (effective.type === 'order.invoice.preference') {
        const invoice = state.invoices.find((invoice) => invoice.orderId === effective.id)
        if (
          invoice &&
          (
            await tx.query(
              `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind IN ('invoice.create','invoice.finalize') AND status IN ('queued','running','waiting','uncertain')`,
              [auth.workspaceId, invoice.id],
            )
          ).rows.length
        )
          throw new AppError(
            409,
            'INVOICE_BUSY',
            'Fatura işlemi sürüyor veya sonucu doğrulanmalı. Önce mevcut işlemi kontrol edin.',
          )
      }
      if (effective.type === 'product.save') {
        const old = state.products.find((item) => item.id === effective.product.id)
        if (old && (old.version ?? 0) !== (effective.product.version ?? 0))
          throw new AppError(
            409,
            'ENTITY_CHANGED',
            'Ürün başka bir işlemle değişti. Kartı yeniden açıp güncel bilgileri kontrol edin.',
          )
        effective.product.version = (old?.version ?? 0) + 1
      }
      if (effective.type === 'customer.save') {
        const old = state.customers.find((item) => item.id === effective.customer.id)
        if (old && (old.version ?? 0) !== (effective.customer.version ?? 0))
          throw new AppError(
            409,
            'ENTITY_CHANGED',
            'Müşteri kartı değişti. Güncel kaydı yeniden açın.',
          )
        effective.customer.version = (old?.version ?? 0) + 1
      }
      if (effective.type === 'order.transition') {
        const order = state.orders.find((item) => item.id === effective.id)
        if (
          order?.externalId &&
          ['shipped', 'delivered', 'cancelled', 'returned'].includes(effective.status)
        ) {
          throw new AppError(
            409,
            'REMOTE_ORDER_ACTION',
            'Pazaryeri siparişinin kargo, iptal ve iade işlemleri ilgili platform işlemiyle yürütülür.',
          )
        }
      }
      const targetListingStatus = effective.type === 'listing.update' ? effective.status : undefined
      if (effective.type === 'listing.update' && targetListingStatus) {
        if (!['active', 'archived'].includes(targetListingStatus))
          throw new AppError(
            400,
            'REMOTE_STATUS',
            'İlan sonucu pazaryerinden alınır; elle bu duruma getirilemez.',
          )
        delete effective.status
      }
      const outcome = executeCommand(state, effective)
      state = outcome.state
      result = outcome.result
      if (result.ok && state.movements.length > row.document.movements.length) {
        for (const movement of state.movements.slice(
          0,
          state.movements.length - row.document.movements.length,
        ))
          movement.author = auth.name
      }
      if (result.ok && effective.type === 'order.note.add') {
        const note = state.orders
          .find((order) => order.id === effective.id)
          ?.notes?.find((note) => note.id === effective.noteId)
        if (
          note &&
          !row.document.orders
            .find((order) => order.id === effective.id)
            ?.notes?.some((note) => note.id === effective.noteId)
        )
          note.author = auth.name
      }
      if (result.ok && effective.type === 'order.create' && effective.input.internalNote?.trim()) {
        const order = state.orders.find((order) => order.id === result.id)
        if (order?.notes?.[0]) order.notes[0].author = auth.name
      }
      const immediateId =
        result.ok &&
        effective.type === 'order.create' &&
        effective.input.invoicePreference === 'immediate'
          ? result.id
          : result.ok &&
              effective.type === 'order.invoice.preference' &&
              effective.preference === 'immediate'
            ? effective.id
            : undefined
      if (immediateId) {
        const order = state.orders.find((order) => order.id === immediateId)!
        const invoice = state.invoices.find((invoice) => invoice.orderId === order.id)!
        const connectionId =
          effective.type === 'order.create'
            ? effective.input.invoiceConnectionId
            : effective.type === 'order.invoice.preference'
              ? effective.connectionId || invoice.connectionId
              : undefined
        if (order.syncError)
          throw new AppError(
            409,
            'ORDER_RECONCILIATION_REQUIRED',
            'Faturadan önce sipariş kalemlerini uzlaştırın.',
          )
        if (!connectionId || (invoice.connectionId && invoice.connectionId !== connectionId))
          throw new AppError(
            409,
            'INVOICE_ACCOUNT_REQUIRED',
            'Faturanın bağlı olduğu Paraşüt hesabını seçin.',
          )
        const connection = (
          await tx.query<{ id: string }>(
            `SELECT id FROM integration_connections WHERE workspace_id=$1 AND id=$2 AND kind='invoice' AND provider='parasut' AND enabled=true AND status='verified' AND deleted_at IS NULL`,
            [auth.workspaceId, connectionId],
          )
        ).rows[0]
        if (!connection)
          throw new AppError(
            409,
            'INVOICE_PROVIDER_NOT_READY',
            'Etkin ve test edilmiş bir Paraşüt hesabı seçin.',
          )
        const kind = invoice.externalId ? 'invoice.finalize' : 'invoice.create'
        const jobId = await enqueue(tx, {
          workspaceId: auth.workspaceId,
          connectionId,
          kind,
          entityId: invoice.id,
          payload: { invoiceId: invoice.id },
          key: `${kind}:${invoice.id}`,
        })
        const job = (
          await tx.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
            jobId,
          ])
        ).rows[0]
        if (!['queued', 'running', 'waiting'].includes(job.status))
          throw new AppError(
            409,
            'INVOICE_RESULT_REQUIRED',
            'Önceki fatura işleminin sonucunu İşlem Merkezi’nden kontrol edin.',
          )
        invoice.connectionId = connectionId
        if (!invoice.externalId) invoice.status = 'queued'
        result.jobId = jobId
        result.message =
          effective.type === 'order.create'
            ? 'Sipariş oluşturuldu; Paraşüt işlemi sıraya alındı.'
            : 'Fatura tercihi kaydedildi; Paraşüt işlemi sıraya alındı.'
      }
      if (result.ok && command.type === 'listing.update' && targetListingStatus) {
        const listing = state.listings.find((item) => item.id === command.id)!
        if (!listing.externalId)
          throw new AppError(
            409,
            'LISTING_MAPPING_REQUIRED',
            'Önce pazaryeri ilanını yerel varyantla eşleştirin.',
          )
        result.jobId = await enqueue(tx, {
          workspaceId: auth.workspaceId,
          connectionId: listing.storeId,
          kind: 'inventory.push',
          entityId: listing.id,
          payload: { listingId: listing.id, archive: targetListingStatus === 'archived' },
          key: `${requestKey}:listing`,
        })
        listing.desiredStatus = targetListingStatus === 'archived' ? 'archived' : 'active'
        listing.syncStatus = 'queued'
        result.message = 'Pazaryeri işlemi kuyruğa alındı; sonuç işlem merkezinde izlenebilir.'
      }
      if (result.ok && effective.type === 'invoice.document.link') {
        const invoice = state.invoices.find((invoice) => invoice.id === effective.id)!
        invoice.manualDocument!.linkedBy = auth.name
        const order = state.orders.find((order) => order.id === invoice.orderId)
        if (order?.storeId && order.externalId) {
          const store = (
            await tx.query<{
              id: string
              provider: ProviderId
              enabled: boolean
              status: string
              settings: { sendInvoiceLink?: boolean }
            }>(
              'SELECT id,provider,enabled,status,settings FROM integration_connections WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
              [auth.workspaceId, order.storeId],
            )
          ).rows[0]
          if (
            store?.enabled &&
            store.status === 'verified' &&
            store.settings.sendInvoiceLink !== false &&
            createAdapter(store.provider, new ProviderHttp()).capabilities.includes('invoice.link')
          ) {
            result.jobId = await enqueue(tx, {
              workspaceId: auth.workspaceId,
              connectionId: store.id,
              kind: 'invoice.link',
              entityId: order.id,
              payload: {
                orderId: order.id,
                invoiceLinkKey: invoiceLinkKey(state, order.id),
                automaticInvoiceLink: true,
              },
              key: `invoice.link:${invoice.id}:manual:${requestKey}`,
            })
            result.message = 'Dış fatura bağlandı; pazaryerine link iletimi kuyruğa alındı.'
          }
        }
      }
      if (result.ok && effective.type === 'invoice.document.unlink') {
        const invoice = state.invoices.find((invoice) => invoice.id === effective.id)!
        if (invoice.orderId)
          await tx.query(
            "UPDATE integration_jobs SET status='cancelled',finished_at=now() WHERE workspace_id=$1 AND entity_id=$2 AND kind='invoice.link' AND status IN ('queued','waiting')",
            [auth.workspaceId, invoice.orderId],
          )
      }
      if (result.ok && command.type === 'order.transition' && command.status === 'approved') {
        const order = state.orders.find((item) => item.id === command.id)!
        const source = order.storeId
          ? (
              await tx.query<{
                provider: ProviderId
                enabled: boolean
                settings: { invoiceMode?: string; invoiceConnectionId?: string }
              }>(
                'SELECT provider,enabled,settings FROM integration_connections WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
                [auth.workspaceId, order.storeId],
              )
            ).rows[0]
          : undefined
        if (
          order.externalId &&
          order.storeId &&
          source?.enabled &&
          createAdapter(source.provider, new ProviderHttp()).capabilities.includes('order.update')
        ) {
          await enqueue(tx, {
            workspaceId: auth.workspaceId,
            connectionId: order.storeId,
            kind: 'order.update',
            entityId: order.id,
            payload: { orderId: order.id, action: 'approve' },
            key: `${requestKey}:order`,
          })
          order.syncStatus = 'pending'
        }
      }
      if (
        result.ok &&
        ['order.create', 'order.transition', 'order.invoice', 'invoice.create'].includes(
          effective.type,
        )
      ) {
        const previousIds = new Set(row.document.invoices.map((invoice) => invoice.id))
        for (const invoice of state.invoices) {
          const created = !previousIds.has(invoice.id),
            related = effective.type === 'order.transition' && invoice.orderId === effective.id
          if (!created && !related) continue
          const jobId = await queueAutomaticInvoice(tx, auth.workspaceId, state, invoice, created)
          if (jobId) {
            result.jobId ??= jobId
            result.message += ' Fatura sağlayıcı işlemi kuyruğa alındı.'
          }
        }
      }
      if (
        result.ok &&
        command.type === 'order.transition' &&
        ['cancelled', 'returned'].includes(command.status)
      ) {
        const order = state.orders.find((item) => item.id === command.id)
        if (order?.invoiceId)
          await tx.query(
            `UPDATE integration_jobs SET status='cancelled',finished_at=now() WHERE workspace_id=$1 AND entity_id=$2 AND kind IN ('invoice.create','invoice.finalize') AND status IN ('queued','waiting')`,
            [auth.workspaceId, order.invoiceId],
          )
      }
      if (
        result.ok &&
        [
          'order.create',
          'invoice.create',
          'invoice.edit',
          'invoice.cancel',
          'invoice.restore',
          'invoice.delete',
          'order.transition',
          'retail.sale',
          'stock.adjust',
          'stock.record',
          'product.save',
          'product.patch',
          'listing.update',
          'sale.return',
          'stock.transfer',
          'stock.count.complete',
          'expense.create',
          'margin.save',
          'margin.delete',
          'margin.settings',
          'margin.apply',
          'ecommerce.settings',
          'product.bulk',
        ].includes(command.type)
      ) {
        const connections = await tx.query<{ id: string }>(
          `SELECT id FROM integration_connections WHERE workspace_id=$1 AND enabled=true AND status='verified' AND deleted_at IS NULL AND settings->>'pushInventory'='true'`,
          [auth.workspaceId],
        )
        for (const connection of connections.rows)
          await enqueue(tx, {
            workspaceId: auth.workspaceId,
            connectionId: connection.id,
            kind: 'inventory.reconcile',
            payload: {},
            key: `${requestKey}:stock:${connection.id}`,
          })
      }
    }
    const revision = Number(row.revision) + (result.ok ? 1 : 0)
    if (result.ok && command.type === 'order.print') {
      const order = state.orders.find((order) => order.id === command.id)
      if (order?.printStatus && !order.printStatus.author) order.printStatus.author = auth.name
    }
    if (result.ok)
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=$2,updated_at=now() WHERE workspace_id=$3',
        [JSON.stringify(state), revision, auth.workspaceId],
      )
    await tx.query(
      'INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        auth.workspaceId,
        requestKey,
        auth.userId,
        command.type,
        hash,
        JSON.stringify(result),
        revision,
      ],
    )
    await audit(tx, auth.workspaceId, auth.userId, command.type, result.id, {
      ok: result.ok,
      requestKey,
    })
    return result
  })
  return { result: execution, ...(await workspaceSnapshot(database, auth)) }
}

export function registerWorkspaceRoutes(app: FastifyInstance, database: Database) {
  app.get('/api/workspace', async (request) => workspaceSnapshot(database, requireAuth(request)))
  app.get('/api/workspace/revision', async (request) => {
    const auth = requireAuth(request)
    const row = (
      await database.query<{ revision: number; updated_at: string }>(
        'SELECT revision,updated_at FROM workspace_states WHERE workspace_id=$1',
        [auth.workspaceId],
      )
    ).rows[0]
    return { revision: Number(row?.revision ?? 0), updatedAt: row?.updated_at }
  })
  app.post('/api/commands', async (request, reply) => {
    const auth = requireAuth(request)
    const key = uuid.parse(request.headers['idempotency-key'])
    const command = commandSchema.parse(request.body) as Command
    const outcome = await executeWorkspaceCommand(database, auth, command, key)
    return reply.code(outcome.result.ok ? 200 : 422).send(outcome)
  })
  app.get('/api/audit', async (request) => {
    const auth = requireAuth(request)
    assertPermission(auth, 'workspace.manage')
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query)
    return {
      events: (
        await database.query(
          'SELECT a.id,a.action,a.entity_id,a.metadata,a.created_at,u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.user_id WHERE a.workspace_id=$1 ORDER BY a.created_at DESC LIMIT $2',
          [auth.workspaceId, limit],
        )
      ).rows,
    }
  })
}

export async function updateWorkspace(
  database: Database,
  workspaceId: string,
  callback: (state: AppState, tx: Sql) => Promise<void>,
) {
  await database.transaction(async (tx) => {
    const row = (
      await tx.query<StateRow>(
        'SELECT document,revision FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
        [workspaceId],
      )
    ).rows[0]
    if (!row) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Çalışma alanı bulunamadı.')
    await callback(row.document, tx)
    await tx.query(
      'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
      [JSON.stringify(row.document), workspaceId],
    )
  })
}

export async function createAuditEvent(
  database: Database,
  workspaceId: string,
  action: string,
  entityId?: string,
) {
  await audit(database, workspaceId, null, action, entityId, { eventId: randomUUID() })
}
