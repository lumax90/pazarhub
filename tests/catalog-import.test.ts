import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { AppState, Product } from '../src/domain/types'
import { createEmptyState } from '../src/domain/empty-state'
import { parseImport, parseImportNumber } from '../server/catalog-import/parsing'
import { applyImportPlan, planImport } from '../server/catalog-import/planning'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 8),
  cookieName: 'import_test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Pazarhub',
}
let app: FastifyInstance,
  db: Database,
  sequence = 10
beforeAll(async () => {
  db = await createDatabase(config, true)
  app = (await createApp(config, { database: db, worker: false, logger: false })).app
}, 30000)
afterAll(async () => {
  await app.close()
  await db.close()
})
async function setup() {
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.3.${sequence++}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Import Owner',
      workspaceName: 'Katalog Testi',
      email: `${randomUUID()}@example.com`,
      password: 'catalog-import-password',
    },
  })
  expect(registration.statusCode, registration.body).toBe(201)
  const cookie = registration.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
  return {
    workspaceId: session.workspace.id as string,
    userId: session.user.id as string,
    headers: {
      cookie,
      origin: config.publicOrigin,
      'x-csrf-token': session.csrfToken as string,
      'x-workspace-id': session.workspace.id as string,
    },
  }
}
type Setup = Awaited<ReturnType<typeof setup>>
const write = (auth: Setup, url: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url,
    headers: { ...auth.headers, 'idempotency-key': randomUUID() },
    payload,
  })
const state = async (auth: Setup) =>
  (await app.inject({ url: '/api/workspace', headers: auth.headers })).json().state as AppState
const sample =
  'Model;SKU;Ürün adı;Varyant;Satış fiyatı;Stok\nKUPA;KUPA-1;Seramik kupa;Beyaz;49,90;5\nKUPA;KUPA-2;Seramik kupa;Siyah;59,90;3'
async function prepare(auth: Setup, text = sample) {
  const file = await write(auth, '/api/catalog-imports', {
    name: 'urunler.csv',
    format: 'csv',
    text,
  })
  expect(file.statusCode, file.body).toBe(201)
  const inspected = file.json(),
    id = inspected.id as string
  const options = {
    mapping: inspected.suggested,
    mode: 'create',
    decimal: ',',
    warehouseId: 'main',
  }
  const preview = await write(auth, `/api/catalog-imports/${id}/preview`, options)
  expect(preview.statusCode, preview.body).toBe(200)
  return { id, options, preview: preview.json() }
}
describe('catalogue import files and atomic application', () => {
  it('parses BOM, quoted newlines, embedded delimiters and escaped quotes', () => {
    const parsed = parseImport(
      '\uFEFF\nSKU,Name,Description\r\n001,"Kupa, büyük","Satır 1\nSatır ""iki"""\r\n',
      'csv',
    )
    expect(parsed.rows).toEqual([
      { SKU: '001', Name: 'Kupa, büyük', Description: 'Satır 1\nSatır "iki"' },
    ])
    expect(() => parseImport('SKU;Name\nA;"kapanmadı', 'csv')).toThrow()
  })
  it('keeps XML identifiers as strings and refuses external entities', () => {
    const parsed = parseImport(
      '<products><product><sku>001</sku><name>Kupa</name><price>10.00</price></product><product><sku>002</sku><name>Tabak</name><price>20.00</price></product></products>',
      'xml',
    )
    expect(parsed.recordPath).toBe('products.product')
    expect(parsed.rows[0].sku).toBe('001')
    expect(() =>
      parseImport(
        '<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///C:/secret">]><x><sku>A</sku><name>&bad;</name></x>',
        'xml',
      ),
    ).toThrow()
  })
  it('parses locale-specific money exactly and rejects ambiguous fractions', () => {
    expect(parseImportNumber('1.234,56', ',', true)).toBe(123456)
    expect(parseImportNumber('1,234.56', '.', true)).toBe(123456)
    expect(() => parseImportNumber('12.345', '.', true)).toThrow()
    expect(() => parseImportNumber('-1', ',', true)).toThrow()
  })
  it('binds new variants to an existing model regardless of row order and preserves other warehouse balances', () => {
    const state = createEmptyState('Test')
    state.warehouses = [
      { id: 'main', name: 'Merkez', active: true },
      { id: 'other', name: 'Diğer', active: true },
    ]
    const product: Product = {
      id: 'old-product',
      name: 'Kupa',
      category: 'Mutfak',
      brand: 'Atölye',
      description: 'Açıklama',
      art: 'cup',
      color: '#aabbcc',
      taxRate: 20,
      active: true,
      lowStock: 1,
      version: 1,
      variants: [
        {
          id: 'old-variant',
          name: 'Beyaz',
          sku: 'KUPA-OLD',
          barcode: '',
          price: 1000,
          cost: 500,
          stock: 10,
          stockByWarehouse: { main: 3, other: 7 },
        },
      ],
    }
    state.products = [product]
    const data = parseImport(
      'Model;SKU;Ürün adı;Satış fiyatı;Stok\nKUPA;KUPA-NEW;Kupa;20,00;2\nKUPA;KUPA-OLD;Kupa;15,00;4',
      'csv',
    )
    const plan = planImport(
      state,
      1,
      data,
      {
        mapping: {
          model: 'Model',
          sku: 'SKU',
          name: 'Ürün adı',
          price: 'Satış fiyatı',
          stock: 'Stok',
        },
        mode: 'upsert',
        decimal: ',',
        warehouseId: 'main',
      },
      'source',
      'file.csv',
    )
    expect(plan.preview.errors).toEqual([])
    expect(plan.preview.newProducts).toBe(0)
    const result = applyImportPlan(state, plan, 'file.csv')
    expect(result.products).toHaveLength(1)
    expect(result.products[0].variants).toHaveLength(2)
    expect(
      result.products[0].variants.find((v) => v.id === 'old-variant')?.stockByWarehouse,
    ).toEqual({ main: 4, other: 7 })
    expect(state.products[0].variants).toHaveLength(1)
  })
  it('applies grouped CSV variants and opening stock once for concurrent requests', async () => {
    const auth = await setup(),
      prepared = await prepare(auth)
    expect(prepared.preview.errors).toEqual([])
    expect(prepared.preview.newProducts).toBe(1)
    const results = await Promise.all([
      write(auth, `/api/catalog-imports/${prepared.id}/apply`, { previewId: prepared.preview.id }),
      write(auth, `/api/catalog-imports/${prepared.id}/apply`, { previewId: prepared.preview.id }),
    ])
    expect(results.map((r) => r.statusCode)).toEqual([200, 200])
    const workspace = await state(auth)
    expect(workspace.products).toHaveLength(1)
    expect(workspace.products[0].variants.map((v) => v.stock)).toEqual([5, 3])
    expect(workspace.movements).toHaveLength(2)
    expect(
      (
        await db.query('SELECT id FROM audit_events WHERE workspace_id=$1 AND action=$2', [
          auth.workspaceId,
          'catalog.imported',
        ])
      ).rows,
    ).toHaveLength(1)
    expect(
      (
        await db.query<{ document: unknown; plan: unknown }>(
          'SELECT document,plan FROM catalog_imports WHERE id=$1',
          [prepared.id],
        )
      ).rows[0],
    ).toEqual({ document: {}, plan: null })
  })
  it('never partially applies a file containing one invalid or duplicate row', async () => {
    const auth = await setup(),
      prepared = await prepare(auth, sample.replace('KUPA-2', 'KUPA-1'))
    expect(prepared.preview.errors.length).toBeGreaterThan(0)
    expect(
      (
        await write(auth, `/api/catalog-imports/${prepared.id}/apply`, {
          previewId: prepared.preview.id,
        })
      ).statusCode,
    ).toBe(422)
    expect((await state(auth)).products).toHaveLength(0)
  })
  it('requires a new preview after concurrent workspace changes', async () => {
    const auth = await setup(),
      prepared = await prepare(auth)
    expect(
      (
        await write(auth, '/api/commands', {
          type: 'customer.save',
          customer: {
            id: randomUUID(),
            name: 'Yeni müşteri',
            email: '',
            phone: '',
            city: '',
            address: '',
          },
        })
      ).statusCode,
    ).toBe(200)
    const result = await write(auth, `/api/catalog-imports/${prepared.id}/apply`, {
      previewId: prepared.preview.id,
    })
    expect(result.statusCode).toBe(409)
    expect(result.json().error.code).toBe('IMPORT_STALE')
    expect((await state(auth)).products).toHaveLength(0)
  })
  it('isolates file previews by tenant and enforces current membership permissions', async () => {
    const a = await setup(),
      b = await setup(),
      prepared = await prepare(a)
    expect(
      (
        await write(b, `/api/catalog-imports/${prepared.id}/apply`, {
          previewId: prepared.preview.id,
        })
      ).statusCode,
    ).toBe(404)
    await db.query(`UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`, [
      a.workspaceId,
      a.userId,
    ])
    expect(
      (
        await write(a, `/api/catalog-imports/${prepared.id}/apply`, {
          previewId: prepared.preview.id,
        })
      ).statusCode,
    ).toBe(403)
  })
})
