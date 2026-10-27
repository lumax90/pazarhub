import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ProviderHttp } from '../server/integrations/http'
import type { AdapterContext } from '../server/integrations/contracts'
import { AMAZON_TR } from '../server/integrations/amazon'
import { N11Publisher } from '../server/publishing/n11'
import { AmazonPublisher } from '../server/publishing/amazon'
import { CiceksepetiPublisher } from '../server/publishing/ciceksepeti'
import type { PreparedListing, PublicationPlan } from '../server/publishing/types'
import type { PublishingProvider } from '../src/domain/publishing'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function context(provider: PublishingProvider): AdapterContext {
  return {
    workspaceId: randomUUID(),
    connectionId: randomUUID(),
    provider,
    credentials: {
      sellerId: '123',
      appKey: 'test-app-key',
      appSecret: 'test-app-secret',
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
      refreshToken: 'test-token',
      clientId: 'test-client',
      clientSecret: 'test-client-secret',
    },
    settings: defaultIntegrationSettings,
    integrationName: 'Pazarhub',
    state: createEmptyState('Test'),
  }
}
function item(provider: PublishingProvider): PreparedListing {
  const variant = {
    id: 'variant-1',
    name: 'Beyaz',
    sku: 'SKU-BEYAZ',
    barcode: '8690000001',
    price: 12345,
    cost: 7000,
    stock: 4,
  }
  const product = {
    id: 'product-1',
    name: 'Seramik kupa',
    category: 'Mutfak',
    brand: 'Test',
    description: 'Günlük kullanıma uygun beyaz seramik kupa.',
    art: 'cup' as const,
    color: '#aabbcc',
    taxRate: 20,
    active: true,
    lowStock: 1,
    variants: [variant],
  }
  return {
    variant,
    product,
    listing: {
      id: 'listing-1',
      productId: product.id,
      variantId: variant.id,
      storeId: 'store-1',
      channel: provider,
      status: 'pending',
      updatedAt: new Date().toISOString(),
    },
    config: {
      attributes: {},
      categoryId: '10',
      shipmentTemplate: 'Standart',
      preparingDay: 3,
      deliveryType: 2,
      deliveryMessageType: 5,
      asin: 'B012345678',
    },
    title: product.name,
    description: product.description,
    images: ['https://example.com/cup.jpg'],
    price: 12345,
    quantity: 4,
  }
}
function plan(
  provider: PublishingProvider,
  prepared: PreparedListing,
  body: Record<string, unknown> = {},
): PublicationPlan {
  return {
    listingId: prepared.listing.id,
    productId: prepared.product.id,
    provider,
    version: 1,
    snapshotHash: 'fixture',
    title: prepared.title,
    description: prepared.description,
    images: prepared.images,
    sku: prepared.variant.sku,
    barcode: prepared.variant.barcode,
    price: prepared.price,
    quantity: prepared.quantity,
    config: prepared.config,
    body,
    attributes: [],
  }
}

describe('publication provider acceptance boundaries', () => {
  it('uses n11 CDN metadata and waits for catalogue approval after a successful task row', async () => {
    let active = false
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.includes('/cdn/category/'))
        return json({
          id: 10,
          name: 'Mutfak',
          categoryAttributes: [
            {
              attributeId: 1,
              attributeName: 'Marka',
              isMandatory: true,
              isVariant: false,
              isSlicer: false,
              isCustomValue: true,
              attributeValues: [{ id: 11, value: 'Test' }],
            },
          ],
        })
      if (path.includes('/task-details/'))
        return json({
          status: 'PROCESSED',
          skus: { content: [{ itemCode: 'SKU-BEYAZ', status: 'SUCCESS' }] },
        })
      if (path.endsWith('/product-query'))
        return json({
          content: [
            {
              stockCode: 'SKU-BEYAZ',
              n11ProductId: 9001,
              barcode: '8690000001',
              status: active ? 'Active' : 'CatalogApproval',
            },
          ],
        })
      throw new Error(path)
    })
    const publisher = new N11Publisher(new ProviderHttp(fetcher)),
      ctx = context('n11'),
      prepared = item('n11')
    const metadata = await publisher.metadata(ctx, { resource: 'attributes', categoryId: '10' })
    expect(metadata.schema?.attributes[0]).toMatchObject({
      required: true,
      allowCustom: true,
      values: [{ id: '11', name: 'Test' }],
    })
    prepared.config.attributes = { '1': { customValue: 'Test' } }
    const body = publisher.build(ctx, prepared, metadata.schema!)
    expect(body).toMatchObject({
      payload: {
        integrator: 'Pazarhub',
        skus: [
          {
            stockCode: 'SKU-BEYAZ',
            salePrice: 123.45,
            preparingDay: 3,
            shipmentTemplate: 'Standart',
            attributes: [{ id: 1, customValue: 'Test' }],
          },
        ],
      },
    })
    const preparedPlan = plan('n11', prepared, body)
    expect((await publisher.inspect(ctx, preparedPlan, '1092')).state.phase).toBe('review')
    active = true
    expect((await publisher.inspect(ctx, preparedPlan, '1092', 'approval')).state.phase).toBe(
      'live',
    )
  })
  it('keeps Çiçeksepeti personalization optional and honours the catalogue polling interval', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/attributes'))
        return json({
          categoryId: 10,
          categoryName: 'Hediye',
          categoryAttributes: [
            {
              attributeId: 147,
              attributeName: 'Renk',
              required: true,
              varianter: true,
              type: 'Variant Özelliği',
              attributeValues: [{ id: 11, name: 'Beyaz' }],
            },
            {
              attributeId: 99,
              attributeName: 'İsim',
              required: true,
              varianter: false,
              type: 'Kişiselleştirilebilir Özellik',
              attributeValues: [],
            },
          ],
        })
      if (path.includes('/batch-status/'))
        return json({ items: [{ status: 'Success', data: { stockCode: 'SKU-BEYAZ' } }] })
      if (path.endsWith('/Products'))
        return json({
          products: [
            {
              stockCode: 'SKU-BEYAZ',
              productCode: 'mp123',
              barcode: '8690000001',
              productStatusType: 'Yayında',
            },
          ],
        })
      throw new Error(path)
    })
    const publisher = new CiceksepetiPublisher(new ProviderHttp(fetcher)),
      ctx = context('ciceksepeti'),
      prepared = item('ciceksepeti')
    const metadata = await publisher.metadata(ctx, { resource: 'attributes', categoryId: '10' })
    expect(metadata.schema?.attributes[1]).toMatchObject({ personalization: true, required: false })
    prepared.config.attributes = { '147': { valueIds: ['11'] }, '99': { textLength: 30 } }
    const body = publisher.build(ctx, prepared, metadata.schema!)
    expect(body).toMatchObject({
      products: [
        {
          salesPrice: 123.45,
          deliveryType: 2,
          attributes: expect.arrayContaining([
            { id: 147, valueId: 11 },
            { id: 99, textLength: 30 },
          ]),
        },
      ],
    })
    const result = await publisher.inspect(ctx, plan('ciceksepeti', prepared, body), 'batch-1')
    expect(result.state.phase).toBe('review')
    expect(result.pollAfterSeconds).toBeGreaterThanOrEqual(600)
    const confirmed = await publisher.inspect(
      ctx,
      plan('ciceksepeti', prepared, body),
      'batch-1',
      'approval',
    )
    expect(confirmed.state.phase).toBe('live')
    expect(confirmed.externalId).toBe('mp123')
  })
  it('never marks an Amazon offer live without the exact Türkiye ASIN identity', async () => {
    let asin: string | undefined
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/auth/o2/token')
        ? json({ access_token: 'test-lwa-token', expires_in: 3600 })
        : json({
            sku: 'SKU-BEYAZ',
            summaries: [{ marketplaceId: AMAZON_TR, asin, status: ['BUYABLE'] }],
            issues: [],
          }),
    )
    const publisher = new AmazonPublisher(new ProviderHttp(fetcher)),
      ctx = context('amazon'),
      prepared = item('amazon'),
      preparedPlan = plan('amazon', prepared)
    const missing = await publisher.inspect(ctx, preparedPlan, 'submission-1')
    expect(missing.state.phase).toBe('review')
    expect(missing.externalId).toBeUndefined()
    asin = 'B999999999'
    await expect(publisher.inspect(ctx, preparedPlan, 'submission-1')).rejects.toMatchObject({
      code: 'ASIN_MISMATCH',
    })
    asin = prepared.config.asin
    expect((await publisher.inspect(ctx, preparedPlan, 'submission-1')).state.phase).toBe('live')
  })
  it('keeps malformed successful Amazon submission responses uncertain', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) =>
      String(input).includes('/auth/o2/token')
        ? json({ access_token: 'token', expires_in: 3600 })
        : init?.method === 'PUT'
          ? json({ submissionId: 'submission-1' })
          : json({}, 404),
    )
    const publisher = new AmazonPublisher(new ProviderHttp(fetcher)),
      ctx = context('amazon'),
      prepared = item('amazon')
    await expect(
      publisher.submit(ctx, plan('amazon', prepared, publisher.build(ctx, prepared, null))),
    ).rejects.toMatchObject({ uncertain: true })
  })
  it('represents a zero-stock Amazon offer as listed rather than falsely buyable', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/auth/o2/token')
        ? json({ access_token: 'token', expires_in: 3600 })
        : json({
            sku: 'SKU-BEYAZ',
            summaries: [{ marketplaceId: AMAZON_TR, asin: 'B012345678', status: ['DISCOVERABLE'] }],
            issues: [],
          }),
    )
    const publisher = new AmazonPublisher(new ProviderHttp(fetcher)),
      ctx = context('amazon'),
      prepared = item('amazon')
    prepared.quantity = 0
    const result = await publisher.inspect(ctx, plan('amazon', prepared), 'submission-1')
    expect(result.state.phase).toBe('listed')
    expect(result.again).toBeUndefined()
  })
})
