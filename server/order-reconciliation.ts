import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState, Order, OrderLine, StockAllocation } from '../src/domain/types'
import type { RemoteOrder } from '../src/domain/integrations'
import {
  availableStock,
  findVariant,
  lineTotal,
  orderTotal,
  variantCost,
} from '../src/domain/selectors'
import { moveStock, MAIN_WAREHOUSE } from '../src/domain/inventory'
import { snapshotBundle, stockDemand, variantCostKnown } from '../src/domain/bundles'
import { invoiceLineMetadata } from '../src/domain/products'
import { currencySnapshot } from '../src/domain/money'
import { allocateOrderStock, aggregateStockAllocations } from '../src/domain/stock-allocation'
import type { IntegrationService } from './integration-service'
import { requirePermission, assertPermission, audit } from './auth'
import { AppError } from './errors'
import { identifier, uuid } from './validation'
import { canonicalJson, sha256 } from './security'
import { enqueue } from './jobs'
import { ensureAutomaticOrderInvoice } from '../src/domain/orders'
import { queueAutomaticInvoice } from './invoice-automation'

export function remoteOrderFingerprint(remote: RemoteOrder) {
  return sha256(
    canonicalJson({
      externalId: remote.externalId,
      total: remote.total,
      shipping: remote.shipping,
      closed: ['cancelled', 'returned'].includes(remote.normalizedStatus ?? '')
        ? remote.normalizedStatus
        : '',
      lines: remote.lines
        .map((line) => ({
          id: line.externalId,
          sku: line.sku,
          barcode: line.barcode,
          quantity: line.quantity,
          total: line.total ?? line.unitPrice * line.quantity,
          taxRate: line.taxRate,
          closed: ['cancelled', 'returned'].includes(line.status ?? '') ? line.status : '',
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  )
}
export function reconciledOrderStatus(
  remote: RemoteOrder,
): 'pending' | 'shipped' | 'delivered' | 'cancelled' | 'returned' {
  if (['cancelled', 'returned'].includes(remote.normalizedStatus ?? ''))
    return remote.normalizedStatus as 'cancelled' | 'returned'
  const active = remote.lines.filter(
    (line) => !['cancelled', 'returned'].includes(line.status ?? ''),
  )
  if (!active.length)
    return remote.lines.every((line) => line.status === 'returned') ? 'returned' : 'cancelled'
  if (active.every((line) => line.status === 'delivered')) return 'delivered'
  if (active.every((line) => ['shipped', 'delivered'].includes(line.status ?? ''))) return 'shipped'
  return remote.normalizedStatus ?? 'pending'
}
export function suggestOrderMapping(state: AppState, order: Order, remote: RemoteOrder) {
  return Object.fromEntries(
    remote.lines
      .map((line) => {
        const exact = order.lines.find((old) => old.externalId === line.externalId)
        if (exact?.variantId) return [line.externalId, exact.variantId]
        const candidates = state.products.flatMap((product) =>
          product.variants.filter(
            (variant) =>
              (line.barcode && variant.barcode === line.barcode) ||
              (line.sku && variant.sku === line.sku),
          ),
        )
        return [line.externalId, candidates.length === 1 ? candidates[0].id : '']
      })
      .filter(([, id]) => id),
  )
}

interface ReconciliationInput {
  mappings: Record<string, string>
  restockRemoved: boolean
  note: string
}
export function reconcileOrderState(
  original: AppState,
  orderId: string,
  remote: RemoteOrder,
  input: ReconciliationInput,
  author: string,
  now = new Date().toISOString(),
) {
  const state = structuredClone(original),
    order = state.orders.find((order) => order.id === orderId)
  if (!order || !order.externalId || order.externalId !== remote.externalId)
    throw new AppError(409, 'ORDER_IDENTITY_MISMATCH', 'Pazaryeri sipariş ilişkisi değişti.')
  const before = {
      lines: structuredClone(order.lines),
      total: orderTotal(order),
      status: order.status,
    },
    status = reconciledOrderStatus(remote),
    closed = ['cancelled', 'returned'].includes(status)
  const active = closed
    ? []
    : remote.lines.filter((line) => !['cancelled', 'returned'].includes(line.status ?? ''))
  const mappings = { ...suggestOrderMapping(state, order, remote), ...input.mappings }
  const lines: OrderLine[] = active.map((line) => {
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isSafeInteger(line.total ?? line.unitPrice * line.quantity) ||
      line.unitPrice < 0
    )
      throw new AppError(422, 'INVALID_ORDER_LINE', 'Pazaryeri kalem miktarı veya tutarı geçersiz.')
    const variantId = mappings[line.externalId],
      found = variantId ? findVariant(state, variantId) : undefined
    if (!found) throw new AppError(422, 'MAPPING_REQUIRED', `${line.title}: yerel varyantı seçin.`)
    const previous =
      order.lines.find(
        (old) => old.externalId === line.externalId && old.variantId === variantId,
      ) ?? order.lines.find((old) => old.variantId === variantId)
    const cost = previous?.unitCost ?? (order.historical ? 0 : variantCost(state, variantId))
    if (!Number.isSafeInteger(cost))
      throw new AppError(
        422,
        'COST_RATE_REQUIRED',
        'Yeni eşlenen ürünün döviz kuru veya maliyeti gerekli.',
      )
    const taxRate = line.taxRate ?? previous?.taxRate ?? found.product.taxRate
    return {
      ...previous,
      variantId,
      externalId: line.externalId,
      externalSku: line.sku,
      externalBarcode: line.barcode,
      title: line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotalOverride: line.total,
      taxRate,
      taxKnown: line.taxRate !== undefined || previous?.taxKnown !== false,
      costKnown: previous?.costKnown ?? (!order.historical && variantCostKnown(state, variantId)),
      unitCost: cost,
      ...(!previous
        ? {
            ...invoiceLineMetadata(found.product, found.variant),
            ...currencySnapshot(
              found.product.currency,
              state.exchangeRates,
              state.ecommerce?.exchangeRateType,
            ),
            ...(found.product.bundle && !order.historical
              ? { bundleComponents: snapshotBundle(state, variantId) }
              : {}),
          }
        : {}),
      prepared:
        previous?.prepared &&
        previous.quantity === line.quantity &&
        lineTotal(previous) === (line.total ?? line.unitPrice * line.quantity),
    }
  })
  const incomingTotal =
      remote.lines.reduce((sum, line) => sum + (line.total ?? line.unitPrice * line.quantity), 0) +
      remote.shipping,
    afterTotal = closed
      ? before.total
      : lines.reduce((sum, line) => sum + lineTotal(line), 0) + remote.shipping
  if (!Number.isSafeInteger(remote.total) || ![incomingTotal, afterTotal].includes(remote.total))
    throw new AppError(
      422,
      'ORDER_TOTAL_UNRESOLVED',
      'Pazaryeri toplamı ile kalemler uyuşmuyor. İndirim/kargo dağılımı sağlayıcıda doğrulanmalı.',
    )
  const economic = (values: OrderLine[]) =>
    canonicalJson(
      values
        .map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          total: lineTotal(line),
          taxRate: line.taxRate,
        }))
        .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    )
  const economicChanged =
    (closed && order.status !== status) ||
    (!closed && (economic(lines) !== economic(order.lines) || afterTotal !== before.total))
  const invoice = state.invoices.find((invoice) => invoice.orderId === order.id)
  if (
    economicChanged &&
    (invoice?.externalId || invoice?.status === 'issued' || invoice?.uncertainJobId)
  )
    throw new AppError(
      409,
      'FISCAL_RECONCILIATION_REQUIRED',
      'Siparişin Paraşüt kaydı/resmî belgesi var. Mali düzeltme tamamlanmadan kalem ve tutar değiştirilemez.',
    )
  if (
    economicChanged &&
    state.returns?.some((item) => item.source === 'order' && item.saleId === order.id)
  )
    throw new AppError(
      409,
      'RETURN_RECONCILIATION_REQUIRED',
      'Siparişin kayıtlı iadeleri var. Aynı stok/tutar etkisini ikinci kez uygulamadan iade kayıtlarını uzlaştırın.',
    )
  const warehouse = order.warehouseId ?? MAIN_WAREHOUSE,
    hadInventory = order.inventoryApplied === true,
    consumeNew = !hadInventory && !order.historical && ['shipped', 'delivered'].includes(status)
  const oldAllocations = hadInventory
    ? (order.stockAllocations ??
      stockDemand(state, order.lines, true).map((item) => ({ ...item, warehouseId: warehouse })))
    : []
  const virtual = structuredClone(state)
  for (const allocation of oldAllocations) {
    const variant = findVariant(virtual, allocation.variantId)!.variant
    variant.stockByWarehouse ??= { [MAIN_WAREHOUSE]: variant.stock }
    variant.stockByWarehouse[allocation.warehouseId] =
      (variant.stockByWarehouse[allocation.warehouseId] ?? 0) + allocation.quantity
    variant.stock = Object.values(variant.stockByWarehouse).reduce((sum, value) => sum + value, 0)
  }
  let allocations: StockAllocation[] = []
  if (!closed && (!order.historical || hadInventory))
    try {
      allocations = allocateOrderStock(
        virtual,
        lines,
        order.warehouseIds ?? [warehouse],
        order.id,
        false,
        oldAllocations,
      )
    } catch (error) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', (error as Error).message)
    }
  const allocationKey = (item: StockAllocation) =>
    JSON.stringify([item.warehouseId, item.variantId])
  const oldMap = new Map(
      aggregateStockAllocations(oldAllocations).map((item) => [allocationKey(item), item]),
    ),
    newMap = new Map(
      aggregateStockAllocations(hadInventory || consumeNew ? allocations : []).map((item) => [
        allocationKey(item),
        item,
      ]),
    )
  const movements = [...new Set([...oldMap.keys(), ...newMap.keys()])]
    .map((key) => ({
      ...(oldMap.get(key) ?? newMap.get(key))!,
      quantity: (oldMap.get(key)?.quantity ?? 0) - (newMap.get(key)?.quantity ?? 0),
    }))
    .map((item) => ({
      ...item,
      quantity: item.quantity > 0 && !input.restockRemoved ? 0 : item.quantity,
    }))
    .filter((item) => item.quantity !== 0)
  for (const movement of movements)
    if (
      movement.quantity < 0 &&
      !state.ecommerce?.allowNegativeStock &&
      availableStock(state, movement.variantId, order.id, movement.warehouseId) < -movement.quantity
    )
      throw new AppError(
        409,
        'INSUFFICIENT_STOCK',
        'Artan sipariş miktarı için depoda yeterli satılabilir stok yok.',
      )
  for (const movement of movements) {
    const created = moveStock(
      state,
      movement.variantId,
      movement.warehouseId,
      movement.quantity,
      'adjustment',
      `${order.number} · pazaryeri kalem uzlaştırması`,
      now,
      randomUUID,
    )
    if (created) created.author = author
  }
  order.lines = closed ? order.lines : lines
  if (!closed) {
    order.totalOverride = afterTotal
    order.shipping = remote.shipping
  }
  order.status = status === 'pending' && order.status === 'approved' ? 'approved' : status
  order.inventoryApplied = closed ? false : hadInventory || consumeNew
  if (!closed && order.warehouseIds) order.stockAllocations = allocations
  order.remoteStatus = remote.status
  order.remoteUpdatedAt = remote.modifiedAt
  order.reconciledRemoteHash = remoteOrderFingerprint(remote)
  order.syncError = undefined
  order.syncStatus = 'synced'
  order.packageNumbers = remote.packageNumbers ?? order.packageNumbers
  if (closed && invoice && !invoice.externalId) invoice.status = 'cancelled'
  order.events.push({
    id: randomUUID(),
    at: now,
    label: `Pazaryeri kalemleri ${author} tarafından uzlaştırıldı. ${input.note}`.trim(),
  })
  const reconciliationId = randomUUID()
  state.orderReconciliations = [
    {
      id: reconciliationId,
      orderId,
      at: now,
      author,
      sourceHash: order.reconciledRemoteHash,
      before,
      afterTotal: closed ? 0 : afterTotal,
      restockRemoved: input.restockRemoved,
      note: input.note,
    },
    ...(state.orderReconciliations ?? []),
  ]
  return {
    state,
    summary: {
      id: reconciliationId,
      beforeTotal: before.total,
      afterTotal: closed ? 0 : afterTotal,
      economicChanged,
      status: order.status,
      movements: movements.map((movement) => ({
        ...movement,
        name: findVariant(state, movement.variantId)?.product.name ?? movement.variantId,
      })),
      lines: order.lines,
    },
  }
}

export function registerOrderReconciliation(app: FastifyInstance, service: IntegrationService) {
  const db = service.database
  const source = async (workspaceId: string, order: Order) => {
    const row = (
      await db.query<{ document: RemoteOrder }>(
        "SELECT document FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND external_id=$3 AND resource='order'",
        [workspaceId, order.storeId, order.externalId],
      )
    ).rows[0]
    if (!row)
      throw new AppError(404, 'SOURCE_NOT_FOUND', 'Önce pazaryeri sipariş eşitlemesini çalıştırın.')
    return row.document
  }
  app.get('/api/orders/:id/reconciliation', async (request) => {
    const auth = requirePermission(request, 'orders.write'),
      id = identifier.parse((request.params as { id: string }).id),
      row = (
        await db.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1',
          [auth.workspaceId],
        )
      ).rows[0],
      order = row.document.orders.find((order) => order.id === id)
    if (!order?.externalId)
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Pazaryeri siparişi bulunamadı.')
    const remote = await source(auth.workspaceId, order)
    return { remote, mappings: suggestOrderMapping(row.document, order, remote) }
  })
  app.post('/api/orders/:id/reconciliation/preview', async (request) => {
    const auth = requirePermission(request, 'orders.write'),
      id = identifier.parse((request.params as { id: string }).id),
      input = z
        .strictObject({
          mappings: z.record(identifier, identifier),
          restockRemoved: z.boolean(),
          note: z.string().trim().min(3).max(1000),
        })
        .parse(request.body)
    const row = (
        await db.query<{ document: AppState; revision: string | number }>(
          'SELECT document,revision FROM workspace_states WHERE workspace_id=$1',
          [auth.workspaceId],
        )
      ).rows[0],
      order = row.document.orders.find((order) => order.id === id)
    if (!order?.externalId || !order.storeId)
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Pazaryeri siparişi bulunamadı.')
    const remote = await source(auth.workspaceId, order),
      planned = reconcileOrderState(row.document, id, remote, input, auth.name)
    if (planned.summary.economicChanged) assertPermission(auth, 'finance.write')
    const previewId = randomUUID()
    await db.query(
      "INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
      [
        auth.workspaceId,
        order.storeId,
        `order-reconcile:${previewId}`,
        JSON.stringify({
          id,
          input,
          revision: Number(row.revision),
          sourceHash: remoteOrderFingerprint(remote),
        }),
      ],
    )
    return { previewId, ...planned.summary }
  })
  app.post('/api/orders/:id/reconciliation/apply', async (request) => {
    const auth = requirePermission(request, 'orders.write'),
      id = identifier.parse((request.params as { id: string }).id),
      { previewId } = z.strictObject({ previewId: uuid }).parse(request.body),
      key = uuid.parse(request.headers['idempotency-key']),
      hash = sha256(canonicalJson({ id, previewId }))
    return db.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState; revision: string | number }>(
          'SELECT document,revision FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const receipt = (
        await tx.query<{ user_id: string; body_hash: string; result: unknown }>(
          'SELECT user_id,body_hash,result FROM command_receipts WHERE workspace_id=$1 AND request_key=$2',
          [auth.workspaceId, key],
        )
      ).rows[0]
      if (receipt) {
        if (receipt.user_id !== auth.userId || receipt.body_hash !== hash)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'İstek anahtarı farklı bir işleme ait.')
        return receipt.result
      }
      const order = row.document.orders.find((order) => order.id === id)
      if (!order?.storeId || !order.externalId)
        throw new AppError(404, 'ORDER_NOT_FOUND', 'Pazaryeri siparişi bulunamadı.')
      const cached = (
        await tx.query<{
          document: { id: string; input: ReconciliationInput; revision: number; sourceHash: string }
        }>(
          'SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()',
          [auth.workspaceId, order.storeId, `order-reconcile:${previewId}`],
        )
      ).rows[0]?.document
      const remote = (
        await tx.query<{ document: RemoteOrder }>(
          "SELECT document FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND external_id=$3 AND resource='order'",
          [auth.workspaceId, order.storeId, order.externalId],
        )
      ).rows[0]?.document
      if (
        !cached ||
        cached.id !== id ||
        cached.revision !== Number(row.revision) ||
        !remote ||
        cached.sourceHash !== remoteOrderFingerprint(remote)
      )
        throw new AppError(
          409,
          'RECONCILIATION_STALE',
          'Sipariş, stok veya pazaryeri kaydı değişti. Önizlemeyi yenileyin.',
        )
      const invoices = [
        ...row.document.invoices
          .filter((invoice) => invoice.orderId === id)
          .map((invoice) => invoice.id),
        ...(row.document.shipments ?? [])
          .filter((shipment) => shipment.orderId === id)
          .map((shipment) => shipment.id),
      ]
      const pending = await tx.query(
        "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND (entity_id=$2 OR entity_id=ANY($3::text[])) AND kind IN ('invoice.create','invoice.finalize','order.fulfillment','shipment.create') AND status IN ('queued','running','waiting','uncertain') LIMIT 1",
        [auth.workspaceId, id, invoices],
      )
      if (pending.rows.length)
        throw new AppError(
          409,
          'ORDER_BUSY',
          'Fatura veya gönderim işlemi bitmeden sipariş kalemleri değiştirilemez.',
        )
      const planned = reconcileOrderState(row.document, id, remote, cached.input, auth.name)
      if (planned.summary.economicChanged) assertPermission(auth, 'finance.write')
      const currentOrder = planned.state.orders.find((order) => order.id === id)!
      const invoice = ensureAutomaticOrderInvoice(
        planned.state,
        currentOrder,
        new Date().toISOString(),
        randomUUID,
      )
      if (invoice)
        await queueAutomaticInvoice(
          tx,
          auth.workspaceId,
          planned.state,
          invoice,
          !row.document.invoices.some((old) => old.id === invoice.id),
        )
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(planned.state), auth.workspaceId],
      )
      const stores = await tx.query<{ id: string }>(
        "SELECT id FROM integration_connections WHERE workspace_id=$1 AND kind='marketplace' AND enabled=true AND status='verified' AND settings->>'pushInventory'='true'",
        [auth.workspaceId],
      )
      for (const store of stores.rows)
        await enqueue(tx, {
          workspaceId: auth.workspaceId,
          connectionId: store.id,
          kind: 'inventory.reconcile',
          key: `order-reconcile:${previewId}:${store.id}`,
        })
      const result = { ok: true, id: planned.summary.id }
      await tx.query(
        "INSERT INTO command_receipts(workspace_id,request_key,user_id,command_type,body_hash,result,revision) SELECT $1,$2,$3,'order.reconcile',$4,$5,revision FROM workspace_states WHERE workspace_id=$1",
        [auth.workspaceId, key, auth.userId, hash, JSON.stringify(result)],
      )
      await tx.query(
        'DELETE FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3',
        [auth.workspaceId, order.storeId, `order-reconcile:${previewId}`],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'order.reconciled', id, {
        sourceHash: cached.sourceHash,
        reconciliationId: planned.summary.id,
      })
      return result
    })
  })
}
