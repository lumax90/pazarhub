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
import { canonicalJson } from '../server/security'

const category = '11111111-1111-4111-8111-111111111111',
  brand = '22222222-2222-4222-8222-222222222222'
const remote = {
  products: new Map<string, Record<string, unknown>>(),
  requests: [] as Record<string, unknown>[],
  drop: false,
  partial: false,
  shared: false,
}
const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 9),
  cookieName: 'group_publication_test',
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
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
      if (path.endsWith('/token')) return json({ access_token: 'group-token', expires_in: 3600 })
      if (path.endsWith('/categories'))
        return json({
          categories:
            Number(new URL(String(url)).searchParams.get('page')) > 0
              ? []
              : [{ guid: category, name: 'Banyo', breadcrumb: 'Ev / Banyo' }],
        })
      if (path.endsWith('/brands')) return json({ brands: [{ guid: brand, name: 'Marka' }] })
      if (path.endsWith('/attributes'))
        return json({
          data: {
            name: 'Banyo',
            combinationAttributes: [
              {
                id: 5,
                name: remote.shared ? 'Seçenekler' : 'Renk',
                required: true,
                options: [
                  { id: 1, name: 'Beyaz' },
                  { id: 2, name: 'Siyah' },
                ],
              },
            ],
            specificationAttributes: [],
          },
        })
      if (path.endsWith('/products/search')) {
        const sku = JSON.parse(String(init?.body)).productSearch.barcode
        const found =
          remote.products.get(sku) ??
          [...remote.products.values()].find((product) =>
            (product.productAttributeCombinations as Record<string, unknown>[]).some(
              (combination) => combination.barcode === sku,
            ),
          )
        const product =
          found && remote.partial
            ? {
                ...found,
                productAttributeCombinations: (
                  found.productAttributeCombinations as unknown[]
                ).slice(0, 1),
              }
            : found
        return json({ content: product ? [product] : [], page: 0, totalPages: 1 })
      }
      if (path.endsWith('/products/new')) {
        const request = JSON.parse(String(init?.body)).product as Record<string, unknown>
        remote.requests.push(request)
        const product = {
          ...request,
          id: 10,
          productCode: randomUUID(),
          approvalStatusId: 0,
          onSale: true,
          productAttributeCombinations: (
            request.productAttributeCombinations as Record<string, unknown>[]
          ).map((item, index) => ({ ...item, id: 101 + index, isActive: 'true' })),
        }
        remote.products.set(String(request.stock_code), product)
        if (remote.drop) throw new Error('Response lost')
        return json({ content: [product] })
      }
      throw new Error(`Unexpected provider request ${path}`)
    },
  })
  app = built.app
  worker = built.worker
}, 30000)
afterAll(async () => {
  await app.close()
  await db.close()
})

afterEach(async () => {
  await cancelPending()
  remote.drop = false
  remote.partial = false
  remote.shared = false
})

async function setup(shared = false) {
  remote.shared = shared
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.9.${remote.requests.length + remote.products.size + 1}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Owner',
      workspaceName: 'Group',
      email: `${randomUUID()}@example.com`,
      password: 'Group1234',
    },
  })
  expect(registered.statusCode).toBe(201)
  const cookie = registered.headers['set-cookie']!.toString().split(';')[0]
  const session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
  const headers = { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken }
  const command = (payload: Command) =>
    app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload,
    })
  const id = randomUUID(),
    model = `GROUP-${id.slice(0, 8)}`
  const product: Product = {
    id,
    modelCode: model,
    name: 'Havlu',
    category: 'Banyo',
    brand: 'Marka',
    art: 'towel',
    color: '#bbbbbb',
    description: 'Pamuklu havlu',
    images: ['https://example.com/photo.jpg'],
    taxRate: 20,
    active: true,
    lowStock: 1,
    variants: [
      {
        id: randomUUID(),
        sku: `${model}-W`,
        barcode: '8691234567890',
        name: 'Beyaz',
        price: 10000,
        cost: 5000,
        stock: 5,
      },
      {
        id: randomUUID(),
        sku: `${model}-B`,
        barcode: '8691234567883',
        name: 'Siyah',
        price: 12000,
        cost: 6000,
        stock: 3,
      },
    ],
  }
  const packVariant = product.variants[1]
  if (shared) {
    product.variants = [product.variants[0]]
    product.variants[0].stock = 35
  }
  expect((await command({ type: 'product.save', product })).statusCode).toBe(200)
  const pack: Product | undefined = shared
    ? {
        ...product,
        id: randomUUID(),
        modelCode: `${model}-PACK`,
        bundle: {
          components: [{ variantId: product.variants[0].id, quantity: 10 }],
          priceMode: 'fixed',
          discountBps: 0,
        },
        variants: [{ ...packVariant, stock: 0, cost: 0 }],
      }
    : undefined
  if (pack) expect((await command({ type: 'product.save', product: pack })).statusCode).toBe(200)
  const connection = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      provider: 'toptantr',
      name: 'ToptanTR',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials: { username: 'fixture', password: 'fixture' },
    },
  })
  expect(connection.statusCode).toBe(201)
  const storeId = connection.json().id
  await db.query("UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1", [
    storeId,
  ])
  const created = await app.inject({
    method: 'POST',
    url: '/api/listing-drafts',
    headers,
    payload: { storeId, productId: id, variantIds: product.variants.map((variant) => variant.id) },
  })
  expect(created.statusCode, created.body).toBe(201)
  const ids = created.json().ids as string[]
  if (pack) {
    const second = await app.inject({
      method: 'POST',
      url: '/api/listing-drafts',
      headers,
      payload: {
        storeId,
        productId: pack.id,
        variantIds: pack.variants.map((variant) => variant.id),
      },
    })
    expect(second.statusCode).toBe(201)
    ids.push(...second.json().ids)
  }
  for (const [index, listingId] of ids.entries()) {
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/listing-drafts/${listingId}`,
      headers,
      payload: {
        version: 1,
        config: {
          productMainId: model,
          categoryId: category,
          brandId: brand,
          brandName: 'Marka',
          itemPerPackage: shared && index === 1 ? 10 : 1,
          attributes: { 'v:5': { valueIds: [String(index + 1)] } },
        },
      },
    })
    expect(saved.statusCode, saved.body).toBe(200)
  }
  return { headers, command, workspaceId: session.workspace.id as string, ids, model, product }
}
async function processOne() {
  await db.query(
    "UPDATE integration_jobs SET available_at=now() WHERE status IN ('queued','waiting')",
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  return worker.processOne()
}
async function cancelPending() {
  await db.query(
    "UPDATE integration_jobs SET status='cancelled',worker_id=NULL,lease_until=NULL WHERE status IN ('queued','waiting','running')",
  )
}

describe('atomic parent publication groups', () => {
  it('publishes a physical product and its ten-unit bundle as one shared-stock parent', async () => {
    const t = await setup(true)
    const preview = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/preview`,
      headers: t.headers,
      payload: {},
    })
    expect(preview.statusCode, preview.body).toBe(200)
    const combinations = preview.json().body.product.productAttributeCombinations as {
      itemPerPackage: number
      stockQuantity: number
    }[]
    expect(
      combinations.find((combination) => combination.itemPerPackage === 1)?.stockQuantity,
    ).toBe(35)
    expect(
      combinations.find((combination) => combination.itemPerPackage === 10)?.stockQuantity,
    ).toBe(3)
    const queued = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/publish`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: { previewId: preview.json().id },
    })
    expect(queued.statusCode, queued.body).toBe(202)
    await processOne()
    await processOne()
    await processOne()
    await processOne()
    const state = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [t.workspaceId],
      )
    ).rows[0].document
    expect(
      state.listings.every(
        (listing) => listing.publication?.phase === 'live' && listing.syncStatus === 'synced',
      ),
    ).toBe(true)
    expect(
      state.listings.map((listing) => listing.lastSent?.quantity).sort((a, b) => a! - b!),
    ).toEqual([3, 35])
  }, 30000)
  it('validates every member, rejects a stale member and sends one complete parent request', async () => {
    const t = await setup()
    const preview = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/preview`,
      headers: t.headers,
      payload: {},
    })
    expect(preview.statusCode, preview.body).toBe(200)
    expect(preview.json().members).toHaveLength(2)
    expect(preview.json().body.product.productAttributeCombinations).toHaveLength(2)
    const memberPreview = (
      await db.query<{ cache_key: string }>(
        "SELECT cache_key FROM metadata_cache WHERE workspace_id=$1 AND document->'plan'->>'listingId'=$2 AND NOT((document->'plan') ? 'group') LIMIT 1",
        [t.workspaceId, t.ids[0]],
      )
    ).rows[0]
    const partial = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/publish`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: { previewId: memberPreview.cache_key.slice('preview:'.length) },
    })
    expect(partial.statusCode).toBe(409)
    expect(partial.json().error.code).toBe('GROUP_REQUIRED')
    await t.command({
      type: 'stock.adjust',
      variantId: t.product.variants[1].id,
      quantity: 4,
      note: 'Yeni stok',
    })
    const stale = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/publish`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: { previewId: preview.json().id },
    })
    expect(stale.statusCode).toBe(409)
    const fresh = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/preview`,
      headers: t.headers,
      payload: {},
    })
    expect(fresh.statusCode, fresh.body).toBe(200)
    const queued = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/publish`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: { previewId: fresh.json().id },
    })
    expect(queued.statusCode, queued.body).toBe(202)
    let state = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [t.workspaceId],
      )
    ).rows[0].document
    expect(state.listings.every((listing) => listing.publication?.phase === 'queued')).toBe(true)
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[1]}/preview`,
      headers: t.headers,
      payload: {},
    })
    expect(blocked.statusCode).toBe(409)
    const before = remote.requests.length
    await processOne()
    await processOne()
    expect(remote.requests).toHaveLength(before + 1)
    state = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [t.workspaceId],
      )
    ).rows[0].document
    expect(state.listings.every((listing) => listing.publication?.phase === 'live')).toBe(true)
    expect(new Set(state.listings.map((listing) => listing.externalId)).size).toBe(2)
    expect(state.listings.every((listing) => listing.attributes?.productCode)).toBe(true)
    await processOne()
    await processOne()
    state = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [t.workspaceId],
      )
    ).rows[0].document
    expect(
      state.listings.every((listing) => listing.lastSent?.price && listing.syncStatus === 'synced'),
    ).toBe(true)
    await cancelPending()
  }, 30000)
  it('keeps all members uncertain after a lost response and requires every identity before reconciliation', async () => {
    const t = await setup()
    const preview = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/preview`,
      headers: t.headers,
      payload: {},
    })
    expect(preview.statusCode, preview.body).toBe(200)
    const queued = await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/publish`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: { previewId: preview.json().id },
    })
    const writes = remote.requests.length
    remote.drop = true
    await processOne()
    remote.drop = false
    let state = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [t.workspaceId],
      )
    ).rows[0].document
    expect(state.listings.every((listing) => listing.publication?.phase === 'uncertain')).toBe(true)
    remote.partial = true
    await app.inject({
      method: 'POST',
      url: `/api/listing-drafts/${t.ids[0]}/reconcile`,
      headers: { ...t.headers, 'idempotency-key': randomUUID() },
      payload: {},
    })
    await processOne()
    state = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [t.workspaceId],
      )
    ).rows[0].document
    expect(state.listings.every((listing) => listing.publication?.phase === 'uncertain')).toBe(true)
    remote.partial = false
    await processOne()
    state = (
      await db.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [t.workspaceId],
      )
    ).rows[0].document
    expect(state.listings.every((listing) => listing.publication?.phase === 'live')).toBe(true)
    expect(remote.requests).toHaveLength(writes + 1)
    const source = (
      await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
        queued.json().jobId,
      ])
    ).rows[0]
    expect(source.status).toBe('completed')
    expect(canonicalJson(state.listings.map((listing) => listing.externalId))).not.toContain('null')
    await cancelPending()
  }, 30000)
})
