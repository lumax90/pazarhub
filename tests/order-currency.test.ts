import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultEcommerceSettings } from '../src/domain/ecommerce'
import { executeCommand } from '../src/domain/operations'
import { orderCurrencyTotal } from '../src/domain/order-currency'
import { orderTotal } from '../src/domain/selectors'
import { orderPrintKey, orderPrinted, filterOrders } from '../src/domain/orders'
import { ParasutAdapter } from '../server/integrations/parasut'
import { ProviderHttp } from '../server/integrations/http'
import type { AdapterContext } from '../server/integrations/contracts'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { fulfillmentFixture } from './fulfillment-fixture'
import { imagesForVariant } from '../src/domain/product-images'
import { validateProductStructure } from '../src/domain/products'
import type { Product } from '../src/domain/types'

function fixture() {
  const state = createEmptyState('Döviz')
  state.ecommerce = { ...defaultEcommerceSettings }
  state.exchangeRates = {
    source: 'TCMB',
    date: '2026-10-23',
    fetchedAt: '2026-10-24T10:00:00Z',
    rates: {
      USD: {
        forexSelling: '3612340000',
        forexBuying: '3600000000',
        banknoteBuying: '3600000000',
        banknoteSelling: '3620000000',
      },
    },
  }
  state.customers = [
    {
      id: 'c',
      name: 'Müşteri',
      city: 'İstanbul',
      district: 'Kadıköy',
      address: 'Test Mahallesi Sokak 1',
      phone: '5551234567',
      email: '',
      taxId: '11111111111',
    },
  ]
  return state
}
function create() {
  return executeCommand(
    fixture(),
    {
      type: 'order.create',
      input: {
        customerId: 'c',
        channel: 'manual',
        currency: 'USD',
        expectedExchangeRate: '3612340000',
        priceInputIncludesVat: false,
        expectedTotal: 1204,
        expectedTryTotal: 43492,
        items: [
          {
            kind: 'free',
            title: 'Hizmet',
            quantity: 3,
            unitPrice: 333,
            taxRate: 20,
            discount: { kind: 'percent', value: 1000 },
          },
        ],
        shipping: 125,
        note: '',
        paid: true,
      },
    },
    '2026-10-24T10:00:00Z',
    randomUUID,
  )
}

describe('manual order currency, print state and variant media', () => {
  it('freezes native currency and TRY ledger amounts with VAT/discount rounding and does not revalue them on later rates', () => {
    const result = create()
    expect(result.result.ok, result.result.message).toBe(true)
    const order = result.state.orders[0]
    expect(order.currency).toBe('USD')
    expect(order.currencyRate?.value).toBe('3612340000')
    expect(order.lines[0]).toMatchObject({
      currencyUnitPrice: 400,
      currencyTotal: 1079,
      unitPrice: 14449,
      lineTotalOverride: 38977,
    })
    expect(orderCurrencyTotal(order)).toBe(1204)
    expect(orderTotal(order)).toBe(43492)
    expect(result.state.cash[0].amount).toBe(43492)
    result.state.exchangeRates!.rates.USD!.forexSelling = '9999900000'
    expect(orderTotal(order)).toBe(43492)
    expect(orderCurrencyTotal(order)).toBe(1204)
  })
  it('rejects stale currency/rate and total snapshots before reserving inventory or taking payment', () => {
    const state = fixture(),
      input = {
        customerId: 'c',
        channel: 'manual' as const,
        currency: 'USD' as const,
        expectedExchangeRate: '3500000000',
        items: [
          { kind: 'free' as const, title: 'Hizmet', quantity: 1, unitPrice: 1000, taxRate: 20 },
        ],
        shipping: 0,
        note: '',
        paid: true,
      }
    const rate = executeCommand(state, { type: 'order.create', input })
    expect(rate.result.ok).toBe(false)
    expect(rate.state).toBe(state)
    const total = executeCommand(state, {
      type: 'order.create',
      input: { ...input, expectedExchangeRate: '3612340000', expectedTotal: 999 },
    })
    expect(total.result.ok).toBe(false)
    expect(state.cash).toHaveLength(0)
    expect(state.orders).toHaveLength(0)
  })
  it('writes Paraşüt native currency with the frozen exchange rate and rejects a changed provider rate', async () => {
    const result = create(),
      remote = fulfillmentFixture(),
      order = result.state.orders[0]
    result.state.invoices = [
      {
        id: 'invoice',
        number: 'FT-1',
        orderId: order.id,
        createdAt: order.createdAt,
        status: 'queued',
      },
    ]
    const context: AdapterContext = {
      workspaceId: randomUUID(),
      connectionId: randomUUID(),
      provider: 'parasut',
      credentials: {
        companyId: '123',
        clientId: 'fixture',
        clientSecret: 'fixture',
        email: 'fixture@example.com',
        password: 'fixture',
      },
      settings: defaultIntegrationSettings,
      state: result.state,
      integrationName: 'Test',
    }
    const adapter = new ParasutAdapter(new ProviderHttp(remote.fetcher))
    let payload: Record<string, unknown> = { invoiceId: 'invoice' }
    for (let i = 0; i < 4; i++) {
      const step = await adapter.execute('invoice.create', context, payload)
      if (step.invoice?.externalId) context.state.invoices[0].externalId = step.invoice.externalId
      if (step.nextPayload) payload = step.nextPayload
    }
    const saved = [...remote.state.invoices.values()][0],
      attrs = saved.data.attributes as Record<string, unknown>
    expect(attrs).toMatchObject({ currency: 'USD', exchange_rate: 36.1234 })
    expect(Math.round(Number(attrs.net_total) * 100)).toBe(1204)
    expect((await adapter.execute('invoice.create', context, payload)).invoice?.status).toBe(
      'draft',
    )
    attrs.exchange_rate = 35
    await expect(
      adapter.execute('invoice.status', context, { invoiceId: 'invoice' }),
    ).rejects.toMatchObject({ code: 'INVOICE_TOTAL_MISMATCH' })
  })
  it('invalidates printed status when output content changes and refuses marking a stale print snapshot', () => {
    const result = create(),
      order = result.state.orders[0],
      key = orderPrintKey(order)
    const marked = executeCommand(result.state, {
      type: 'order.print',
      id: order.id,
      printed: true,
      expectedContent: key,
    })
    expect(marked.result.ok).toBe(true)
    expect(filterOrders(marked.state, { printed: true })).toHaveLength(1)
    const next = marked.state
    next.orders[0].shippingAddress!.address = 'Yeni teslimat adresi'
    expect(orderPrinted(next.orders[0])).toBe(false)
    expect(filterOrders(next, { printed: false })).toHaveLength(1)
    expect(
      executeCommand(next, {
        type: 'order.print',
        id: order.id,
        printed: true,
        expectedContent: key,
      }).result.ok,
    ).toBe(false)
  })
  it('keeps color-image associations by stable option IDs through renames and excludes another color’s photos', () => {
    const product: Product = {
      id: 'p',
      name: 'Havlu',
      category: 'Banyo',
      brand: 'Marka',
      description: '',
      taxRate: 20,
      active: true,
      lowStock: 1,
      art: 'towel',
      color: '#ffffff',
      variantAxes: [
        {
          id: 'color',
          name: 'Renk',
          definitionId: 'system-color',
          values: [
            { id: 'w', name: 'Beyaz' },
            { id: 'b', name: 'Siyah' },
          ],
        },
      ],
      variants: [
        {
          id: 'v',
          name: 'Beyaz',
          sku: 'SKU',
          barcode: '',
          price: 1000,
          cost: 500,
          stock: 1,
          options: { color: 'w' },
        },
      ],
      images: [
        'https://example.com/black.jpg',
        'https://example.com/common.jpg',
        'https://example.com/white.jpg',
      ],
      imageMetadata: {
        'https://example.com/black.jpg': { axisId: 'color', valueId: 'b' },
        'https://example.com/white.jpg': { axisId: 'color', valueId: 'w', alt: 'Beyaz havlu' },
      },
    }
    expect(imagesForVariant(product, product.variants[0])).toEqual([
      'https://example.com/white.jpg',
      'https://example.com/common.jpg',
    ])
    product.variantAxes![0].values[0].name = 'Kırık beyaz'
    expect(validateProductStructure(product)).toBeNull()
    product.imageMetadata!['https://example.com/white.jpg'].valueId = 'missing'
    expect(validateProductStructure(product)).toContain('renk ilişkilerini')
  })
})
