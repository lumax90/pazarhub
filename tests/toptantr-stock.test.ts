import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { AdapterContext } from '../server/integrations/contracts'
import { isToptanSharedStock, planToptanSharedStock } from '../server/integrations/toptantr-stock'
import { catalogParts } from './catalog-workspace-fixture'
import { ToptanTrAdapter } from '../server/integrations/toptantr'
import { ProviderHttp } from '../server/integrations/http'
import { randomUUID } from 'node:crypto'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { AppState } from '../src/domain/types'
import { enqueue } from '../server/jobs'

function fixture() {
  const state = createEmptyState('Ortak stok')
  const product = catalogParts()[0]
  product.variants[0].stock = 35
  product.variants[0].stockByWarehouse = { main: 35 }
  state.products = [
    product,
    {
      ...product,
      id: 'pack',
      name: '10’lu havlu',
      bundle: {
        components: [{ variantId: 'a', quantity: 10 }],
        priceMode: 'fixed',
        discountBps: 0,
      },
      variants: [
        {
          id: 'pack-v',
          sku: 'PACK',
          barcode: '0010',
          name: 'Paket',
          price: 10000,
          cost: 0,
          stock: 0,
        },
      ],
    },
  ]
  state.listings = [
    {
      id: 'one',
      productId: product.id,
      variantId: 'a',
      channel: 'toptantr',
      storeId: 'store',
      externalId: '101',
      externalSku: 'EACH',
      attributes: { productCode: 'remote', itemPerPackage: 1 },
      status: 'active',
      updatedAt: '',
    },
    {
      id: 'ten',
      productId: 'pack',
      variantId: 'pack-v',
      channel: 'toptantr',
      storeId: 'store',
      externalId: '102',
      externalSku: 'PACK',
      attributes: { productCode: 'remote', itemPerPackage: 10 },
      status: 'active',
      updatedAt: '',
    },
  ]
  const context: AdapterContext = {
    workspaceId: 'workspace',
    connectionId: 'store',
    provider: 'toptantr',
    credentials: {},
    integrationName: 'Test',
    settings: { ...defaultIntegrationSettings },
    state,
  }
  const remote = {
    productCode: 'remote',
    productAttributeCombinations: [
      {
        id: 101,
        barcode: 'EACH',
        itemPerPackage: 1,
        attributesXml:
          '<Attributes><ProductAttribute ID="5"><ProductAttributeValue><Value>1</Value></ProductAttributeValue></ProductAttribute></Attributes>',
      },
      {
        id: 102,
        barcode: 'PACK',
        itemPerPackage: 10,
        attributesXml:
          '<Attributes><ProductAttribute ID="5"><ProductAttributeValue><Value>2</Value></ProductAttributeValue></ProductAttribute></Attributes>',
      },
    ],
  }
  return { context, remote }
}
describe('ToptanTR shared package inventory plan', () => {
  it('persists verified inventory in the worker and skips an unchanged subsequent reconciliation', async () => {
    const config: ServerConfig = {
      environment: 'test',
      port: 3001,
      host: '127.0.0.1',
      publicOrigin: 'http://localhost:5173',
      dataDirectory: '.data/test',
      encryptionKey: Buffer.alloc(32, 8),
      cookieName: 'shared_stock_test',
      secureCookies: false,
      sessionHours: 1,
      registrationEnabled: true,
      embeddedWorker: false,
      serveFrontend: false,
      integrationName: 'Test',
    }
    const db = await createDatabase(config, true)
    const { context, remote } = fixture()
    const observed = {
      ...remote,
      categories: [{ guid: 'category' }],
      productAttributeCombinations: remote.productAttributeCombinations.map((combination) => ({
        ...combination,
        stockQuantity: combination.id === 101 ? 35 : 3,
        overriddenPrice: combination.id === 101 ? 10.01 : 100,
        overriddenOldPrice: 0,
      })),
    }
    const built = await createApp(config, {
      database: db,
      worker: false,
      logger: false,
      fetcher: async (url, init) => {
        const path = new URL(String(url)).pathname
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
        if (path.endsWith('/token'))
          return json({ access_token: 'worker-fixture', expires_in: 3600 })
        if (path.endsWith('/products/search'))
          return json({ content: [observed], page: 0, totalPages: 1 })
        if (path.endsWith('/attributes'))
          return json({ data: { combinationAttributes: [{ id: 5, name: 'Seçenekler' }] } })
        throw new Error(`Unexpected ${init?.method} ${path}`)
      },
    })
    try {
      const registered = await built.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { origin: config.publicOrigin },
        payload: {
          name: 'Owner',
          workspaceName: 'Shared',
          email: 'shared-worker@example.com',
          password: 'Shared1234',
        },
      })
      expect(registered.statusCode).toBe(201)
      const cookie = registered.headers['set-cookie']!.toString().split(';')[0]
      const session = (await built.app.inject({ url: '/api/session', headers: { cookie } })).json()
      const headers = {
        cookie,
        origin: config.publicOrigin,
        'x-csrf-token': session.csrfToken,
        'idempotency-key': randomUUID(),
      }
      const connected = await built.app.inject({
        method: 'POST',
        url: '/api/integrations',
        headers,
        payload: {
          provider: 'toptantr',
          name: 'Test',
          enabled: false,
          settings: defaultIntegrationSettings,
          credentials: { username: 'fixture', password: 'fixture' },
        },
      })
      expect(connected.statusCode, connected.body).toBe(201)
      const storeId = connected.json().id,
        workspaceId = session.workspace.id
      context.state.listings.forEach((listing) => {
        listing.storeId = storeId
      })
      context.state.listings[0].lastSent = { price: 1001, quantity: 35, archive: false }
      await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
        JSON.stringify(context.state),
        workspaceId,
      ])
      await db.query(
        "UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1",
        [storeId],
      )
      const id = await enqueue(db, {
        workspaceId,
        connectionId: storeId,
        kind: 'inventory.push',
        entityId: 'ten',
        payload: { listingId: 'ten' },
      })
      expect(await built.worker.processOne()).toBe(true)
      const job = (
        await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [id])
      ).rows[0]
      expect(job.status).toBe('completed')
      const state = (
        await db.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1',
          [workspaceId],
        )
      ).rows[0].document
      expect(state.listings.find((listing) => listing.id === 'ten')).toMatchObject({
        syncStatus: 'synced',
        lastSent: { price: 10000, quantity: 3, archive: false },
      })
      await db.query(
        'UPDATE integration_rate_limits SET next_request_at=now() WHERE connection_id=$1',
        [storeId],
      )
      await enqueue(db, { workspaceId, connectionId: storeId, kind: 'inventory.reconcile' })
      expect(await built.worker.processOne()).toBe(true)
      expect(
        (
          await db.query(
            "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND status IN ('queued','waiting','running')",
            [workspaceId],
          )
        ).rows,
      ).toHaveLength(0)
    } finally {
      await built.app.close()
      await db.close()
    }
  }, 30000)
  it('updates price separately, writes stock only to the base and verifies projected package quantities', async () => {
    const { context, remote } = fixture()
    context.connectionId = randomUUID()
    context.workspaceId = randomUUID()
    context.credentials = { username: 'fixture', password: 'fixture' }
    context.state.listings.forEach((listing) => {
      listing.storeId = context.connectionId
    })
    const product = {
      ...remote,
      categories: [{ guid: 'category' }],
      productAttributeCombinations: remote.productAttributeCombinations.map((combination) => ({
        ...combination,
        stockQuantity: 0,
        overriddenPrice: 1,
        overriddenOldPrice: 1,
      })),
    }
    const writes: { path: string; rows: Record<string, unknown>[] }[] = []
    const batches = new Map<string, number>()
    const adapter = new ToptanTrAdapter(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
        if (path.endsWith('/token'))
          return json({ access_token: 'fixture-token', expires_in: 3600 })
        if (path.endsWith('/products/search'))
          return json({ content: [product], page: 0, totalPages: 1 })
        if (path.endsWith('/attributes'))
          return json({ data: { combinationAttributes: [{ id: 5, name: 'Seçenekler' }] } })
        if (path.endsWith('/jobs'))
          return json({
            result: Array.from(
              {
                length: batches.get(new URL(String(url)).searchParams.get('batchRequestId')!) ?? 0,
              },
              () => ({ success: true }),
            ),
          })
        const rows = JSON.parse(String(init?.body)).product.combinations as Record<
          string,
          unknown
        >[]
        writes.push({ path, rows })
        if (path.endsWith('/price'))
          for (const row of rows) {
            expect(row.quantity).toBeUndefined()
            const combination = product.productAttributeCombinations.find(
              (combination) => combination.id === row.id,
            )!
            combination.overriddenPrice = row.sellingPrice as number
            combination.overriddenOldPrice = row.originalPrice as number
          }
        else if (path.endsWith('/stock')) {
          expect(rows).toEqual([{ id: 101, barcode: 'EACH', quantity: 35 }])
          product.productAttributeCombinations[0].stockQuantity = 35
          product.productAttributeCombinations[1].stockQuantity = 3
        } else throw new Error(`Unexpected write ${path}`)
        const id = String(writes.length)
        batches.set(id, rows.length)
        return json({ batchRequestId: id })
      }),
    )
    let payload: Record<string, unknown> = {
      listingId: 'ten',
      inventoryPlan: { price: 10000, quantity: 3, archive: false },
    }
    let completed = false
    for (let index = 0; index < 5; index++) {
      const result = await adapter.execute('inventory.push', context, payload)
      if (!result.nextPayload) {
        expect(result.listingStatus).toBe('active')
        completed = true
        break
      }
      payload = JSON.parse(JSON.stringify(result.nextPayload))
    }
    expect(completed).toBe(true)
    expect(writes.map((write) => write.path)).toEqual([
      '/sapi/v1/combinations/price',
      '/sapi/v1/combinations/stock',
    ])
    expect(writes[0].rows).toEqual([
      { id: 102, barcode: 'PACK', sellingPrice: 100, originalPrice: 100 },
    ])
    context.state.listings[1].desiredStatus = 'archived'
    payload = { listingId: 'ten', inventoryPlan: { price: 10000, quantity: 0, archive: true } }
    let archived = false
    for (let index = 0; index < 4; index++) {
      const result = await adapter.execute('inventory.push', context, payload)
      if (!result.nextPayload) {
        expect(result.listingStatus).toBe('archived')
        archived = true
        break
      }
      payload = result.nextPayload
    }
    expect(archived).toBe(true)
    expect(writes.filter((write) => write.path.endsWith('/stock'))).toHaveLength(1)
    expect(product.productAttributeCombinations[0].stockQuantity).toBe(35)
    expect(product.productAttributeCombinations[1].overriddenPrice).toBe(0)
    context.state.listings[1].desiredStatus = 'active'
    const pending = await adapter.execute('inventory.push', context, {
      listingId: 'ten',
      inventoryPlan: { price: 10000, quantity: 3, archive: false },
    })
    expect(pending.nextPayload).toBeTruthy()
    context.state.products[0].variants[0].stock = 34
    context.state.products[0].variants[0].stockByWarehouse = { main: 34 }
    const beforeStale = writes.length
    await expect(
      adapter.execute('inventory.push', context, pending.nextPayload!),
    ).rejects.toMatchObject({ code: 'INVENTORY_PLAN_STALE' })
    expect(writes).toHaveLength(beforeStale)
  })
  it('recognizes the actual used variation type instead of assuming every multi-variant product shares stock', () => {
    const { remote } = fixture()
    expect(
      isToptanSharedStock(remote, [
        { id: 5, name: 'Seçenekler' },
        { id: 6, name: 'Renk' },
      ]),
    ).toBe(true)
    expect(isToptanSharedStock(remote, [{ id: 5, name: 'Renk' }])).toBe(false)
    expect(() => isToptanSharedStock(remote, [{ id: 6, name: 'Seçenekler' }])).toThrow()
  })
  it('derives every package from one physical stock balance and the provider base variation', () => {
    const { context, remote } = fixture(),
      plan = planToptanSharedStock(context, remote)
    expect(plan).toMatchObject({
      baseId: '101',
      sourceVariantId: 'a',
      sourceQuantity: 35,
      baseQuantity: 35,
    })
    expect(plan.members.map((member) => member.quantity)).toEqual([35, 3])
    context.settings.stockBuffer = 1
    expect(() => planToptanSharedStock(context, remote)).toThrow('tamponu 0')
  })
  it('rejects incomplete or mismatched component mappings before any provider write', () => {
    const { context, remote } = fixture()
    context.state.products[1].bundle!.components[0].quantity = 5
    expect(() => planToptanSharedStock(context, remote)).toThrow('oranıyla')
    context.state.products[1].bundle!.components[0].quantity = 10
    context.state.listings.pop()
    expect(() => planToptanSharedStock(context, remote)).toThrow('tümünü')
  })
  it('does not zero shared base stock when only one package listing is archived', () => {
    const { context, remote } = fixture()
    context.state.listings[1].desiredStatus = 'archived'
    const plan = planToptanSharedStock(context, remote)
    expect(plan.baseQuantity).toBe(35)
    expect(plan.members.map((member) => member.quantity)).toEqual([35, 0])
  })
})
