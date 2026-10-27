import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { createEmptyState } from '../src/domain/empty-state'
import type { AppState, Order } from '../src/domain/types'
import type { OrderFulfillmentInput } from '../src/domain/order-fulfillment'
import { orderFulfillmentFixture } from './order-fulfillment-fixture'
import { ingestOrders } from '../server/worker'
import type { RemoteOrder } from '../src/domain/integrations'

let fixture = orderFulfillmentFixture()
const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 12),
  cookieName: 'order-fulfillment-test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Test',
}
let app: FastifyInstance,
  db: Database,
  worker: IntegrationWorker,
  ip = 1
beforeAll(async () => {
  db = await createDatabase(config, true)
  const built = await createApp(config, {
    database: db,
    worker: false,
    logger: false,
    fetcher: (url, init) => fixture.fetcher(url, init),
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
  fixture = orderFulfillmentFixture()
})
async function setup(provider: 'hepsiburada' | 'trendyol' = 'hepsiburada') {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.11.${ip++}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Owner',
      workspaceName: 'Paket',
      email: `${randomUUID()}@example.com`,
      password: 'Package1234',
    },
  })
  expect(registration.statusCode).toBe(201)
  const cookie = registration.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json(),
    headers = { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken }
  const credentials =
    provider === 'hepsiburada'
      ? { merchantId: fixture.merchantId, username: 'fixture', password: 'fixture' }
      : { sellerId: '123', apiKey: 'fixture', apiSecret: 'fixture' }
  const connection = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      provider,
      name: 'Test Store',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials,
    },
  })
  expect(connection.statusCode, connection.body).toBe(201)
  const storeId = connection.json().id,
    workspaceId = session.workspace.id as string,
    id = randomUUID()
  await db.query("UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1", [
    storeId,
  ])
  const state = createEmptyState('Paket'),
    lines =
      provider === 'hepsiburada'
        ? fixture.state.hbLines.map((line, index) => ({
            externalId: line.id,
            variantId: `v${index}`,
            title: line.name,
            externalSku: line.merchantSku,
            externalBarcode: line.productBarcode,
            quantity: line.quantity,
            unitPrice: line.unitPrice.amount * 100,
            unitCost: 4000,
            taxRate: 20,
          }))
        : [
            {
              externalId: '101',
              variantId: 'v0',
              title: 'Havlu',
              quantity: 2,
              unitPrice: 12000,
              unitCost: 4000,
              taxRate: 20,
            },
          ]
  state.products = lines.map((line, index) => ({
    id: `p${index}`,
    name: line.title,
    category: 'Test',
    brand: 'Marka',
    description: '',
    art: 'towel',
    color: '#cccccc',
    taxRate: 20,
    active: true,
    lowStock: 1,
    variants: [
      {
        id: line.variantId,
        name: 'Standart',
        sku: `SKU-${index}`,
        barcode: `869123456789${index}`,
        price: line.unitPrice,
        cost: line.unitCost,
        stock: 10,
      },
    ],
  }))
  const order: Order = {
    id,
    number: 'SP-1',
    externalId: provider === 'hepsiburada' ? 'HB-ORDER-1' : '100',
    externalNumber: provider === 'hepsiburada' ? 'HB-ORDER-1' : 'TY-ORDER-1',
    storeId,
    customerId: 'c',
    channel: provider,
    status: 'approved',
    createdAt: '2026-10-24T10:00:00.000Z',
    dueAt: '2026-10-25T20:59:59.999Z',
    paid: false,
    shipping: 0,
    note: '',
    lines,
    events: [],
    inventoryApplied: true,
  }
  state.orders = [order]
  await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
    JSON.stringify(state),
    workspaceId,
  ])
  const read = async () =>
    (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [workspaceId],
      )
    ).rows[0].document
  const preview = async () => {
    const response = await app.inject({ url: `/api/orders/${id}/marketplace`, headers })
    expect(response.statusCode, response.body).toBe(200)
    return response.json()
  }
  const action = async (
    input: Partial<OrderFulfillmentInput>,
    previewId?: string,
    key = randomUUID(),
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/orders/${id}/marketplace/action`,
      headers: { ...headers, 'idempotency-key': key },
      payload: {
        previewId: previewId ?? (await preview()).previewId,
        parcels: 1,
        desi: 1,
        ...input,
      },
    })
  return { headers, storeId, workspaceId, id, order, read, preview, action }
}
async function processOne() {
  await db.query(
    "UPDATE integration_jobs SET available_at=now() WHERE status IN ('queued','waiting')",
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  return worker.processOne()
}

describe('marketplace package lifecycle', () => {
  it('previews partial cancellation stock effects, rejects stale revisions and applies the reconciliation only once', async () => {
    const t = await setup(),
      line = t.order.lines[1]
    expect(
      (
        await t.action({
          action: 'cancel',
          lines: [{ id: line.externalId!, quantity: 1 }],
          reasonId: '83',
        })
      ).statusCode,
    ).toBe(202)
    await processOne()
    await processOne()
    expect((await t.read()).orders[0].syncError).toBeTruthy()
    const loaded = await app.inject({
      url: `/api/orders/${t.id}/reconciliation`,
      headers: t.headers,
    })
    expect(loaded.statusCode, loaded.body).toBe(200)
    const input = {
      mappings: loaded.json().mappings,
      restockRemoved: true,
      note: 'Pazaryerinin iptal ettiği kalem depoya döndü.',
    }
    const preview = await app.inject({
      method: 'POST',
      url: `/api/orders/${t.id}/reconciliation/preview`,
      headers: t.headers,
      payload: input,
    })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().movements).toMatchObject([{ variantId: 'v1', quantity: 1 }])
    await db.query('UPDATE workspace_states SET revision=revision+1 WHERE workspace_id=$1', [
      t.workspaceId,
    ])
    const stale = await app.inject({
      method: 'POST',
      url: `/api/orders/${t.id}/reconciliation/apply`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: { previewId: preview.json().previewId },
    })
    expect(stale.statusCode).toBe(409)
    const current = await app.inject({
        method: 'POST',
        url: `/api/orders/${t.id}/reconciliation/preview`,
        headers: t.headers,
        payload: input,
      }),
      key = randomUUID()
    const apply = () =>
      app.inject({
        method: 'POST',
        url: `/api/orders/${t.id}/reconciliation/apply`,
        headers: { ...t.headers, 'idempotency-key': key },
        payload: { previewId: current.json().previewId },
      })
    expect((await apply()).statusCode).toBe(200)
    expect((await apply()).statusCode).toBe(200)
    const state = await t.read()
    expect(state.products[1].variants[0].stock).toBe(11)
    expect(state.orders[0].lines).toHaveLength(1)
    expect(state.orderReconciliations).toHaveLength(1)
    expect(state.orders[0].syncError).toBeUndefined()
    const remote = (
      await db.query<{ document: RemoteOrder }>(
        "SELECT document FROM external_records WHERE workspace_id=$1 AND resource='order'",
        [t.workspaceId],
      )
    ).rows[0].document
    await ingestOrders(state, [remote], t.storeId, 'hepsiburada', db, t.workspaceId)
    expect(state.orders[0].syncError).toBeUndefined()
    expect(state.products[1].variants[0].stock).toBe(11)
  }, 30000)
  it('packages selected HB lines, stores labels and verifies the shipment notification', async () => {
    const t = await setup(),
      line = t.order.lines[0]
    const queued = await t.action({
      action: 'pack',
      lines: [{ id: line.externalId!, quantity: line.quantity }],
    })
    expect(queued.statusCode, queued.body).toBe(202)
    await processOne()
    await processOne()
    let order = (await t.read()).orders[0]
    expect(order.fulfillmentWorkflow?.state).toBe('confirmed')
    expect(order.marketplacePackages?.[0].id).toBe('PKG-1')
    expect(fixture.state.writes).toEqual(['hb-pack'])
    expect((await t.action({ action: 'label', packageId: 'PKG-1', lines: [] })).statusCode).toBe(
      202,
    )
    await processOne()
    order = (await t.read()).orders[0]
    expect(order.marketplacePackages?.[0].labels?.[0].url).toContain('/media/')
    await db.query(
      "UPDATE integration_connections SET settings=jsonb_set(settings,'{cargoConnectionId}',to_jsonb($2::text)) WHERE id=$1",
      [t.storeId, randomUUID()],
    )
    expect(
      (
        await t.action({
          action: 'ship',
          packageId: 'PKG-1',
          lines: [],
          trackingNumber: 'MERCHANT-TRACK',
          trackingUrl: 'https://example.com/tracking',
          shippedAt: '2026-10-24T12:00:00.000Z',
        })
      ).statusCode,
    ).toBe(202)
    await processOne()
    await processOne()
    expect((await t.read()).orders[0].marketplacePackages?.[0]).toMatchObject({
      status: 'InTransit',
      trackingNumber: 'MERCHANT-TRACK',
    })
    expect(fixture.state.writes).toEqual(['hb-pack', 'hb-ship'])
  }, 30000)
  it('recovers a lost package response with a read-only identity check and rejects a changed preview', async () => {
    const t = await setup(),
      preview = await t.preview()
    fixture.state.hbLines[0].quantity = 3
    const queued = await t.action(
      { action: 'pack', lines: [{ id: t.order.lines[0].externalId!, quantity: 2 }] },
      preview.previewId,
    )
    expect(queued.statusCode).toBe(202)
    await processOne()
    expect(fixture.state.writes).toEqual([])
    expect((await t.read()).orders[0].fulfillmentWorkflow?.state).toBe('failed')
    fixture.state.hbLines[0].quantity = 2
    fixture.state.drop = true
    expect(
      (
        await t.action({
          action: 'pack',
          lines: [{ id: t.order.lines[0].externalId!, quantity: 2 }],
        })
      ).statusCode,
    ).toBe(202)
    await processOne()
    expect((await t.read()).orders[0].fulfillmentWorkflow?.state).toBe('uncertain')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${t.id}/marketplace/reconcile`,
          headers: { ...t.headers, 'idempotency-key': randomUUID() },
          payload: {},
        })
      ).statusCode,
    ).toBe(202)
    await processOne()
    expect((await t.read()).orders[0].fulfillmentWorkflow?.state).toBe('confirmed')
    expect(fixture.state.writes).toEqual(['hb-pack'])
  }, 30000)
  it('prepares a Trendyol package, retrieves its label and restores stock once after a verified full cancellation', async () => {
    const t = await setup('trendyol')
    expect(
      (await t.action({ action: 'pack', lines: [{ id: '101', quantity: 2 }] })).statusCode,
    ).toBe(202)
    await processOne()
    await processOne()
    expect((await t.read()).orders[0].fulfillmentWorkflow?.state).toBe('confirmed')
    expect((await t.action({ action: 'label', lines: [], packageId: '100' })).statusCode).toBe(202)
    await processOne()
    await processOne()
    expect((await t.read()).orders[0].marketplacePackages?.[0].labels).toHaveLength(1)
    expect(
      (await t.action({ action: 'cancel', lines: [{ id: '101', quantity: 2 }], reasonId: '500' }))
        .statusCode,
    ).toBe(202)
    await processOne()
    await processOne()
    const state = await t.read()
    expect(state.orders[0].status).toBe('cancelled')
    expect(state.products[0].variants[0].stock).toBe(12)
    expect(fixture.state.writes).toEqual(['ty-pack', 'ty-label', 'ty-cancel'])
  }, 30000)
})
