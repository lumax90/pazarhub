import { describe, expect, it, vi } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import { manualInvoiceUrl, invoiceManualSourceKey } from '../src/domain/invoice-document'
import { invoiceLinkKey, invoiceLinkRequestContainsUrl } from '../server/invoice-link'
import { catalogParts } from './catalog-workspace-fixture'
import { ParasutAdapter } from '../server/integrations/parasut'
import { ProviderHttp } from '../server/integrations/http'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { InvoiceInput } from '../src/domain/types'

const input: InvoiceInput = {
  customerId: 'customer',
  issueDate: '2026-10-25',
  title: 'Satış',
  note: '',
  currency: 'TRY',
  localOnly: false,
  items: [{ variantId: 'a', quantity: 1, unitPrice: 10000, taxRate: 20 }],
}
function fixture() {
  const state = createEmptyState('Dış fatura')
  state.customers = [
    {
      id: 'customer',
      name: 'Müşteri',
      email: '',
      phone: '5551234567',
      city: 'İstanbul',
      address: 'Test Mahallesi Sokak 1',
    },
  ]
  state.products = catalogParts()
  return executeCommand(state, { type: 'invoice.create', id: 'invoice', input }).state
}
const link = (state: ReturnType<typeof fixture>) =>
  executeCommand(state, {
    type: 'invoice.document.link',
    id: 'invoice',
    expectedVersion: state.invoices[0].version ?? 0,
    expectedSource: invoiceManualSourceKey(state, state.invoices[0]),
    url: 'https://invoice.example/document.pdf',
    number: 'ABC2026000000001',
  })
describe('manually associated external invoices', () => {
  it('links an external document without creating stock, cash, orders or rewriting frozen costs', () => {
    const state = fixture(),
      result = link(state)
    expect(result.result.ok, result.result.message).toBe(true)
    expect(result.state.invoices[0]).toMatchObject({
      status: 'issued',
      url: 'https://invoice.example/document.pdf',
      documentNumber: 'ABC2026000000001',
    })
    expect(result.state.invoices[0].externalId).toBeUndefined()
    expect(result.state.invoices[0].document).toEqual(state.invoices[0].document)
    expect(result.state.products).toEqual(state.products)
    expect(result.state.cash).toEqual(state.cash)
    expect(result.state.movements).toEqual(state.movements)
    expect(result.state.orders).toEqual(state.orders)
    expect(link(result.state).result.ok).toBe(false)
    expect(
      executeCommand(result.state, {
        type: 'invoice.edit',
        id: 'invoice',
        expectedVersion: result.state.invoices[0].version!,
        input,
      }).result.ok,
    ).toBe(false)
    expect(
      executeCommand(result.state, {
        type: 'invoice.delete',
        id: 'invoice',
        expectedVersion: result.state.invoices[0].version!,
      }).result.ok,
    ).toBe(false)
  })
  it('removes only the manual association; provider documents cannot be unlinked this way', () => {
    const state = fixture(),
      linked = link(state).state,
      invoice = linked.invoices[0]
    expect(
      executeCommand(linked, {
        type: 'invoice.document.unlink',
        id: invoice.id,
        expectedVersion: 1,
      }).result.ok,
    ).toBe(false)
    const result = executeCommand(linked, {
      type: 'invoice.document.unlink',
      id: invoice.id,
      expectedVersion: invoice.version!,
    })
    expect(result.result.ok).toBe(true)
    expect(result.state.invoices[0].status).toBe('draft')
    expect(result.state.invoices[0].manualDocument).toBeUndefined()
    expect(result.state.invoices[0].url).toBeUndefined()
    expect(result.state.products).toEqual(linked.products)
    linked.invoices[0].connectionId = 'provider'
    expect(
      executeCommand(linked, {
        type: 'invoice.document.unlink',
        id: invoice.id,
        expectedVersion: invoice.version!,
      }).result.ok,
    ).toBe(false)
  })
  it('retains the external association through local cancellation and restoration without an official cancellation', () => {
    const linked = link(fixture()).state,
      invoice = linked.invoices[0]
    const cancelled = executeCommand(linked, {
      type: 'invoice.cancel',
      id: invoice.id,
      expectedVersion: invoice.version!,
    })
    expect(cancelled.result.ok, cancelled.result.message).toBe(true)
    expect(cancelled.state.invoices[0]).toMatchObject({
      status: 'cancelled',
      manualDocument: invoice.manualDocument,
      url: invoice.url,
    })
    expect(cancelled.state.products[0].variants[0].stock).toBe(
      linked.products[0].variants[0].stock + 1,
    )
    expect(
      executeCommand(cancelled.state, {
        type: 'invoice.delete',
        id: invoice.id,
        expectedVersion: cancelled.state.invoices[0].version!,
      }).result.ok,
    ).toBe(false)
    const restored = executeCommand(cancelled.state, {
      type: 'invoice.restore',
      id: invoice.id,
      expectedVersion: cancelled.state.invoices[0].version!,
    })
    expect(restored.result.ok).toBe(true)
    expect(restored.state.invoices[0].status).toBe('issued')
    expect(restored.state.invoices[0].manualDocument).toEqual(invoice.manualDocument)
    expect(restored.state.products[0].variants[0].stock).toBe(linked.products[0].variants[0].stock)
  })
  it('rejects stale source data, local-only documents and documents already associated with a provider', () => {
    const state = fixture(),
      invoice = state.invoices[0],
      key = invoiceManualSourceKey(state, invoice)
    invoice.document!.billingAddress.name = 'Başka alıcı'
    expect(
      executeCommand(state, {
        type: 'invoice.document.link',
        id: invoice.id,
        expectedVersion: invoice.version!,
        expectedSource: key,
        url: 'https://invoice.example/file',
      }).result.ok,
    ).toBe(false)
    invoice.localOnly = true
    expect(link(state).result.ok).toBe(false)
    invoice.localOnly = false
    invoice.connectionId = 'parasut'
    expect(link(state).result.ok).toBe(false)
  })
  it('rejects unsafe or private-looking addresses without fetching a document', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://invoice.example/file',
      'https://localhost/file',
      'https://127.0.0.1/file',
      'https://10.0.0.1/file',
      'https://host.local/file',
      'https://user:secret@invoice.example/file',
      'https://invoice.example:8443/file',
      'https://[::1]/file',
      'https://invoice.example/file#token',
    ])
      expect(manualInvoiceUrl(url)).toBeUndefined()
    expect(manualInvoiceUrl(' https://invoice.example/file?signature=abc ')).toBe(
      'https://invoice.example/file?signature=abc',
    )
  })
  it('blocks Paraşüt calls before authentication for manually associated invoices', async () => {
    const state = link(fixture()).state,
      fetcher = vi.fn<typeof fetch>()
    for (const operation of [
      'invoice.create',
      'invoice.finalize',
      'invoice.status',
      'invoice.reconcile',
    ] as const)
      await expect(
        new ParasutAdapter(new ProviderHttp(fetcher)).execute(
          operation,
          {
            state,
            workspaceId: 'workspace',
            connectionId: 'provider',
            provider: 'parasut',
            credentials: {},
            settings: defaultIntegrationSettings,
            integrationName: 'Test',
          },
          { invoiceId: 'invoice' },
        ),
      ).rejects.toMatchObject({ code: 'INVOICE_EXTERNAL_DOCUMENT' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('freezes marketplace link identity and becomes invalid when the order is closed', () => {
    const url = 'https://invoice.example/file?a=1&b=2'
    expect(invoiceLinkRequestContainsUrl(JSON.stringify({ invoiceLink: url }), url)).toBe(true)
    expect(
      invoiceLinkRequestContainsUrl('<url>https://invoice.example/file?a=1&amp;b=2</url>', url),
    ).toBe(true)
    expect(invoiceLinkRequestContainsUrl(JSON.stringify({ grant_type: 'password' }), url)).toBe(
      false,
    )
    const state = fixture()
    state.orders = [
      {
        id: 'order',
        number: 'SP-1',
        storeId: 'store',
        externalId: 'remote',
        externalNumber: '123',
        channel: 'trendyol',
        customerId: 'customer',
        status: 'approved',
        createdAt: '2026-10-25T10:00:00Z',
        dueAt: '2026-10-26',
        lines: state.invoices[0].document!.lines,
        shipping: 0,
        note: '',
        events: [],
        paid: false,
        inventoryApplied: true,
      },
    ]
    state.invoices[0].orderId = 'order'
    delete state.invoices[0].document
    const linked = link(state).state,
      key = invoiceLinkKey(linked, 'order')
    expect(key).toBeTruthy()
    linked.invoices[0].url = 'https://invoice.example/other'
    expect(invoiceLinkKey(linked, 'order')).not.toBe(key)
    linked.orders[0].status = 'cancelled'
    expect(invoiceLinkKey(linked, 'order')).toBeUndefined()
  })
})
