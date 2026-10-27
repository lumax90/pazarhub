import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { AppState, Command, Product } from '../src/domain/types'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { claimJob, enqueue } from '../server/jobs'
import type { IntegrationWorker } from '../server/worker'
import { ingestOrders } from '../server/worker'
import { ProviderError } from '../server/errors'
import { catalogBundle, catalogParts } from './catalog-workspace-fixture'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 7),
  cookieName: 'pazarhub_test',
  secureCookies: false,
  sessionHours: 12,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Pazarhub',
}
let app: FastifyInstance, database: Database, worker: IntegrationWorker
let providerFails = false
beforeAll(async () => {
  database = await createDatabase(config, true)
  const built = await createApp(config, {
    database,
    worker: false,
    logger: false,
    factory: () => ({
      capabilities: ['test', 'catalog.pull', 'orders.pull', 'inventory.push', 'invoice.create'],
      execute: async (operation) => {
        if (providerFails)
          throw new ProviderError('NETWORK_ERROR', 'İstek sonucu belirsiz.', false, undefined, true)
        return {
          message:
            operation === 'test' ? 'Fixture connection verified' : 'Fixture operation completed',
        }
      },
    }),
  })
  app = built.app
  worker = built.worker
}, 30000)
afterAll(async () => {
  await app.close()
  await database.close()
})

describe('server-backed bundles and definitions', () => {
  it('stores order attachments privately and enforces workspace ownership on download and deletion', async () => {
    const auth = await owner(),
      item = await product(auth)
    await command(auth, {
      type: 'customer.save',
      customer: {
        id: 'attachment-customer',
        name: 'Müşteri',
        city: 'İstanbul',
        address: 'Adres',
        email: '',
        phone: '',
      },
    })
    const created = await command(auth, {
      type: 'order.create',
      input: {
        customerId: 'attachment-customer',
        channel: 'manual',
        shipping: 0,
        note: '',
        items: [{ variantId: item.variants[0].id, quantity: 1 }],
      },
    })
    expect(created.statusCode).toBe(200)
    const orderId = created.json().result.id,
      boundary = 'pazarhub-test-boundary'
    const contents = '%PDF-1.4\n%%EOF'
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/attachments`,
      headers: { ...auth.headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="document.pdf"\r\nContent-Type: application/pdf\r\n\r\n${contents}\r\n--${boundary}--\r\n`,
    })
    expect(uploaded.statusCode, uploaded.body).toBe(201)
    const fileId = uploaded.json().attachment.id
    const file = (
      await database.query<{ public_token: string; name: string }>(
        'SELECT public_token,name FROM stored_files WHERE id=$1',
        [fileId],
      )
    ).rows[0]
    expect((await app.inject({ url: `/media/${file.public_token}/${file.name}` })).statusCode).toBe(
      404,
    )
    expect((await app.inject({ url: `/api/files/${fileId}`, headers: auth.headers })).body).toBe(
      contents,
    )
    const other = await owner()
    expect(
      (await app.inject({ url: `/api/files/${fileId}`, headers: other.headers })).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/orders/${orderId}/attachments/${fileId}`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(404)
    expect((await snapshot(auth)).orders[0].attachments?.[0]).toMatchObject({
      id: fileId,
      author: 'Test Owner',
      mime: 'application/pdf',
    })
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/orders/${orderId}/attachments/${fileId}`,
          headers: auth.headers,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ url: `/api/files/${fileId}`, headers: auth.headers })).statusCode,
    ).toBe(404)
  })
  it('serializes competing package sales, replays receipts and isolates component references by tenant', async () => {
    const auth = await owner()
    expect(
      (
        await command(auth, {
          type: 'warehouse.save',
          warehouse: { id: 'shop', name: 'Mağaza', active: true },
        })
      ).statusCode,
    ).toBe(200)
    for (const product of [...catalogParts(), catalogBundle()])
      expect((await command(auth, { type: 'product.save', product })).statusCode).toBe(200)
    const body: Command = {
      type: 'retail.sale',
      input: { method: 'cash', items: [{ variantId: 'pack', quantity: 6, bundleVersion: 1 }] },
    }
    const keys = [randomUUID(), randomUUID()]
    const results = await Promise.all(keys.map((key) => command(auth, body, key)))
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 422])
    const accepted = results.findIndex((result) => result.statusCode === 200)
    expect((await command(auth, body, keys[accepted])).statusCode).toBe(200)
    let state = await snapshot(auth)
    expect(state.retailSales).toHaveLength(1)
    expect(state.cash).toHaveLength(1)
    expect(state.products.find((p) => p.id === 'part-a')?.variants[0].stockByWarehouse?.main).toBe(
      0,
    )
    expect(state.products.find((p) => p.id === 'bundle')?.variants[0].stock).toBe(0)
    const key = randomUUID(),
      entry: Command = {
        type: 'stock.record',
        variantId: 'a',
        warehouseId: 'main',
        direction: 'in',
        quantity: 1,
        expectedQuantity: 0,
        reason: 'production',
        note: 'Üretim',
      }
    expect((await command(auth, entry, key)).statusCode).toBe(200)
    expect((await command(auth, entry, key)).statusCode).toBe(200)
    state = await snapshot(auth)
    expect(state.movements[0]).toMatchObject({
      quantity: 1,
      balance: 1,
      author: 'Test Owner',
      reason: 'Üretim',
    })
    const another = await owner()
    expect(
      (await command(another, { type: 'product.save', product: catalogBundle() })).statusCode,
    ).toBe(422)
    expect((await snapshot(another)).products).toHaveLength(0)
    expect((await snapshot(another)).definitions).toHaveLength(1)
    await database.query(
      "UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
      [auth.workspaceId, auth.userId],
    )
    expect(
      (
        await command(auth, {
          type: 'definition.save',
          definition: {
            id: 'blocked',
            kind: 'brand',
            name: 'Yeni marka',
            active: true,
            sortOrder: 0,
            version: 0,
          },
        })
      ).statusCode,
    ).toBe(403)
    expect((await command(auth, { ...entry, expectedQuantity: 1 })).statusCode).toBe(403)
  })
})

async function owner() {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.0.${Math.floor(Math.random() * 200) + 1}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Test Owner',
      workspaceName: `Workspace ${randomUUID()}`,
      email: `${randomUUID()}@example.com`,
      password: 'Auth1234',
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const cookie = response.headers['set-cookie']!.toString().split(';')[0]
  const session = (
    await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } })
  ).json()
  return {
    userId: session.user.id as string,
    workspaceId: session.workspace.id as string,
    headers: {
      cookie,
      origin: config.publicOrigin,
      'x-csrf-token': session.csrfToken as string,
      'x-workspace-id': session.workspace.id as string,
    },
  }
}
type Owner = Awaited<ReturnType<typeof owner>>
const command = (auth: Owner, body: Command, key = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/api/commands',
    headers: { ...auth.headers, 'idempotency-key': key },
    payload: body,
  })
const snapshot = async (auth: Owner) =>
  (await app.inject({ method: 'GET', url: '/api/workspace', headers: auth.headers })).json()
    .state as AppState
async function product(auth: Owner, stock = 1) {
  const item: Product = {
    id: randomUUID(),
    name: 'Atomik stok ürünü',
    category: 'Test',
    brand: 'Test',
    description: '',
    art: 'cup',
    color: '#aabbcc',
    taxRate: 20,
    active: true,
    lowStock: 2,
    variants: [
      {
        id: randomUUID(),
        name: 'Standart',
        sku: `SKU-${randomUUID()}`,
        barcode: '',
        stock,
        price: 10000,
        cost: 6000,
      },
    ],
  }
  expect((await command(auth, { type: 'product.save', product: item })).statusCode).toBe(200)
  return item
}
async function connection(auth: Owner, provider = 'trendyol') {
  const body = {
    provider,
    name: 'Fixture store',
    enabled: false,
    settings: defaultIntegrationSettings,
    credentials:
      provider === 'parasut'
        ? {
            clientId: 'client-fixture',
            clientSecret: 'super-secret-fixture',
            email: 'fixture@example.com',
            password: 'secret-password-fixture',
            companyId: '12345',
          }
        : {
            sellerId: '12345',
            apiKey: 'fixture-key-that-must-stay-private',
            apiSecret: 'fixture-secret-that-must-stay-private',
          },
  }
  const key = randomUUID()
  const result = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...auth.headers, 'idempotency-key': key },
    payload: body,
  })
  expect(result.statusCode, result.body).toBe(201)
  return { id: result.json().id as string, key, body, response: result }
}

describe('server isolation and atomic transactions', () => {
  it('leaves conflicting remote SKU and barcode mappings unresolved instead of selecting an arbitrary stock source', async () => {
    const auth = await owner(),
      connected = await connection(auth),
      first = await product(auth, 3),
      second = await product(auth, 3),
      state = await snapshot(auth)
    for (const [index, variantId] of [first.variants[0].id, second.variants[0].id].entries())
      await database.query(
        "INSERT INTO external_records(id,workspace_id,connection_id,resource,external_id,document,local_id) VALUES($1,$2,$3,'product',$4,$5,$6)",
        [
          randomUUID(),
          auth.workspaceId,
          connected.id,
          `remote-${index}`,
          JSON.stringify(
            index === 0
              ? { sku: 'ORDER-SKU', barcode: 'OTHER-BARCODE' }
              : { sku: 'OTHER-SKU', barcode: 'ORDER-BARCODE' },
          ),
          variantId,
        ],
      )
    await ingestOrders(
      state,
      [
        {
          externalId: 'conflicting-order',
          number: 'CONFLICT',
          createdAt: '2026-10-24T10:00:00Z',
          modifiedAt: '2026-10-24T10:00:00Z',
          status: 'Created',
          normalizedStatus: 'pending',
          total: 10000,
          shipping: 0,
          recipient: {
            name: 'Örnek',
            address: 'Adres',
            city: 'İstanbul',
            district: 'Kadıköy',
            phone: '5551234567',
            country: 'TR',
          },
          lines: [
            {
              externalId: 'line',
              sku: 'ORDER-SKU',
              barcode: 'ORDER-BARCODE',
              title: 'Ürün',
              quantity: 1,
              unitPrice: 10000,
              taxRate: 20,
            },
          ],
        },
      ],
      connected.id,
      'trendyol',
      database,
      auth.workspaceId,
    )
    expect(state.orders[0].lines[0].variantId).toBe('')
    expect(state.products.every((product) => product.variants[0].stock === 3)).toBe(true)
  })
  it('reconciles archive and reopen intent even when the last stock quantity already matches', async () => {
    const auth = await owner(),
      connected = await connection(auth),
      item = await product(auth, 0),
      state = await snapshot(auth)
    state.listings = [
      {
        id: 'close-zero',
        productId: item.id,
        variantId: item.variants[0].id,
        storeId: connected.id,
        channel: 'trendyol',
        status: 'active',
        desiredStatus: 'archived',
        externalId: 'close',
        updatedAt: '',
        lastSent: { price: 10000, listPrice: 10000, quantity: 0, archive: false },
      },
      {
        id: 'reopen-zero',
        productId: item.id,
        variantId: item.variants[0].id,
        storeId: connected.id,
        channel: 'trendyol',
        status: 'archived',
        desiredStatus: 'active',
        externalId: 'open',
        updatedAt: '',
        lastSent: { price: 10000, listPrice: 10000, quantity: 0, archive: true },
      },
    ]
    await database.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(state),
      auth.workspaceId,
    ])
    await database.query(
      "UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1",
      [connected.id],
    )
    await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: connected.id,
      kind: 'inventory.reconcile',
    })
    await worker.processOne()
    const jobs = await database.query<{ entity_id: string }>(
      "SELECT entity_id FROM integration_jobs WHERE workspace_id=$1 AND kind='inventory.push' AND status='queued' ORDER BY entity_id",
      [auth.workspaceId],
    )
    expect(jobs.rows.map((row) => row.entity_id)).toEqual(['close-zero', 'reopen-zero'])
    await database.query(
      "UPDATE integration_jobs SET status='cancelled' WHERE workspace_id=$1 AND status='queued'",
      [auth.workspaceId],
    )
  })
  it('rejects an automatically resumed inventory plan after stock changes instead of sending the old quantity', async () => {
    const auth = await owner(),
      connected = await connection(auth),
      item = await product(auth, 5),
      state = await snapshot(auth)
    state.listings = [
      {
        id: 'stale-stock',
        productId: item.id,
        variantId: item.variants[0].id,
        storeId: connected.id,
        channel: 'trendyol',
        status: 'active',
        desiredStatus: 'active',
        externalId: 'remote-stock',
        updatedAt: '',
      },
    ]
    await database.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(state),
      auth.workspaceId,
    ])
    await database.query(
      "UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1",
      [connected.id],
    )
    const job = await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: connected.id,
      kind: 'inventory.push',
      entityId: 'stale-stock',
      payload: {
        listingId: 'stale-stock',
        inventoryPlan: { price: item.variants[0].price, quantity: 5, archive: false },
      },
    })
    expect(
      (
        await command(auth, {
          type: 'stock.adjust',
          variantId: item.variants[0].id,
          quantity: 2,
          expectedQuantity: 5,
          note: 'Yeni stok bakiyesi',
        })
      ).statusCode,
    ).toBe(200)
    await worker.processOne()
    expect(
      (
        await database.query<{ status: string; last_error: string }>(
          'SELECT status,last_error FROM integration_jobs WHERE id=$1',
          [job],
        )
      ).rows[0],
    ).toMatchObject({
      status: 'failed',
      last_error: expect.stringContaining('INVENTORY_PLAN_STALE'),
    })
  })
  it('keeps static assets out of API quotas while enforcing API and login rate limits', async () => {
    await mkdir(resolve('.data'), { recursive: true })
    const root = await mkdtemp(join(resolve('.data'), 'static-fixture-'))
    const built = await createApp(config, { database, worker: false, logger: false })
    try {
      await writeFile(join(root, 'chunk.js'), 'export default 1')
      await built.app.register(fastifyStatic, { root })
      for (let index = 0; index < 305; index++) {
        const response = await built.app.inject({ url: '/chunk.js', remoteAddress: '127.0.6.1' })
        expect(response.statusCode).toBe(200)
      }
      const health = await built.app.inject({ url: '/api/health', remoteAddress: '127.0.6.1' })
      expect(health.statusCode).toBe(200)
      expect(Number(health.headers['x-ratelimit-remaining'])).toBe(299)
      let lastStatus = 0
      for (let index = 0; index < 300; index++)
        lastStatus = (await built.app.inject({ url: '/api/health', remoteAddress: '127.0.6.1' }))
          .statusCode
      expect(lastStatus).toBe(429)
      const statuses: number[] = []
      for (let index = 0; index < 13; index++)
        statuses.push(
          (
            await built.app.inject({
              method: 'POST',
              url: '/api/auth/login',
              remoteAddress: '127.0.6.2',
              headers: { origin: config.publicOrigin },
              payload: { email: 'missing-user@example.test', password: 'Wrong1234' },
            })
          ).statusCode,
        )
      expect(statuses.slice(0, 12).every((status) => status === 401)).toBe(true)
      expect(statuses[12]).toBe(429)
    } finally {
      await built.app.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 15000)
  it('rejects anonymous access and forged cross-workspace headers', async () => {
    expect((await app.inject('/api/workspace')).statusCode).toBe(401)
    const a = await owner(),
      b = await owner()
    await product(a)
    expect((await snapshot(b)).products).toHaveLength(0)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/workspace',
          headers: { ...a.headers, 'x-workspace-id': b.workspaceId },
        })
      ).statusCode,
    ).toBe(401)
  })
  it('requires both a matching Origin and the authenticated CSRF token', async () => {
    const auth = await owner()
    const input = {
      type: 'preferences.update',
      preferences: { businessName: 'Changed', theme: 'light', density: 'compact' },
    }
    for (const headers of [
      { ...auth.headers, origin: 'https://elsewhere.test' },
      { ...auth.headers, 'x-csrf-token': 'forged' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: input,
      })
      expect(response.statusCode).toBe(403)
    }
  })
  it('enforces current membership role on every write', async () => {
    const auth = await owner()
    await database.query(
      `UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`,
      [auth.workspaceId, auth.userId],
    )
    expect(
      (
        await command(auth, {
          type: 'stock.adjust',
          variantId: 'missing',
          quantity: 1,
          note: 'Test',
        })
      ).statusCode,
    ).toBe(403)
    expect((await app.inject({ url: '/api/integrations', headers: auth.headers })).statusCode).toBe(
      403,
    )
    expect((await app.inject({ url: '/api/workspace', headers: auth.headers })).statusCode).toBe(
      200,
    )
  })
  it('sells the last unit once under concurrent checkout and stores one cash entry', async () => {
    const auth = await owner(),
      item = await product(auth)
    const sale: Command = {
      type: 'retail.sale',
      input: { items: [{ variantId: item.variants[0].id, quantity: 1 }], method: 'cash' },
    }
    const responses = await Promise.all([command(auth, sale), command(auth, sale)])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 422])
    const state = await snapshot(auth)
    expect(state.products[0].variants[0].stock).toBe(0)
    expect(state.retailSales).toHaveLength(1)
    expect(state.cash).toHaveLength(1)
  })
  it('replays an uncertain checkout with the same key without selling twice', async () => {
    const auth = await owner(),
      item = await product(auth, 3),
      key = randomUUID()
    const sale: Command = {
      type: 'retail.sale',
      input: { items: [{ variantId: item.variants[0].id, quantity: 1 }], method: 'card' },
    }
    const responses = await Promise.all([command(auth, sale, key), command(auth, sale, key)])
    expect(responses.every((response) => response.statusCode === 200)).toBe(true)
    expect(responses[0].json().result.id).toBe(responses[1].json().result.id)
    expect((await snapshot(auth)).cash).toHaveLength(1)
    const conflicting = await command(
      auth,
      { ...sale, input: { ...sale.input, method: 'cash' } },
      key,
    )
    expect(conflicting.statusCode).toBe(409)
  })
  it('rejects stale product edits without overwriting current values', async () => {
    const auth = await owner(),
      item = await product(auth)
    const current = (await snapshot(auth)).products[0]
    expect(
      (await command(auth, { type: 'product.save', product: { ...current, name: 'New title' } }))
        .statusCode,
    ).toBe(200)
    expect(
      (await command(auth, { type: 'product.save', product: { ...current, name: 'Old draft' } }))
        .statusCode,
    ).toBe(409)
    expect((await snapshot(auth)).products.find((p) => p.id === item.id)?.name).toBe('New title')
  })
  it('serializes product section edits, preserves stock and replays additions without duplicate openings', async () => {
    const auth = await owner(),
      item = await product(auth, 3)
    const newVariant = {
      ...item.variants[0],
      id: randomUUID(),
      sku: 'ADDED-SKU',
      stock: 2,
      stockByWarehouse: { main: 2 },
    }
    const patch: Command = {
      type: 'product.patch',
      id: item.id,
      expectedVersion: 1,
      patch: {
        changes: { invoiceName: 'Fatura ürünü', dimensions: { desi: 2 }, origin: 'TR' },
        newVariants: [newVariant],
      },
    }
    const key = randomUUID()
    const responses = await Promise.all([command(auth, patch, key), command(auth, patch, key)])
    expect(responses.every((r) => r.statusCode === 200)).toBe(true)
    expect(responses[0].json().result.entityVersion).toBe(2)
    const saved = await snapshot(auth)
    expect(saved.products[0].variants).toHaveLength(2)
    expect(saved.movements.filter((m) => m.variantId === newVariant.id)).toHaveLength(1)
    const results = await Promise.all([
      command(auth, {
        type: 'product.patch',
        id: item.id,
        expectedVersion: 2,
        patch: { changes: { subtitle: 'Güncel alt başlık' } },
      }),
      command(auth, {
        type: 'stock.adjust',
        variantId: item.variants[0].id,
        quantity: 4,
        expectedQuantity: 3,
        note: 'Sayım',
      }),
    ])
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    expect((await snapshot(auth)).products[0].variants[0].stock).toBe(4)
    const stale = await command(auth, {
      type: 'product.patch',
      id: item.id,
      expectedVersion: 2,
      patch: { changes: { subtitle: 'Eski alt başlık' } },
    })
    expect(stale.statusCode).toBe(422)
    expect((await snapshot(auth)).products[0].subtitle).toBe('Güncel alt başlık')
    await database.query(
      `UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`,
      [auth.workspaceId, auth.userId],
    )
    expect(
      (
        await command(auth, {
          type: 'product.patch',
          id: item.id,
          expectedVersion: 3,
          patch: { changes: { name: 'Yetkisiz' } },
        })
      ).statusCode,
    ).toBe(403)
  })
  it('encrypts API secrets and replays connection creation instead of duplicating it', async () => {
    const auth = await owner(),
      created = await connection(auth)
    expect(created.response.body).not.toContain(created.body.credentials.apiKey)
    expect(created.response.body).not.toContain(created.body.credentials.apiSecret)
    const stored = (
      await database.query<{ credentials: string }>(
        'SELECT credentials FROM integration_connections WHERE id=$1',
        [created.id],
      )
    ).rows[0]
    expect(stored.credentials).toMatch(/^v1\./)
    expect(stored.credentials).not.toContain('fixture-key')
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { ...auth.headers, 'idempotency-key': created.key },
      payload: created.body,
    })
    expect(repeated.json().id).toBe(created.id)
    const changed = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { ...auth.headers, 'idempotency-key': created.key },
      payload: { ...created.body, name: 'Different request' },
    })
    expect(changed.statusCode).toBe(409)
  })
  it('blocks cross-tenant connection relations at the database boundary', async () => {
    const a = await owner(),
      b = await owner(),
      created = await connection(a)
    await expect(
      enqueue(database, { workspaceId: b.workspaceId, connectionId: created.id, kind: 'test' }),
    ).rejects.toThrow()
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/integrations/${created.id}/jobs`,
          headers: { ...b.headers, 'idempotency-key': randomUUID() },
          payload: { operation: 'test' },
        })
      ).statusCode,
    ).toBe(404)
  })
  it('claims at most one job for a connection and allows unrelated delayed work', async () => {
    const auth = await owner(),
      created = await connection(auth)
    await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: created.id,
      kind: 'invoice.finalize',
      entityId: 'later',
      delaySeconds: 3600,
    })
    const first = await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: created.id,
      kind: 'test',
    })
    await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: created.id,
      kind: 'catalog.pull',
    })
    const claimed = await claimJob(database, 'fixture-worker-one')
    expect(claimed?.id).toBe(first)
    expect(await claimJob(database, 'fixture-worker-two')).toBeNull()
    await database.query(`UPDATE integration_jobs SET status='completed' WHERE workspace_id=$1`, [
      auth.workspaceId,
    ])
  })
  it('recovers an expired fiscal operation as uncertain, never automatically resending it', async () => {
    const auth = await owner(),
      created = await connection(auth, 'parasut')
    const id = await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: created.id,
      kind: 'invoice.create',
      entityId: 'invoice-uncertain',
    })
    await claimJob(database, 'old-worker')
    await database.query(
      `UPDATE integration_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`,
      [id],
    )
    expect(await claimJob(database, 'new-worker')).toBeNull()
    expect(
      (
        await database.query<{ status: string }>(
          'SELECT status FROM integration_jobs WHERE id=$1',
          [id],
        )
      ).rows[0].status,
    ).toBe('uncertain')
  })
  it('does not mark an untested connection verified until the provider test finishes', async () => {
    const auth = await owner(),
      created = await connection(auth)
    const started = await app.inject({
      method: 'POST',
      url: `/api/integrations/${created.id}/jobs`,
      headers: { ...auth.headers, 'idempotency-key': randomUUID() },
      payload: { operation: 'test' },
    })
    expect(started.statusCode).toBe(202)
    expect(
      (
        await database.query<{ status: string }>(
          'SELECT status FROM integration_connections WHERE id=$1',
          [created.id],
        )
      ).rows[0].status,
    ).toBe('testing')
    await worker.processOne()
    expect(
      (
        await database.query<{ status: string }>(
          'SELECT status FROM integration_connections WHERE id=$1',
          [created.id],
        )
      ).rows[0].status,
    ).toBe('verified')
    providerFails = true
    await database.query(`UPDATE integration_connections SET enabled=true WHERE id=$1`, [
      created.id,
    ])
    const item = await product(auth)
    await command(auth, {
      type: 'customer.save',
      customer: {
        id: 'fiscal-fixture',
        name: 'Test Customer',
        city: 'İstanbul',
        address: 'Test Address',
        email: '',
        phone: '',
      },
    })
    const order = await command(auth, {
      type: 'order.create',
      input: {
        customerId: 'fiscal-fixture',
        channel: 'manual',
        shipping: 0,
        note: '',
        items: [{ variantId: item.variants[0].id, quantity: 1 }],
      },
    })
    const invoice = await command(auth, { type: 'order.invoice', id: order.json().result.id })
    expect(invoice.statusCode, invoice.body).toBe(200)
    const job = await enqueue(database, {
      workspaceId: auth.workspaceId,
      connectionId: created.id,
      kind: 'invoice.create',
      entityId: invoice.json().result.id,
      payload: { invoiceId: invoice.json().result.id },
    })
    await worker.processOne()
    providerFails = false
    expect(
      (
        await database.query<{ status: string }>(
          'SELECT status FROM integration_jobs WHERE id=$1',
          [job],
        )
      ).rows[0].status,
    ).toBe('uncertain')
  })
})
