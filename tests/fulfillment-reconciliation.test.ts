import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import { enqueue } from '../server/jobs'
import { createEmptyState } from '../src/domain/empty-state'
import type { AppState, Order, Shipment } from '../src/domain/types'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { fulfillmentFixture } from './fulfillment-fixture'

vi.mock('../server/downloads', () => ({
  downloadPublicFile: async () => Buffer.from('%PDF-1.4\n%%EOF'),
}))
const fixture = fulfillmentFixture()
const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 11),
  cookieName: 'fulfillment-test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Test',
}
let app: FastifyInstance, db: Database, worker: IntegrationWorker
beforeAll(async () => {
  db = await createDatabase(config, true)
  const built = await createApp(config, {
    database: db,
    worker: false,
    logger: false,
    fetcher: fixture.fetcher,
  })
  app = built.app
  worker = built.worker
}, 30000)
afterAll(async () => {
  await app.close()
  await db.close()
})
afterEach(async () => {
  await db.query(
    "UPDATE integration_jobs SET status='cancelled',worker_id=NULL,lease_until=NULL WHERE status IN ('queued','waiting','running')",
  )
  fixture.state.drop = ''
})
async function setup(provider: 'parasut' | 'yurtici' = 'parasut') {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.10.${fixture.state.invoices.size + fixture.state.shipments.size + 1}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Owner',
      workspaceName: 'Fulfillment',
      email: `${randomUUID()}@example.com`,
      password: 'Fulfillment1234',
    },
  })
  expect(registration.statusCode).toBe(201)
  const cookie = registration.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json(),
    headers = { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken }
  const credentials =
    provider === 'parasut'
      ? {
          companyId: '123',
          clientId: 'fixture',
          clientSecret: 'fixture',
          email: 'fixture@example.com',
          password: 'fixture',
        }
      : { username: 'fixture', password: 'fixture', testReference: 'TEST-REF' }
  const connected = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      provider,
      name: provider,
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials,
    },
  })
  expect(connected.statusCode, connected.body).toBe(201)
  const storeId = connected.json().id,
    workspaceId = session.workspace.id as string,
    invoiceId = randomUUID(),
    orderId = randomUUID(),
    shipmentId = randomUUID()
  await db.query("UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1", [
    storeId,
  ])
  const state = createEmptyState('Fulfillment')
  const address = {
    name: `Alıcı ${orderId}`,
    address: 'Test Mahallesi Sokak 1',
    city: 'İstanbul',
    district: 'Kadıköy',
    phone: '5551234567',
    taxId: '11111111111',
  }
  const order: Order = {
    id: orderId,
    number: `SP-${orderId}`,
    customerId: 'customer',
    channel: 'manual',
    status: 'approved',
    createdAt: '2026-10-24T10:00:00.000Z',
    dueAt: '2026-10-25T20:59:59.999Z',
    shipping: 0,
    paid: false,
    note: '',
    lines: [
      {
        variantId: `variant-${orderId}`,
        quantity: 1,
        unitPrice: 12000,
        unitCost: 5000,
        taxRate: 20,
        invoiceTitle: 'Test Ürünü',
        unit: 'Adet',
      },
    ],
    events: [],
    inventoryApplied: true,
    invoiceId,
    billingAddress: address,
  }
  state.orders = [order]
  state.invoices = [
    {
      id: invoiceId,
      number: 'FT-1',
      orderId,
      connectionId: provider === 'parasut' ? storeId : undefined,
      status: 'queued',
      createdAt: order.createdAt,
    },
  ]
  const shipment: Shipment = {
    id: shipmentId,
    orderId,
    connectionId: storeId,
    provider,
    reference: `PH${shipmentId.replaceAll('-', '')}`,
    status: 'queued',
    createdAt: order.createdAt,
    recipient: address,
    packages: 1,
    desi: 1,
    weight: 1,
  }
  if (provider !== 'parasut') state.shipments = [shipment]
  await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
    JSON.stringify(state),
    workspaceId,
  ])
  const readState = async () =>
    (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [workspaceId],
      )
    ).rows[0].document
  return { headers, workspaceId, storeId, invoiceId, orderId, shipmentId, readState }
}
async function processOne() {
  await db.query(
    "UPDATE integration_jobs SET available_at=now() WHERE status IN ('queued','waiting')",
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  return worker.processOne()
}
async function reconcile(
  t: Awaited<ReturnType<typeof setup>>,
  sourceJobId: string,
  kind: 'invoice' | 'shipment' = 'invoice',
  externalId?: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/fulfillment/${kind}/${kind === 'invoice' ? t.invoiceId : t.shipmentId}/reconcile`,
    headers: { ...t.headers, 'idempotency-key': randomUUID() },
    payload: { sourceJobId, externalId },
  })
  expect(response.statusCode, response.body).toBe(202)
  return response.json().jobId as string
}
async function jobStatus(id: string) {
  return (
    await db.query<{ status: string; last_error: string }>(
      'SELECT status,last_error FROM integration_jobs WHERE id=$1',
      [id],
    )
  ).rows[0]
}

describe('provider-verified fiscal and carrier reconciliation', () => {
  it('recovers a lost invoice response by exact reference, customer, lines and amount without a second invoice', async () => {
    const t = await setup(),
      before = fixture.state.writes.filter((item) => item === 'invoice').length
    fixture.state.drop = 'invoice'
    const source = await enqueue(db, {
      workspaceId: t.workspaceId,
      connectionId: t.storeId,
      kind: 'invoice.create',
      entityId: t.invoiceId,
      payload: { invoiceId: t.invoiceId },
    })
    await processOne()
    await processOne()
    await processOne()
    expect((await jobStatus(source)).status).toBe('uncertain')
    expect((await t.readState()).invoices[0].uncertainJobId).toBe(source)
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/invoices/${t.invoiceId}/action`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: { operation: 'finalize', connectionId: t.storeId },
    })
    expect(blocked.json().error.code).toBe('INVOICE_UNCERTAIN')
    await reconcile(t, source)
    await processOne()
    expect(await jobStatus(source)).toMatchObject({ status: 'completed', last_error: null })
    const invoice = (await t.readState()).invoices[0]
    expect(invoice.externalId).toBeTruthy()
    expect(invoice.status).toBe('draft')
    expect(invoice.uncertainJobId).toBeUndefined()
    expect(fixture.state.writes.filter((item) => item === 'invoice')).toHaveLength(before + 1)
  }, 30000)
  it('resumes a confirmed prerequisite and rejects a wrong operator-selected invoice', async () => {
    const t = await setup(),
      before = fixture.state.writes.filter((item) => item === 'contact').length
    fixture.state.drop = 'contact'
    const source = await enqueue(db, {
      workspaceId: t.workspaceId,
      connectionId: t.storeId,
      kind: 'invoice.create',
      entityId: t.invoiceId,
      payload: { invoiceId: t.invoiceId },
    })
    await processOne()
    expect((await jobStatus(source)).status).toBe('uncertain')
    await reconcile(t, source)
    await processOne()
    expect((await jobStatus(source)).status).toBe('waiting')
    expect(fixture.state.writes.filter((item) => item === 'contact')).toHaveLength(before + 1)
    fixture.state.drop = 'invoice'
    await processOne()
    await processOne()
    expect((await jobStatus(source)).status).toBe('uncertain')
    const wrong = [...fixture.state.invoices.keys()][0]
    await reconcile(t, source, 'invoice', wrong)
    await processOne()
    expect((await jobStatus(source)).status).toBe('uncertain')
    expect((await t.readState()).invoices[0].externalId).toBeUndefined()
  }, 30000)
  it('confirms a lost finalization and persists its PDF without a second e-document write', async () => {
    const t = await setup()
    await enqueue(db, {
      workspaceId: t.workspaceId,
      connectionId: t.storeId,
      kind: 'invoice.create',
      entityId: t.invoiceId,
      payload: { invoiceId: t.invoiceId },
    })
    await processOne()
    await processOne()
    await processOne()
    await processOne()
    fixture.state.drop = 'finalize'
    const source = await enqueue(db, {
      workspaceId: t.workspaceId,
      connectionId: t.storeId,
      kind: 'invoice.finalize',
      entityId: t.invoiceId,
      payload: { invoiceId: t.invoiceId },
    })
    await processOne()
    expect((await jobStatus(source)).status).toBe('uncertain')
    const before = fixture.state.writes.filter((item) => item === 'finalize').length
    await reconcile(t, source)
    await processOne()
    const invoice = (await t.readState()).invoices[0]
    expect((await jobStatus(source)).status).toBe('completed')
    expect(invoice.status).toBe('issued')
    expect(invoice.url).toContain('/media/')
    expect(fixture.state.writes.filter((item) => item === 'finalize')).toHaveLength(before)
  }, 30000)
  it('resolves a lost carrier response through its unique reference and isolates the recovery by tenant', async () => {
    const t = await setup('yurtici'),
      other = await setup('yurtici'),
      before = fixture.state.writes.filter((item) => item === 'shipment').length
    fixture.state.drop = 'shipment'
    const source = await enqueue(db, {
      workspaceId: t.workspaceId,
      connectionId: t.storeId,
      kind: 'shipment.create',
      entityId: t.shipmentId,
      payload: { shipmentId: t.shipmentId },
    })
    await processOne()
    expect((await jobStatus(source)).status).toBe('uncertain')
    const denied = await app.inject({
      method: 'POST',
      url: `/api/fulfillment/shipment/${t.shipmentId}/reconcile`,
      headers: { ...other.headers, 'idempotency-key': randomUUID() },
      payload: { sourceJobId: source },
    })
    expect(denied.statusCode).toBe(404)
    await reconcile(t, source, 'shipment')
    await processOne()
    expect((await jobStatus(source)).status).toBe('completed')
    expect((await t.readState()).shipments?.[0]).toMatchObject({
      status: 'created',
      trackingNumber: 'TRACK-1',
    })
    expect(fixture.state.writes.filter((item) => item === 'shipment')).toHaveLength(before + 1)
  }, 30000)
})
