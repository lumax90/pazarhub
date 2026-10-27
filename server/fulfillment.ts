import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState, Shipment } from '../src/domain/types'
import type { IntegrationOperation } from '../src/domain/integrations'
import { audit, requireAuth, requirePermission } from './auth'
import { AppError } from './errors'
import type { IntegrationService } from './integration-service'
import { identifier, uuid } from './validation'
import { enqueue } from './jobs'
import { canonicalJson } from './security'
import { invoiceSource } from '../src/domain/invoice-source'

const address = z.strictObject({
  name: z.string().trim().min(2).max(200),
  address: z.string().trim().min(8).max(1000),
  city: z.string().trim().min(2).max(100),
  district: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .trim()
    .min(10)
    .max(25)
    .refine((value) => /^\+?[\d\s()-]+$/.test(value), 'Telefon maskesiz ve sayısal olmalı.'),
})

export function registerFulfillmentRoutes(app: FastifyInstance, service: IntegrationService) {
  const database = service.database
  app.get('/api/integration-options', async (request) => {
    const auth = requireAuth(request)
    const kind = z
      .enum(['marketplace', 'cargo', 'invoice'])
      .parse((request.query as { kind?: string }).kind)
    const rows = await database.query<{
      id: string
      provider: Parameters<typeof service.capabilities>[0]
      name: string
      status: string
      enabled: boolean
      is_default?: boolean
    }>(
      'SELECT id,provider,name,status,enabled,is_default FROM integration_connections WHERE workspace_id=$1 AND kind=$2 AND deleted_at IS NULL ORDER BY created_at',
      [auth.workspaceId, kind],
    )
    return {
      connections: rows.rows.map((row) => ({
        ...row,
        isDefault: !!row.is_default,
        capabilities: service.capabilities(row.provider),
      })),
    }
  })
  app.post('/api/shipments', async (request, reply) => {
    const auth = requirePermission(request, 'orders.write')
    const input = z
      .strictObject({
        orderId: identifier,
        connectionId: uuid,
        recipient: address,
        packages: z.number().int().min(1).max(20),
        desi: z.number().min(0.1).max(1000),
        weight: z.number().min(0.1).max(1000),
        carrierBarcode: z.string().trim().max(40).optional(),
      })
      .parse(request.body)
    const result = await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const order = row.document.orders.find((item) => item.id === input.orderId)
      if (!order || order.status !== 'approved' || !order.inventoryApplied)
        throw new AppError(
          409,
          'ORDER_NOT_READY',
          'Gönderi için onaylanmış ve stok işlemi tamamlanmış sipariş seçin.',
        )
      if (order.syncError)
        throw new AppError(
          409,
          'ORDER_RECONCILIATION_REQUIRED',
          'Gönderiden önce sipariş kalemlerini uzlaştırın.',
        )
      const existing = row.document.shipments?.find(
        (item) => item.orderId === order.id && item.status !== 'cancelled',
      )
      if (existing) {
        const same =
          existing.connectionId === input.connectionId &&
          existing.packages === input.packages &&
          existing.desi === input.desi &&
          existing.weight === input.weight &&
          (existing.carrierBarcode ?? '') === (input.carrierBarcode ?? '') &&
          canonicalJson(existing.recipient) === canonicalJson(input.recipient)
        if (!same)
          throw new AppError(
            409,
            'SHIPMENT_EXISTS',
            'Bu siparişin farklı bilgilerle açılmış bir gönderisi var. Mevcut gönderiyi kontrol edin.',
          )
        return { ok: true, shipmentId: existing.id }
      }
      const connection = await service.connection(auth.workspaceId, input.connectionId, tx)
      if (connection.kind !== 'cargo' || !connection.enabled || connection.status !== 'verified')
        throw new AppError(409, 'CARGO_NOT_READY', 'Etkin ve test edilmiş bir kargo hesabı seçin.')
      if (!service.capabilities(connection.provider).includes('shipment.create'))
        throw new AppError(
          409,
          'UNSUPPORTED_OPERATION',
          'Bu taşıyıcı gönderi oluşturmaya hazır değil.',
        )
      if (order.externalId && order.storeId) {
        const store = await service.connection(auth.workspaceId, order.storeId, tx)
        if (store.settings.cargoConnectionId !== connection.id)
          throw new AppError(
            409,
            'CARGO_MODEL_MISMATCH',
            'Mağaza bağlantısında kendi kargo hesabınızı seçin. Pazaryeri kargosunun yerine ikinci gönderi açılmamalı.',
          )
      }
      if (connection.provider === 'ptt' && !input.carrierBarcode)
        throw new AppError(
          400,
          'BARCODE_REQUIRED',
          'PTT hesabınıza tahsisli kullanılmamış barkodu girin.',
        )
      if (
        input.carrierBarcode &&
        row.document.shipments?.some((item) => item.carrierBarcode === input.carrierBarcode)
      )
        throw new AppError(409, 'BARCODE_USED', 'Bu taşıyıcı barkodu daha önce kullanılmış.')
      const id = randomUUID(),
        shipment: Shipment = {
          id,
          orderId: order.id,
          connectionId: connection.id,
          provider: connection.provider,
          reference: `PH${id.replaceAll('-', '').slice(0, 24)}`,
          status: 'queued',
          createdAt: new Date().toISOString(),
          recipient: input.recipient,
          packages: input.packages,
          desi: input.desi,
          weight: input.weight,
          carrierBarcode: input.carrierBarcode,
        }
      row.document.shipments = [shipment, ...(row.document.shipments ?? [])]
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: 'shipment.create',
        entityId: id,
        payload: { shipmentId: id },
        key: `shipment.create:${id}`,
      })
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'shipment.queued', id, {
        orderId: order.id,
        jobId,
      })
      return { ok: true, shipmentId: id, jobId }
    })
    return reply.code(202).send(result)
  })
  app.post('/api/shipments/:id/:action', async (request, reply) => {
    const auth = requirePermission(request, 'orders.write'),
      params = z.object({ id: uuid, action: z.enum(['track', 'cancel']) }).parse(request.params)
    const key = uuid.parse(request.headers['idempotency-key'])
    const result = await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const shipment = row.document.shipments?.find((item) => item.id === params.id)
      if (!shipment) throw new AppError(404, 'NOT_FOUND', 'Gönderi bulunamadı.')
      if (params.action === 'cancel' && shipment.status !== 'created')
        throw new AppError(
          409,
          'CANCEL_NOT_ALLOWED',
          'Yalnız taşıyıcıya teslim edilmemiş gönderi iptal edilebilir.',
        )
      if (params.action === 'cancel' && shipment.uncertainJobId)
        throw new AppError(
          409,
          'SHIPMENT_UNCERTAIN',
          'Gönderinin önceki işlem sonucunu önce uzlaştırın.',
        )
      const connection = await service.connection(auth.workspaceId, shipment.connectionId, tx)
      const operation = `shipment.${params.action}` as IntegrationOperation
      if (!service.capabilities(connection.provider).includes(operation))
        throw new AppError(
          409,
          'UNSUPPORTED_OPERATION',
          'Bu taşıyıcıda seçilen işlem kullanıma açık değil.',
        )
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: operation,
        entityId: shipment.id,
        payload: { shipmentId: shipment.id },
        key: `${operation}:${shipment.id}:${key}`,
      })
      await audit(tx, auth.workspaceId, auth.userId, operation, shipment.id, { jobId })
      return { ok: true, jobId }
    })
    return reply.code(202).send(result)
  })
  app.post('/api/invoices/:id/action', async (request, reply) => {
    const auth = requirePermission(request, 'finance.write'),
      id = identifier.parse((request.params as { id: string }).id)
    const input = z
      .strictObject({ operation: z.enum(['create', 'finalize', 'status']), connectionId: uuid })
      .parse(request.body)
    const key = uuid.parse(request.headers['idempotency-key'])
    const result = await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const invoice = row.document.invoices.find((item) => item.id === id)
      if (!invoice) throw new AppError(404, 'NOT_FOUND', 'Fatura bulunamadı.')
      if (invoice.manualDocument)
        throw new AppError(
          409,
          'INVOICE_EXTERNAL_DOCUMENT',
          'Fatura başka yerde kesilmiş ve elle bağlanmış. Paraşüt’te ikinci belge oluşturulmaz veya sorgulanmaz.',
        )
      const order = invoiceSource(row.document, invoice)
      if (!order)
        throw new AppError(404, 'INVOICE_SOURCE_REQUIRED', 'Faturanın kalem kaynağı bulunamadı.')
      if (input.operation !== 'status' && invoice.localOnly)
        throw new AppError(409, 'INVOICE_LOCAL_ONLY', 'Bu fatura yalnız iç kayıt için seçilmiş.')
      if (input.operation !== 'status' && ['cancelled', 'returned'].includes(order.status))
        throw new AppError(409, 'ORDER_CLOSED', 'İptal/iade siparişi için bu işlem yapılamaz.')
      if (invoice.connectionId && invoice.connectionId !== input.connectionId)
        throw new AppError(
          409,
          'ACCOUNT_LOCKED',
          'Fatura daha önce başka bir sağlayıcı hesabına bağlandı.',
        )
      const connection = await service.connection(auth.workspaceId, input.connectionId, tx)
      if (connection.kind !== 'invoice' || !connection.enabled || connection.status !== 'verified')
        throw new AppError(
          409,
          'INVOICE_PROVIDER_NOT_READY',
          'Etkin ve test edilmiş bir Paraşüt hesabı seçin.',
        )
      if (input.operation === 'finalize' && order.invoicePreference === 'draft')
        throw new AppError(
          409,
          'FINALIZATION_DISABLED',
          'Siparişte “Resmîleşmesin” seçili. Fatura tercihini düzenleyin.',
        )
      const operation = `invoice.${input.operation}` as IntegrationOperation
      if (input.operation !== 'status') {
        const uncertain = await tx.query(
          "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind IN ('invoice.create','invoice.finalize') AND status='uncertain' LIMIT 1",
          [auth.workspaceId, invoice.id],
        )
        if (uncertain.rows.length)
          throw new AppError(
            409,
            'INVOICE_UNCERTAIN',
            'Önceki fatura işleminin sonucunu uzlaştırın.',
          )
      }
      const jobId = await enqueue(tx, {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        kind: operation,
        entityId: invoice.id,
        payload: { invoiceId: invoice.id },
        key: input.operation === 'status' ? `${operation}:${id}:${key}` : `${operation}:${id}`,
      })
      if (input.operation === 'create' && !invoice.externalId) invoice.status = 'queued'
      invoice.connectionId = connection.id
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, operation, id, { jobId })
      return { ok: true, jobId }
    })
    return reply.code(202).send(result)
  })
  app.patch('/api/orders/:id/billing', async (request) => {
    const auth = requirePermission(request, 'finance.write'),
      id = identifier.parse((request.params as { id: string }).id)
    const input = z
      .strictObject({
        billingAddress: z.strictObject({
          name: z.string().trim().min(2).max(200),
          address: z.string().trim().min(5).max(1000),
          city: z.string().trim().min(2).max(100),
          district: z.string().max(100).optional(),
          phone: z.string().max(50),
          taxId: z.string().regex(/^(\d{10}|\d{11})?$/),
          taxOffice: z.string().max(200).optional(),
        }),
        invoicePreference: z.enum(['default', 'draft', 'immediate']),
        shipmentMetadata: z
          .strictObject({
            carrierName: z.string().max(200),
            carrierTaxId: z.string().regex(/^(\d{10})?$/),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .optional(),
      })
      .parse(request.body)
    await database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const order = row.document.orders.find((item) => item.id === id)
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Sipariş bulunamadı.')
      const invoice = row.document.invoices.find((item) => item.id === order.invoiceId)
      const pending = invoice
        ? (
            await tx.query(
              `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND kind IN ('invoice.create','invoice.finalize') AND status IN ('queued','running','waiting','uncertain')`,
              [auth.workspaceId, invoice.id],
            )
          ).rows
        : []
      if (pending.length)
        throw new AppError(
          409,
          'INVOICE_BUSY',
          'Fatura işlemi devam ediyor; tamamlandıktan sonra bilgileri düzenleyin.',
        )
      if (invoice?.status === 'issued')
        throw new AppError(
          409,
          'INVOICE_LOCKED',
          'Resmileşmiş belgenin fatura bilgileri değiştirilemez.',
        )
      if (
        invoice?.externalId &&
        (['name', 'address', 'city', 'district', 'phone', 'taxId', 'taxOffice'] as const).some(
          (key) => (order.billingAddress?.[key] ?? '') !== (input.billingAddress[key] ?? ''),
        )
      )
        throw new AppError(
          409,
          'REMOTE_DRAFT_EXISTS',
          'Paraşüt taslağının alıcı bilgilerini Paraşüt üzerinden düzenleyin.',
        )
      order.billingAddress = input.billingAddress
      order.invoicePreference = input.invoicePreference
      order.shipmentMetadata = input.shipmentMetadata
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'order.billing_updated', id)
    })
    return { ok: true }
  })
}
