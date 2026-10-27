import { describe, expect, it, vi } from 'vitest'
import { ProviderHttp } from '../server/integrations/http'
import { TrendyolAdapter } from '../server/integrations/trendyol'
import { normalizeAmazonOrder } from '../server/integrations/amazon'
import { normalizeCiceksepetiOrder } from '../server/integrations/ciceksepeti'
import { PttCargoAdapter } from '../server/integrations/cargo'
import { ParasutAdapter } from '../server/integrations/parasut'
import { soapCall, parseXml } from '../server/integrations/soap'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { AdapterContext } from '../server/integrations/contracts'
import { seal, unseal } from '../server/security'
import { isPublicAddress } from '../server/downloads'

const context: AdapterContext = {
  workspaceId: 'workspace',
  connectionId: 'connection',
  provider: 'trendyol',
  credentials: { sellerId: '123', apiKey: 'key', apiSecret: 'secret' },
  settings: defaultIntegrationSettings,
  integrationName: 'Pazarhub',
  state: createEmptyState('Test'),
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('provider boundary contracts', () => {
  it('respects Retry-After on throttling', async () => {
    const http = new ProviderHttp(
      vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })),
    )
    await expect(http.request('https://provider.example/orders')).rejects.toMatchObject({
      retryable: true,
      retryAfterSeconds: 120,
      uncertain: false,
    })
  })
  it('marks ambiguous fiscal writes uncertain while read timeouts remain retryable', async () => {
    const http = new ProviderHttp(
      vi.fn(async () => {
        throw new Error('socket ended')
      }),
    )
    await expect(
      http.request('https://provider.example/invoices', { method: 'POST', json: {} }),
    ).rejects.toMatchObject({ retryable: false, uncertain: true })
    await expect(http.request('https://provider.example/orders')).rejects.toMatchObject({
      retryable: true,
      uncertain: false,
    })
  })
  it('does not call a malformed successful POST response a safe failure', async () => {
    const http = new ProviderHttp(vi.fn(async () => new Response('not JSON', { status: 200 })))
    await expect(
      http.request('https://provider.example/invoices', { method: 'POST', json: {} }),
    ).rejects.toMatchObject({ uncertain: true })
  })
  it('rejects a failed Trendyol batch instead of reporting the listing active', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      json({
        status: 'COMPLETED',
        failedItemCount: 1,
        items: [{ status: 'FAILED', failureReasons: ['invalid category'] }],
      }),
    )
    const adapter = new TrendyolAdapter(new ProviderHttp(fetcher))
    await expect(
      adapter.execute('inventory.push', context, { batchId: 'batch1' }),
    ).rejects.toMatchObject({ code: 'BATCH_FAILED' })
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      '/integration/product/sellers/123/products/batch-requests/batch1',
    )
  })
  it('keeps Amazon 2026 item totals exact instead of multiplying a rounded unit price', () => {
    const order = normalizeAmazonOrder({
      orderId: 'amazon-order',
      createdTime: '2026-10-22T10:00:00Z',
      lastUpdatedTime: '2026-10-22T11:00:00Z',
      fulfillment: { fulfillmentStatus: 'UNSHIPPED' },
      proceeds: { grandTotal: { amount: '90.01', currencyCode: 'TRY' } },
      orderItems: [
        {
          orderItemId: 'line1',
          quantityOrdered: 3,
          product: { sellerSku: 'SKU1', title: 'Ürün' },
          proceeds: { proceedsTotal: { amount: '90.01', currencyCode: 'TRY' } },
        },
      ],
    })
    expect(order.lines[0].total).toBe(9001)
    expect(order.total).toBe(9001)
    expect(order.lines[0].taxRate).toBeUndefined()
  })
  it('uses Çiçeksepeti suborder identity and parses Turkish dates deterministically', () => {
    const order = normalizeCiceksepetiOrder({
      orderId: 200,
      orderItemId: 201,
      orderCreateDate: '23/10/2026',
      orderCreateTime: '09:30',
      orderModifyDate: '23/10/2026',
      orderModifyTime: '09:35',
      quantity: 2,
      invoicePrice: 30.01,
      cargoPrice: 0,
      orderItemStatusId: 5,
      name: 'Ürün',
      code: 'SKU1',
    })
    expect(order.externalId).toBe('201')
    expect(order.createdAt).toBe('2026-10-23T06:30:00.000Z')
    expect(order.lines[0].total).toBe(3001)
    expect(order.normalizedStatus).toBe('shipped')
  })
  it('escapes SOAP values and rejects entity declarations', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          '<Envelope><Body><TestResponse><ok>true</ok></TestResponse></Body></Envelope>',
        ),
    )
    await soapCall(
      new ProviderHttp(fetcher),
      'https://carrier.example/soap',
      'http://example.org',
      'Test',
      { password: 'A&B<secret>' },
      { safe: true },
    )
    expect(fetcher.mock.calls[0][1]?.body).toContain('A&amp;B&lt;secret&gt;')
    expect(() =>
      parseXml('<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///etc/passwd">]><x>&bad;</x>'),
    ).toThrow()
  })
  it('sends PTT tracking fields in the WSDL-qualified input namespace', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          '<Envelope><Body><barkodSorguResponse><return><hataKodu>0</hataKodu><barkod>1234567890123</barkod><kabulTarih>20261022</kabulTarih></return></barkodSorguResponse></Body></Envelope>',
        ),
    )
    const result = await new PttCargoAdapter(new ProviderHttp(fetcher)).execute(
      'test',
      {
        ...context,
        provider: 'ptt',
        credentials: {
          username: 'user',
          password: 'secret',
          customerCode: '123',
          testReference: '1234567890123',
        },
      },
      {},
    )
    expect(result.message).toContain('doğrulandı')
    expect(fetcher.mock.calls[0][1]?.body).toContain('xmlns:t="http://hareket.ptt.gov.tr/xsd"')
    expect(fetcher.mock.calls[0][1]?.body).toContain('<t:musteri_no>123</t:musteri_no>')
  })
  it('uses frozen invoice names and units in Paraşüt and rejects conflicting provider units', async () => {
    const state = createEmptyState('Invoice fixture')
    state.orders.push({
      id: 'order',
      number: 'SP-1',
      customerId: 'customer',
      channel: 'manual',
      status: 'approved',
      createdAt: '2026-10-23T10:00:00.000Z',
      dueAt: '2026-10-23T10:00:00.000Z',
      lines: [
        {
          variantId: 'v',
          title: 'Katalog adı',
          invoiceTitle: 'Satışta dondurulan fatura adı',
          unit: 'Set',
          quantity: 1,
          unitPrice: 12000,
          unitCost: 5000,
          taxRate: 20,
        },
      ],
      shipping: 0,
      note: '',
      invoiceId: 'invoice',
      paid: false,
      inventoryApplied: true,
      events: [],
      billingAddress: { name: 'Test alıcı', address: 'Test adresi', city: 'İstanbul', phone: '' },
    })
    state.invoices.push({
      id: 'invoice',
      number: 'FT-1',
      orderId: 'order',
      createdAt: '2026-10-23T10:00:00.000Z',
      status: 'draft',
    })
    const writes: unknown[] = []
    let conflictingUnit = false
    const adapter = new ParasutAdapter(
      new ProviderHttp(
        vi.fn<typeof fetch>(async (input, init) => {
          const url = new URL(String(input))
          if (url.pathname === '/oauth/token')
            return json({ access_token: 'invoice-fixture-token', expires_in: 3600 })
          if (url.pathname.endsWith('/products') && init?.method !== 'POST')
            return json({
              data: conflictingUnit
                ? [{ id: 'product', attributes: { code: 'PH-v', unit: 'Adet' } }]
                : [],
            })
          writes.push(JSON.parse(String(init?.body)))
          return json({
            data: { id: url.pathname.endsWith('/products') ? 'product' : 'remote-invoice' },
          })
        }),
      ),
    )
    const invoiceContext: AdapterContext = {
      ...context,
      connectionId: 'parasut-snapshot',
      provider: 'parasut',
      state,
      credentials: {
        companyId: '123',
        clientId: 'fixture',
        clientSecret: 'fixture-secret',
        email: 'fixture@example.com',
        password: 'fixture-password',
      },
    }
    const product = await adapter.execute('invoice.create', invoiceContext, {
      invoiceId: 'invoice',
      contactId: 'contact',
      productIds: [],
    })
    const invoice = await adapter.execute('invoice.create', invoiceContext, product.nextPayload!)
    expect(invoice.invoice?.externalId).toBe('remote-invoice')
    expect(writes[0]).toMatchObject({
      data: { attributes: { name: 'Satışta dondurulan fatura adı', unit: 'Set' } },
    })
    expect(writes[1]).toMatchObject({
      data: {
        relationships: {
          details: {
            data: [
              {
                attributes: {
                  description: 'Satışta dondurulan fatura adı',
                  quantity: 1,
                  unit_price: 100,
                  vat_rate: 20,
                },
              },
            ],
          },
        },
      },
    })
    conflictingUnit = true
    await expect(
      adapter.execute('invoice.create', invoiceContext, {
        invoiceId: 'invoice',
        contactId: 'contact',
        productIds: [],
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNIT_MISMATCH', uncertain: false })
    expect(writes).toHaveLength(2)
  })
  it('honors immediate and draft invoice preferences after provider total verification', async () => {
    const state = createEmptyState('Invoice preference fixture')
    state.orders.push({
      id: 'order',
      number: 'SP-1',
      customerId: 'customer',
      channel: 'manual',
      status: 'pending',
      createdAt: '2026-10-23T10:00:00.000Z',
      dueAt: '2026-10-24T10:00:00.000Z',
      lines: [{ variantId: 'v', quantity: 1, unitPrice: 12000, unitCost: 5000, taxRate: 20 }],
      shipping: 0,
      note: '',
      paid: false,
      inventoryApplied: false,
      events: [],
      invoicePreference: 'immediate',
    })
    state.invoices.push({
      id: 'invoice',
      number: 'FT-1',
      orderId: 'order',
      createdAt: '2026-10-23T10:00:00.000Z',
      status: 'draft',
      externalId: 'remote',
    })
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/oauth/token')
        ? json({ access_token: 'preference-token', expires_in: 3600 })
        : json({ data: { id: 'remote', attributes: { net_total: '120.00' } } }),
    )
    const adapter = new ParasutAdapter(new ProviderHttp(fetcher))
    const ctx: AdapterContext = {
      ...context,
      state,
      connectionId: 'preference-fixture',
      provider: 'parasut',
      settings: { ...defaultIntegrationSettings, finalizeInvoices: true, finalizeDelayMinutes: 60 },
      credentials: {
        companyId: '123',
        clientId: 'fixture',
        clientSecret: 'fixture-secret',
        email: 'fixture@example.test',
        password: 'fixture-password',
      },
    }
    expect(
      (await adapter.execute('invoice.create', ctx, { invoiceId: 'invoice' })).invoice
        ?.finalizeAfterSeconds,
    ).toBe(0)
    state.orders[0].invoicePreference = 'draft'
    expect(
      (await adapter.execute('invoice.create', ctx, { invoiceId: 'invoice' })).invoice
        ?.finalizeAfterSeconds,
    ).toBeUndefined()
    state.orders[0].invoicePreference = 'default'
    expect(
      (await adapter.execute('invoice.create', ctx, { invoiceId: 'invoice' })).invoice
        ?.finalizeAfterSeconds,
    ).toBe(3600)
  })
  it('binds encrypted credentials to both tenant and connection identity', () => {
    const key = Buffer.alloc(32, 8),
      sealed = seal({ secret: 'private' }, key, 'tenant-a:connection-a')
    expect(unseal(sealed, key, 'tenant-a:connection-a')).toEqual({ secret: 'private' })
    expect(() => unseal(sealed, key, 'tenant-b:connection-a')).toThrow()
  })
  it('rejects private network document destinations', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('169.254.169.254')).toBe(false)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('10.0.1.3')).toBe(false)
    expect(isPublicAddress('1.1.1.1')).toBe(true)
  })
})
