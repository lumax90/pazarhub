import { randomUUID } from 'node:crypto'
import { invoiceLineMetadata } from '../src/domain/products'
import { currencySnapshot } from '../src/domain/money'
import { reserveOrderWarehouses } from '../src/domain/stock-allocation'
import { snapshotBundle, variantCost, variantCostKnown } from '../src/domain/bundles'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { executeCommand } from '../src/domain/operations'
import { ensureAutomaticOrderInvoice } from '../src/domain/orders'
import { queueAutomaticInvoice } from './invoice-automation'
import { findVariant } from '../src/domain/selectors'
import type { AppState, Product } from '../src/domain/types'
import type { MarketplaceProvider, RemoteProduct } from '../src/domain/integrations'
import { audit, requirePermission } from './auth'
import { AppError } from './errors'
import type { IntegrationService } from './integration-service'
import { identifier, uuid } from './validation'
import { enqueue } from './jobs'

interface RemoteRow {
  id: string
  external_id: string
  local_id: string | null
  document: RemoteProduct
}

export function registerMappingRoutes(app: FastifyInstance, service: IntegrationService) {
  const database = service.database
  app.post('/api/remote-products/:id/map', async (request) => {
    const auth = requirePermission(request, 'catalog.write')
    const id = uuid.parse((request.params as { id: string }).id)
    const input = z
      .discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('link'), variantId: identifier }),
        z.strictObject({
          mode: z.literal('import'),
          initialStock: z.enum(['zero', 'remote']).default('zero'),
          taxRate: z.number().int().min(0).max(100),
          cost: z.number().int().min(0).max(1_000_000_000).default(0),
        }),
      ])
      .parse(request.body)
    return database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const remote = (
        await tx.query<RemoteRow & { connection_id: string }>(
          `SELECT id,external_id,local_id,document,connection_id FROM external_records WHERE workspace_id=$1 AND id=$2 AND resource='product' FOR UPDATE`,
          [auth.workspaceId, id],
        )
      ).rows[0]
      if (!remote) throw new AppError(404, 'NOT_FOUND', 'Uzak ürün bulunamadı.')
      const connection = await service.connection(auth.workspaceId, remote.connection_id, tx)
      if (remote.local_id) {
        if (input.mode === 'link' && remote.local_id !== input.variantId)
          throw new AppError(409, 'ALREADY_MAPPED', 'Bu uzak ilan başka bir varyanta bağlı.')
        return { ok: true, variantId: remote.local_id }
      }
      let variantId = input.mode === 'link' ? input.variantId : randomUUID()
      if (input.mode === 'import') {
        const d = remote.document
        const matches = row.document.products.flatMap((product) =>
          product.variants.filter(
            (variant) =>
              (d.barcode && variant.barcode === d.barcode) ||
              (!d.barcode && d.sku && variant.sku === d.sku),
          ),
        )
        if (matches.length)
          throw new AppError(
            409,
            'MATCH_EXISTS',
            'Bu barkod/stok kodu katalogda var. Yeni ürün almak yerine mevcut varyantı bağlayın.',
          )
        const product: Product = {
          id: randomUUID(),
          name: d.title,
          category: d.category || 'Sınıflandırılmamış',
          brand: d.brand || '',
          description: '',
          art: 'bag',
          color: '#aab8cc',
          taxRate: input.taxRate,
          active: true,
          lowStock: 5,
          version: 1,
          images: d.images,
          variants: [
            {
              id: variantId,
              name: 'Standart',
              sku: d.sku || `SKU-${randomUUID().slice(0, 8)}`,
              barcode: d.barcode,
              price: d.price,
              cost: input.cost,
              stock: input.initialStock === 'remote' ? d.quantity : 0,
            },
          ],
        }
        const outcome = executeCommand(row.document, { type: 'product.save', product })
        if (!outcome.result.ok) throw new AppError(422, 'IMPORT_INVALID', outcome.result.message)
        Object.assign(row.document, outcome.state)
      }
      const found = findVariant(row.document, variantId)
      if (!found) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Varyant bulunamadı.')
      variantId = found.variant.id
      const existing = row.document.listings.find(
        (listing) => listing.storeId === connection.id && listing.externalId === remote.external_id,
      )
      if (existing && existing.variantId !== variantId)
        throw new AppError(409, 'LISTING_MAPPED', 'İlanın mevcut eşlemesi farklı.')
      if (!existing)
        row.document.listings.push({
          id: randomUUID(),
          productId: found.product.id,
          variantId,
          storeId: connection.id,
          channel: connection.provider as MarketplaceProvider,
          status: remote.document.status ?? 'pending',
          desiredStatus: 'active',
          syncStatus: 'idle',
          priceOverride: remote.document.price,
          remoteListPrice: remote.document.listPrice,
          titleOverride: remote.document.title,
          externalId: remote.external_id,
          externalSku: remote.document.sku,
          externalBarcode: remote.document.barcode,
          remoteCategoryId: remote.document.categoryId,
          asin: remote.document.asin,
          attributes: remote.document.attributes,
          updatedAt: new Date().toISOString(),
          version: 1,
        })
      await tx.query('UPDATE external_records SET local_id=$1 WHERE workspace_id=$2 AND id=$3', [
        variantId,
        auth.workspaceId,
        id,
      ])
      for (const order of row.document.orders.filter(
        (order) => order.storeId === connection.id && !order.inventoryApplied,
      )) {
        for (const line of order.lines) {
          if (
            !line.variantId &&
            ((remote.document.barcode && line.externalBarcode === remote.document.barcode) ||
              (!line.externalBarcode &&
                remote.document.sku &&
                line.externalSku === remote.document.sku))
          ) {
            line.variantId = variantId
            if (!order.historical) {
              Object.assign(line, invoiceLineMetadata(found.product, found.variant))
              if (found.product.bundle)
                line.bundleComponents = snapshotBundle(row.document, variantId)
              const cost = variantCost(row.document, variantId)
              line.unitCost = Number.isSafeInteger(cost) ? cost : 0
              Object.assign(
                line,
                currencySnapshot(
                  found.product.currency,
                  row.document.exchangeRates,
                  row.document.ecommerce?.exchangeRateType,
                ),
              )
              line.costKnown = variantCostKnown(row.document, variantId)
              if (line.taxKnown === false) {
                line.taxRate = found.product.taxRate
                line.taxKnown = true
              }
            }
          }
        }
        if (order.warehouseIds) reserveOrderWarehouses(row.document, order, order.warehouseIds)
      }
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, `catalog.${input.mode}`, id, {
        variantId,
        connectionId: connection.id,
      })
      return { ok: true, variantId }
    })
  })
  app.post('/api/orders/:id/map-line', async (request) => {
    const auth = requirePermission(request, 'orders.write')
    const orderId = identifier.parse((request.params as { id: string }).id)
    const input = z.strictObject({ lineId: identifier, variantId: identifier }).parse(request.body)
    await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const order = row.document.orders.find((item) => item.id === orderId)
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Sipariş bulunamadı.')
      const line = order.lines.find((item) => item.externalId === input.lineId)
      const found = findVariant(row.document, input.variantId)
      if (!line || !found) throw new AppError(404, 'NOT_FOUND', 'Satır veya varyant bulunamadı.')
      if (order.inventoryApplied || (line.variantId && line.variantId !== input.variantId))
        throw new AppError(
          409,
          'MAPPING_LOCKED',
          'Stok hareketi bulunan veya zaten bağlı satır değiştirilemez.',
        )
      const wasMapped = !!line.variantId
      line.variantId = input.variantId
      if (!order.historical && !wasMapped) {
        Object.assign(line, invoiceLineMetadata(found.product, found.variant))
        if (found.product.bundle)
          line.bundleComponents = snapshotBundle(row.document, input.variantId)
        const cost = variantCost(row.document, input.variantId)
        line.unitCost = Number.isSafeInteger(cost) ? cost : 0
        Object.assign(
          line,
          currencySnapshot(
            found.product.currency,
            row.document.exchangeRates,
            row.document.ecommerce?.exchangeRateType,
          ),
        )
        line.costKnown = variantCostKnown(row.document, input.variantId)
        if (line.taxKnown === false) {
          line.taxRate = found.product.taxRate
          line.taxKnown = true
        }
      }
      if (order.warehouseIds) reserveOrderWarehouses(row.document, order, order.warehouseIds)
      const invoice = ensureAutomaticOrderInvoice(
        row.document,
        order,
        new Date().toISOString(),
        randomUUID,
      )
      if (invoice) await queueAutomaticInvoice(tx, auth.workspaceId, row.document, invoice)
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'order.line_mapped', order.id, {
        lineId: input.lineId,
        variantId: input.variantId,
      })
    })
    return { ok: true }
  })
  app.post('/api/orders/:id/reconcile-stock', async (request) => {
    const auth = requirePermission(request, 'stock.write')
    const id = identifier.parse((request.params as { id: string }).id)
    await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const order = row.document.orders.find((item) => item.id === id)
      if (!order || order.historical || !['shipped', 'delivered'].includes(order.status))
        throw new AppError(409, 'NOT_ELIGIBLE', 'Bu sipariş stok tamamlama işlemine uygun değil.')
      if (order.inventoryApplied) return
      const status = order.status
      order.status = 'pending'
      const result = executeCommand(row.document, {
        type: 'order.transition',
        id,
        status: 'approved',
      })
      if (!result.result.ok) throw new AppError(422, 'STOCK_BLOCKED', result.result.message)
      Object.assign(row.document, result.state)
      const current = row.document.orders.find((item) => item.id === id)!
      current.status = status
      current.syncStatus = 'synced'
      const invoice = ensureAutomaticOrderInvoice(
        row.document,
        current,
        new Date().toISOString(),
        randomUUID,
      )
      if (invoice) await queueAutomaticInvoice(tx, auth.workspaceId, row.document, invoice)
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      const targets = await tx.query<{ id: string }>(
        `SELECT id FROM integration_connections WHERE workspace_id=$1 AND enabled=true AND settings->>'pushInventory'='true' AND deleted_at IS NULL`,
        [auth.workspaceId],
      )
      for (const target of targets.rows)
        await enqueue(tx, {
          workspaceId: auth.workspaceId,
          connectionId: target.id,
          kind: 'inventory.reconcile',
          key: `reconcile-order:${id}:${target.id}`,
        })
      await audit(tx, auth.workspaceId, auth.userId, 'order.stock_reconciled', id)
    })
    return { ok: true }
  })
}
