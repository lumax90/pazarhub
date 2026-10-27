import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { FastifyInstance } from 'fastify'
import type { IntegrationWorker } from '../server/worker'
import { ingestOrders } from '../server/worker'
import { queueAutomaticInvoice } from '../server/invoice-automation'
import { invoiceLinkKey } from '../server/invoice-link'
import type { ServerConfig } from '../server/config'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { IntegrationSettings } from '../src/domain/integrations'
import type { AppState, Command, InvoiceInput } from '../src/domain/types'
import { defaultEcommerceSettings } from '../src/domain/ecommerce'
import { invoiceManualSourceKey } from '../src/domain/invoice-document'
import { fulfillmentFixture } from './fulfillment-fixture'
import { createAdapter } from '../server/integrations/registry'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 21),
  cookieName: 'automation-test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Test',
}
const fixture = fulfillmentFixture()
let db: Database,
  app: FastifyInstance,
  worker: IntegrationWorker,
  index = 20,
  prepareThenDisable = false
beforeAll(async () => {
  db = await createDatabase(config, true)
  const built = await createApp(config, {
    database: db,
    worker: true,
    logger: false,
    fetcher: async (url, init) => {
      if (String(url) === 'https://fixture.example/prepare') {
        await db.query(
          "UPDATE integration_connections SET settings=jsonb_set(settings,'{sendInvoiceLink}','false'::jsonb) WHERE provider='trendyol'",
        )
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }
      return fixture.fetcher(url, init)
    },
    factory: (provider, http) => {
      const real = createAdapter(provider, http)
      if (provider !== 'trendyol' || !prepareThenDisable) return real
      return {
        capabilities: real.capabilities,
        execute: async (operation, context, payload) => {
          if (operation !== 'invoice.link') return real.execute(operation, context, payload)
          await http.request('https://fixture.example/prepare')
          const invoice = context.state.invoices.find(
            (invoice) => invoice.orderId === payload.orderId,
          )!
          await http.request('https://fixture.example/link', {
            method: 'POST',
            json: { invoiceLink: invoice.url },
          })
          return { message: 'Link sent' }
        },
      }
    },
  })
  app = built.app
  worker = built.worker
  await worker.stop()
}, 30000)
afterAll(async () => {
  await app.close()
  await db.close()
})
afterEach(async () => {
  prepareThenDisable = false
  fixture.state.drop = ''
  fixture.state.writes = []
  await db.query(
    "UPDATE integration_jobs SET status='cancelled',worker_id=NULL,lease_until=NULL WHERE status IN ('queued','waiting','running')",
  )
})
async function owner() {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.22.${index++}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Fatura Sorumlusu',
      workspaceName: 'Otomasyon',
      email: `${randomUUID()}@example.com`,
      password: 'Automation1234',
    },
  })
  expect(registered.statusCode).toBe(201)
  const cookie = registered.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json(),
    headers = { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken },
    workspaceId = session.workspace.id as string
  return {
    headers,
    workspaceId,
    command: (payload: Command, key = randomUUID()) =>
      app.inject({
        method: 'POST',
        url: '/api/commands',
        headers: { ...headers, 'idempotency-key': key },
        payload,
      }),
  }
}
type Owner = Awaited<ReturnType<typeof owner>>
async function state(a: Owner) {
  return (await app.inject({ url: '/api/workspace', headers: a.headers })).json().state as AppState
}
async function customer(a: Owner) {
  expect(
    (
      await a.command({
        type: 'customer.save',
        customer: {
          id: 'customer',
          name: 'Müşteri',
          email: '',
          phone: '5551234567',
          city: 'İstanbul',
          address: 'Test Mahallesi Sokak 1',
        },
      })
    ).statusCode,
  ).toBe(200)
}
async function connection(
  a: Owner,
  provider: 'parasut' | 'trendyol',
  isDefault?: boolean,
  settings: IntegrationSettings = defaultIntegrationSettings,
) {
  const result = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...a.headers, 'idempotency-key': randomUUID() },
    payload: {
      provider,
      name: `${provider} ${randomUUID()}`,
      enabled: false,
      settings,
      ...(isDefault !== undefined ? { isDefault } : {}),
      credentials:
        provider === 'parasut'
          ? {
              companyId: '123',
              clientId: 'fixture',
              clientSecret: 'fixture',
              email: 'fixture@example.com',
              password: 'fixture',
            }
          : { sellerId: '123', apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
    },
  })
  expect(result.statusCode, result.body).toBe(201)
  return result.json() as { id: string; isDefault: boolean }
}
const input: InvoiceInput = {
  customerId: 'customer',
  issueDate: '2026-10-25',
  title: 'Satış',
  note: '',
  currency: 'TRY',
  localOnly: false,
  items: [{ kind: 'free', title: 'Hizmet', quantity: 1, unitPrice: 10000, taxRate: 20 }],
}
const active = async (id: string) =>
  db.query("UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1", [id])
const step = async () => {
  await db.query(
    "UPDATE integration_jobs SET available_at=now()-interval '1 second' WHERE status IN ('queued','waiting')",
  )
  await worker.processOne()
}
describe('invoice timing, default account and link automation', () => {
  it('assigns the first new invoice account by default and changes it once without retargeting queued documents', async () => {
    const a = await owner(),
      other = await owner()
    await customer(a)
    const first = await connection(a, 'parasut'),
      second = await connection(a, 'parasut'),
      foreign = await connection(other, 'parasut')
    expect(first.isDefault).toBe(true)
    expect(second.isDefault).toBe(false)
    await active(first.id)
    await active(second.id)
    const created = await a.command({ type: 'invoice.create', id: 'invoice', input })
    expect(created.statusCode).toBe(200)
    expect((await state(a)).invoices[0].connectionId).toBe(first.id)
    const invalidDefault = await app.inject({
      method: 'POST',
      url: `/api/integrations/${first.id}/default`,
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: { isDefault: false },
    })
    expect(invalidDefault.statusCode).toBe(400)
    const key = randomUUID(),
      set = () =>
        app.inject({
          method: 'POST',
          url: `/api/integrations/${second.id}/default`,
          headers: { ...a.headers, 'idempotency-key': key },
          payload: {},
        })
    const result = await Promise.all([set(), set()])
    expect(result.every((r) => r.statusCode === 200)).toBe(true)
    const defaults = await db.query<{ id: string }>(
      'SELECT id FROM integration_connections WHERE workspace_id=$1 AND is_default',
      [a.workspaceId],
    )
    expect(defaults.rows.map((row) => row.id)).toEqual([second.id])
    expect((await state(a)).invoices[0].connectionId).toBe(first.id)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/integrations/${foreign.id}/default`,
          headers: { ...a.headers, 'idempotency-key': randomUUID() },
          payload: {},
        })
      ).statusCode,
    ).toBe(404)
  })
  it('does not fall back to another company when the default account is inactive, or export local-only documents', async () => {
    const a = await owner()
    await customer(a)
    const first = await connection(a, 'parasut'),
      second = await connection(a, 'parasut')
    await active(second.id)
    await a.command({ type: 'invoice.create', id: 'inactive', input })
    expect((await state(a)).invoices[0].connectionId).toBeUndefined()
    await active(first.id)
    await a.command({ type: 'invoice.create', id: 'active', input })
    expect((await state(a)).invoices[0].connectionId).toBe(first.id)
    await a.command({ type: 'invoice.create', id: 'local', input: { ...input, localOnly: true } })
    expect((await state(a)).invoices[0].connectionId).toBeUndefined()
  })
  it('uses the stored shipment trigger and explicit store account without applying stock twice', async () => {
    const a = await owner()
    await customer(a)
    const first = await connection(a, 'parasut'),
      second = await connection(a, 'parasut')
    await active(first.id)
    await active(second.id)
    const store = await connection(a, 'trendyol', undefined, {
      ...defaultIntegrationSettings,
      invoiceMode: 'workspace',
      invoiceConnectionId: second.id,
    })
    await active(store.id)
    await a.command({
      type: 'ecommerce.settings',
      settings: { ...defaultEcommerceSettings, invoiceTiming: 'on_shipped' },
    })
    const created = await a.command({
        type: 'order.create',
        input: {
          customerId: 'customer',
          channel: 'trendyol',
          items: input.items,
          shipping: 0,
          note: '',
        },
      }),
      orderId = created.json().result.id
    let current = await state(a)
    current.orders[0].storeId = store.id
    current.orders[0].externalId = '12345'
    current.orders[0].lines[0].externalId = 'line'
    await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(current),
      a.workspaceId,
    ])
    await a.command({ type: 'order.transition', id: orderId, status: 'approved' })
    expect((await state(a)).invoices).toHaveLength(0)
    await db.transaction(async (tx) => {
      const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
            [a.workspaceId],
          )
        ).rows[0],
        order = row.document.orders[0],
        line = order.lines[0]
      await ingestOrders(
        row.document,
        [
          {
            externalId: '12345',
            number: order.number,
            createdAt: order.createdAt,
            modifiedAt: new Date().toISOString(),
            status: 'shipped',
            normalizedStatus: 'shipped',
            total: line.lineTotalOverride ?? line.unitPrice * line.quantity,
            shipping: 0,
            recipient: {
              name: 'Müşteri',
              address: 'Test Mahallesi Sokak 1',
              city: 'İstanbul',
              district: 'Kadıköy',
              country: 'TR',
              phone: '5551234567',
            },
            lines: [
              {
                externalId: 'line',
                sku: '',
                barcode: '',
                title: line.title ?? 'Hizmet',
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                taxRate: line.taxRate,
                total: line.lineTotalOverride ?? line.unitPrice * line.quantity,
              },
            ],
          },
        ],
        store.id,
        'trendyol',
        tx,
        a.workspaceId,
      )
      await queueAutomaticInvoice(tx, a.workspaceId, row.document, row.document.invoices[0])
      await tx.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
        JSON.stringify(row.document),
        a.workspaceId,
      ])
    })
    current = await state(a)
    expect(current.invoices).toHaveLength(1)
    expect(current.invoices[0].connectionId).toBe(second.id)
    expect(current.movements).toHaveLength(0)
    await a.command({ type: 'order.transition', id: orderId, status: 'delivered' })
    expect(
      (
        await db.query(
          "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND kind='invoice.create'",
          [a.workspaceId],
        )
      ).rows,
    ).toHaveLength(1)
  })
  it('cancels only unsent automatic links and retains the manually associated document', async () => {
    const a = await owner()
    await customer(a)
    const store = await connection(a, 'trendyol')
    await active(store.id)
    const created = await a.command({
        type: 'order.create',
        input: {
          customerId: 'customer',
          channel: 'trendyol',
          items: input.items,
          shipping: 0,
          note: '',
        },
      }),
      orderId = created.json().result.id
    await a.command({ type: 'order.transition', id: orderId, status: 'approved' })
    const current = await state(a)
    Object.assign(current.orders[0], { storeId: store.id, externalId: '123456' })
    await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(current),
      a.workspaceId,
    ])
    const invoice = current.invoices[0]
    const linked = await a.command({
      type: 'invoice.document.link',
      id: invoice.id,
      expectedVersion: invoice.version ?? 0,
      expectedSource: invoiceManualSourceKey(current, invoice),
      url: 'https://invoice.example/doc.pdf',
    })
    expect(linked.statusCode).toBe(200)
    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/integrations/${store.id}`,
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: {
        provider: 'trendyol',
        name: 'Test mağazası',
        credentials: {},
        enabled: true,
        settings: { ...defaultIntegrationSettings, sendInvoiceLink: false },
      },
    })
    expect(changed.statusCode, changed.body).toBe(200)
    expect(
      (
        await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
          linked.json().result.jobId,
        ])
      ).rows[0].status,
    ).toBe('cancelled')
    expect((await state(a)).invoices[0].manualDocument?.url).toBe('https://invoice.example/doc.pdf')
    await step()
    expect(fixture.state.writes).not.toContain('marketplace-invoice-link')
  })
  it('checks a disabled automatic link again between provider requests', async () => {
    const a = await owner()
    await customer(a)
    const store = await connection(a, 'trendyol')
    await active(store.id)
    const created = await a.command({
        type: 'order.create',
        input: {
          customerId: 'customer',
          channel: 'trendyol',
          items: input.items,
          shipping: 0,
          note: '',
        },
      }),
      orderId = created.json().result.id
    await a.command({ type: 'order.transition', id: orderId, status: 'approved' })
    const current = await state(a)
    Object.assign(current.orders[0], { storeId: store.id, externalId: '123456' })
    await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(current),
      a.workspaceId,
    ])
    const invoice = current.invoices[0]
    const linked = await a.command({
      type: 'invoice.document.link',
      id: invoice.id,
      expectedVersion: invoice.version ?? 0,
      expectedSource: invoiceManualSourceKey(current, invoice),
      url: 'https://invoice.example/doc.pdf',
    })
    prepareThenDisable = true
    const saved = (
      await db.query<{ payload: Record<string, unknown> }>(
        'SELECT payload FROM integration_jobs WHERE id=$1',
        [linked.json().result.jobId],
      )
    ).rows[0]
    expect(invoiceLinkKey(await state(a), orderId)).toBe(saved.payload.invoiceLinkKey)
    await step()
    const job = (
      await db.query<{ status: string; last_error: string }>(
        'SELECT status,last_error FROM integration_jobs WHERE id=$1',
        [linked.json().result.jobId],
      )
    ).rows[0]
    expect(job.status).toBe('failed')
    expect(job.last_error).toContain('INVOICE_LINK_DISABLED')
    expect((await state(a)).invoices[0].status).toBe('issued')
  })
})
