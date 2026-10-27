import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import { createEmptyState } from '../src/domain/empty-state'
import type { AppState } from '../src/domain/types'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { publishingFixture } from './publishing-fixture'

const fixture = publishingFixture(),
  config: ServerConfig = {
    environment: 'test',
    port: 3001,
    host: '127.0.0.1',
    publicOrigin: 'http://localhost:5173',
    dataDirectory: '.data/test',
    encryptionKey: Buffer.alloc(32, 13),
    cookieName: 'content-test',
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
  fixture.state.contents.clear()
  fixture.state.contentBatches.clear()
  fixture.state.contentCdn = false
  fixture.state.contentDrop = false
  fixture.state.contentOutcome = 'SUCCESS'
})
async function setup() {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.12.${ip++}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Owner',
      workspaceName: 'Content',
      email: `${randomUUID()}@example.com`,
      password: 'Content1234',
    },
  })
  expect(registration.statusCode).toBe(201)
  const cookie = registration.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json(),
    headers = { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken }
  const created = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      provider: 'trendyol',
      name: 'Content Store',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials: { sellerId: '123', apiKey: 'fixture', apiSecret: 'fixture' },
    },
  })
  expect(created.statusCode).toBe(201)
  const storeId = created.json().id,
    workspaceId = session.workspace.id as string
  await db.query("UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1", [
    storeId,
  ])
  const state = createEmptyState('Content')
  state.products = [
    {
      id: 'product',
      name: 'Yerel Ürün',
      category: 'Test',
      brand: 'Marka',
      description: 'Yerel açıklama',
      art: 'vase',
      color: '#cccccc',
      taxRate: 20,
      active: true,
      lowStock: 1,
      version: 1,
      variants: [
        { id: 'a', name: 'A', sku: 'SKU-A', barcode: 'BAR-A', stock: 10, price: 12000, cost: 5000 },
        { id: 'b', name: 'B', sku: 'SKU-B', barcode: 'BAR-B', stock: 10, price: 12000, cost: 5000 },
      ],
    },
  ]
  state.listings = state.products[0].variants.map((variant) => ({
    id: `listing-${variant.id}`,
    productId: 'product',
    variantId: variant.id,
    channel: 'trendyol',
    storeId,
    externalId: `ty-${variant.barcode}`,
    externalSku: variant.sku,
    externalBarcode: variant.barcode,
    status: 'active',
    version: 1,
    updatedAt: '2026-10-24T10:00:00Z',
  }))
  await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
    JSON.stringify(state),
    workspaceId,
  ])
  const current = {
    contentId: 999,
    title: 'Eski Başlık',
    description: 'Eski Açıklama',
    images: [{ url: 'https://example.com/old.jpg' }],
    variants: [
      { barcode: 'BAR-A', stockCode: 'SKU-A' },
      { barcode: 'BAR-B', stockCode: 'SKU-B' },
    ],
  }
  fixture.state.contents.set('BAR-A', current)
  fixture.state.contents.set('BAR-B', current)
  const get = async (id = 'listing-a') => {
    const response = await app.inject({ url: `/api/listing-content/${id}`, headers })
    expect(response.statusCode, response.body).toBe(200)
    return response.json()
  }
  const preview = async (changes: unknown, id = 'listing-a') => {
    const source = await get(id)
    return app.inject({
      method: 'POST',
      url: `/api/listing-content/${id}/preview`,
      headers,
      payload: { sourceId: source.sourceId, changes },
    })
  }
  const send = (previewId: string, id = 'listing-a', key = randomUUID()) =>
    app.inject({
      method: 'POST',
      url: `/api/listing-content/${id}/send`,
      headers: { ...headers, 'idempotency-key': key },
      payload: { previewId },
    })
  const read = async () =>
    (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [workspaceId],
      )
    ).rows[0].document
  return { headers, workspaceId, storeId, get, preview, send, read, current }
}
async function processOne() {
  await db.query(
    "UPDATE integration_jobs SET available_at=now() WHERE status IN ('queued','waiting')",
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  return worker.processOne()
}

describe('existing listing content updates', () => {
  it('sends only chosen fields, locks shared content and uses correlated approval audits when the CDN rewrites images', async () => {
    const t = await setup(),
      before = fixture.state.writes.length
    const preview = await t.preview({
      title: 'Yeni Başlık',
      images: ['https://example.com/new.jpg'],
    })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().members).toEqual(['SKU-A', 'SKU-B'])
    const key = randomUUID()
    expect((await t.send(preview.json().previewId, 'listing-a', key)).statusCode).toBe(202)
    expect((await t.send(preview.json().previewId, 'listing-a', key)).statusCode).toBe(202)
    const other = await t.preview({ description: 'Diğer değişiklik' }, 'listing-b')
    expect((await t.send(other.json().previewId, 'listing-b')).json().error.code).toBe(
      'CONTENT_BUSY',
    )
    fixture.state.contentCdn = true
    await processOne()
    await processOne()
    expect(fixture.state.writes.slice(before)).toEqual([
      {
        path: '/integration/product/sellers/123/products/content-bulk-update',
        body: {
          items: [
            {
              contentId: 999,
              title: 'Yeni Başlık',
              images: [{ url: 'https://example.com/new.jpg' }],
            },
          ],
        },
      },
    ])
    const state = await t.read()
    expect(state.listings[0].contentWorkflow?.state).toBe('applied')
    expect(state.listings[0].titleOverride).toBe('Yeni Başlık')
    expect(state.products[0].variants[0]).toMatchObject({ price: 12000, stock: 10 })
    expect(state.products[0].name).toBe('Yerel Ürün')
  }, 30000)
  it('rejects externally changed content before writing and reports provider field rejection', async () => {
    const t = await setup(),
      preview = await t.preview({ description: 'Yeni açıklama' })
    expect((await t.send(preview.json().previewId)).statusCode).toBe(202)
    t.current.title = 'Satıcı panelinde değiştirildi'
    const before = fixture.state.writes.length
    await processOne()
    expect(fixture.state.writes).toHaveLength(before)
    expect((await t.read()).listings[0].contentWorkflow?.state).toBe('rejected')
    await app.inject({ url: '/api/listing-content/listing-a?refresh=1', headers: t.headers })
    const updated = await t.preview({ description: 'Yeni açıklama' })
    fixture.state.contentOutcome = 'FAIL'
    await t.send(updated.json().previewId)
    await processOne()
    await processOne()
    expect((await t.read()).listings[0].contentWorkflow?.state).toBe('rejected')
  }, 30000)
  it('reconciles a lost content response by reading the requested values without resubmission', async () => {
    const t = await setup(),
      preview = await t.preview({ title: 'Doğrulanmış başlık' }),
      before = fixture.state.writes.length
    fixture.state.contentDrop = true
    const queued = await t.send(preview.json().previewId)
    await processOne()
    expect((await t.read()).listings[0].contentWorkflow?.state).toBe('uncertain')
    const check = await app.inject({
      method: 'POST',
      url: '/api/listing-content/listing-a/check',
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: {},
    })
    expect(check.statusCode).toBe(202)
    await processOne()
    expect((await t.read()).listings[0].contentWorkflow?.state).toBe('applied')
    expect(fixture.state.writes).toHaveLength(before + 1)
    expect(
      (
        await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
          queued.json().jobId,
        ])
      ).rows[0].status,
    ).toBe('completed')
  }, 30000)
})
