import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import type { AppState, Command, InvoiceInput } from '../src/domain/types'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { fulfillmentFixture } from './fulfillment-fixture'
import { catalogParts } from './catalog-workspace-fixture'
import { invoiceManualSourceKey } from '../src/domain/invoice-document'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 17),
  cookieName: 'invoice-core-test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Test',
}
const fixture = fulfillmentFixture()
let app: FastifyInstance,
  db: Database,
  worker: IntegrationWorker,
  sequence = 1
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
  fixture.state.drop = ''
  fixture.state.contacts.clear()
  fixture.state.products.clear()
  fixture.state.categories.clear()
  fixture.state.invoices.clear()
  fixture.state.writes = []
})
async function owner() {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.18.${sequence++}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Fatura Sorumlusu',
      workspaceName: 'Fatura',
      email: `${randomUUID()}@example.com`,
      password: 'Invoice1234',
    },
  })
  expect(registered.statusCode).toBe(201)
  const cookie = registered.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
  return {
    workspaceId: session.workspace.id as string,
    userId: session.user.id as string,
    headers: { cookie, origin: config.publicOrigin, 'x-csrf-token': session.csrfToken },
    command: (payload: Command, key = randomUUID()) =>
      app.inject({
        method: 'POST',
        url: '/api/commands',
        headers: {
          cookie,
          origin: config.publicOrigin,
          'x-csrf-token': session.csrfToken,
          'idempotency-key': key,
        },
        payload,
      }),
  }
}
type Owner = Awaited<ReturnType<typeof owner>>
const state = async (owner: Owner) =>
  (await app.inject({ url: '/api/workspace', headers: owner.headers })).json().state as AppState
async function prepare(owner: Owner) {
  const saved = await owner.command({
    type: 'customer.save',
    customer: {
      id: 'customer',
      name: `Alıcı ${owner.workspaceId}`,
      phone: '5551234567',
      email: '',
      address: 'Test Mahallesi Sokak 1',
      city: 'İstanbul',
      district: 'Kadıköy',
      taxId: '11111111111',
    },
  })
  expect(saved.statusCode).toBe(200)
}
const input: InvoiceInput = {
  customerId: 'customer',
  currency: 'TRY',
  issueDate: '2026-10-25',
  dueDate: '2026-11-01',
  title: 'Hizmet faturası',
  note: 'Ödeme koşulları',
  localOnly: false,
  items: [
    { kind: 'free', title: 'Hizmet', unit: 'Adet', quantity: 1, unitPrice: 10000, taxRate: 20 },
  ],
}
async function step() {
  await db.query(
    "UPDATE integration_jobs SET available_at=now() WHERE status IN ('queued','waiting')",
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  await worker.processOne()
}

describe('invoice commands, accounting and provider source', () => {
  it('associates an external invoice once, cancels an unsent link on correction, and locks a submitted marketplace link', async () => {
    const a = await owner(),
      other = await owner()
    await prepare(a)
    await prepare(other)
    const connection = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: {
        provider: 'trendyol',
        name: 'Test mağazası',
        enabled: false,
        settings: defaultIntegrationSettings,
        credentials: { sellerId: '123', apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
      },
    })
    expect(connection.statusCode, connection.body).toBe(201)
    const storeId = connection.json().id
    await db.query(
      "UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1",
      [storeId],
    )
    const created = await a.command({
      type: 'order.create',
      input: {
        customerId: 'customer',
        channel: 'trendyol',
        items: input.items,
        shipping: 0,
        note: '',
      },
    })
    expect(created.statusCode, created.body).toBe(200)
    const orderId = created.json().result.id
    expect(
      (await a.command({ type: 'order.transition', id: orderId, status: 'approved' })).statusCode,
    ).toBe(200)
    const current = await state(a),
      order = current.orders[0],
      invoice = current.invoices[0]
    Object.assign(order, { storeId, externalId: '123456', externalNumber: 'order-number' })
    await db.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(current),
      a.workspaceId,
    ])
    await db.query(
      "UPDATE memberships SET role='accountant' WHERE workspace_id=$1 AND user_id=$2",
      [a.workspaceId, a.userId],
    )
    const command: Command = {
        type: 'invoice.document.link',
        id: invoice.id,
        expectedVersion: invoice.version ?? 0,
        expectedSource: invoiceManualSourceKey(current, invoice),
        url: 'https://invoice.example/document.pdf',
        number: 'ABC2026000000001',
      },
      key = randomUUID()
    expect((await other.command(command)).statusCode).toBe(422)
    const result = await Promise.all([a.command(command, key), a.command(command, key)])
    expect(result.every((response) => response.statusCode === 200)).toBe(true)
    const jobId = result[0].json().result.jobId
    expect(jobId).toBeTruthy()
    let linked = await state(a)
    expect(linked.invoices[0].manualDocument?.linkedBy).toBe('Fatura Sorumlusu')
    expect(linked.cash).toHaveLength(0)
    expect(linked.movements).toEqual(current.movements)
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/invoices/${invoice.id}/action`,
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: { operation: 'create', connectionId: randomUUID() },
    })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().error.code).toBe('INVOICE_EXTERNAL_DOCUMENT')
    expect(
      (
        await a.command({
          type: 'invoice.document.unlink',
          id: invoice.id,
          expectedVersion: linked.invoices[0].version!,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
          jobId,
        ])
      ).rows[0].status,
    ).toBe('cancelled')
    const unlinked = await state(a)
    const again = await a.command({
      ...command,
      expectedVersion: unlinked.invoices[0].version!,
      expectedSource: invoiceManualSourceKey(unlinked, unlinked.invoices[0]),
    })
    expect(again.statusCode).toBe(200)
    fixture.state.drop = 'marketplace-link'
    await step()
    linked = await state(a)
    expect(
      fixture.state.writes.filter((write) => write === 'marketplace-invoice-link'),
    ).toHaveLength(1)
    const attempted = (
      await db.query<{ status: string; payload: Record<string, unknown> }>(
        'SELECT status,payload FROM integration_jobs WHERE id=$1',
        [again.json().result.jobId],
      )
    ).rows[0]
    expect(attempted.status).toBe('waiting')
    expect(attempted.payload.invoiceLinkWriteStartedAt).toBeTruthy()
    expect(
      (
        await a.command({
          type: 'invoice.document.unlink',
          id: invoice.id,
          expectedVersion: linked.invoices[0].version!,
        })
      ).statusCode,
    ).toBe(409)
    await step()
    expect(
      (
        await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
          again.json().result.jobId,
        ])
      ).rows[0].status,
    ).toBe('completed')
  }, 30000)
  it('replays bulk receipts once, enforces ownership and permits metadata-only category assignment without stock permission', async () => {
    const a = await owner(),
      other = await owner()
    await prepare(a)
    await prepare(other)
    for (const id of ['first', 'second'])
      expect((await a.command({ type: 'invoice.create', id, input })).statusCode).toBe(200)
    const before = await state(a),
      key = randomUUID(),
      command: Command = {
        type: 'invoice.pay.bulk',
        items: before.invoices.map((invoice) => ({
          id: invoice.id,
          expectedTotal: 12000,
          expectedVersion: invoice.version!,
        })),
        payment: { method: 'card', warehouseId: 'main', at: '2026-10-25T12:00:00Z' },
      }
    expect((await other.command(command)).statusCode).toBe(422)
    const paid = await Promise.all([a.command(command, key), a.command(command, key)])
    expect(paid.every((result) => result.statusCode === 200)).toBe(true)
    expect((await state(a)).cash).toHaveLength(2)
    expect(
      (
        await a.command({
          type: 'invoice.category.save',
          id: 'category',
          name: 'Bayi',
          active: true,
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await a.command({
          type: 'warehouse.save',
          warehouse: { id: 'shop', name: 'Mağaza', active: true },
        })
      ).statusCode,
    ).toBe(200)
    const product = await a.command({ type: 'product.save', product: catalogParts()[0] })
    expect(product.statusCode, product.body).toBe(200)
    const stock = await a.command({
      type: 'invoice.create',
      id: 'stock',
      input: { ...input, items: [{ variantId: 'a', quantity: 1, unitPrice: 10000, taxRate: 20 }] },
    })
    expect(stock.statusCode, stock.body).toBe(200)
    await db.query(
      "UPDATE memberships SET role='accountant' WHERE workspace_id=$1 AND user_id=$2",
      [a.workspaceId, a.userId],
    )
    expect(
      (await a.command({ type: 'invoice.edit', id: 'stock', expectedVersion: 1, input }))
        .statusCode,
    ).toBe(403)
    expect(
      (
        await a.command({
          type: 'invoice.category.set',
          id: 'stock',
          categoryId: 'category',
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await a.command({
          type: 'invoice.category.delete',
          id: 'category',
          expectedVersion: 1,
          expectedUsage: 1,
        })
      ).statusCode,
    ).toBe(422)
  }, 30000)
  it('recovers a lost Paraşüt category response read-only and sends its verified relationship without duplicate creation', async () => {
    const a = await owner()
    await prepare(a)
    await a.command({
      type: 'invoice.category.save',
      id: 'category',
      name: `Bayi ${a.workspaceId}`,
      active: true,
      expectedVersion: 0,
    })
    expect(
      (
        await a.command({
          type: 'invoice.create',
          id: 'invoice',
          input: { ...input, categoryId: 'category' },
        })
      ).statusCode,
    ).toBe(200)
    const connection = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: {
        provider: 'parasut',
        name: 'Paraşüt',
        enabled: false,
        settings: defaultIntegrationSettings,
        credentials: {
          companyId: '123',
          clientId: 'fixture',
          clientSecret: 'fixture',
          email: 'fixture@example.com',
          password: 'fixture',
        },
      },
    })
    const connectionId = connection.json().id
    await db.query(
      "UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1",
      [connectionId],
    )
    const queued = await app.inject({
      method: 'POST',
      url: '/api/invoices/invoice/action',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: { operation: 'create', connectionId },
    })
    fixture.state.drop = 'category'
    const before = fixture.state.writes.filter((item) => item === 'category').length
    await step()
    expect((await state(a)).invoices[0].uncertainJobId).toBe(queued.json().jobId)
    const reconcile = await app.inject({
      method: 'POST',
      url: '/api/fulfillment/invoice/invoice/reconcile',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: { sourceJobId: queued.json().jobId },
    })
    expect(reconcile.statusCode, reconcile.body).toBe(202)
    await step()
    await step()
    await step()
    await step()
    await step()
    const invoice = (await state(a)).invoices[0]
    expect(invoice.externalId).toBeTruthy()
    expect(invoice.remoteCategoryId).toBeTruthy()
    expect(fixture.state.writes.filter((item) => item === 'category')).toHaveLength(before + 1)
    expect(fixture.state.invoices.get(invoice.externalId!)!.data.relationships).toMatchObject({
      category: { data: { id: invoice.remoteCategoryId, type: 'item_categories' } },
    })
    await a.command({
      type: 'invoice.category.save',
      id: 'category',
      name: 'Yeniden adlandırıldı',
      active: true,
      expectedVersion: 1,
    })
    const check = await app.inject({
      method: 'POST',
      url: '/api/invoices/invoice/action',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: { operation: 'status', connectionId },
    })
    expect(check.statusCode).toBe(202)
    await step()
    expect((await state(a)).invoices[0].status).toBe('draft')
    expect((await state(a)).invoices[0].remoteCategoryName).toBe(`Bayi ${a.workspaceId}`)
  }, 30000)
  it('creates and pays through one atomic idempotent transaction and prevents cross-tenant payment or stock changes', async () => {
    const a = await owner(),
      b = await owner()
    await prepare(a)
    await prepare(b)
    const key = randomUUID(),
      payload: Command = {
        type: 'invoice.create',
        id: 'invoice',
        input: {
          ...input,
          payment: { method: 'transfer', at: '2026-10-25T10:00:00Z', warehouseId: 'main' },
        },
      }
    const results = await Promise.all([a.command(payload, key), a.command(payload, key)])
    expect(results.every((result) => result.statusCode === 200)).toBe(true)
    expect((await state(a)).invoices).toHaveLength(1)
    expect((await state(a)).cash).toHaveLength(1)
    expect((await state(a)).orders).toHaveLength(0)
    const wrong = await b.command({
      type: 'invoice.unpay',
      id: 'invoice',
      expectedPaymentId: (await state(a)).invoices[0].paymentCashId!,
    })
    expect(wrong.statusCode).toBe(422)
    await db.query(
      "UPDATE memberships SET role='accountant' WHERE workspace_id=$1 AND user_id=$2",
      [a.workspaceId, a.userId],
    )
    expect((await a.command({ type: 'invoice.create', id: 'free', input })).statusCode).toBe(200)
    await db.query("UPDATE memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2", [
      a.workspaceId,
      a.userId,
    ])
    await a.command({ type: 'product.save', product: catalogParts()[0] })
    await db.query(
      "UPDATE memberships SET role='accountant' WHERE workspace_id=$1 AND user_id=$2",
      [a.workspaceId, a.userId],
    )
    const denied = await a.command({
      type: 'invoice.create',
      id: 'stock',
      input: { ...input, items: [{ variantId: 'a', quantity: 1, unitPrice: 10000, taxRate: 20 }] },
    })
    expect(denied.statusCode).toBe(403)
  }, 30000)
  it('passes standalone issue/due dates and exact native lines to Paraşüt, and reconciles a lost creation response', async () => {
    const a = await owner()
    await prepare(a)
    expect((await a.command({ type: 'invoice.create', id: 'invoice', input })).statusCode).toBe(200)
    const connection = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: {
        provider: 'parasut',
        name: 'Paraşüt',
        enabled: false,
        settings: defaultIntegrationSettings,
        credentials: {
          companyId: '123',
          clientId: 'fixture',
          clientSecret: 'fixture',
          email: 'fixture@example.com',
          password: 'fixture',
        },
      },
    })
    expect(connection.statusCode, connection.body).toBe(201)
    const connectionId = connection.json().id
    await db.query(
      "UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1",
      [connectionId],
    )
    const queued = await app.inject({
      method: 'POST',
      url: '/api/invoices/invoice/action',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: { operation: 'create', connectionId },
    })
    expect(queued.statusCode, queued.body).toBe(202)
    const blocked = await a.command({
      type: 'invoice.edit',
      id: 'invoice',
      expectedVersion: 1,
      input,
    })
    expect(blocked.statusCode).toBe(409)
    fixture.state.drop = 'invoice'
    const before = fixture.state.writes.filter((item) => item === 'invoice').length
    await step()
    await step()
    await step()
    expect((await state(a)).invoices[0].uncertainJobId).toBe(queued.json().jobId)
    const reconcile = await app.inject({
      method: 'POST',
      url: '/api/fulfillment/invoice/invoice/reconcile',
      headers: { ...a.headers, 'idempotency-key': randomUUID() },
      payload: { sourceJobId: queued.json().jobId },
    })
    expect(reconcile.statusCode, reconcile.body).toBe(202)
    await step()
    const saved = (await state(a)).invoices[0]
    expect(saved.externalId).toBeTruthy()
    expect(saved.status).toBe('draft')
    expect((await state(a)).orders).toHaveLength(0)
    const remote = fixture.state.invoices.get(saved.externalId!)!
    expect(remote.data.attributes).toMatchObject({
      issue_date: '2026-10-25',
      due_date: '2026-11-01',
      currency: 'TRL',
      net_total: 120,
    })
    expect(fixture.state.writes.filter((item) => item === 'invoice')).toHaveLength(before + 1)
  }, 30000)
})
