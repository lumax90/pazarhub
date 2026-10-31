import { randomUUID } from 'node:crypto'
import { invoiceLineMetadata } from '../src/domain/products'
import { orderDueDate, ensureAutomaticOrderInvoice } from '../src/domain/orders'
import { queueAutomaticInvoice } from './invoice-automation'
import { invoiceSnapshot } from './fulfillment-snapshots'
import { invoiceLinkKey, invoiceLinkRequestContainsUrl } from './invoice-link'
import type { InvoiceSnapshot } from './fulfillment-snapshots'
import { currencySnapshot } from '../src/domain/money'
import { snapshotBundle, variantCost, variantCostKnown } from '../src/domain/bundles'
import { hostname } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import type { AppState, Order, OrderStatus } from '../src/domain/types'
import type { RemoteOrder } from '../src/domain/integrations'
import { executeCommand } from '../src/domain/operations'
import {
  findVariant,
  listingPrice,
  listingListPrice,
  listingQuantity,
  orderTotal,
} from '../src/domain/selectors'
import { MAIN_WAREHOUSE } from '../src/domain/inventory'
import { audit } from './auth'
import type { Sql } from './db'
import { ProviderError } from './errors'
import type { IntegrationService } from './integration-service'
import { ProviderHttp } from './integrations/http'
import type { AdapterResult } from './integrations/contracts'
import { claimJob, enqueue } from './jobs'
import type { StoredJob } from './jobs'
import { downloadPublicFile } from './downloads'
import { imageMime, storeFile } from './files'
import { PublicationService } from './publishing/service'
import type { PublicationPlan } from './publishing/types'
import { applyMarketplaceWorkflow } from './marketplace/workflow'
import { remoteOrderFingerprint, reconciledOrderStatus } from './order-reconciliation'
import { contentLocalKey } from './listing-content/contracts'
import type { ContentPlan } from './listing-content/contracts'
import { inventorySourceKey } from './inventory-source'
import { fulfillmentLocalKey } from './order-fulfillment/contracts'
import type { OrderFulfillmentPlan } from '../src/domain/order-fulfillment'
import { storeWarehouseIds, reserveOrderWarehouses } from '../src/domain/stock-allocation'

function orderStatus(value: string): OrderStatus {
  const status = value.trim().toLowerCase()
  if (['delivered', 'teslim edildi', 'completed'].includes(status)) return 'delivered'
  if (['cancelled', 'canceled', 'unsupplied', 'iptal edildi'].includes(status)) return 'cancelled'
  if (['returned', 'refunded', 'iade edildi'].includes(status)) return 'returned'
  if (['shipped', 'kargoya verildi', 'in_transit'].includes(status)) return 'shipped'
  return 'pending'
}

export async function ingestOrders(
  state: AppState,
  orders: RemoteOrder[],
  connectionId: string,
  channel: Order['channel'],
  tx: Sql,
  workspaceId: string,
  warehouse: string | string[] = MAIN_WAREHOUSE,
) {
  const warehouseIds = Array.isArray(warehouse) ? warehouse : [warehouse],
    warehouseId = warehouseIds[0] ?? MAIN_WAREHOUSE
  for (const remote of orders) {
    const existing = state.orders.find(
      (order) => order.storeId === connectionId && order.externalId === remote.externalId,
    )
    let status = remote.normalizedStatus ?? orderStatus(remote.status)
    if (existing) {
      if (
        existing.remoteUpdatedAt &&
        new Date(remote.modifiedAt).getTime() < new Date(existing.remoteUpdatedAt).getTime()
      )
        continue
      existing.remoteStatus = remote.status
      existing.remoteUpdatedAt = remote.modifiedAt
      existing.packageNumbers = remote.packageNumbers ?? existing.packageNumbers
      existing.trackingNumber = remote.trackingNumber || existing.trackingNumber
      existing.cargoProvider = remote.cargoProvider || existing.cargoProvider
      existing.syncStatus = 'synced'
      const acknowledged = existing.reconciledRemoteHash === remoteOrderFingerprint(remote)
      if (acknowledged) status = reconciledOrderStatus(remote)
      if (remote.requiresReconciliation && !acknowledged) {
        existing.syncStatus = 'error'
        existing.syncError = remote.requiresReconciliation
        continue
      }
      const changed =
        !acknowledged &&
        (remote.shipping !== existing.shipping ||
          remote.total !== orderTotal(existing) ||
          remote.lines.length !== existing.lines.length ||
          remote.lines.some((line) => {
            const previous = existing.lines.find((item) => item.externalId === line.externalId)
            return (
              !previous ||
              previous.quantity !== line.quantity ||
              (line.taxRate !== undefined && previous.taxRate !== line.taxRate) ||
              (previous.lineTotalOverride ?? previous.unitPrice * previous.quantity) !==
                (line.total ?? line.unitPrice * line.quantity)
            )
          }))
      if (changed) {
        existing.syncStatus = 'error'
        if (!existing.syncError)
          existing.events.push({
            id: randomUUID(),
            at: remote.modifiedAt,
            label: 'Pazaryerinde sipariş kalemleri değişti; stok ve fatura inceleme bekliyor.',
          })
        existing.syncError =
          'Pazaryeri kalemleri kayıtlı siparişten farklı. Miktar, fiyat ve varsa düzenlenmiş belge uzlaştırılmalı.'
        continue
      }
      if (
        existing.status !== status &&
        ['cancelled', 'shipped', 'delivered', 'returned'].includes(status)
      ) {
        if (status === 'cancelled' && ['pending', 'approved'].includes(existing.status)) {
          const cash = state.cash,
            paid = existing.paid
          const result = executeCommand(state, {
            type: 'order.transition',
            id: existing.id,
            status: 'cancelled',
          })
          if (result.result.ok) {
            Object.assign(state, result.state)
            state.cash = cash
            state.orders.find((item) => item.id === existing.id)!.paid = paid
          }
        } else {
          if (
            ['shipped', 'delivered'].includes(status) &&
            !existing.inventoryApplied &&
            !existing.historical &&
            existing.status === 'pending'
          ) {
            const outcome = executeCommand(state, {
              type: 'order.transition',
              id: existing.id,
              status: 'approved',
            })
            if (outcome.result.ok) Object.assign(state, outcome.state)
          }
          const current = state.orders.find((item) => item.id === existing.id)!
          current.status = status
          if (
            ['shipped', 'delivered'].includes(status) &&
            !current.inventoryApplied &&
            !current.historical
          )
            current.syncStatus = 'error'
          current.events.push({
            id: randomUUID(),
            label: `Pazaryeri durumu: ${remote.status}`,
            at: remote.modifiedAt,
          })
        }
      }
      ensureAutomaticOrderInvoice(
        state,
        state.orders.find((order) => order.id === existing.id)!,
        new Date().toISOString(),
        randomUUID,
      )
      continue
    }
    const customerId = randomUUID()
    state.customers.push({
      id: customerId,
      name: remote.recipient.name || 'Pazaryeri müşterisi',
      email: remote.recipient.email || '',
      phone: remote.recipient.phone,
      city: remote.recipient.city,
      address: remote.recipient.address,
      district: remote.recipient.district,
      country: remote.recipient.country,
      taxId: remote.recipient.taxId,
      version: 1,
    })
    const lines = []
    for (const line of remote.lines) {
      const mappings = (
        await tx.query<{ local_id: string }>(
          `SELECT DISTINCT local_id FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND resource='product' AND local_id IS NOT NULL
        AND (($3<>'' AND document->>'sku'=$3) OR ($4<>'' AND document->>'barcode'=$4)) LIMIT 2`,
          [workspaceId, connectionId, line.sku, line.barcode],
        )
      ).rows
      const mapping = mappings.length === 1 ? mappings[0] : undefined
      let product = state.products.find((item) =>
        item.variants.some((variant) => variant.id === mapping?.local_id),
      )
      let variant = product?.variants.find((item) => item.id === mapping?.local_id)
      if (!variant && mappings.length < 2) {
        const matches = state.products.flatMap((product) =>
          product.variants
            .filter(
              (variant) =>
                (line.barcode && variant.barcode === line.barcode) ||
                (!line.barcode && line.sku && variant.sku === line.sku),
            )
            .map((variant) => ({ product, variant })),
        )
        if (matches.length === 1) {
          product = matches[0].product
          variant = matches[0].variant
        }
      }
      const localCost =
        variant && (!product?.bundle || status === 'pending') ? variantCost(state, variant.id) : 0
      lines.push({
        variantId: variant?.id ?? '',
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: Number.isSafeInteger(localCost) ? localCost : 0,
        taxRate: line.taxRate ?? product?.taxRate ?? 0,
        externalId: line.externalId,
        externalSku: line.sku,
        externalBarcode: line.barcode,
        title: line.title,
        costKnown:
          !!variant &&
          (!product?.bundle || status === 'pending') &&
          Number.isSafeInteger(localCost) &&
          variantCostKnown(state, variant.id),
        taxKnown: line.taxRate !== undefined || !!product,
        lineTotalOverride: line.total,
        ...(status === 'pending' && product && variant
          ? {
              ...invoiceLineMetadata(product, variant),
              ...currencySnapshot(
                product.currency,
                state.exchangeRates,
                state.ecommerce?.exchangeRateType,
              ),
              ...(product.bundle ? { bundleComponents: snapshotBundle(state, variant.id) } : {}),
            }
          : {}),
      })
    }
    const historical = status !== 'pending'
    state.orders.unshift({
      id: randomUUID(),
      number: `SP-${String(state.orders.length + 1001).padStart(6, '0')}`,
      customerId,
      channel,
      storeId: connectionId,
      externalId: remote.externalId,
      externalNumber: remote.number,
      remoteStatus: remote.status,
      remoteUpdatedAt: remote.modifiedAt,
      packageNumbers: remote.packageNumbers,
      status,
      createdAt: remote.createdAt,
      dueAt: orderDueDate(remote.createdAt, state.ecommerce?.dueDays ?? 2),
      totalOverride: remote.total,
      shippingAddress: {
        name: remote.recipient.name,
        address: remote.recipient.address,
        city: remote.recipient.city,
        district: remote.recipient.district,
        country: remote.recipient.country,
        phone: remote.recipient.phone,
      },
      lines,
      shipping: remote.shipping,
      note: '',
      paid: false,
      inventoryApplied: false,
      invoiceTiming: state.ecommerce?.invoiceTiming ?? 'on_approval',
      historical,
      warehouseId,
      billingAddress: remote.billing,
      trackingNumber: remote.trackingNumber,
      cargoProvider: remote.cargoProvider,
      syncStatus: remote.requiresReconciliation ? 'error' : 'synced',
      syncError: remote.requiresReconciliation,
      events: [
        {
          id: randomUUID(),
          label: historical
            ? 'Geçmiş pazaryeri kaydı içe alındı; stok hareketi oluşturulmadı.'
            : 'Pazaryeri siparişi alındı. Eşleşen ürünler onaya kadar rezerve edilir.',
          at: new Date().toISOString(),
        },
      ],
    })
    reserveOrderWarehouses(state, state.orders[0], warehouseIds)
    ensureAutomaticOrderInvoice(state, state.orders[0], new Date().toISOString(), randomUUID)
  }
}

export class IntegrationWorker {
  readonly id = `worker-${process.env.WORKER_ID ?? process.env.HOSTNAME ?? hostname()}-${randomUUID()}`
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private running: Promise<void> | undefined
  private lastSchedule = 0
  constructor(private readonly service: IntegrationService) {}

  start() {
    this.stopped = false
    const tick = () => {
      if (this.stopped) return
      this.running = this.cycle()
        .catch(() => console.error('Integration worker cycle failed; retrying on next cycle.'))
        .finally(() => {
          this.running = undefined
          if (!this.stopped) {
            this.timer = setTimeout(tick, 1500)
            this.timer.unref()
          }
        })
    }
    tick()
  }
  async stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    await this.running
  }
  async cycle() {
    await this.service.database.query(
      'INSERT INTO worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET updated_at=now()',
      [this.id],
    )
    if (Date.now() - this.lastSchedule > 60000) {
      await this.service.database.query(
        `DELETE FROM catalog_imports WHERE id IN (SELECT id FROM catalog_imports WHERE applied_at IS NULL AND expires_at<now() LIMIT 1000)`,
      )
      await this.service.database.query(
        `DELETE FROM metadata_cache WHERE (workspace_id,connection_id,cache_key) IN (SELECT workspace_id,connection_id,cache_key FROM metadata_cache WHERE expires_at<now() LIMIT 5000)`,
      )
      await this.schedule()
      await this.scheduleShipments()
      await this.schedulePublications()
      await this.scheduleMarketplaceWorkflows()
      this.lastSchedule = Date.now()
    }
    await this.processOne()
  }
  async schedule() {
    const { rows } = await this.service.database.query<{
      id: string
      workspace_id: string
      provider: string
      settings: Record<string, unknown>
    }>(
      `SELECT id,workspace_id,provider,settings FROM integration_connections WHERE enabled=true AND status='verified' AND deleted_at IS NULL`,
    )
    for (const connection of rows) {
      for (const [setting, operation] of [
        ['pullOrders', 'orders.pull'],
        ['pullCatalog', 'catalog.pull'],
        ['pullQuestions', 'questions.pull'],
        ['pullClaims', 'claims.pull'],
        ['pullSettlements', 'settlements.pull'],
      ] as const) {
        if (!connection.settings[setting]) continue
        const interval =
          operation === 'settlements.pull'
            ? 86400000
            : operation === 'claims.pull'
              ? 3600000
              : operation === 'catalog.pull'
                ? 1800000
                : 300000
        const slot = Math.floor(Date.now() / interval)
        const pending = await this.service.database.query(
          `SELECT id FROM integration_jobs WHERE connection_id=$1 AND kind=$2 AND status IN ('queued','running','waiting') LIMIT 1`,
          [connection.id, operation],
        )
        if (pending.rows.length) continue
        const cursor = (
          await this.service.database.query<{ cursor: { lastTo?: number } }>(
            'SELECT cursor FROM integration_cursors WHERE workspace_id=$1 AND connection_id=$2 AND resource=$3',
            [connection.workspace_id, connection.id, operation],
          )
        ).rows[0]
        const from = Math.max(
          0,
          Number(cursor?.cursor.lastTo ?? Date.now() - 7 * 86400000) - 86400000,
        )
        const to = Math.min(Date.now(), from + 7 * 86400000)
        await enqueue(this.service.database, {
          workspaceId: connection.workspace_id,
          connectionId: connection.id,
          kind: operation,
          key: `scheduled:${connection.id}:${operation}:${slot}`,
          payload: operation === 'orders.pull' ? { from, to } : {},
        })
      }
    }
  }
  private async scheduleShipments() {
    const rows = await this.service.database.query<{
      workspace_id: string
      shipment: { id: string; connectionId: string; trackingNumber?: string; provider: string }
    }>(
      `SELECT workspace_id,s AS shipment FROM workspace_states CROSS JOIN LATERAL jsonb_array_elements(COALESCE(document->'shipments','[]'::jsonb)) s WHERE s->>'status' IN ('created','in_transit')`,
    )
    const slot = Math.floor(Date.now() / 900000)
    for (const row of rows.rows) {
      if (!row.shipment.trackingNumber && row.shipment.provider !== 'yurtici') continue
      const connection = await this.service
        .connection(row.workspace_id, row.shipment.connectionId)
        .catch(() => null)
      if (!connection?.enabled || connection.status !== 'verified') continue
      await enqueue(this.service.database, {
        workspaceId: row.workspace_id,
        connectionId: connection.id,
        kind: 'shipment.track',
        entityId: row.shipment.id,
        payload: { shipmentId: row.shipment.id },
        key: `shipment.track:${row.shipment.id}:${slot}`,
      })
    }
  }
  private async schedulePublications() {
    const pending = await this.service.database.query<{
      workspace_id: string
      listing: AppState['listings'][number]
    }>(
      `SELECT workspace_id,l AS listing FROM workspace_states CROSS JOIN LATERAL jsonb_array_elements(document->'listings') l WHERE l->'publication'->>'phase' IN ('submitted','review')`,
    )
    const slot = Math.floor(Date.now() / 1800000)
    const seen = new Set<string>()
    for (const { workspace_id, listing } of pending.rows) {
      const connection = await this.service
        .connection(workspace_id, listing.storeId)
        .catch(() => null)
      if (!connection?.enabled || connection.status !== 'verified') continue
      if (
        !listing.publication?.jobId ||
        (!listing.publication.reference && !listing.publication.reconciledByIdentity)
      )
        continue
      if (seen.has(listing.publication.jobId)) continue
      seen.add(listing.publication.jobId)
      const active = await this.service.database.query(
        `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND (entity_id=$2 OR payload->>'sourceJobId'=$3) AND kind='listing.status' AND status IN ('queued','running','waiting') LIMIT 1`,
        [workspace_id, listing.id, listing.publication.jobId],
      )
      if (active.rows.length) continue
      const source = (
        await this.service.database.query<{ payload: { plan: PublicationPlan } }>(
          `SELECT payload FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND kind='listing.publish'`,
          [workspace_id, listing.publication.jobId],
        )
      ).rows[0]
      if (source)
        await enqueue(this.service.database, {
          workspaceId: workspace_id,
          connectionId: listing.storeId,
          kind: 'listing.status',
          entityId: source.payload.plan.listingId,
          payload: {
            plan: source.payload.plan,
            reference: listing.publication.reference ?? '',
            polls: 0,
            sourceJobId: listing.publication.jobId,
            phase: listing.publication.phase === 'submitted' ? 'batch' : 'approval',
            ...(listing.publication.reconciledByIdentity
              ? { reconcile: true, phase: 'approval' }
              : {}),
          },
          key: `publication-monitor:${listing.publication.jobId}:${slot}`,
        })
    }
  }
  private async scheduleMarketplaceWorkflows() {
    const rows = await this.service.database.query<{
      id: string
      workspace_id: string
      connection_id: string
      external_id: string
      resource: 'question' | 'claim'
    }>(
      `SELECT id,workspace_id,connection_id,external_id,resource FROM external_records WHERE resource IN ('question','claim') AND workflow->>'state' IN ('pending','uncertain') AND seen_at<now()-interval '1 minute' ORDER BY seen_at LIMIT 50`,
    )
    const slot = Math.floor(Date.now() / 60000)
    for (const row of rows.rows) {
      const connection = await this.service
        .connection(row.workspace_id, row.connection_id)
        .catch(() => null)
      if (!connection?.enabled || connection.status !== 'verified') continue
      const kind = row.resource === 'question' ? 'questions.pull' : 'claims.pull'
      const active = await this.service.database.query(
        `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind=$3 AND status IN ('queued','running','waiting') LIMIT 1`,
        [row.workspace_id, row.id, kind],
      )
      if (active.rows.length) continue
      await enqueue(this.service.database, {
        workspaceId: row.workspace_id,
        connectionId: row.connection_id,
        kind,
        entityId: row.id,
        payload:
          row.resource === 'question'
            ? { questionId: row.external_id }
            : { claimId: row.external_id },
        key: `marketplace-followup:${row.id}:${slot}`,
      })
    }
  }
  async processOne(): Promise<boolean> {
    const job = await claimJob(this.service.database, this.id)
    if (!job) return false
    const heartbeat = setInterval(() => {
      void this.service.database
        .query(
          `UPDATE integration_jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND worker_id=$2 AND status='running'`,
          [job.id, this.id],
        )
        .catch(() => undefined)
    }, 20000)
    heartbeat.unref()
    let secrets: Record<string, string> = {}
    let providerResultReceived = false
    try {
      if (!job.connection_id)
        throw new ProviderError('CONNECTION_REQUIRED', 'İşlemin bağlantısı eksik.')
      const connection = await this.service.connection(job.workspace_id, job.connection_id)
      if (
        job.credential_version !== null &&
        job.credential_version !== connection.credential_version
      )
        throw new ProviderError(
          'CONNECTION_CHANGED',
          'Bağlantı bilgileri değişti. Güncel bilgilerle yeni bir işlem başlatın.',
        )
      secrets = this.service.credentials(connection)
      if (job.kind !== 'test' && (!connection.enabled || connection.status !== 'verified'))
        throw new ProviderError('CONNECTION_DISABLED', 'Bağlantı test edilip etkinleştirilmeli.')
      const stateRow = (
        await this.service.database.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1',
          [job.workspace_id],
        )
      ).rows[0]
      if (!stateRow) throw new ProviderError('WORKSPACE_NOT_FOUND', 'Çalışma alanı bulunamadı.')
      if (job.kind === 'invoice.reconcile' || job.kind === 'shipment.reconcile') {
        const source = (
          await this.service.database.query<StoredJob>(
            'SELECT * FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND connection_id=$3 AND entity_id=$4',
            [job.workspace_id, job.payload.sourceJobId, job.connection_id, job.entity_id],
          )
        ).rows[0]
        if (
          !source ||
          !['failed', 'uncertain'].includes(source.status) ||
          !['invoice.create', 'invoice.finalize', 'shipment.create', 'shipment.cancel'].includes(
            source.kind,
          )
        )
          throw new ProviderError(
            'RECONCILIATION_SUPERSEDED',
            'Kaynak işlem değişti veya daha önce uzlaştırıldı.',
          )
        job.payload.sourcePayload = source.payload
        job.payload.sourceOperation = source.kind
      }
      if (job.kind === 'invoice.create' || job.kind === 'invoice.finalize') {
        const snapshot = invoiceSnapshot(stateRow.document, String(job.entity_id))
        if (!snapshot) throw new ProviderError('INVOICE_NOT_FOUND', 'Fatura ve sipariş bulunamadı.')
        const saved = job.payload.invoiceSnapshot as InvoiceSnapshot | undefined
        if (saved && saved.key !== snapshot.key)
          throw new ProviderError(
            'INVOICE_SOURCE_CHANGED',
            'Fatura hazırlığı sırasında sipariş veya alıcı bilgileri değişti. Mevcut sağlayıcı kaydını uzlaştırın.',
          )
        if (!saved) {
          job.payload.invoiceSnapshot = snapshot
          await this.service.database.query(
            "UPDATE integration_jobs SET payload=$1 WHERE id=$2 AND worker_id=$3 AND status='running'",
            [JSON.stringify(job.payload), job.id, this.id],
          )
        }
      }
      if (job.kind === 'invoice.link') {
        if (
          job.payload.automaticInvoiceLink !== false &&
          connection.settings.sendInvoiceLink === false
        )
          throw new ProviderError(
            'INVOICE_LINK_DISABLED',
            'Bu mağazada otomatik fatura bağlantısı iletimi kapalı.',
          )
        const order = stateRow.document.orders.find((order) => order.id === job.payload.orderId),
          key = invoiceLinkKey(stateRow.document, String(job.payload.orderId))
        if (
          !key ||
          order?.storeId !== connection.id ||
          (job.payload.invoiceLinkKey && job.payload.invoiceLinkKey !== key)
        )
          throw new ProviderError(
            'INVOICE_LINK_CHANGED',
            'Fatura bağlantısı veya sipariş değişti; eski belge pazaryerine iletilmedi.',
          )
        job.payload.invoiceLinkKey = key
        await this.service.database.query(
          "UPDATE integration_jobs SET payload=$1 WHERE id=$2 AND worker_id=$3 AND status='running'",
          [JSON.stringify(job.payload), job.id, this.id],
        )
      }
      if (job.kind === 'inventory.reconcile') {
        for (const listing of stateRow.document.listings.filter(
          (item) =>
            item.storeId === connection.id &&
            !!item.externalId &&
            (item.status === 'active' ||
              item.desiredStatus === 'active' ||
              item.desiredStatus === 'archived'),
        )) {
          const archive = listing.desiredStatus === 'archived'
          const price = listingPrice(stateRow.document, listing),
            quantity = archive
              ? 0
              : listingQuantity(
                  stateRow.document,
                  listing,
                  connection.settings.stockBuffer,
                  storeWarehouseIds(stateRow.document, connection.settings),
                )
          const listPrice = ['trendyol', 'n11', 'pazarama'].includes(listing.channel)
            ? listingListPrice(stateRow.document, listing)
            : price
          if (
            listing.lastSent?.price === price &&
            listing.lastSent?.archive === archive &&
            (listing.lastSent?.listPrice ?? listing.lastSent?.price) === listPrice &&
            listing.lastSent?.quantity === quantity
          )
            continue
          const pending = await this.service.database.query(
            `SELECT id FROM integration_jobs WHERE connection_id=$1 AND entity_id=$2 AND kind='inventory.push' AND status IN ('queued','running','waiting') LIMIT 1`,
            [connection.id, listing.id],
          )
          if (pending.rows.length) continue
          await enqueue(this.service.database, {
            workspaceId: job.workspace_id,
            connectionId: connection.id,
            kind: 'inventory.push',
            entityId: listing.id,
            payload: { listingId: listing.id },
            key: `${job.id}:${listing.id}`,
          })
        }
        await this.finish(job, { message: 'Stok/fiyat ilan işlemleri kuyruğa alındı.' })
        return true
      }
      const http = new ProviderHttp(this.service.fetcher, async (url, options) => {
        const milliseconds = await this.service.database.transaction(async (tx) => {
          await tx.query(
            'INSERT INTO integration_rate_limits(connection_id) VALUES($1) ON CONFLICT DO NOTHING',
            [connection.id],
          )
          const row = (
            await tx.query<{ next_request_at: string }>(
              'SELECT next_request_at FROM integration_rate_limits WHERE connection_id=$1 FOR UPDATE',
              [connection.id],
            )
          ).rows[0]
          const when = Math.max(Date.now(), new Date(row.next_request_at).getTime())
          const interval =
            connection.provider === 'ciceksepeti'
              ? 5100
              : connection.provider === 'pazarama' &&
                  options.method === 'POST' &&
                  /\/product\/(create|updatePrice-v2|updateStock-v2)$/.test(url)
                ? 10100
                : 1100
          await tx.query(
            'UPDATE integration_rate_limits SET next_request_at=$1 WHERE connection_id=$2',
            [new Date(when + interval), connection.id],
          )
          return Math.max(0, when - Date.now())
        })
        if (milliseconds) await delay(milliseconds)
        const current = (
          await this.service.database.query<{
            document: AppState
            credential_version: number
            enabled: boolean
            connection_status: string
            current_settings: { sendInvoiceLink?: boolean }
          }>(
            "SELECT s.document,c.credential_version,c.enabled,c.status AS connection_status,c.settings AS current_settings FROM integration_jobs j JOIN workspace_states s ON s.workspace_id=j.workspace_id JOIN integration_connections c ON c.workspace_id=j.workspace_id AND c.id=j.connection_id WHERE j.id=$1 AND j.worker_id=$2 AND j.status='running' AND j.lease_until>now() AND c.deleted_at IS NULL",
            [job.id, this.id],
          )
        ).rows[0]
        if (!current)
          throw new ProviderError(
            'LEASE_LOST',
            'İşlem sahipliği değişti; sağlayıcı isteği başlatılmadı.',
          )
        if (
          job.kind === 'invoice.link' &&
          job.payload.automaticInvoiceLink !== false &&
          current.current_settings.sendInvoiceLink === false
        )
          throw new ProviderError(
            'INVOICE_LINK_DISABLED',
            'Otomatik fatura bağlantısı iletimi kapatıldı; yeni çağrı yapılmadı.',
          )
        if (
          current.credential_version !== connection.credential_version ||
          (job.kind !== 'test' && (!current.enabled || current.connection_status !== 'verified'))
        )
          throw new ProviderError('CONNECTION_CHANGED', 'Bağlantı işlem sırasında değişti.')
        if (
          job.kind === 'inventory.push' &&
          job.payload.inventorySourceKey !==
            inventorySourceKey(
              current.document,
              connection.id,
              String(job.payload.listingId),
              connection.settings,
            )
        )
          throw new ProviderError(
            'INVENTORY_PLAN_STALE',
            'Stok/fiyat kaynağı sağlayıcı sorgusu sırasında değişti; eski değer gönderilmedi.',
          )
        if (
          ['invoice.create', 'invoice.finalize'].includes(job.kind) &&
          invoiceSnapshot(current.document, String(job.entity_id))?.key !==
            (job.payload.invoiceSnapshot as InvoiceSnapshot | undefined)?.key
        )
          throw new ProviderError(
            'INVOICE_SOURCE_CHANGED',
            'Faturanın sipariş veya alıcı bilgileri işlem sırasında değişti.',
          )
        if (
          job.kind === 'invoice.link' &&
          invoiceLinkKey(current.document, String(job.payload.orderId)) !==
            job.payload.invoiceLinkKey
        )
          throw new ProviderError(
            'INVOICE_LINK_CHANGED',
            'Fatura linki sağlayıcı çağrısından önce değişti; eski bağlantı gönderilmedi.',
          )
        if (job.kind === 'listing.publish') {
          const plan = job.payload.plan as PublicationPlan
          if (
            new PublicationService(this.service).planFingerprint(
              current.document,
              plan,
              connection,
            ) !== plan.snapshotHash
          )
            throw new ProviderError(
              'PUBLICATION_STALE',
              'Yayın önizlemesi sağlayıcı sorgusu sırasında değişti.',
            )
        }
        if (job.kind === 'listing.content' && !job.payload.verify) {
          const plan = job.payload.plan as ContentPlan,
            listing = current.document.listings.find((item) => item.id === plan.listingId)
          if (!listing || contentLocalKey(current.document, listing) !== plan.localKey)
            throw new ProviderError('CONTENT_STALE', 'İlan veya ürün işlem sırasında değişti.')
        }
        if (job.kind === 'order.fulfillment' && !job.payload.verify) {
          const plan = job.payload.plan as OrderFulfillmentPlan,
            order = current.document.orders.find((item) => item.id === plan.orderId)
          if (!order || order.syncError || fulfillmentLocalKey(order) !== plan.localKey)
            throw new ProviderError(
              'FULFILLMENT_STALE',
              'Sipariş kalemleri işlem sırasında değişti.',
            )
        }
        const linkedUrl =
          job.kind === 'invoice.link'
            ? current.document.invoices.find((invoice) => invoice.orderId === job.payload.orderId)
                ?.url
            : undefined
        const requestBody =
          typeof options.body === 'string' ? options.body : JSON.stringify(options.json ?? {})
        if (
          job.kind === 'invoice.link' &&
          linkedUrl &&
          !['GET', 'HEAD'].includes(options.method ?? 'GET') &&
          invoiceLinkRequestContainsUrl(requestBody, linkedUrl)
        ) {
          job.payload.invoiceLinkWriteStartedAt ??= new Date().toISOString()
          const marked = await this.service.database.query(
            "UPDATE integration_jobs SET payload=$1 WHERE id=$2 AND worker_id=$3 AND status='running' AND lease_until>now() RETURNING id",
            [JSON.stringify(job.payload), job.id, this.id],
          )
          if (!marked.rows.length)
            throw new ProviderError(
              'LEASE_LOST',
              'Fatura linki yazılmadan önce işlem sahipliği kaybedildi.',
            )
        }
      })
      const adapter = this.service.factory(connection.provider, http)
      if (job.kind === 'listing.content' || job.kind === 'listing.content.status') {
        const listing = stateRow.document.listings.find(
          (item) => item.id === job.entity_id && item.storeId === connection.id,
        )
        if (listing?.contentWorkflow?.jobId !== (job.payload.sourceJobId ?? job.id))
          throw new ProviderError(
            'CONTENT_SUPERSEDED',
            'Bu içeriğin güncel işlem ilişkisi değişti.',
          )
      }
      if (job.kind === 'order.fulfillment' || job.kind === 'order.fulfillment.status') {
        const order = stateRow.document.orders.find(
          (item) => item.id === job.entity_id && item.storeId === connection.id,
        )
        if (order?.fulfillmentWorkflow?.jobId !== (job.payload.sourceJobId ?? job.id))
          throw new ProviderError(
            'FULFILLMENT_SUPERSEDED',
            'Bu sipariş işleminin yerine güncel bir işlem kaydedildi.',
          )
      }
      if (job.kind === 'question.answer' || job.kind === 'claim.decide') {
        const row = (
          await this.service.database.query<{ workflow: { jobId: string; state: string } }>(
            `SELECT workflow FROM external_records WHERE workspace_id=$1 AND id=$2 AND connection_id=$3`,
            [job.workspace_id, job.entity_id, connection.id],
          )
        ).rows[0]
        if (row?.workflow?.jobId !== job.id || !['queued', 'pending'].includes(row.workflow.state))
          throw new ProviderError(
            'ACTION_SUPERSEDED',
            'Bu isteğin yerine güncel bir işlem veya sağlayıcı sonucu kaydedildi.',
          )
      }
      if (job.kind === 'listing.publish') {
        const plan = job.payload.plan as PublicationPlan | undefined,
          listing = stateRow.document.listings.find(
            (l) => l.id === plan?.listingId && l.storeId === connection.id,
          )
        if (!plan || !listing || listing.publication?.jobId !== job.id)
          throw new ProviderError(
            'PUBLICATION_CHANGED',
            'Yayın taslağı veya işlem ilişkisi değişti.',
          )
        const service = new PublicationService(this.service)
        if (service.planFingerprint(stateRow.document, plan, connection) !== plan.snapshotHash)
          throw new ProviderError(
            'PUBLICATION_STALE',
            'Kuyruk beklerken ürün, stok veya fiyat değişti. Güncel önizlemeyle tekrar gönderin.',
          )
      }
      if (job.kind === 'inventory.push' && !job.payload.inventoryPlan) {
        const listing = stateRow.document.listings.find(
          (item) => item.id === job.payload.listingId && item.storeId === connection.id,
        )
        if (!listing) throw new ProviderError('LISTING_NOT_FOUND', 'İlan eşlemesi bulunamadı.')
        const archive = Boolean(job.payload.archive ?? listing.desiredStatus === 'archived')
        const price = listingPrice(stateRow.document, listing),
          quantity = archive
            ? 0
            : listingQuantity(
                stateRow.document,
                listing,
                connection.settings.stockBuffer,
                storeWarehouseIds(stateRow.document, connection.settings),
              )
        if (!Number.isSafeInteger(price) || price <= 0 || price > 1_000_000_000)
          throw new ProviderError(
            'INVALID_PRICE',
            'Gönderilecek fiyat pozitif ve sınırlar içinde olmalı. Maliyet ve marj ayarlarını kontrol edin.',
          )
        const listPrice = ['trendyol', 'n11', 'pazarama'].includes(listing.channel)
          ? listingListPrice(stateRow.document, listing)
          : price
        if (!Number.isSafeInteger(listPrice) || listPrice < price || listPrice > 1_000_000_000)
          throw new ProviderError('INVALID_LIST_PRICE', 'Liste fiyatını kontrol edin.')
        job.payload.inventoryPlan = { price, listPrice, quantity, archive }
        await this.service.database.query(
          `UPDATE integration_jobs SET payload=$1 WHERE id=$2 AND worker_id=$3 AND status='running'`,
          [JSON.stringify(job.payload), job.id, this.id],
        )
      }
      if (job.kind === 'inventory.push') {
        const listing = stateRow.document.listings.find(
            (item) => item.id === job.payload.listingId && item.storeId === connection.id,
          )!,
          plan = job.payload.inventoryPlan as {
            price: number
            listPrice?: number
            quantity: number
            archive: boolean
          }
        const archive = listing.desiredStatus === 'archived',
          quantity = archive
            ? 0
            : listingQuantity(
                stateRow.document,
                listing,
                connection.settings.stockBuffer,
                storeWarehouseIds(stateRow.document, connection.settings),
              ),
          price = listingPrice(stateRow.document, listing),
          listPrice = ['trendyol', 'n11', 'pazarama'].includes(listing.channel)
            ? listingListPrice(stateRow.document, listing)
            : price
        if (
          plan.price !== price ||
          plan.quantity !== quantity ||
          plan.archive !== archive ||
          (plan.listPrice ?? plan.price) !== listPrice
        )
          throw new ProviderError(
            'INVENTORY_PLAN_STALE',
            'Stok/fiyat planı güncel değil; eski miktar yeniden gönderilmedi.',
          )
        const sourceKey = inventorySourceKey(
          stateRow.document,
          connection.id,
          listing.id,
          connection.settings,
        )
        if (job.payload.inventorySourceKey && job.payload.inventorySourceKey !== sourceKey)
          throw new ProviderError(
            'INVENTORY_PLAN_STALE',
            'Stok kaynağı veya uzak ilan ilişkisi değişmiş.',
          )
        if (!job.payload.inventorySourceKey) {
          job.payload.inventorySourceKey = sourceKey
          await this.service.database.query(
            "UPDATE integration_jobs SET payload=$1 WHERE id=$2 AND worker_id=$3 AND status='running'",
            [JSON.stringify(job.payload), job.id, this.id],
          )
        }
      }
      if (!adapter.capabilities.includes(job.kind))
        throw new ProviderError('UNSUPPORTED_OPERATION', 'Sağlayıcı bu işlem için hazır değil.')
      if (Number(job.payload.polls ?? 0) > (connection.provider === 'pazarama' ? 240 : 120))
        throw new ProviderError(
          'RESULT_TIMEOUT',
          'Pazaryeri işlemi zamanında sonuçlanmadı. Sağlayıcı kaydını kontrol edin.',
          false,
          undefined,
          true,
        )
      const providerPayload = { ...job.payload }
      if (
        job.kind === 'claim.decide' &&
        Array.isArray(job.payload.fileIds) &&
        job.payload.fileIds.length
      ) {
        const files = await this.service.database.query<{
          name: string
          mime: string
          contents: Uint8Array
        }>(
          'SELECT f.name,f.mime,f.contents FROM claim_documents d JOIN stored_files f ON f.id=d.file_id AND f.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.record_id=$2 AND f.id=ANY($3::uuid[])',
          [job.workspace_id, job.entity_id, job.payload.fileIds],
        )
        if (files.rows.length !== job.payload.fileIds.length)
          throw new ProviderError('CLAIM_FILES_CHANGED', 'Kararın kanıt dosyaları değişti.')
        providerPayload.files = files.rows.map((file) => ({
          name: file.name,
          mime: file.mime,
          data: Buffer.from(file.contents).toString('base64'),
        }))
      }
      const result = await adapter.execute(
        job.kind,
        {
          connectionId: connection.id,
          workspaceId: job.workspace_id,
          provider: connection.provider,
          credentials: secrets,
          settings: connection.settings,
          integrationName: this.service.config.integrationName,
          hepsiburadaIntegrator: this.service.config.hepsiburadaIntegrator,
          state: stateRow.document,
        },
        providerPayload,
      )
      providerResultReceived = true
      if (job.kind === 'claim.decide' && result.nextPayload) delete result.nextPayload.files
      if (result.nextPayload && job.payload.invoiceSnapshot)
        result.nextPayload.invoiceSnapshot = job.payload.invoiceSnapshot
      if (result.nextPayload && job.kind === 'inventory.push') {
        result.nextPayload.inventoryPlan = job.payload.inventoryPlan
        result.nextPayload.inventorySourceKey = job.payload.inventorySourceKey
      }
      if (job.kind === 'shipment.reconcile' && result.shipment && !result.nextPayload) {
        if (
          job.payload.sourceOperation === 'shipment.cancel' &&
          result.shipment.status !== 'cancelled'
        )
          throw new ProviderError(
            'CANCELLATION_NOT_CONFIRMED',
            'Taşıyıcı kaydı mevcut; iptal henüz doğrulanmadı.',
          )
        result.resolution = { outcome: 'confirmed' }
      }
      const redact = (message: string) =>
        Object.values(secrets)
          .filter((value) => value.length > 4)
          .reduce((result, value) => result.replaceAll(value, '[gizli]'), message)
      result.message = redact(result.message)
      if (result.contentUpdate) result.contentUpdate.message = redact(result.contentUpdate.message)
      if (result.failure) result.failure.message = redact(result.failure.message)
      if (result.publication?.state.message)
        result.publication.state.message = redact(result.publication.state.message)
      if (result.publication?.state.errors)
        for (const detail of result.publication.state.errors)
          for (const value of Object.values(secrets))
            if (value.length > 4) detail.message = detail.message.replaceAll(value, '[gizli]')
      await this.finish(job, result)
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              'WORKER_ERROR',
              'İşlem tamamlanamadı. Bağlantı ve kayıt bilgilerini kontrol edin.',
              false,
              undefined,
              providerResultReceived &&
                [
                  'listing.publish',
                  'invoice.create',
                  'invoice.finalize',
                  'shipment.create',
                  'question.answer',
                  'claim.decide',
                  'order.fulfillment',
                  'listing.content',
                ].includes(job.kind),
            )
      let message = providerError.message
      for (const value of Object.values(secrets))
        if (value.length > 4) message = message.replaceAll(value, '[gizli]')
      const attempts = job.attempts + 1
      const status = providerError.uncertain
        ? 'uncertain'
        : providerError.retryable && attempts < job.max_attempts
          ? 'waiting'
          : 'failed'
      const seconds = providerError.retryAfterSeconds ?? Math.min(900, 15 * 2 ** attempts)
      await this.service.database.transaction(async (tx) => {
        const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
            [job.workspace_id],
          )
        ).rows[0]
        const updated = await tx.query(
          `UPDATE integration_jobs SET status=$1,attempts=$2,last_error=$3,available_at=now()+($4::double precision * interval '1 second'),lease_until=NULL,worker_id=NULL,finished_at=CASE WHEN $1 IN ('failed','uncertain') THEN now() ELSE NULL END WHERE id=$5 AND worker_id=$6 AND status='running' RETURNING id`,
          [status, attempts, `${providerError.code}: ${message}`, seconds, job.id, this.id],
        )
        if (!updated.rows.length) return
        if (job.kind === 'test')
          await tx.query(
            `UPDATE integration_connections SET status='failed',enabled=false,last_error=$1,last_test_at=now() WHERE id=$2 AND workspace_id=$3 AND credential_version=$4`,
            [message, job.connection_id, job.workspace_id, job.credential_version],
          )
        if (status === 'failed' || status === 'uncertain') {
          if (
            job.kind === 'question.answer' ||
            job.kind === 'claim.decide' ||
            (job.kind === 'settlements.pull' && job.payload.paymentOrderId)
          )
            await tx.query(
              `UPDATE external_records SET workflow=workflow||$1::jsonb WHERE workspace_id=$2 AND id=$3 AND workflow->>'jobId'=$4`,
              [
                JSON.stringify({ state: status, message, updatedAt: new Date().toISOString() }),
                job.workspace_id,
                job.entity_id,
                job.id,
              ],
            )
          const invoice = row.document.invoices.find((item) => item.id === job.entity_id)
          const shipment = row.document.shipments?.find((item) => item.id === job.entity_id)
          const listing = row.document.listings.find((item) => item.id === job.entity_id)
          if (
            job.kind.startsWith('listing.content') &&
            listing?.contentWorkflow?.jobId === (job.payload.sourceJobId ?? job.id)
          ) {
            listing.contentWorkflow.state = status === 'uncertain' ? 'uncertain' : 'rejected'
            listing.contentWorkflow.message = message
            listing.contentWorkflow.checkedAt = new Date().toISOString()
          }
          const order = row.document.orders.find((item) => item.id === job.entity_id)
          if (
            job.kind.startsWith('order.fulfillment') &&
            order?.fulfillmentWorkflow?.jobId === (job.payload.sourceJobId ?? job.id)
          ) {
            order.fulfillmentWorkflow.state = status === 'uncertain' ? 'uncertain' : 'failed'
            order.fulfillmentWorkflow.message = message
            order.fulfillmentWorkflow.updatedAt = new Date().toISOString()
          }
          if (
            invoice &&
            !invoice.manualDocument &&
            job.kind.startsWith('invoice.') &&
            job.kind !== 'invoice.link'
          ) {
            invoice.status = 'failed'
            invoice.error = message
            if (status === 'uncertain' && ['invoice.create', 'invoice.finalize'].includes(job.kind))
              invoice.uncertainJobId = job.id
          }
          if (shipment) {
            if (!shipment.externalId) shipment.status = status
            shipment.error = message
            if (status === 'uncertain' && ['shipment.create', 'shipment.cancel'].includes(job.kind))
              shipment.uncertainJobId = job.id
          }
          if (listing && job.kind === 'inventory.push') {
            listing.syncStatus = 'failed'
            listing.error = message
            if (providerError.code === 'INVENTORY_PLAN_STALE' && job.connection_id) {
              const connection = await this.service.connection(
                job.workspace_id,
                job.connection_id,
                tx,
              )
              if (connection.settings.pushInventory)
                await enqueue(tx, {
                  workspaceId: job.workspace_id,
                  connectionId: job.connection_id,
                  kind: 'inventory.reconcile',
                  key: `stale-inventory:${job.id}`,
                })
            }
          }
          if (job.kind === 'listing.publish') {
            for (const affected of row.document.listings.filter(
              (item) => item.publication?.jobId === job.id,
            )) {
              affected.publication!.phase = status === 'uncertain' ? 'uncertain' : 'rejected'
              affected.publication!.message = message
              affected.error = message
              affected.syncStatus = 'failed'
              affected.status = 'rejected'
            }
          }
          if (
            listing &&
            job.kind === 'listing.status' &&
            (!job.payload.sourceJobId || listing.publication?.jobId === job.payload.sourceJobId)
          )
            listing.error = message
          if (invoice || shipment || listing || (job.kind.startsWith('order.fulfillment') && order))
            await tx.query(
              'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
              [JSON.stringify(row.document), job.workspace_id],
            )
        }
        await audit(tx, job.workspace_id, null, 'integration.job_failed', job.id, {
          code: providerError.code,
          status,
          attempts,
        })
      })
    } finally {
      clearInterval(heartbeat)
    }
    return true
  }

  private async finish(job: StoredJob, result: AdapterResult) {
    const pdf = result.invoice?.pdfUrl ? await downloadPublicFile(result.invoice.pdfUrl) : undefined
    if (pdf && pdf.subarray(0, 5).toString() !== '%PDF-')
      throw new ProviderError(
        'INVALID_PDF',
        'Paraşüt PDF yanıtı geçerli bir PDF dosyası değil.',
        true,
        30,
      )
    await this.service.database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [job.workspace_id],
        )
      ).rows[0]
      const lease = await tx.query(
        'SELECT id FROM integration_jobs WHERE id=$1 AND worker_id=$2 AND status=$3 FOR UPDATE',
        [job.id, this.id, 'running'],
      )
      if (!lease.rows.length) return
      const beforeOrderStatuses = new Map(
        row.document.orders.map((order) => [order.id, order.status]),
      )
      const beforeInvoiceIds = new Set(row.document.invoices.map((invoice) => invoice.id))
      if (result.resolution) {
        const source = (
          await tx.query<StoredJob>(
            'SELECT * FROM integration_jobs WHERE workspace_id=$1 AND id=$2 AND entity_id=$3 AND connection_id=$4 FOR UPDATE',
            [job.workspace_id, job.payload.sourceJobId, job.entity_id, job.connection_id],
          )
        ).rows[0]
        if (
          !source ||
          !['invoice.reconcile', 'shipment.reconcile'].includes(job.kind) ||
          !['failed', 'uncertain'].includes(source.status)
        )
          throw new ProviderError(
            'RECONCILIATION_SUPERSEDED',
            'Kaynak işlem artık uzlaştırma beklemiyor.',
          )
        const entity =
          job.kind === 'invoice.reconcile'
            ? row.document.invoices.find((item) => item.id === job.entity_id)
            : row.document.shipments?.find((item) => item.id === job.entity_id)
        if (!entity) throw new ProviderError('RECORD_NOT_FOUND', 'Uzlaştırılacak kayıt bulunamadı.')
        if (result.resolution.outcome === 'resume') {
          const next = result.resolution.nextPayload,
            snapshot = next?.invoiceSnapshot as InvoiceSnapshot | undefined
          if (
            !next ||
            !snapshot ||
            invoiceSnapshot(row.document, String(job.entity_id))?.key !== snapshot.key ||
            source.credential_version !== job.credential_version
          )
            throw new ProviderError(
              'RESUME_SOURCE_CHANGED',
              'Sipariş veya bağlantı değişti. Eski hazırlık adımı devam ettirilmedi.',
            )
          await tx.query(
            "UPDATE integration_jobs SET status='waiting',payload=$1,available_at=now(),attempts=0,last_error=NULL,finished_at=NULL,worker_id=NULL,lease_until=NULL WHERE id=$2",
            [JSON.stringify(next), source.id],
          )
          entity.status = 'queued'
        } else {
          await tx.query(
            "UPDATE integration_jobs SET status='completed',last_error=NULL,finished_at=now(),worker_id=NULL,lease_until=NULL,result=COALESCE(result,'{}'::jsonb)||$1::jsonb WHERE id=$2",
            [
              JSON.stringify({
                reconciledBy: job.id,
                message: result.message,
                reference: result.invoice?.externalId || result.shipment?.externalId,
              }),
              source.id,
            ],
          )
        }
        if (entity.uncertainJobId === source.id) delete entity.uncertainJobId
        entity.error = undefined
        await audit(tx, job.workspace_id, null, 'fulfillment.reconciled', String(job.entity_id), {
          sourceJobId: source.id,
          reconciliationJobId: job.id,
          outcome: result.resolution.outcome,
        })
      }
      for (const product of result.products ?? []) {
        const listing = row.document.listings.find(
          (listing) =>
            listing.storeId === job.connection_id && listing.externalId === product.externalId,
        )
        if (listing && Number.isSafeInteger(product.listPrice))
          listing.remoteListPrice = product.listPrice
        await tx.query(
          `INSERT INTO external_records(id,workspace_id,connection_id,resource,external_id,document) VALUES($1,$2,$3,'product',$4,$5) ON CONFLICT(workspace_id,connection_id,resource,external_id) DO UPDATE SET document=EXCLUDED.document,seen_at=now()`,
          [
            randomUUID(),
            job.workspace_id,
            job.connection_id,
            product.externalId,
            JSON.stringify(product),
          ],
        )
      }
      for (const order of result.orders ?? [])
        await tx.query(
          `INSERT INTO external_records(id,workspace_id,connection_id,resource,external_id,document) VALUES($1,$2,$3,'order',$4,$5) ON CONFLICT(workspace_id,connection_id,resource,external_id) DO UPDATE SET document=EXCLUDED.document,seen_at=now()`,
          [
            randomUUID(),
            job.workspace_id,
            job.connection_id,
            order.externalId,
            JSON.stringify(order),
          ],
        )
      for (const item of result.records ?? [])
        await tx.query(
          `INSERT INTO external_records(id,workspace_id,connection_id,resource,external_id,document) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,connection_id,resource,external_id) DO UPDATE SET document=EXCLUDED.document,seen_at=now()`,
          [
            randomUUID(),
            job.workspace_id,
            job.connection_id,
            item.resource,
            item.id,
            JSON.stringify(item.data),
          ],
        )
      if (result.publication) {
        const reports = [
          result.publication,
          ...(result.publication.members ?? []).map((member) => ({
            ...member,
            plan: result.publication!.plan.group?.find(
              (plan) => plan.listingId === member.listingId,
            ),
          })),
        ]
        if (
          result.publication.plan.group &&
          (reports.length !== result.publication.plan.group.length ||
            new Set(reports.map((report) => report.listingId)).size !== reports.length)
        )
          throw new ProviderError(
            'INVALID_GROUP_RESULT',
            'Üst ürün grubunun bütün varyant sonuçları gerekli.',
          )
        for (const report of reports) {
          const listing = row.document.listings.find(
            (item) => item.id === report.listingId && item.storeId === job.connection_id,
          )
          if (
            !report.plan ||
            !listing ||
            (listing.version ?? 0) !== report.plan.version ||
            (job.kind === 'listing.status' &&
              job.payload.sourceJobId &&
              listing.publication?.jobId !== job.payload.sourceJobId)
          )
            throw new ProviderError(
              'PUBLICATION_CHANGED',
              'Yayın grubu değişti; eski sonuç uygulanmadı.',
              false,
              undefined,
              true,
            )
        }
        for (const report of reports) {
          const { plan, state: publication, externalId } = report
          if (!plan)
            throw new ProviderError(
              'INVALID_GROUP_RESULT',
              'Sağlayıcı grup dışında bir varyant sonucu döndürdü.',
            )
          const listing = row.document.listings.find(
            (l) => l.id === report.listingId && l.storeId === job.connection_id,
          )
          if (
            !listing ||
            (listing.version ?? 0) !== plan.version ||
            (job.kind === 'listing.status' &&
              ((job.payload.sourceJobId &&
                listing.publication?.jobId !== job.payload.sourceJobId) ||
                (listing.publication?.reference ?? '') !== (job.payload.reference ?? '')))
          ) {
            await tx.query(
              `UPDATE integration_jobs SET status='cancelled',finished_at=now(),worker_id=NULL,lease_until=NULL,last_error='Taslak sürümü değişti; eski durum sonucu uygulanmadı.' WHERE id=$1`,
              [job.id],
            )
            return
          }
          const before = listing.publication?.phase
          listing.publication = {
            ...listing.publication,
            ...publication,
            jobId: job.kind === 'listing.publish' ? job.id : listing.publication?.jobId,
            errors: publication.errors,
          }
          listing.status = ['live', 'listed'].includes(publication.phase)
            ? 'active'
            : ['rejected', 'uncertain'].includes(publication.phase)
              ? 'rejected'
              : 'pending'
          listing.error = ['rejected', 'uncertain'].includes(publication.phase)
            ? publication.errors?.map((e) => e.message).join(' · ') || publication.message
            : undefined
          listing.syncStatus = ['rejected', 'uncertain'].includes(publication.phase)
            ? 'failed'
            : ['live', 'listed'].includes(publication.phase)
              ? 'synced'
              : 'syncing'
          listing.updatedAt = new Date().toISOString()
          if (
            job.kind === 'listing.publish' ||
            (publication.reconciledByIdentity && before === 'uncertain')
          ) {
            listing.externalSku = plan.sku
            listing.externalBarcode = plan.barcode
            listing.remoteCategoryId = plan.config.categoryId
            listing.titleOverride = plan.title
            listing.publishConfig = {
              ...plan.config,
              title: plan.title,
              description: plan.description,
              images: plan.images,
            }
          }
          if (externalId) listing.externalId = externalId
          if ('attributes' in report && report.attributes)
            listing.attributes = { ...listing.attributes, ...report.attributes }
          if (
            externalId &&
            row.document.marginSettings?.find((settings) => settings.storeId === listing.storeId)
              ?.enabled === false &&
            !listing.marginPriceSnapshot
          )
            listing.marginPriceSnapshot = {
              price: plan.price,
              listPrice: plan.listPrice ?? plan.price,
            }
          if (externalId && plan.provider === 'hepsiburada')
            listing.attributes = { ...listing.attributes, hepsiburadaSku: externalId.split(':')[0] }
          if (job.kind === 'listing.publish' && report.listingId === result.publication.listingId)
            await enqueue(tx, {
              workspaceId: job.workspace_id,
              connectionId: job.connection_id!,
              kind: 'listing.status',
              entityId: listing.id,
              payload: {
                plan: result.publication.plan,
                reference: publication.reference,
                polls: 0,
                sourceJobId: job.id,
              },
              key: `publication-check:${job.id}`,
              delaySeconds: 5,
            })
          if (['live', 'listed'].includes(publication.phase) && before !== publication.phase)
            await enqueue(tx, {
              workspaceId: job.workspace_id,
              connectionId: job.connection_id!,
              kind: 'inventory.push',
              entityId: listing.id,
              payload: { listingId: listing.id },
              key: `publication-inventory:${listing.publication.jobId}:${listing.id}`,
            })
          if (publication.reconciledByIdentity && externalId && job.payload.sourceJobId) {
            await tx.query(
              `UPDATE integration_jobs SET status='completed',finished_at=now(),last_error=NULL,result=$1 WHERE workspace_id=$2 AND id=$3 AND status='uncertain'`,
              [
                JSON.stringify({
                  message: 'Yayın sonucu barkod/SKU ile doğrulandı.',
                  externalId,
                  reconciliationJob: job.id,
                }),
                job.workspace_id,
                job.payload.sourceJobId,
              ],
            )
            await audit(tx, job.workspace_id, null, 'listing.reconciled', listing.id, {
              externalId,
              sourceJobId: job.payload.sourceJobId,
            })
          }
        }
      }
      await applyMarketplaceWorkflow(tx, job, result)
      if (result.orders?.length) {
        const connection = await this.service.connection(job.workspace_id, job.connection_id!, tx)
        await ingestOrders(
          row.document,
          result.orders,
          connection.id,
          connection.provider as Order['channel'],
          tx,
          job.workspace_id,
          storeWarehouseIds(row.document, connection.settings),
        )
        if (connection.settings.autoApproveOrders) {
          for (const order of row.document.orders.filter(
            (item) =>
              item.storeId === connection.id &&
              item.status === 'pending' &&
              !item.historical &&
              item.lines.every((line) => findVariant(row.document, line.variantId)),
          )) {
            const approved = executeCommand(row.document, {
              type: 'order.transition',
              id: order.id,
              status: 'approved',
            })
            if (approved.result.ok) Object.assign(row.document, approved.state)
          }
        }
        const targets = await tx.query<{ id: string }>(
          `SELECT id FROM integration_connections WHERE workspace_id=$1 AND enabled=true AND status='verified' AND settings->>'pushInventory'='true' AND deleted_at IS NULL`,
          [job.workspace_id],
        )
        for (const target of targets.rows)
          await enqueue(tx, {
            workspaceId: job.workspace_id,
            connectionId: target.id,
            kind: 'inventory.reconcile',
            key: `order-sync:${job.id}:${Number(job.payload.page ?? 0)}:${target.id}`,
          })
      }
      if (result.listingStatus && job.payload.listingId) {
        const listing = row.document.listings.find(
          (item) => item.id === job.payload.listingId && item.storeId === job.connection_id,
        )
        if (listing) {
          if (job.kind === 'listing.publish') listing.status = result.listingStatus
          listing.syncStatus = 'synced'
          listing.error = undefined
          listing.lastSyncedAt = new Date().toISOString()
          if (job.payload.inventoryPlan)
            listing.lastSent = job.payload.inventoryPlan as {
              price: number
              listPrice?: number
              quantity: number
              archive: boolean
            }
          listing.updatedAt = new Date().toISOString()
          if (listing.publication?.phase === 'listed' && listing.publication.jobId) {
            const source = (
              await tx.query<{ payload: { plan: PublicationPlan } }>(
                'SELECT payload FROM integration_jobs WHERE workspace_id=$1 AND id=$2',
                [job.workspace_id, listing.publication.jobId],
              )
            ).rows[0]
            if (source)
              await enqueue(tx, {
                workspaceId: job.workspace_id,
                connectionId: listing.storeId,
                kind: 'listing.status',
                entityId: listing.id,
                payload: {
                  plan: source.payload.plan,
                  reference: listing.publication.reference ?? '',
                  sourceJobId: listing.publication.jobId,
                  phase: 'approval',
                  polls: 0,
                  ...(listing.publication.reconciledByIdentity
                    ? { reconcile: true, phase: 'approval' }
                    : {}),
                },
                key: `listed-check:${job.id}`,
              })
          }
          const connection = await this.service.connection(job.workspace_id, job.connection_id!, tx)
          if (
            connection.settings.pushInventory &&
            (listing.lastSent?.price !== listingPrice(row.document, listing) ||
              (['trendyol', 'n11', 'pazarama'].includes(listing.channel) &&
                (listing.lastSent?.listPrice ?? listing.lastSent?.price) !==
                  listingListPrice(row.document, listing)) ||
              listing.lastSent?.quantity !==
                listingQuantity(
                  row.document,
                  listing,
                  connection.settings.stockBuffer,
                  storeWarehouseIds(row.document, connection.settings),
                ))
          )
            await enqueue(tx, {
              workspaceId: job.workspace_id,
              connectionId: connection.id,
              kind: 'inventory.reconcile',
              key: `after-push:${job.id}`,
            })
        }
      }
      if (result.orderFulfillment) {
        const data = result.orderFulfillment,
          order = row.document.orders.find(
            (item) => item.id === data.orderId && item.storeId === job.connection_id,
          )
        if (
          !order?.fulfillmentWorkflow ||
          order.fulfillmentWorkflow.jobId !== (job.payload.sourceJobId ?? job.id)
        )
          throw new ProviderError(
            'FULFILLMENT_SUPERSEDED',
            'Pazaryeri paket işlemi değişti; eski sonuç uygulanmadı.',
          )
        const wasConfirmed = order.fulfillmentWorkflow.state === 'confirmed'
        const previous = order.marketplacePackages ?? []
        order.marketplacePackages = data.packages.map((item) => ({
          ...item,
          labels: previous.find((old) => old.id === item.id)?.labels,
        }))
        for (const label of data.labels ?? []) {
          const target = order.marketplacePackages.find((item) => item.id === label.packageId)
          if (!target)
            throw new ProviderError(
              'PACKAGE_IDENTITY_MISMATCH',
              'Etiketin paket ilişkisi doğrulanamadı.',
            )
          const contents = Buffer.from(label.data, label.encoding)
          if (
            !contents.length ||
            contents.length > 10 * 1024 * 1024 ||
            (label.mime === 'application/pdf' && contents.subarray(0, 5).toString() !== '%PDF-')
          )
            throw new ProviderError('INVALID_LABEL', 'Pazaryeri etiketi geçersiz.')
          const name = `package-${target.number}.${label.mime === 'application/pdf' ? 'pdf' : 'zpl'}`
          const saved = await storeFile(tx, this.service.config, {
            workspaceId: job.workspace_id,
            name,
            mime: label.mime,
            contents,
            purpose: 'label',
          })
          target.labels = [{ id: saved.id, name, url: saved.url }]
        }
        order.fulfillmentWorkflow.state = data.confirmed ? 'confirmed' : 'pending'
        order.fulfillmentWorkflow.message = result.message
        order.fulfillmentWorkflow.updatedAt = new Date().toISOString()
        if (data.confirmed && !wasConfirmed)
          order.events.push({
            id: randomUUID(),
            at: new Date().toISOString(),
            label: result.message,
          })
        if (data.confirmed && job.payload.sourceJobId)
          await tx.query(
            "UPDATE integration_jobs SET status='completed',last_error=NULL,finished_at=now(),result=COALESCE(result,'{}'::jsonb)||$1::jsonb WHERE workspace_id=$2 AND id=$3 AND entity_id=$4 AND kind='order.fulfillment' AND status IN ('failed','uncertain')",
            [
              JSON.stringify({ reconciledBy: job.id, message: result.message }),
              job.workspace_id,
              job.payload.sourceJobId,
              order.id,
            ],
          )
      }
      if (result.contentUpdate) {
        const update = result.contentUpdate,
          listing = row.document.listings.find(
            (item) => item.id === update.listingId && item.storeId === job.connection_id,
          ),
          plan = job.payload.plan as ContentPlan
        if (
          !listing?.contentWorkflow ||
          listing.contentWorkflow.jobId !== (job.payload.sourceJobId ?? job.id)
        )
          throw new ProviderError(
            'CONTENT_SUPERSEDED',
            'İçerik işlemi değişti; eski sonuç uygulanmadı.',
          )
        Object.assign(listing.contentWorkflow, {
          state: update.state,
          message: update.message,
          reference: result.reference || listing.contentWorkflow.reference,
          checkedAt: new Date().toISOString(),
        })
        if (
          update.state === 'applied' &&
          contentLocalKey(row.document, listing) === plan.localKey
        ) {
          const fields = { ...plan.source.fields, ...plan.changes }
          if (plan.changes.title !== undefined) listing.titleOverride = plan.changes.title
          listing.publishConfig = { ...(listing.publishConfig ?? { attributes: {} }), ...fields }
          listing.version = (listing.version ?? 0) + 1
          listing.updatedAt = new Date().toISOString()
        }
        if (['applied', 'rejected'].includes(update.state) && job.payload.sourceJobId)
          await tx.query(
            "UPDATE integration_jobs SET status=$1,last_error=NULL,finished_at=now(),result=COALESCE(result,'{}'::jsonb)||$2::jsonb WHERE workspace_id=$3 AND id=$4 AND entity_id=$5 AND connection_id=$6 AND kind='listing.content' AND status IN ('failed','uncertain')",
            [
              update.state === 'applied' ? 'completed' : 'failed',
              JSON.stringify({ reconciledBy: job.id, message: update.message }),
              job.workspace_id,
              job.payload.sourceJobId,
              listing.id,
              job.connection_id,
            ],
          )
      }
      if (result.invoice && job.entity_id) {
        const invoice = row.document.invoices.find((item) => item.id === job.entity_id)
        if (invoice) {
          const details = { ...result.invoice }
          delete details.pdfUrl
          delete details.finalizeAfterSeconds
          Object.assign(invoice, details)
          if (pdf)
            invoice.url = (
              await storeFile(tx, this.service.config, {
                workspaceId: job.workspace_id,
                name: `invoice-${invoice.id}.pdf`,
                mime: 'application/pdf',
                contents: pdf,
                purpose: 'invoice',
              })
            ).url
          invoice.error = undefined
          invoice.connectionId = job.connection_id!
          if (result.invoice.finalizeAfterSeconds !== undefined)
            await enqueue(tx, {
              workspaceId: job.workspace_id,
              connectionId: job.connection_id!,
              kind: 'invoice.finalize',
              entityId: invoice.id,
              payload: { invoiceId: invoice.id },
              key: `invoice.finalize:${invoice.id}`,
              delaySeconds: result.invoice.finalizeAfterSeconds,
            })
          if (invoice.status === 'issued') {
            const order = row.document.orders.find((item) => item.id === invoice.orderId)
            const store = order?.storeId
              ? await this.service.connection(job.workspace_id, order.storeId, tx)
              : null
            if (
              order?.storeId &&
              order.externalId &&
              store &&
              store.settings.sendInvoiceLink !== false &&
              this.service.capabilities(store.provider).includes('invoice.link')
            )
              await enqueue(tx, {
                workspaceId: job.workspace_id,
                connectionId: order.storeId,
                kind: 'invoice.link',
                entityId: order.id,
                payload: { orderId: order.id, automaticInvoiceLink: true },
                key: `invoice.link:${invoice.id}`,
              })
          }
        }
      }
      if (result.shipment && job.entity_id) {
        const shipment = row.document.shipments?.find((item) => item.id === job.entity_id)
        if (shipment) {
          const { label, ...details } = result.shipment
          Object.assign(shipment, details)
          shipment.lastCheckedAt = new Date().toISOString()
          shipment.error = undefined
          if (label) {
            const contents = Buffer.from(label.data, label.encoding)
            if (contents.length > 10 * 1024 * 1024)
              throw new ProviderError('LABEL_TOO_LARGE', 'Taşıyıcı etiketi boyut sınırını aştı.')
            const mime = label.mime.startsWith('image/') ? imageMime(contents) : label.mime
            if (!mime)
              throw new ProviderError('INVALID_LABEL', 'Taşıyıcı etiketi geçerli bir görsel değil.')
            const extension =
              mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'png' : 'zpl'
            shipment.labelUrl = (
              await storeFile(tx, this.service.config, {
                workspaceId: job.workspace_id,
                name: `label-${shipment.id}.${extension}`,
                mime,
                contents,
                purpose: 'label',
              })
            ).url
          }
          const order = row.document.orders.find((item) => item.id === shipment.orderId)
          if (order) {
            order.trackingNumber = shipment.trackingNumber ?? order.trackingNumber
            order.cargoProvider = shipment.provider
            if (
              ['approved', 'shipped'].includes(order.status) &&
              ['in_transit', 'delivered'].includes(shipment.status)
            ) {
              order.status = shipment.status === 'delivered' ? 'delivered' : 'shipped'
              order.events.push({
                id: randomUUID(),
                at: new Date().toISOString(),
                label:
                  shipment.status === 'delivered'
                    ? 'Taşıyıcı teslimatı doğruladı.'
                    : 'Taşıyıcı gönderiyi teslim aldı.',
              })
            }
          }
        }
      }
      if (
        result.products?.length ||
        result.orders?.length ||
        result.listingStatus ||
        result.invoice ||
        result.shipment ||
        result.publication ||
        result.orderFulfillment ||
        result.contentUpdate ||
        result.resolution
      )
        await tx.query(
          'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
          [JSON.stringify(row.document), job.workspace_id],
        )
      if (job.kind === 'test')
        await tx.query(
          `UPDATE integration_connections SET status='verified',last_test_at=now(),last_error=NULL WHERE workspace_id=$1 AND id=$2 AND credential_version=$3`,
          [job.workspace_id, job.connection_id, job.credential_version],
        )
      const importedIds = new Set(result.orders?.map((order) => order.externalId) ?? [])
      for (const order of row.document.orders) {
        if (
          beforeOrderStatuses.get(order.id) === order.status &&
          !(
            order.storeId === job.connection_id &&
            order.externalId &&
            importedIds.has(order.externalId)
          )
        )
          continue
        const invoice = ensureAutomaticOrderInvoice(
          row.document,
          order,
          new Date().toISOString(),
          randomUUID,
        )
        if (invoice)
          await queueAutomaticInvoice(
            tx,
            job.workspace_id,
            row.document,
            invoice,
            !beforeInvoiceIds.has(invoice.id),
          )
      }
      const previousCount = Number(job.result?.recordsProcessed ?? 0)
      const summary = {
        message: result.message,
        reference: result.reference,
        ...(result.publication ? { publication: result.publication.state } : {}),
        recordsProcessed:
          previousCount +
          (result.products?.length ?? 0) +
          (result.orders?.length ?? 0) +
          (result.records?.length ?? 0),
      }
      if (result.failure) {
        await tx.query(
          `UPDATE integration_jobs SET status='failed',result=$1,last_error=$2,finished_at=now(),worker_id=NULL,lease_until=NULL WHERE id=$3`,
          [JSON.stringify(summary), `${result.failure.code}: ${result.failure.message}`, job.id],
        )
        await audit(tx, job.workspace_id, null, 'integration.job_failed', job.id, {
          kind: job.kind,
          code: result.failure.code,
        })
      } else if (result.nextPayload)
        await tx.query(
          `UPDATE integration_jobs SET status='waiting',payload=$1,result=$2,available_at=now()+($3::double precision * interval '1 second'),worker_id=NULL,lease_until=NULL,last_error=NULL WHERE id=$4`,
          [
            JSON.stringify(result.nextPayload),
            JSON.stringify(summary),
            result.delaySeconds ?? 5,
            job.id,
          ],
        )
      else {
        if (job.kind === 'orders.pull' && typeof job.payload.to === 'number')
          await tx.query(
            `INSERT INTO integration_cursors(workspace_id,connection_id,resource,cursor) VALUES($1,$2,$3,$4)
          ON CONFLICT(workspace_id,connection_id,resource) DO UPDATE SET cursor=CASE WHEN COALESCE((integration_cursors.cursor->>'lastTo')::bigint,0) < $5 THEN EXCLUDED.cursor ELSE integration_cursors.cursor END,updated_at=now()`,
            [
              job.workspace_id,
              job.connection_id,
              job.kind,
              JSON.stringify({ lastTo: job.payload.to }),
              job.payload.to,
            ],
          )
        await tx.query(
          `UPDATE integration_jobs SET status='completed',result=$1,finished_at=now(),worker_id=NULL,lease_until=NULL,last_error=NULL WHERE id=$2`,
          [JSON.stringify(summary), job.id],
        )
        await audit(tx, job.workspace_id, null, 'integration.job_completed', job.id, {
          kind: job.kind,
          recordsProcessed: summary.recordsProcessed,
        })
      }
    })
  }
}
