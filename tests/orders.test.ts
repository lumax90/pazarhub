import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { AppState, Command, OrderInput } from '../src/domain/types'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import {
  discountedOrderAmount,
  filterOrders,
  orderContentKey,
  orderLineKey,
  orderPreparation,
} from '../src/domain/orders'
import { customerBalance, orderTotal, reservedStock } from '../src/domain/selectors'
import { defaultIntegrationSettings } from '../src/domain/integrations'

const now = '2026-10-23T10:00:00.000Z'
function workspace() {
  const state = createEmptyState('Sipariş Testi')
  state.customers = [
    {
      id: 'customer',
      name: 'Alıcı',
      address: 'Örnek teslimat adresi',
      city: 'İstanbul',
      district: 'Kadıköy',
      phone: '5551234567',
      email: '',
    },
  ]
  state.products = [
    {
      id: 'product',
      name: 'Seramik ürün',
      category: 'Seramik',
      brand: '',
      description: '',
      art: 'cup',
      color: '#aabbcc',
      active: true,
      lowStock: 1,
      taxRate: 20,
      variants: [
        {
          id: 'variant',
          name: 'Standart',
          sku: 'CAT-1',
          barcode: '001234',
          stock: 10,
          price: 10000,
          cost: 4000,
        },
      ],
    },
  ]
  return state
}
const input = (): OrderInput => ({
  customerId: 'customer',
  channel: 'manual',
  shipping: 1000,
  note: 'Alıcı notu',
  internalNote: 'Ekip notu',
  externalNumber: 'PHONE-123',
  paymentMethod: 'cash',
  paid: true,
  items: [
    { variantId: 'variant', quantity: 2, discount: { kind: 'percent', value: 1000 } },
    {
      kind: 'free',
      title: 'Hediye paketleme',
      unitPrice: 4990,
      quantity: 1,
      taxRate: 20,
      discount: { kind: 'percent', value: 5000 },
    },
  ],
})
const apply = (state: AppState, command: Command) => executeCommand(state, command, now)

describe('verified order workflows', () => {
  it('preserves distinct catalog and free rows, discounts and payment snapshots without inventing stock', () => {
    const created = apply(workspace(), { type: 'order.create', input: input() })
    expect(created.result.ok).toBe(true)
    const order = created.state.orders[0]
    expect(orderTotal(order)).toBe(21495)
    expect(order).toMatchObject({
      externalNumber: 'PHONE-123',
      paid: true,
      paymentMethod: 'cash',
      note: 'Alıcı notu',
    })
    expect(order.notes?.[0].text).toBe('Ekip notu')
    expect(order.lines.map((line) => line.kind)).toEqual(['catalog', 'free'])
    expect(reservedStock(created.state, 'variant')).toBe(2)
    expect(created.state.products).toHaveLength(1)
    expect(created.state.products[0].variants[0].stock).toBe(10)
    expect(created.state.cash).toHaveLength(1)
    expect(created.state.cash[0]).toMatchObject({
      amount: 21495,
      method: 'cash',
      reference: order.id,
    })
    const invoiced = apply(created.state, { type: 'order.invoice', id: order.id }).state
    const approved = apply(invoiced, {
      type: 'order.transition',
      id: order.id,
      status: 'approved',
    }).state
    expect(approved.invoices).toHaveLength(1)
    expect(approved.products[0].variants[0].stock).toBe(8)
    expect(approved.movements).toHaveLength(1)
    expect(approved.products[0].variants[0].price).toBe(10000)
    expect(customerBalance(approved, 'customer')).toBe(0)
  })
  it('aggregates catalog quantities for reservations without merging rows with separate prices', () => {
    const command: Command = {
      type: 'order.create',
      input: {
        ...input(),
        paid: false,
        items: [
          { variantId: 'variant', quantity: 6, unitPrice: 5000 },
          { variantId: 'variant', quantity: 5, unitPrice: 7000 },
        ],
      },
    }
    const original = workspace(),
      failed = apply(original, command)
    expect(failed.result.ok).toBe(false)
    expect(failed.state).toBe(original)
    command.input.items[1].quantity = 4
    const created = apply(original, command)
    expect(created.result.ok).toBe(true)
    expect(created.state.orders[0].lines).toHaveLength(2)
    expect(created.state.orders[0].lines.map((line) => line.unitPrice)).toEqual([5000, 7000])
    expect(reservedStock(created.state, 'variant')).toBe(10)
    expect(() => discountedOrderAmount(1, 100, { kind: 'amount', value: 101 })).toThrow()
    expect(discountedOrderAmount(3, 3333, { kind: 'percent', value: 1250 })).toBe(8749)
  })
  it('treats unmapped provider lines differently from explicitly free service lines', () => {
    const created = apply(workspace(), {
      type: 'order.create',
      input: {
        ...input(),
        paid: false,
        items: [{ kind: 'free', title: 'Hizmet', unitPrice: 12000, quantity: 1, taxRate: 20 }],
      },
    }).state
    expect(filterOrders(created, { unmapped: true })).toHaveLength(0)
    const approved = apply(created, {
      type: 'order.transition',
      id: created.orders[0].id,
      status: 'approved',
    })
    expect(approved.result.ok).toBe(true)
    expect(approved.state.movements).toHaveLength(0)
    const unknown = structuredClone(created)
    delete unknown.orders[0].lines[0].kind
    expect(filterOrders(unknown, { unmapped: true })).toHaveLength(1)
    expect(
      apply(unknown, { type: 'order.transition', id: unknown.orders[0].id, status: 'approved' })
        .result.ok,
    ).toBe(false)
  })
  it('guards preparation against changed lines and never changes the inventory balance', () => {
    let state = apply(workspace(), {
      type: 'order.create',
      input: { ...input(), paid: false },
    }).state
    const order = state.orders[0],
      content = orderContentKey(order)
    state = apply(state, {
      type: 'order.prepare',
      id: order.id,
      expectedContent: content,
      lineKeys: [orderLineKey(order.lines[0], 0)],
      ready: true,
    }).state
    expect(orderPreparation(state.orders[0])).toEqual({ ready: 1, total: 2 })
    expect(state.movements).toHaveLength(0)
    const taxed = apply(state, {
      type: 'order.tax',
      id: order.id,
      taxRate: 10,
      expectedContent: content,
    }).state
    const stale = apply(taxed, {
      type: 'order.prepare',
      id: order.id,
      expectedContent: content,
      lineKeys: order.lines.map(orderLineKey),
      ready: true,
    })
    expect(stale.result.ok).toBe(false)
    expect(stale.state).toBe(taxed)
    const invoice = apply(taxed, { type: 'order.invoice', id: order.id }).state
    expect(
      apply(invoice, {
        type: 'order.tax',
        id: order.id,
        taxRate: 1,
        expectedContent: orderContentKey(invoice.orders[0]),
      }).result.ok,
    ).toBe(false)
  })
  it('requires manual tracking and supports a non-restocking full return exactly once', () => {
    let state = apply(workspace(), { type: 'order.create', input: input() }).state
    const id = state.orders[0].id
    state = apply(state, { type: 'order.transition', id, status: 'approved' }).state
    expect(apply(state, { type: 'order.transition', id, status: 'shipped' }).result.ok).toBe(false)
    state = apply(state, {
      type: 'order.transition',
      id,
      status: 'shipped',
      shipment: { carrier: 'Aras', trackingNumber: 'TRACK-1' },
    }).state
    state = apply(state, { type: 'order.transition', id, status: 'delivered' }).state
    state = apply(state, {
      type: 'order.transition',
      id,
      status: 'returned',
      restock: false,
      reason: 'Hasarlı ürün',
    }).state
    expect(state.products[0].variants[0].stock).toBe(8)
    expect(state.cash.map((entry) => entry.kind).sort()).toEqual(['in', 'out'])
    expect(state.cash.every((entry) => entry.method === 'cash')).toBe(true)
    expect(state.invoices[0].status).toBe('cancelled')
    const duplicate = apply(state, {
      type: 'sale.return',
      id: 'again',
      source: 'order',
      saleId: id,
      items: [{ lineIndex: 0, quantity: 2, restock: true }],
      refund: true,
      method: 'cash',
      note: 'Again',
    })
    expect(duplicate.result.ok).toBe(false)
    expect(duplicate.state).toBe(state)
  })
  it('filters in Istanbul dates and persists saved filter identity revisions', () => {
    let state = apply(workspace(), { type: 'order.create', input: input() }).state
    state.orders[0].createdAt = '2026-10-22T22:30:00.000Z'
    expect(
      filterOrders(state, { from: '2026-10-23', to: '2026-10-23', paid: true, query: 'PHONE-123' }),
    ).toHaveLength(1)
    expect(filterOrders(state, { to: '2026-10-22' })).toHaveLength(0)
    const filter = { id: 'view', name: 'Tahsil edilenler', filters: { paid: true }, version: 0 }
    state = apply(state, { type: 'order.filter.save', filter }).state
    expect(state.orderFilters?.[0].version).toBe(1)
    expect(
      apply(state, { type: 'order.filter.save', filter: { ...filter, name: 'Eski değişiklik' } })
        .result.ok,
    ).toBe(false)
    expect(
      apply(state, { type: 'order.filter.delete', id: 'view', version: 1 }).state.orderFilters,
    ).toHaveLength(0)
  })
})

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/orders-test',
  encryptionKey: Buffer.alloc(32, 9),
  cookieName: 'order_test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Orders fixture',
}
let app: FastifyInstance,
  database: Database,
  ip = 1
beforeAll(async () => {
  database = await createDatabase(config, true)
  const built = await createApp(config, {
    database,
    worker: false,
    logger: false,
    factory: () => ({
      capabilities: ['test', 'invoice.create', 'invoice.finalize', 'shipment.create'],
      execute: async () => ({ message: 'Fixture' }),
    }),
  })
  app = built.app
}, 30000)
afterAll(async () => {
  await app.close()
  await database.close()
})
async function owner() {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.5.${ip++}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Order Owner',
      workspaceName: 'Order workspace',
      email: `${randomUUID()}@example.test`,
      password: 'Order123',
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const cookie = response.headers['set-cookie']!.toString().split(';')[0]
  const session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
  const auth = {
    workspaceId: session.workspace.id as string,
    userId: session.user.id as string,
    headers: {
      cookie,
      origin: config.publicOrigin,
      'x-csrf-token': session.csrfToken as string,
      'x-workspace-id': session.workspace.id as string,
    },
  }
  await command(auth, { type: 'customer.save', customer: workspace().customers[0] })
  await command(auth, { type: 'product.save', product: workspace().products[0] })
  return auth
}
type Owner = Awaited<ReturnType<typeof owner>>
const command = (auth: Owner, payload: Command, key = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/api/commands',
    headers: { ...auth.headers, 'idempotency-key': key },
    payload,
  })
const snapshot = async (auth: Owner) =>
  (await app.inject({ url: '/api/workspace', headers: auth.headers })).json().state as AppState
async function connect(auth: Owner, provider: 'parasut' | 'yurtici', verified = true) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...auth.headers, 'idempotency-key': randomUUID() },
    payload: {
      provider,
      name: 'Fixture account',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials:
        provider === 'parasut'
          ? {
              clientId: 'fixture',
              clientSecret: 'fixture-secret',
              email: 'fixture@example.test',
              password: 'fixture-password',
              companyId: '123',
            }
          : {
              username: 'fixture',
              password: 'fixture-password',
              testReference: 'fixture-reference',
            },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const id = response.json().id as string
  if (verified)
    await database.query(
      `UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1`,
      [id],
    )
  return id
}

describe('order API transactions', () => {
  it('replays prepaid creation without duplicate order, cash entry or internal note', async () => {
    const auth = await owner(),
      key = randomUUID()
    const responses = await Promise.all([
      command(auth, { type: 'order.create', input: input() }, key),
      command(auth, { type: 'order.create', input: input() }, key),
    ])
    expect(responses.every((response) => response.statusCode === 200)).toBe(true)
    const state = await snapshot(auth)
    expect(state.orders).toHaveLength(1)
    expect(state.cash).toHaveLength(1)
    expect(state.orders[0].notes).toHaveLength(1)
    expect(state.orders[0].notes?.[0].author).toBe('Order Owner')
  })
  it('makes immediate invoicing atomic with account and role validation', async () => {
    const auth = await owner(),
      connectionId = await connect(auth, 'parasut', false)
    const create: Command = {
      type: 'order.create',
      input: { ...input(), invoicePreference: 'immediate', invoiceConnectionId: connectionId },
    }
    expect((await command(auth, create)).statusCode).toBe(409)
    expect((await snapshot(auth)).orders).toHaveLength(0)
    expect((await snapshot(auth)).cash).toHaveLength(0)
    await database.query(
      `UPDATE integration_connections SET enabled=true,status='verified' WHERE id=$1`,
      [connectionId],
    )
    expect((await command(auth, create)).statusCode).toBe(200)
    const state = await snapshot(auth)
    expect(state.invoices[0]).toMatchObject({ connectionId, status: 'queued' })
    expect(state.products[0].variants[0].stock).toBe(10)
    expect(
      (
        await database.query(
          `SELECT id FROM integration_jobs WHERE workspace_id=$1 AND kind='invoice.create'`,
          [auth.workspaceId],
        )
      ).rows,
    ).toHaveLength(1)
    expect(
      (
        await command(auth, {
          type: 'order.invoice.preference',
          id: state.orders[0].id,
          preference: 'draft',
        })
      ).statusCode,
    ).toBe(409)
    await database.query(
      `UPDATE memberships SET role='operator' WHERE workspace_id=$1 AND user_id=$2`,
      [auth.workspaceId, auth.userId],
    )
    expect((await command(auth, { type: 'order.create', input: input() })).statusCode).toBe(403)
  })
  it('retains note authors on replay and keeps column preferences out of the workspace document', async () => {
    const auth = await owner()
    await command(auth, {
      type: 'order.create',
      input: { ...input(), paid: false, internalNote: '' },
    })
    const order = (await snapshot(auth)).orders[0]
    const note: Command = {
      type: 'order.note.add',
      id: order.id,
      noteId: 'note',
      text: 'Hazırlık notu',
    }
    expect((await command(auth, note)).statusCode).toBe(200)
    await database.query('UPDATE users SET name=$1 WHERE id=$2', ['Changed author', auth.userId])
    expect((await command(auth, note)).statusCode).toBe(200)
    expect((await snapshot(auth)).orders[0].notes?.[0].author).toBe('Order Owner')
    const prefs = (await snapshot(auth)).preferences
    expect(
      (
        await command(auth, {
          type: 'preferences.update',
          preferences: { ...prefs, orderColumns: ['status', 'total'] },
        })
      ).statusCode,
    ).toBe(200)
    expect((await snapshot(auth)).preferences.orderColumns).toEqual(['status', 'total'])
    const row = (
      await database.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [auth.workspaceId],
      )
    ).rows[0]
    expect(row.document.preferences.orderColumns).toBeUndefined()
    await database.query(
      `UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`,
      [auth.workspaceId, auth.userId],
    )
    expect(
      (
        await command(auth, {
          type: 'order.prepare',
          id: order.id,
          lineKeys: order.lines.map(orderLineKey),
          ready: true,
          expectedContent: orderContentKey(order),
        })
      ).statusCode,
    ).toBe(403)
  })
  it('binds an existing shipment to its original request and blocks changed-order fulfillment', async () => {
    const auth = await owner(),
      connectionId = await connect(auth, 'yurtici')
    await command(auth, { type: 'order.create', input: { ...input(), paid: false } })
    const order = (await snapshot(auth)).orders[0]
    await command(auth, { type: 'order.transition', id: order.id, status: 'approved' })
    const payload = {
      orderId: order.id,
      connectionId,
      recipient: {
        name: 'Test Alıcı',
        address: 'Örnek teslimat adresi',
        city: 'İstanbul',
        district: 'Kadıköy',
        phone: '5551234567',
      },
      packages: 1,
      desi: 2,
      weight: 1,
    }
    const send = (body: typeof payload) =>
      app.inject({ method: 'POST', url: '/api/shipments', headers: auth.headers, payload: body })
    expect((await send(payload)).statusCode).toBe(202)
    expect((await send(payload)).statusCode).toBe(202)
    expect((await snapshot(auth)).shipments).toHaveLength(1)
    expect((await send({ ...payload, packages: 2 })).json().error.code).toBe('SHIPMENT_EXISTS')
    const state = await snapshot(auth)
    state.orders[0].syncError = 'Sipariş kalemleri değişti.'
    await database.query('UPDATE workspace_states SET document=$1 WHERE workspace_id=$2', [
      JSON.stringify(state),
      auth.workspaceId,
    ])
    expect((await send(payload)).json().error.code).toBe('ORDER_RECONCILIATION_REQUIRED')
  })
})
