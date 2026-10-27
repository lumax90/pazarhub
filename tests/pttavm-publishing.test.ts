import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { AppState, Command, Product } from '../src/domain/types'
import { pttavmFixture } from './pttavm-fixture'
import { normalizePttAvmProducts, pttVariantPrice } from '../server/integrations/pttavm-catalog'
import { enqueue } from '../server/jobs'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 10),
  cookieName: 'ptt_publication_test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Test',
}
const fixture = pttavmFixture()
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
  fixture.state.drop = false
  fixture.state.partial = false
  fixture.state.reject = false
  fixture.state.onParentRead = undefined
})

async function setup() {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.8.${fixture.state.products.size + 1}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Owner',
      workspaceName: 'PTT',
      email: `${randomUUID()}@example.com`,
      password: 'PttTest1234',
    },
  })
  expect(registration.statusCode).toBe(201)
  const cookie = registration.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
  const headers = { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken }
  const command = (payload: Command) =>
    app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload,
    })
  const product: Product = {
    id: randomUUID(),
    name: 'Havlu',
    category: 'Banyo',
    brand: 'Marka',
    description: 'Pamuklu havlu',
    art: 'towel',
    color: '#cccccc',
    taxRate: 20,
    lowStock: 1,
    active: true,
    images: ['https://example.com/photo.jpg'],
    variantAxes: [
      {
        id: 'color',
        name: 'Renk',
        values: [
          { id: 'w', name: 'Beyaz' },
          { id: 'b', name: 'Siyah' },
        ],
      },
    ],
    variants: [
      {
        id: randomUUID(),
        name: 'Beyaz',
        sku: 'PTT-W',
        barcode: '8691234567890',
        price: 12000,
        cost: 5000,
        stock: 5,
        options: { color: 'w' },
      },
      {
        id: randomUUID(),
        name: 'Siyah',
        sku: 'PTT-B',
        barcode: '8691234567891',
        price: 15000,
        cost: 6000,
        stock: 3,
        options: { color: 'b' },
      },
    ],
  }
  const saved = await command({ type: 'product.save', product })
  expect(saved.statusCode, saved.body).toBe(200)
  const connection = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      provider: 'pttavm',
      name: 'PTT',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials: { shopId: '123', apiKey: 'fixture-key', accessToken: 'fixture-token' },
    },
  })
  expect(connection.statusCode, connection.body).toBe(201)
  const storeId = connection.json().id,
    workspaceId = session.workspace.id as string
  await db.query("UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1", [
    storeId,
  ])
  const created = await app.inject({
    method: 'POST',
    url: '/api/listing-drafts',
    headers,
    payload: {
      storeId,
      productId: product.id,
      variantIds: product.variants.map((variant) => variant.id),
    },
  })
  expect(created.statusCode, created.body).toBe(201)
  const ids = created.json().ids as string[]
  for (const id of ids) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/listing-drafts/${id}`,
      headers,
      payload: { version: 1, config: { categoryId: '52', attributes: {} } },
    })
    expect(response.statusCode, response.body).toBe(200)
  }
  const state = async () =>
    (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [workspaceId],
      )
    ).rows[0].document
  const preview = await app.inject({
    method: 'POST',
    url: `/api/listing-drafts/${ids[0]}/preview`,
    headers,
    payload: {},
  })
  expect(preview.statusCode, preview.body).toBe(200)
  return {
    headers,
    command,
    workspaceId,
    storeId,
    ids,
    product,
    state,
    preview: preview.json(),
    model: (await state()).listings[0].publishConfig!.productMainId!,
  }
}
async function processOne() {
  await db.query(
    "UPDATE integration_jobs SET available_at=now() WHERE status IN ('queued','waiting')",
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  return worker.processOne()
}
async function publish(t: Awaited<ReturnType<typeof setup>>) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/listing-drafts/${t.ids[0]}/publish`,
    headers: { ...t.headers, 'idempotency-key': randomUUID() },
    payload: { previewId: t.preview.id },
  })
  expect(response.statusCode, response.body).toBe(202)
  return response.json().jobId as string
}

describe('PttAVM full parent publication and inventory', () => {
  it('rejects a changed stock source between remote lookup and the final HTTP write', async () => {
    const t = await setup()
    await publish(t)
    await processOne()
    await processOne()
    await processOne()
    await processOne()
    const state = await t.state(),
      listing = state.listings.find((listing) => listing.id === t.ids[0])!
    listing.desiredStatus = 'archived'
    await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(state),
      t.workspaceId,
    ])
    const jobId = await enqueue(db, {
      workspaceId: t.workspaceId,
      connectionId: t.storeId,
      kind: 'inventory.push',
      entityId: listing.id,
      payload: { listingId: listing.id, archive: true },
    })
    const before = fixture.state.writes.length
    fixture.state.onParentRead = async () => {
      const current = await t.state()
      current.listings.find((item) => item.id === listing.id)!.desiredStatus = 'active'
      await db.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1 WHERE workspace_id=$2',
        [JSON.stringify(current), t.workspaceId],
      )
    }
    await processOne()
    expect(fixture.state.writes).toHaveLength(before)
    expect(
      (
        await db.query<{ status: string; last_error: string }>(
          'SELECT status,last_error FROM integration_jobs WHERE id=$1',
          [jobId],
        )
      ).rows[0],
    ).toMatchObject({
      status: 'failed',
      last_error: expect.stringContaining('INVENTORY_PLAN_STALE'),
    })
  }, 30000)
  it('publishes the complete variant set, verifies price differences and archives one variant without closing its sibling', async () => {
    const t = await setup()
    expect(t.model).toMatch(/^PH-[a-f0-9]{32}$/)
    expect(t.preview.members).toHaveLength(2)
    expect(
      t.preview.body.items[0].variants.map((variant: { price: number }) => variant.price).sort(),
    ).toEqual([0, 30])
    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/listing-drafts/${t.ids[0]}`,
      headers: t.headers,
      payload: { version: 2, config: { productMainId: 'another-parent', attributes: {} } },
    })
    expect(changed.json().error.code).toBe('PARENT_ID_IMMUTABLE')
    await publish(t)
    await processOne()
    await processOne()
    await processOne()
    await processOne()
    let state = await t.state()
    expect(
      state.listings.every((listing) => listing.publication?.phase === 'live' && listing.lastSent),
    ).toBe(true)
    expect(
      normalizePttAvmProducts(fixture.state.products.get(t.model))
        .sort((a, b) => a.sku.localeCompare(b.sku))
        .map((item) => [item.sku, item.price, item.quantity]),
    ).toEqual([
      ['PTT-B', 15000, 3],
      ['PTT-W', 12000, 5],
    ])
    state.listings.find((listing) => listing.id === t.ids[0])!.desiredStatus = 'archived'
    await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(state),
      t.workspaceId,
    ])
    await enqueue(db, {
      workspaceId: t.workspaceId,
      connectionId: t.storeId,
      kind: 'inventory.push',
      entityId: t.ids[0],
      payload: { listingId: t.ids[0], archive: true },
    })
    await processOne()
    await processOne()
    state = await t.state()
    expect(state.listings.find((listing) => listing.id === t.ids[0])?.lastSent?.quantity).toBe(0)
    const parent = fixture.state.products.get(t.model)!
    expect(parent.aktif).toBe(true)
    expect(
      normalizePttAvmProducts(parent)
        .sort((a, b) => a.sku.localeCompare(b.sku))
        .map((item) => item.quantity),
    ).toEqual([3, 0])
    expect(
      fixture.state.writes.filter(
        (write) => write.path.endsWith('/upsert') && JSON.stringify(write.body).includes(t.model),
      ),
    ).toHaveLength(1)
  }, 30000)
  it('keeps partial read-back uncertain and reconciles every identity without a second upsert', async () => {
    const t = await setup(),
      before = fixture.state.writes.length
    fixture.state.drop = true
    await publish(t)
    await processOne()
    fixture.state.drop = false
    expect(
      (await t.state()).listings.every((listing) => listing.publication?.phase === 'uncertain'),
    ).toBe(true)
    fixture.state.partial = true
    const requested = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/reconcile`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: {},
    })
    expect(requested.statusCode, requested.body).toBe(202)
    await processOne()
    expect(
      (await t.state()).listings.every((listing) => listing.publication?.phase === 'uncertain'),
    ).toBe(true)
    fixture.state.partial = false
    await processOne()
    expect(
      (await t.state()).listings.every((listing) => listing.publication?.reconciledByIdentity),
    ).toBe(true)
    expect(fixture.state.writes).toHaveLength(before + 1)
  }, 30000)
  it('reports provider rejection on every member and refuses an ambiguous variant price basis', async () => {
    const t = await setup()
    await publish(t)
    fixture.state.reject = true
    await processOne()
    await processOne()
    expect(
      (await t.state()).listings.every((listing) => listing.publication?.phase === 'rejected'),
    ).toBe(true)
    fixture.state.reject = false
    expect(pttVariantPrice({ kdVli: 120 }, { fiyat: 30 })).toBeNaN()
  }, 30000)
})
