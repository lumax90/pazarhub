import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AdapterContext } from '../server/integrations/contracts'
import { ProviderHttp } from '../server/integrations/http'
import { PazaramaAdapter, normalizePazaramaOrder } from '../server/integrations/pazarama'
import {
  ToptanTrAdapter,
  normalizeToptanTrProducts,
  normalizeToptanTrOrder,
} from '../server/integrations/toptantr'
import { PazaramaPublisher } from '../server/publishing/pazarama'
import type { PublicationPlan } from '../server/publishing/types'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { publishConfigSchema } from '../server/publishing/validation'

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
function context(provider: 'pazarama' | 'toptantr'): AdapterContext {
  return {
    provider,
    workspaceId: randomUUID(),
    connectionId: randomUUID(),
    credentials: {
      username: 'fixture-user',
      password: 'fixture-password',
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
    },
    settings: defaultIntegrationSettings,
    integrationName: 'Pazarhub',
    state: createEmptyState('Test'),
  }
}
const pzProduct = {
  name: 'Test ürün',
  displayName: 'Test ürün',
  code: 'BARCODE-1',
  stockCode: 'SKU-1',
  salePrice: 100,
  stockCount: 4,
  vatRate: 20,
  images: [],
}
const ttrProduct = {
  id: 1,
  productCode: '11111111-1111-4111-8111-111111111111',
  title: 'Paketli ürün',
  stock_code: 'PARENT-SKU',
  taxCategory: 20,
  approvalStatusId: 0,
  onSale: true,
  categories: [{ guid: '22222222-2222-4222-8222-222222222222', name: 'Test' }],
  brands: [],
  images: [],
  productAttributeCombinations: [
    {
      id: 101,
      barcode: 'PACK-SKU',
      gtin: '8690000001',
      name: 'Koli',
      stockQuantity: 5,
      overriddenPrice: 120,
      itemPerPackage: 6,
      isActive: 'true',
    },
  ],
}
function addListing(ctx: AdapterContext, extra: Record<string, string | number> = {}) {
  ctx.state.products.push({
    id: 'product',
    name: 'Test',
    category: 'Test',
    brand: 'Test',
    art: 'cup',
    color: '#aabbcc',
    taxRate: 20,
    active: true,
    lowStock: 1,
    description: '',
    variants: [
      {
        id: 'variant',
        name: 'Standart',
        sku: 'SKU-1',
        barcode: 'BARCODE-1',
        price: 10000,
        cost: 5000,
        stock: 4,
      },
    ],
  })
  ctx.state.listings.push({
    id: 'listing',
    productId: 'product',
    variantId: 'variant',
    storeId: ctx.connectionId,
    channel: ctx.provider as 'pazarama' | 'toptantr',
    status: 'active',
    desiredStatus: 'active',
    updatedAt: new Date().toISOString(),
    externalId: ctx.provider === 'pazarama' ? 'BARCODE-1' : '101',
    externalSku: ctx.provider === 'pazarama' ? 'SKU-1' : 'PACK-SKU',
    externalBarcode: ctx.provider === 'pazarama' ? 'BARCODE-1' : '8690000001',
    attributes: extra,
  })
}
describe('official Pazarama and ToptanTR contracts', () => {
  it('uses Basic client credentials and the current approved cursor/unapproved page APIs', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/connect/token')
        return json({ access_token: 'pazarama-token', expires_in: 3600 })
      if (url.pathname.endsWith('/approved'))
        return json({
          success: true,
          data: {
            sellerProducts: [pzProduct],
            nextCursor: url.searchParams.has('Cursor') ? null : 'cursor+opaque=',
          },
        })
      if (url.pathname.endsWith('/unapproved'))
        return json({ success: true, data: [], pageIndex: 0, totalPages: 0, hasNextPage: false })
      throw new Error(url.pathname)
    })
    const adapter = new PazaramaAdapter(new ProviderHttp(fetcher)),
      ctx = context('pazarama')
    const first = await adapter.execute('catalog.pull', ctx, {})
    expect(first.nextPayload?.cursor).toBe('cursor+opaque=')
    const second = await adapter.execute('catalog.pull', ctx, first.nextPayload!)
    expect(second.nextPayload).toMatchObject({ phase: 'unapproved', page: 0 })
    await adapter.execute('catalog.pull', ctx, second.nextPayload!)
    const tokenRequest = fetcher.mock.calls[0][1]!
    expect(tokenRequest.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`,
    })
    expect(new URLSearchParams(String(tokenRequest.body)).get('scope')).toBe(
      'merchantgatewayapi.fullaccess',
    )
    expect(String(tokenRequest.body)).not.toContain('fixture-secret')
    expect(fetcher.mock.calls.filter(([u]) => String(u).includes('/connect/token'))).toHaveLength(1)
  })
  it('does not call a Pazarama price marked for approval successful even when its inner status is zero', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/connect/token') return json({ access_token: 'token', expires_in: 3600 })
      if (path.includes('stock-batch'))
        return json({
          success: true,
          data: {
            data: [{ code: 'BARCODE-1', operationStatusText: 'Başarılı', stock: { status: 0 } }],
          },
        })
      if (path.includes('price-batch'))
        return json({
          success: true,
          data: {
            data: [
              {
                code: 'BARCODE-1',
                operationStatusText: 'Onaya gönderildi',
                price: { status: 0, operationDetail: 'Ürün fiyat onayına gönderildi' },
              },
            ],
          },
        })
      throw new Error(path)
    })
    const ctx = context('pazarama')
    addListing(ctx)
    await expect(
      new PazaramaAdapter(new ProviderHttp(fetcher)).execute('inventory.push', ctx, {
        listingId: 'listing',
        stockBatch: 'stock-batch',
        priceBatch: 'price-batch',
      }),
    ).rejects.toMatchObject({ code: 'PRICE_APPROVAL_REQUIRED' })
    expect(
      fetcher.mock.calls.every(
        ([url, init]) => init?.method === 'GET' || String(url).includes('/connect/token'),
      ),
    ).toBe(true)
  })
  it('preserves Pazarama money envelopes and places mixed-state orders on reconciliation hold', () => {
    const order = normalizePazaramaOrder({
      orderId: randomUUID(),
      orderNumber: 123,
      orderDate: '2026-10-23 12:30',
      currency: 'TL',
      orderAmount: 90.01,
      shipmentAmount: 0,
      shipmentAddress: {},
      billingAddress: {},
      items: [
        {
          orderItemId: randomUUID(),
          orderItemStatus: 3,
          quantity: 2,
          salePrice: { valueInt: 3000, value: 30 },
          totalPrice: { valueInt: 6000, value: 60 },
          product: { code: 'A', stockCode: 'A', name: 'Bir' },
        },
        {
          orderItemId: randomUUID(),
          orderItemStatus: 6,
          quantity: 1,
          salePrice: { valueInt: 3001, value: 30.01 },
          totalPrice: { valueInt: 3001, value: 30.01 },
          product: { code: 'B', stockCode: 'B', name: 'İki' },
        },
      ],
    })
    expect(order.createdAt).toBe('2026-10-23T09:30:00.000Z')
    expect(order.total).toBe(9001)
    expect(order.requiresReconciliation).toBeTruthy()
    expect(order.normalizedStatus).toBe('pending')
  })
  it('accepts verified GUID metadata and treats Pazarama single-product zero batch as catalogue monitoring', async () => {
    const categoryId = randomUUID(),
      brandId = randomUUID(),
      attributeId = randomUUID(),
      valueId = randomUUID()
    expect(
      publishConfigSchema.safeParse({
        categoryId,
        brandId,
        attributes: { [attributeId]: { valueIds: [valueId] } },
      }).success,
    ).toBe(true)
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/connect/token') return json({ access_token: 'token', expires_in: 3600 })
      if (path.endsWith('/approved'))
        return json({ success: true, data: { sellerProducts: [pzProduct], nextCursor: null } })
      throw new Error(path)
    })
    const plan: PublicationPlan = {
      listingId: 'listing',
      productId: 'product',
      provider: 'pazarama',
      version: 1,
      snapshotHash: 'x',
      title: 'Test',
      description: '',
      images: [],
      sku: 'SKU-1',
      barcode: 'BARCODE-1',
      price: 10000,
      quantity: 4,
      config: { attributes: {} },
      body: {},
      attributes: [],
    }
    const result = await new PazaramaPublisher(new ProviderHttp(fetcher)).inspect(
      context('pazarama'),
      plan,
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result.state.phase).toBe('live')
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('getProductBatchResult'))).toBe(
      false,
    )
  })
  it('uses the ToptanTR JSON token body and renews a rejected cached token once', async () => {
    let tokens = 0,
      reads = 0
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/token')
        ? json({
            access_token: `token-${++tokens}`,
            token_type: 'Bearer',
            expires_at_utc: new Date(Date.now() + 3600000).toISOString(),
          })
        : ++reads === 1
          ? json({ success: false, msg: 'Unauthorized' }, 401)
          : json({ content: [], page: 0, totalPages: 0 }),
    )
    const ctx = context('toptantr')
    ctx.settings = { ...defaultIntegrationSettings, environment: 'sandbox' }
    const result = await new ToptanTrAdapter(new ProviderHttp(fetcher)).execute('test', ctx, {})
    expect(result.message).toContain('doğrulandı')
    expect(tokens).toBe(2)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://test.toptantr.com/sapi/v1/token')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      username: 'fixture-user',
      password: 'fixture-password',
    })
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toHaveProperty('productSearch')
  })
  it('honours a server that clamps page zero to page one without skipping its last page', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/token')) return json({ access_token: 'token', expires_in: 3600 })
      const page = Math.max(1, JSON.parse(String(init?.body)).productSearch.page)
      return json({
        content: [
          {
            ...ttrProduct,
            id: page,
            productAttributeCombinations: [
              { ...ttrProduct.productAttributeCombinations[0], id: 100 + page },
            ],
          },
        ],
        page,
        totalPages: 2,
      })
    })
    const adapter = new ToptanTrAdapter(new ProviderHttp(fetcher)),
      ctx = context('toptantr')
    const first = await adapter.execute('catalog.pull', ctx, {})
    expect(first.nextPayload).toMatchObject({ page: 2, pageBase: 1 })
    const last = await adapter.execute('catalog.pull', ctx, first.nextPayload!)
    expect(last.products?.[0].externalId).toBe('102')
    expect(last.nextPayload).toBeUndefined()
  })
  it('uses combination SKU separately from GTIN and keeps order quantities in variation units', () => {
    const product = normalizeToptanTrProducts(ttrProduct)[0]
    expect(product.sku).toBe('PACK-SKU')
    expect(product.barcode).toBe('8690000001')
    expect(product.quantity).toBe(5)
    expect(product.attributes?.itemPerPackage).toBe(6)
    const order = normalizeToptanTrOrder({
      id: 10,
      currencyCode: 'TRY',
      orderDate: '2026-10-23T09:30:00Z',
      orderStatusId: 20,
      shippingStatusId: 20,
      paymentStatusId: 30,
      orderTotal: 1500,
      orderShippingInclTax: 0,
      shipmentAddress: {},
      invoiceAddress: {},
      orderItems: [
        {
          id: 20,
          sku: 'PACK-SKU',
          itemPerPackage: 6,
          quantity: 12,
          unitPriceInclTax: 125,
          priceInclTax: 1500,
        },
      ],
    })
    expect(order.lines[0].quantity).toBe(12)
    expect(order.lines[0].total).toBe(150000)
    expect(order.requiresReconciliation).toBeUndefined()
  })
  it('rejects ToptanTR business failures returned with HTTP 200', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/token')
        ? json({ access_token: 'token', expires_in: 3600 })
        : json({ success: false, msg: 'Bu işlem için izin yok.' }),
    )
    await expect(
      new ToptanTrAdapter(new ProviderHttp(fetcher)).execute(
        'catalog.pull',
        context('toptantr'),
        {},
      ),
    ).rejects.toMatchObject({ code: 'TOPTANTR_REJECTED' })
  })
  it('sends stock and total package price under the product wrapper, then checks the batch and remote values', async () => {
    let written = false
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/token')) return json({ access_token: 'token', expires_in: 3600 })
      if (path.endsWith('/products/search'))
        return json({
          page: 0,
          totalPages: 1,
          content: [
            {
              ...ttrProduct,
              productAttributeCombinations: [
                {
                  ...ttrProduct.productAttributeCombinations[0],
                  stockQuantity: written ? 4 : 5,
                  overriddenPrice: written ? 100 : 120,
                },
              ],
            },
          ],
        })
      if (path.endsWith('/combinations')) {
        written = true
        return json({ batchRequestId: 'batch-1' })
      }
      if (path.endsWith('/jobs')) return json({ result: [{ success: true, msg: 'Updated' }] })
      throw new Error(path)
    })
    const ctx = context('toptantr')
    addListing(ctx, { productCode: ttrProduct.productCode, itemPerPackage: 6 })
    const adapter = new ToptanTrAdapter(new ProviderHttp(fetcher)),
      first = await adapter.execute('inventory.push', ctx, { listingId: 'listing' })
    const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/combinations'))!
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      product: {
        combinations: [
          { id: 101, barcode: 'PACK-SKU', quantity: 4, originalPrice: 100, sellingPrice: 100 },
        ],
      },
    })
    const done = await adapter.execute('inventory.push', ctx, first.nextPayload!)
    expect(done.nextPayload).toBeUndefined()
    expect(done.message).toContain('doğrulandı')
  })
  it('keeps shared Adet/Paket/Koli stocks out of independent variant updates', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/token')) return json({ access_token: 'token', expires_in: 3600 })
      if (path.endsWith('/products/search'))
        return json({
          page: 0,
          totalPages: 1,
          content: [
            {
              ...ttrProduct,
              productAttributeCombinations: [
                ...ttrProduct.productAttributeCombinations,
                { ...ttrProduct.productAttributeCombinations[0], id: 102, itemPerPackage: 12 },
              ],
            },
          ],
        })
      if (path.endsWith('/attributes'))
        return json({ data: { combinationAttributes: [{ id: 1, name: 'Seçenekler' }] } })
      throw new Error(path)
    })
    const ctx = context('toptantr')
    addListing(ctx, { productCode: ttrProduct.productCode, itemPerPackage: 6 })
    await expect(
      new ToptanTrAdapter(new ProviderHttp(fetcher)).execute('inventory.push', ctx, {
        listingId: 'listing',
      }),
    ).rejects.toMatchObject({ code: 'SHARED_PACKAGE_STOCK' })
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/combinations'))).toBe(false)
  })
  it('detects shared package stock from the product axes even when the category also supports colour', async () => {
    const variant = {
      ...ttrProduct.productAttributeCombinations[0],
      attributesXml:
        '<Attributes><ProductAttribute ID="1"><ProductAttributeValue><Value>10</Value></ProductAttributeValue></ProductAttribute></Attributes>',
    }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/token')) return json({ access_token: 'token', expires_in: 3600 })
      if (path.endsWith('/products/search'))
        return json({
          page: 0,
          totalPages: 1,
          content: [
            {
              ...ttrProduct,
              productAttributeCombinations: [variant, { ...variant, id: 102, itemPerPackage: 12 }],
            },
          ],
        })
      if (path.endsWith('/attributes'))
        return json({
          data: {
            combinationAttributes: [
              { id: 1, name: 'Seçenekler' },
              { id: 2, name: 'Renk' },
            ],
          },
        })
      throw new Error(path)
    })
    const ctx = context('toptantr')
    addListing(ctx, { productCode: ttrProduct.productCode, itemPerPackage: 6 })
    await expect(
      new ToptanTrAdapter(new ProviderHttp(fetcher)).execute('inventory.push', ctx, {
        listingId: 'listing',
      }),
    ).rejects.toMatchObject({ code: 'SHARED_PACKAGE_STOCK' })
  })
})
