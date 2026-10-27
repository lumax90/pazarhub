import { afterAll, beforeAll, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import type { AppState, Command } from '../src/domain/types'
import type { PublicIntegration, RemoteOrder, RemoteProduct } from '../src/domain/integrations'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { inventoryValues } from '../server/integrations/contracts'
import { availableStock, customerBalance, orderTotal } from '../src/domain/selectors'
import { enqueue } from '../server/jobs'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 15),
  cookieName: 'migration-test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Test',
}
const skus = ['GECIS-BEYAZ', 'GECIS-SIYAH', 'GECIS-SABUN'],
  physical = [10, 7, 30],
  prices = [12000, 15000, 5000]
const writes: { storeId: string; sku: string; quantity: number }[] = []
let app: FastifyInstance, db: Database, worker: IntegrationWorker
beforeAll(async () => {
  db = await createDatabase(config, true)
  const built = await createApp(config, {
    database: db,
    worker: false,
    logger: false,
    factory: (provider) => ({
      capabilities: ['test', 'catalog.pull', 'orders.pull', 'inventory.push'],
      execute: async (operation, context, payload) => {
        if (operation === 'test') return { message: 'Fixture account verified' }
        if (operation === 'catalog.pull')
          return {
            message: 'Fixture catalogue',
            products: skus.map((sku, index): RemoteProduct => ({
              externalId: `${provider}-${sku}`,
              sku,
              barcode: `869000090000${index + 1}`,
              title: index === 2 ? 'Geçiş sabunu' : 'Geçiş havlusu',
              quantity: physical[index],
              price: prices[index],
              status: 'active',
              taxRate: 20,
              images: [],
            })),
          }
        if (operation === 'orders.pull') {
          const index = provider === 'trendyol' ? 0 : 1,
            quantity = index === 0 ? 2 : 1
          const order: RemoteOrder = {
            externalId: `${provider}-open`,
            number: `${provider}-SOURCE`,
            createdAt: '2026-10-24T09:00:00Z',
            modifiedAt: '2026-10-24T09:00:00Z',
            status: 'Picking',
            normalizedStatus: 'pending',
            total: prices[index] * quantity,
            shipping: 0,
            recipient: {
              name: 'Örnek Alıcı',
              address: 'Örnek Mahallesi Sokak 1',
              city: 'İstanbul',
              district: 'Kadıköy',
              phone: '5551234567',
              country: 'TR',
            },
            lines: [
              {
                externalId: `${provider}-line`,
                sku: skus[index],
                barcode: `869000090000${index + 1}`,
                title: 'Geçiş havlusu',
                quantity,
                unitPrice: prices[index],
                taxRate: 20,
              },
            ],
          }
          return {
            message: 'Fixture orders',
            orders: [
              order,
              ...(provider === 'trendyol'
                ? [
                    {
                      ...order,
                      externalId: 'trendyol-old',
                      number: 'TY-OLD',
                      createdAt: '2026-10-01T09:00:00Z',
                      status: 'Delivered',
                      normalizedStatus: 'delivered' as const,
                    },
                  ]
                : []),
            ],
          }
        }
        const listing = context.state.listings.find((item) => item.id === payload.listingId)!,
          variant = context.state.products
            .flatMap((product) => product.variants)
            .find((variant) => variant.id === listing.variantId)!
        const values = inventoryValues(context, listing, payload)
        writes.push({ storeId: context.connectionId, sku: variant.sku, quantity: values.quantity })
        return { message: 'Fixture stock confirmed', listingStatus: 'active' }
      },
    }),
  })
  app = built.app
  worker = built.worker
}, 30000)
afterAll(async () => {
  await app.close()
  await db.close()
})

it('rehearses grouped catalogue, two store links, cutover open orders and opening balances without duplicate stock or cash', async () => {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Geçiş Sorumlusu',
      workspaceName: 'Temsili Geçiş',
      email: `${randomUUID()}@example.com`,
      password: 'Migration1234',
    },
  })
  expect(registration.statusCode).toBe(201)
  const cookie = registration.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json(),
    headers = { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken },
    workspaceId = session.workspace.id
  const post = (url: string, payload: unknown, key = randomUUID()) =>
    app.inject({
      method: 'POST',
      url,
      headers: { ...headers, 'idempotency-key': key },
      payload: payload as Record<string, unknown>,
    })
  const command = async (payload: Command, key = randomUUID()) => {
    const result = await post('/api/commands', payload, key)
    expect(result.statusCode, result.body).toBe(200)
    return result.json()
  }
  const state = async () =>
    (await app.inject({ url: '/api/workspace', headers })).json().state as AppState
  const listed = async () =>
    (await app.inject({ url: '/api/integrations', headers })).json()
      .connections as PublicIntegration[]
  const contents = await readFile(
      new URL('../docs/gecis-ornek-urunler.csv', import.meta.url),
      'utf8',
    ),
    file = await post('/api/catalog-imports', {
      name: 'gecis-ornek-urunler.csv',
      format: 'csv',
      text: contents,
    })
  expect(file.statusCode, file.body).toBe(201)
  const preview = await post(`/api/catalog-imports/${file.json().id}/preview`, {
    mapping: {
      model: 'Model',
      sku: 'SKU',
      barcode: 'Barkod',
      name: 'Ürün adı',
      variant: 'Varyant',
      category: 'Kategori',
      brand: 'Marka',
      price: 'Satış fiyatı',
      cost: 'Alış fiyatı',
      stock: 'Stok',
      taxRate: 'KDV',
    },
    mode: 'create',
    decimal: ',',
    warehouseId: 'main',
  })
  expect(preview.statusCode, preview.body).toBe(200)
  expect(preview.json().errors).toEqual([])
  const imported = await post(`/api/catalog-imports/${file.json().id}/apply`, {
    previewId: preview.json().id,
  })
  expect(imported.statusCode, imported.body).toBe(200)
  expect(
    (await post(`/api/catalog-imports/${file.json().id}/apply`, { previewId: preview.json().id }))
      .statusCode,
  ).toBe(200)
  const idsBySku = Object.fromEntries(
    (await state()).products.flatMap((product) =>
      product.variants.map((variant) => [variant.sku, variant.id]),
    ),
  )
  expect((await state()).products).toHaveLength(2)
  const stores: string[] = [],
    settings = {
      ...defaultIntegrationSettings,
      pullOrders: false,
      pullCatalog: false,
      pushInventory: false,
      pullQuestions: false,
      pullClaims: false,
      pullSettlements: false,
    }
  for (const provider of ['trendyol', 'hepsiburada'] as const) {
    const input = {
      provider,
      name: `Geçiş ${provider}`,
      enabled: false,
      settings,
      credentials:
        provider === 'trendyol'
          ? { sellerId: '123', apiKey: 'fixture', apiSecret: 'fixture' }
          : {
              merchantId: '11111111-1111-4111-8111-111111111111',
              username: 'fixture',
              password: 'fixture',
            },
    }
    const created = await post('/api/integrations', input)
    expect(created.statusCode, created.body).toBe(201)
    const storeId = created.json().id
    stores.push(storeId)
    await post(`/api/integrations/${storeId}/jobs`, { operation: 'test' })
    await worker.processOne()
    // Enable the way the connection card does: listed identity only, secrets left as stored.
    const tested = (await listed()).find((item) => item.id === storeId)!
    expect(tested.status).toBe('verified')
    const enabled = await app.inject({
      method: 'PATCH',
      url: `/api/integrations/${storeId}`,
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        provider,
        name: tested.name,
        credentials: tested.identity,
        settings: tested.settings,
        enabled: true,
      },
    })
    expect(enabled.statusCode, enabled.body).toBe(200)
    expect(enabled.json()).toMatchObject({ enabled: true, status: 'verified' })
    await post(`/api/integrations/${storeId}/jobs`, { operation: 'catalog.pull' })
    await worker.processOne()
    const remote = (
      await db.query<{ id: string; document: RemoteProduct }>(
        "SELECT id,document FROM external_records WHERE workspace_id=$1 AND connection_id=$2 AND resource='product'",
        [workspaceId, storeId],
      )
    ).rows
    for (const item of remote) {
      const link = { mode: 'link', variantId: idsBySku[item.document.sku] }
      expect((await post(`/api/remote-products/${item.id}/map`, link)).statusCode).toBe(200)
      expect((await post(`/api/remote-products/${item.id}/map`, link)).statusCode).toBe(200)
    }
    await post(`/api/integrations/${storeId}/jobs`, { operation: 'orders.pull' })
    await worker.processOne()
    await post(`/api/integrations/${storeId}/jobs`, { operation: 'orders.pull' })
    await worker.processOne()
    const { activity } = (await listed()).find((item) => item.id === storeId)!
    expect(Object.keys(activity ?? {}).sort()).toEqual(['catalog.pull', 'orders.pull'])
    expect(activity?.['orders.pull']).toMatchObject({ status: 'completed', error: null })
  }
  let current = await state()
  expect(current.listings).toHaveLength(6)
  expect(current.orders).toHaveLength(3)
  expect(writes).toHaveLength(0)
  expect(skus.map((sku) => availableStock(current, idsBySku[sku]))).toEqual(physical)
  for (const order of current.orders.filter((order) => !order.historical)) {
    const key = randomUUID()
    await command({ type: 'order.transition', id: order.id, status: 'approved' }, key)
    await command({ type: 'order.transition', id: order.id, status: 'approved' }, key)
  }
  await command({
    type: 'customer.save',
    customer: {
      id: 'opening-customer',
      name: 'Örnek Cari',
      email: '',
      phone: '',
      address: '',
      city: 'İstanbul',
    },
  })
  const entry: Command = {
      type: 'customer.entry',
      id: 'opening-entry',
      customerId: 'opening-customer',
      kind: 'debit',
      amount: 150000,
      description: 'Geçiş açılış bakiyesi; aktarılan siparişler hariç.',
    },
    key = randomUUID()
  await command(entry, key)
  await command(entry, key)
  current = await state()
  expect(
    Object.fromEntries(
      current.products
        .flatMap((product) => product.variants)
        .map((variant) => [variant.sku, variant.stock]),
    ),
  ).toEqual(Object.fromEntries(skus.map((sku, index) => [sku, physical[index]])))
  expect(current.cash).toHaveLength(0)
  expect(customerBalance(current, 'opening-customer')).toBe(150000)
  expect(
    current.orders.filter((order) => order.historical).every((order) => !order.inventoryApplied),
  ).toBe(true)
  expect(
    current.orders
      .filter((order) => !order.historical)
      .reduce((sum, order) => sum + orderTotal(order), 0),
  ).toBe(39000)
  for (const connectionId of stores)
    await enqueue(db, { workspaceId, connectionId, kind: 'inventory.reconcile' })
  for (let count = 0; count < 20; count++) {
    if (!(await worker.processOne())) break
  }
  expect(writes).toHaveLength(6)
  for (const write of writes) expect(write.quantity).toBe(physical[skus.indexOf(write.sku)])
}, 30000)
