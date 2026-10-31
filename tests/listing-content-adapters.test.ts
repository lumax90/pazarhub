import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AdapterContext } from '../server/integrations/contracts'
import { ProviderHttp } from '../server/integrations/http'
import { ListingContentAdapter } from '../server/listing-content/adapters'
import type { ContentPlan, ContentSource } from '../server/listing-content/contracts'
import type { Listing } from '../src/domain/types'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { pttavmFixture } from './pttavm-fixture'

const context = (provider: AdapterContext['provider']): AdapterContext => ({
  provider,
  connectionId: randomUUID(),
  workspaceId: randomUUID(),
  credentials: {
    apiKey: 'fixture',
    accessToken: 'fixture',
    sellerId: '123',
    username: 'fixture',
    password: 'fixture',
    merchantId: '11111111-1111-4111-8111-111111111111',
    appKey: 'fixture',
    appSecret: 'fixture',
  },
  settings: defaultIntegrationSettings,
  state: createEmptyState('Content'),
  integrationName: 'Test',
  hepsiburadaIntegrator: 'fixture',
})
const listing = (channel: Listing['channel'], externalId: string): Listing => ({
  id: 'listing',
  productId: 'p',
  variantId: 'v',
  storeId: 'store',
  channel,
  externalId,
  externalSku: 'SKU',
  externalBarcode: 'BAR',
  status: 'active',
  updatedAt: '',
})
const plan = (
  ctx: AdapterContext,
  source: ContentSource,
  changes: ContentPlan['changes'],
): ContentPlan => ({
  listingId: 'listing',
  provider: ctx.provider as Listing['channel'],
  localKey: 'key',
  source,
  changes,
  createdAt: '2026-10-24T10:00:00Z',
})
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('provider content-update contracts', () => {
  it('sends an HB ticket file with only selected fields and recognizes partial field rejection', async () => {
    const ctx = context('hepsiburada'),
      item = listing('hepsiburada', 'HB1:SKU')
    let partial = false,
      uploaded: unknown
    const adapter = new ListingContentAdapter(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.includes('all-products-of-merchant'))
          return json({
            success: true,
            data: [
              {
                hbSku: 'HB1',
                merchantSku: 'SKU',
                barcode: 'BAR',
                productName: 'Eski',
                productDescription: 'Açıklama',
                images: [],
              },
            ],
          })
        if (path.endsWith('/import')) {
          const file = (init?.body as FormData).get('file') as Blob
          uploaded = JSON.parse(await file.text())
          return json({ success: true, data: { trackingId: 'ticket' } })
        }
        return json({
          success: true,
          data: [
            {
              merchantId: ctx.credentials.merchantId,
              items: [
                {
                  hbSku: 'HB1',
                  productStatus: 'COMPLETED',
                  updateResults: [
                    {
                      fieldName: 'NAME',
                      fieldResult: partial ? 'PARTIAL_APPROVED' : 'APPROVED',
                      rejectReason: partial ? 'Başlık kısmen kabul edildi.' : undefined,
                    },
                  ],
                },
              ],
            },
          ],
        })
      }),
    )
    const saved = plan(ctx, await adapter.read(ctx, item), { title: 'Yeni Başlık' })
    expect(await adapter.send(ctx, saved)).toBe('ticket')
    expect(uploaded).toEqual({
      merchantId: ctx.credentials.merchantId,
      items: [{ hbSku: 'HB1', productName: 'Yeni Başlık' }],
    })
    expect((await adapter.inspect(ctx, item, saved, 'ticket'))?.state).toBe('applied')
    partial = true
    expect((await adapter.inspect(ctx, item, saved, 'ticket'))?.state).toBe('rejected')
  })
  it('updates n11 descriptions without sending catalog title, image, price or stock fields', async () => {
    const ctx = context('n11'),
      item = listing('n11', '101')
    let sent: unknown
    const adapter = new ListingContentAdapter(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/product-query'))
          return json({
            content: [
              {
                n11ProductId: 101,
                stockCode: 'SKU',
                title: 'İsim',
                description: 'Eski',
                images: [],
              },
            ],
          })
        if (path.endsWith('/product-update')) {
          sent = JSON.parse(String(init?.body))
          return json({ id: 20, status: 'IN_QUEUE' })
        }
        return json({
          status: 'PROCESSED',
          skus: { content: [{ itemCode: 'SKU', status: 'SUCCESS' }] },
        })
      }),
    )
    const saved = plan(ctx, await adapter.read(ctx, item), { description: 'Yeni açıklama' })
    await adapter.send(ctx, saved)
    expect(sent).toEqual({
      payload: { integrator: 'Test', skus: [{ stockCode: 'SKU', description: 'Yeni açıklama' }] },
    })
    expect((await adapter.inspect(ctx, item, saved, '20'))?.state).toBe('applied')
  })
  it('preserves Ciceksepeti operator and safety information, and blocks an incomplete read-back', async () => {
    const ctx = context('ciceksepeti'),
      item = listing('ciceksepeti', '101')
    let incomplete = false,
      sent: Record<string, unknown> | undefined
    const raw = {
      productCode: 101,
      stockCode: 'SKU',
      mainProductCode: 'MAIN',
      productName: 'Eski',
      description: 'En az otuz karakterli eski ürün açıklaması.',
      images: ['https://example.com/old.jpg'],
      isActive: true,
      deliveryType: 2,
      deliveryMessageType: 5,
      attributes: [{ id: 1, valueId: 2 }],
      operatorContacts: [{ type: 1, name: 'Firma', address: 'Adres', email: 'firma@example.com' }],
      safetyInfo: { origin: 'TR', warningDescription: 'Bilgi' },
    }
    const adapter = new ListingContentAdapter(
      new ProviderHttp(async (_url, init) => {
        if (init?.method === 'PUT') {
          sent = JSON.parse(String(init.body)).products[0]
          return json({ batchId: 'cs-batch' })
        }
        return json({
          products: [
            incomplete ? { ...raw, operatorContacts: undefined, safetyInfo: undefined } : raw,
          ],
        })
      }),
    )
    const saved = plan(ctx, await adapter.read(ctx, item), { title: 'Yeni Ürün' })
    await adapter.send(ctx, saved)
    expect(sent).toMatchObject({
      productName: 'Yeni Ürün',
      operatorContacts: raw.operatorContacts,
      safetyInfo: raw.safetyInfo,
      attributes: raw.attributes,
      isActive: true,
    })
    expect(sent).not.toHaveProperty('stockQuantity')
    expect(sent).not.toHaveProperty('salesPrice')
    incomplete = true
    await expect(adapter.read(ctx, item)).rejects.toMatchObject({
      code: 'FULL_PRODUCT_DETAILS_REQUIRED',
    })
  })
  it('preserves every PttAVM variant identity without overwriting quantities or price differences', async () => {
    const ctx = context('pttavm'),
      item = listing('pttavm', '1:SKU'),
      fixture = pttavmFixture()
    item.attributes = {
      pttParentSku: 'PARENT',
      pttAttributes: JSON.stringify([{ definition: 'Renk', value: 'Beyaz' }]),
    }
    item.storeId = ctx.connectionId
    ctx.state.listings = [item]
    fixture.state.products.set('PARENT', {
      urunId: 1,
      barkod: 'PARENT',
      urunAdi: 'Eski',
      uzunAciklama: 'Eski açıklama',
      miktar: 5,
      kdVli: 120,
      kdvOran: 20,
      aktif: true,
      resimListesi: [{ url: 'https://example.com/old.jpg' }],
      variantListesi: [
        { variantBarkod: 'SKU', variant1Deger: 'Beyaz', miktar: 5, fiyat: 20, fiyatFarkiMi: true },
      ],
    })
    const adapter = new ListingContentAdapter(new ProviderHttp(fixture.fetcher)),
      saved = plan(ctx, await adapter.read(ctx, item), { title: 'Yeni Ürün' })
    const reference = await adapter.send(ctx, saved)
    expect(fixture.state.writes[0].body).toEqual({
      items: [
        {
          barcode: 'PARENT',
          name: 'Yeni Ürün',
          variants: [
            { variantBarcode: 'SKU', attributes: [{ definition: 'Renk', value: 'Beyaz' }] },
          ],
        },
      ],
    })
    expect((await adapter.inspect(ctx, item, saved, reference))?.state).toBe('applied')
    expect(fixture.state.products.get('PARENT')?.variantListesi).toMatchObject([
      { miktar: 5, fiyat: 20 },
    ])
  })
  it('updates ToptanTR parent content without submitting or recreating its combinations', async () => {
    const ctx = context('toptantr'),
      item = listing('toptantr', '101'),
      raw = {
        productCode: '11111111-1111-4111-8111-111111111111',
        stock_code: 'PARENT',
        title: 'Eski',
        fullDescription: 'Açıklama',
        images: [],
        approvalStatusId: 0,
        productAttributeCombinations: [
          { id: 101, barcode: 'SKU', gtin: 'BAR', stockQuantity: 5, overriddenPrice: 120 },
        ],
      }
    let sent: Record<string, unknown> | undefined
    const adapter = new ListingContentAdapter(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/token')) return json({ access_token: 'token', expires_in: 3600 })
        if (path.endsWith('/products/search'))
          return json({ content: [raw], page: 0, totalPages: 1 })
        sent = JSON.parse(String(init?.body)).product
        Object.assign(raw, sent)
        return json({ content: [raw] })
      }),
    )
    const saved = plan(ctx, await adapter.read(ctx, item), { title: 'Yeni Başlık' }),
      reference = await adapter.send(ctx, saved)
    expect(sent).toEqual({
      productCode: raw.productCode,
      stock_code: 'PARENT',
      title: 'Yeni Başlık',
    })
    expect((await adapter.inspect(ctx, item, saved, reference))?.state).toBe('applied')
    expect(raw.productAttributeCombinations[0].stockQuantity).toBe(5)
  })
})
