import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import type { AppState, Product } from '../src/domain/types'
import type { PublishConfig } from '../src/domain/publishing'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { publishingFixture } from './publishing-fixture'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 4),
  cookieName: 'publishing_test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Pazarhub',
}
const fixture = publishingFixture()
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
    fetcher: fixture.fetcher,
  })
  app = built.app
  worker = built.worker
}, 30000)
afterEach(async () => {
  await db.query(
    `UPDATE integration_jobs SET status='cancelled',worker_id=NULL,lease_until=NULL WHERE status IN ('queued','waiting','running')`,
  )
  fixture.state.rejected = false
  fixture.state.networkFailure = false
  fixture.state.approved = false
})
afterAll(async () => {
  await app.close()
  await db.close()
})

async function setup() {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.1.${ip++}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Publisher Owner',
      workspaceName: 'Yayın Testi',
      email: `${randomUUID()}@example.com`,
      password: 'publisher-test-password',
    },
  })
  expect(registration.statusCode, registration.body).toBe(201)
  const cookie = registration.headers['set-cookie']!.toString().split(';')[0]
  const session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
  const headers = {
    cookie,
    origin: config.publicOrigin,
    'x-csrf-token': session.csrfToken as string,
    'x-workspace-id': session.workspace.id as string,
  }
  const product: Product = {
    id: randomUUID(),
    name: 'Yayın testi ürünü',
    category: 'Seramik',
    brand: 'TestMarka',
    description: 'El yapımı seramik ürün açıklaması.',
    art: 'vase',
    color: '#aabbcc',
    taxRate: 20,
    active: true,
    lowStock: 1,
    images: ['https://example.com/product.jpg'],
    variants: [
      {
        id: randomUUID(),
        name: 'Beyaz',
        sku: `SKU-${randomUUID().slice(0, 12)}`,
        barcode: randomUUID().replaceAll('-', ''),
        stock: 5,
        price: 10000,
        cost: 5000,
      },
    ],
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/commands',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: { type: 'product.save', product },
      })
    ).statusCode,
  ).toBe(200)
  const connection = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      provider: 'trendyol',
      name: 'Yayın Mağazası',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials: {
        sellerId: '123',
        apiKey: 'fixture-publishing-key',
        apiSecret: 'fixture-publishing-secret',
      },
    },
  })
  expect(connection.statusCode, connection.body).toBe(201)
  const storeId = connection.json().id as string
  await db.query(`UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1`, [
    storeId,
  ])
  const draft = await app.inject({
    method: 'POST',
    url: '/api/listing-drafts',
    headers,
    payload: { storeId, productId: product.id, variantIds: [product.variants[0].id] },
  })
  expect(draft.statusCode, draft.body).toBe(201)
  const id = draft.json().ids[0] as string
  const valid: PublishConfig = {
    categoryId: '10',
    categoryName: 'Ev / Dekorasyon',
    brandId: '42',
    brandName: 'TestMarka',
    attributes: { '100': { valueIds: ['7'] }, '101': { valueIds: ['11'] } },
  }
  return {
    headers,
    product,
    storeId,
    id,
    valid,
    workspaceId: session.workspace.id as string,
    userId: session.user.id as string,
  }
}
type Setup = Awaited<ReturnType<typeof setup>>
async function save(test: Setup, config: PublishConfig = test.valid, version = 1) {
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/listing-drafts/${test.id}`,
    headers: test.headers,
    payload: { version, config },
  })
  expect(response.statusCode, response.body).toBe(200)
}
const preview = (test: Setup) =>
  app.inject({
    method: 'POST',
    url: `/api/listing-drafts/${test.id}/preview`,
    headers: test.headers,
    payload: {},
  })
const publish = (test: Setup, previewId: string, key = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: `/api/listing-drafts/${test.id}/publish`,
    headers: { ...test.headers, 'idempotency-key': key },
    payload: { previewId },
  })
const detail = async (test: Setup) =>
  (await app.inject({ url: `/api/listing-drafts/${test.id}`, headers: test.headers })).json()
async function nextJob() {
  await db.query(
    `UPDATE integration_jobs SET available_at=now() WHERE status IN ('waiting','queued')`,
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  expect(await worker.processOne()).toBe(true)
}

describe('publication preparation and delivery', () => {
  it('requires current category attributes and never submits incomplete products', async () => {
    const test = await setup()
    await save(test, { ...test.valid, attributes: {} })
    const count = fixture.state.writes.length,
      response = await preview(test)
    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toContain('Materyal')
    expect(fixture.state.writes).toHaveLength(count)
  })
  it('builds the current V2 schema with multi-value attributes and integer-kuruş prices', async () => {
    const test = await setup()
    await save(test, {
      ...test.valid,
      attributes: { ...test.valid.attributes, '102': { valueIds: ['21', '22'] } },
    })
    const response = await preview(test)
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json().body.items[0]
    expect(body.salePrice).toBe(100)
    expect(body.quantity).toBe(5)
    expect(body.attributes).toContainEqual({ attributeId: 102, attributeValueIds: [21, 22] })
    expect(body.attributes).not.toContainEqual(
      expect.objectContaining({ customAttributeValue: expect.anything() }),
    )
  })
  it('inherits product logistics, respects explicit listing values and invalidates changed product previews', async () => {
    const test = await setup()
    const update = (version: number, origin: string, desi: number) =>
      app.inject({
        method: 'POST',
        url: '/api/commands',
        headers: { ...test.headers, 'idempotency-key': randomUUID() },
        payload: {
          type: 'product.patch',
          id: test.product.id,
          expectedVersion: version,
          patch: { changes: { origin, dimensions: { desi } } },
        },
      })
    expect((await update(1, 'TR', 2)).statusCode).toBe(200)
    await save(test)
    const inherited = await preview(test)
    expect(inherited.statusCode, inherited.body).toBe(200)
    expect(inherited.json().body.items[0]).toMatchObject({ origin: 'TR', dimensionalWeight: 2 })
    await save(test, { ...test.valid, origin: 'CN', dimensionalWeight: 3 }, 2)
    const own = await preview(test)
    expect(own.json().body.items[0]).toMatchObject({ origin: 'CN', dimensionalWeight: 3 })
    expect((await update(2, 'FR', 4)).statusCode).toBe(200)
    expect((await publish(test, own.json().id)).json().error.code).toBe('PREVIEW_STALE')
  })
  it('rejects spoofed attribute IDs and non-leaf categories', async () => {
    const test = await setup()
    await save(test, {
      ...test.valid,
      attributes: { ...test.valid.attributes, '999': { customValue: 'fake' } },
    })
    expect((await preview(test)).statusCode).toBe(422)
    await save(test, { ...test.valid, categoryId: '1' }, 2)
    expect((await preview(test)).statusCode).toBe(422)
  })
  it('invalidates a preview when reservations or stock have changed', async () => {
    const test = await setup()
    await save(test)
    const before = await preview(test)
    expect(before.statusCode, before.body).toBe(200)
    await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { ...test.headers, 'idempotency-key': randomUUID() },
      payload: {
        type: 'stock.adjust',
        variantId: test.product.variants[0].id,
        quantity: 3,
        note: 'Sayım',
      },
    })
    const response = await publish(test, before.json().id)
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('PREVIEW_STALE')
  })
  it('inherits category defaults, marks their source, and invalidates changed mappings', async () => {
    const test = await setup(),
      mappingId = randomUUID()
    const mapping = {
      id: mappingId,
      version: 0,
      storeId: test.storeId,
      localCategory: 'Seramik',
      categoryId: '10',
      attributes: { '100': { valueIds: ['7'] } },
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/catalog-mappings',
          headers: test.headers,
          payload: mapping,
        })
      ).statusCode,
    ).toBe(200)
    await save(test, {
      brandId: '42',
      brandName: 'TestMarka',
      attributes: { '101': { valueIds: ['11'] } },
    })
    const before = await preview(test)
    expect(before.statusCode, before.body).toBe(200)
    expect(before.json().attributes).toContainEqual({
      name: 'Materyal',
      value: 'Seramik',
      source: 'mapping',
    })
    await app.inject({
      method: 'POST',
      url: '/api/catalog-mappings',
      headers: test.headers,
      payload: { ...mapping, version: 1, attributes: { '100': { valueIds: ['8'] } } },
    })
    expect((await publish(test, before.json().id)).json().error.code).toBe('PREVIEW_STALE')
  })
  it('keeps another tenant and a read-only member out of draft mutations', async () => {
    const a = await setup(),
      b = await setup()
    expect(
      (await app.inject({ url: `/api/listing-drafts/${a.id}`, headers: b.headers })).statusCode,
    ).toBe(404)
    await db.query(`UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`, [
      a.workspaceId,
      a.userId,
    ])
    expect((await preview(a)).statusCode).toBe(403)
  })
  it('replays the same publication request without a duplicate external POST', async () => {
    const test = await setup()
    await save(test)
    const before = await preview(test),
      key = randomUUID(),
      count = fixture.state.writes.length
    const results = await Promise.all([
      publish(test, before.json().id, key),
      publish(test, before.json().id, key),
    ])
    expect(results.map((r) => r.statusCode)).toEqual([202, 202])
    expect(results[0].json().jobId).toBe(results[1].json().jobId)
    expect((await publish(test, before.json().id)).statusCode).toBe(409)
    await nextJob()
    expect(fixture.state.writes).toHaveLength(count + 1)
    expect((await detail(test)).listing.publication.phase).toBe('submitted')
    expect((await detail(test)).listing.status).toBe('pending')
  })
  it('marks a product live only after the provider approval lookup confirms it', async () => {
    const test = await setup()
    await save(test)
    const before = await preview(test)
    await publish(test, before.json().id)
    await nextJob()
    await nextJob()
    expect((await detail(test)).listing.publication.phase).toBe('review')
    fixture.state.approved = true
    await nextJob()
    const listing = (await detail(test)).listing
    expect(listing.publication.phase).toBe('live')
    expect(listing.externalId).toBe(`ty-${test.product.variants[0].barcode}`)
    expect(listing.status).toBe('active')
  })
  it('persists row rejection details without treating batch completion as publication', async () => {
    const test = await setup()
    await save(test)
    const before = await preview(test)
    await publish(test, before.json().id)
    await nextJob()
    fixture.state.rejected = true
    await nextJob()
    const listing = (await detail(test)).listing
    expect(listing.publication.phase).toBe('rejected')
    expect(listing.publication.errors[0].message).toContain('özelliği')
    expect(listing.externalId).toBeUndefined()
  })
  it('checks queue-time changes before making a create call', async () => {
    const test = await setup()
    await save(test)
    const before = await preview(test)
    await publish(test, before.json().id)
    const count = fixture.state.writes.length
    await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { ...test.headers, 'idempotency-key': randomUUID() },
      payload: {
        type: 'stock.adjust',
        variantId: test.product.variants[0].id,
        quantity: 2,
        note: 'Stok değişti',
      },
    })
    await nextJob()
    expect(fixture.state.writes).toHaveLength(count)
    expect((await detail(test)).listing.publication.phase).toBe('rejected')
    expect((await detail(test)).listing.error).toContain('değişti')
  })
  it('locks an ambiguous create outcome against a second publication', async () => {
    const test = await setup()
    await save(test)
    const before = await preview(test)
    await publish(test, before.json().id)
    fixture.state.networkFailure = true
    await nextJob()
    expect((await detail(test)).listing.publication.phase).toBe('uncertain')
    expect((await preview(test)).statusCode).toBe(409)
    const stored = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [test.workspaceId],
      )
    ).rows[0]
    expect(stored.document.products[0].variants[0].stock).toBe(5)
  })
  it('reconciles an uncertain create by identity without issuing a second create request', async () => {
    const test = await setup()
    await save(test)
    const before = await preview(test),
      submitted = await publish(test, before.json().id)
    const sourceId = submitted.json().jobId as string
    fixture.state.networkFailure = true
    await nextJob()
    fixture.state.networkFailure = false
    const count = fixture.state.writes.length
    fixture.state.products.add(test.product.variants[0].barcode)
    fixture.state.approved = true
    const requested = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${test.id}/reconcile`,
      headers: { ...test.headers, 'idempotency-key': randomUUID() },
      payload: {},
    })
    expect(requested.statusCode, requested.body).toBe(202)
    await nextJob()
    expect(fixture.state.writes).toHaveLength(count)
    expect((await detail(test)).listing.publication.phase).toBe('live')
    expect((await detail(test)).listing.publication.reconciledByIdentity).toBe(true)
    expect(
      (
        await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
          sourceId,
        ])
      ).rows[0].status,
    ).toBe('completed')
  })
})
