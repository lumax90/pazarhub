import { describe, expect, it } from 'vitest'
import { HepsiburadaPublisher } from '../server/publishing/hepsiburada'
import { ProviderHttp } from '../server/integrations/http'
import type { AdapterContext } from '../server/integrations/contracts'
import type { PreparedListing, PublicationPlan } from '../server/publishing/types'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { createEmptyState } from '../src/domain/empty-state'
import { catalogParts } from './catalog-workspace-fixture'

function fixture() {
  const state = {
    created: false,
    lost: false,
    rejected: false,
    wrongBarcode: false,
    requests: [] as { url: string; method: string }[],
    uploaded: undefined as unknown,
  }
  const product = catalogParts()[0]
  product.variants = [{ ...product.variants[0], sku: 'HB-TEST', barcode: '8691234567890' }]
  const context: AdapterContext = {
    state: createEmptyState('HB'),
    workspaceId: 'workspace',
    connectionId: 'store',
    provider: 'hepsiburada',
    credentials: {
      merchantId: '11111111-1111-4111-8111-111111111111',
      password: 'fixture-secret',
    },
    settings: { ...defaultIntegrationSettings, environment: 'sandbox' },
    integrationName: 'Pazarhub',
    hepsiburadaIntegrator: 'test-integrator',
  }
  const item: PreparedListing = {
    product,
    variant: product.variants[0],
    listing: {
      id: 'listing',
      productId: product.id,
      variantId: product.variants[0].id,
      channel: 'hepsiburada',
      storeId: 'store',
      status: 'pending',
      updatedAt: '',
    },
    config: {
      categoryId: '10',
      productMainId: 'GROUP-1',
      attributes: { renk_variant_property: { valueIds: ['red'], labels: ['Kırmızı'] } },
    },
    title: product.name,
    description: 'Açıklama',
    images: ['https://example.com/image.jpg'],
    price: 24375,
    quantity: 3,
  }
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url),
      path = new URL(address).pathname
    state.requests.push({ url: address, method: init?.method ?? 'GET' })
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    if (path.endsWith('get-all-categories'))
      return json({
        success: true,
        data: [
          {
            categoryId: 10,
            name: 'Banyo',
            paths: ['Ev', 'Banyo'],
            leaf: true,
            available: true,
            status: 'ACTIVE',
          },
        ],
        last: true,
      })
    if (path.endsWith('/attributes'))
      return json({
        success: true,
        data: {
          baseAttributes: [{ id: 'UrunAdi', name: 'Ürün adı', type: 'String', mandatory: true }],
          attributes: [],
          variantAttributes: [
            {
              id: 'renk_variant_property',
              name: 'Renk',
              mandatory: true,
              type: 'Enum',
              multiValue: false,
            },
          ],
        },
      })
    if (path.endsWith('/values'))
      return json({ success: true, data: [{ id: 'red', value: 'Kırmızı' }], last: true })
    if (path.includes('all-products-of-merchant'))
      return json({
        success: true,
        data: state.created
          ? [
              {
                merchantSku: 'HB-TEST',
                barcode: state.wrongBarcode ? '0000000000000' : '8691234567890',
                hbSku: 'HB0001',
                status: 'CREATED',
              },
            ]
          : [],
        last: true,
      })
    if (path.endsWith('/import')) {
      expect(init?.body).toBeInstanceOf(FormData)
      const file = (init!.body as FormData).get('file') as Blob
      state.uploaded = JSON.parse(await file.text())
      state.created = true
      if (state.lost) throw new Error('Response lost after acceptance')
      return json({ success: true, data: { trackingId: 'TRACE-1' } })
    }
    if (path.includes('/status/'))
      return json({
        success: true,
        data: [
          {
            merchantSku: 'HB-TEST',
            barcode: '8691234567890',
            importStatus: state.rejected ? 'FAILED' : 'SUCCESS',
            productStatus: state.rejected ? 'MISSING_INFO' : 'CREATED',
            validationResults: state.rejected
              ? [{ attributeName: 'Renk', message: 'Geçersiz değer' }]
              : [],
          },
        ],
      })
    if (path.includes('/listings/merchantid/'))
      return json({
        listings: state.created
          ? [
              {
                merchantSku: 'HB-TEST',
                hepsiburadaSku: 'HB0001',
                availableStock: 3,
                price: 243.75,
                isSalable: true,
                isLocked: false,
              },
            ]
          : [],
      })
    throw new Error(`Unexpected fixture request: ${address}`)
  }
  const adapter = new HepsiburadaPublisher(new ProviderHttp(fetcher))
  const plan = (): PublicationPlan => ({
    listingId: item.listing.id,
    productId: product.id,
    provider: 'hepsiburada',
    version: 1,
    snapshotHash: 'hash',
    title: item.title,
    description: item.description,
    images: item.images,
    sku: item.variant.sku,
    barcode: item.variant.barcode,
    price: item.price,
    quantity: item.quantity,
    config: item.config,
    body: adapter.build(context, item, {
      id: '10',
      name: 'Banyo',
      attributes: [
        {
          id: 'renk_variant_property',
          name: 'Renk',
          required: true,
          variant: true,
          slicer: false,
          allowCustom: false,
          multiple: false,
        },
      ],
    }),
    attributes: [],
  })
  return { adapter, context, item, state, plan }
}
describe('Hepsiburada native publication contract', () => {
  it('loads category-specific textual attribute IDs and filters automatically supplied fields', async () => {
    const { adapter, context } = fixture()
    expect(
      (await adapter.metadata(context, { resource: 'categories' })).options?.[0],
    ).toMatchObject({ id: '10', path: 'Ev / Banyo', leaf: true })
    expect(
      (await adapter.metadata(context, { resource: 'attributes', categoryId: '10' })).schema
        ?.attributes,
    ).toEqual([
      {
        id: 'renk_variant_property',
        name: 'Renk',
        required: true,
        variant: true,
        slicer: false,
        allowCustom: false,
        multiple: false,
      },
    ])
    expect(
      (
        await adapter.metadata(context, {
          resource: 'values',
          categoryId: '10',
          attributeId: 'renk_variant_property',
        })
      ).options,
    ).toEqual([{ id: 'red', name: 'Kırmızı' }])
  })
  it('sends a JSON file with comma prices and verifies both SKU and barcode before declaring live', async () => {
    const f = fixture(),
      plan = f.plan()
    expect(await f.adapter.submit(f.context, plan)).toBe('TRACE-1')
    expect(f.state.uploaded).toMatchObject([
      {
        categoryId: 10,
        attributes: {
          merchantSku: 'HB-TEST',
          VaryantGroupID: 'GROUP-1',
          price: '243,75',
          stock: '3',
          renk_variant_property: 'Kırmızı',
          Image1: 'https://example.com/image.jpg',
        },
      },
    ])
    expect(await f.adapter.inspect(f.context, plan, 'TRACE-1')).toMatchObject({
      externalId: 'HB0001:HB-TEST',
      state: { phase: 'live' },
    })
    f.state.wrongBarcode = true
    expect((await f.adapter.inspect(f.context, plan, '')).externalId).toBeUndefined()
  })
  it('keeps a lost upload response uncertain and reconciles using reads without uploading again', async () => {
    const f = fixture(),
      plan = f.plan()
    f.state.lost = true
    await expect(f.adapter.submit(f.context, plan)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      uncertain: true,
    })
    expect((await f.adapter.inspect(f.context, plan, '')).state.phase).toBe('live')
    expect(f.state.requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })
  it('rejects existing SKU writes and surfaces provider field rejections', async () => {
    const f = fixture(),
      plan = f.plan()
    f.state.created = true
    await expect(f.adapter.submit(f.context, plan)).rejects.toMatchObject({
      code: 'REMOTE_RECORD_EXISTS',
    })
    expect(f.state.requests.every((request) => request.method === 'GET')).toBe(true)
    f.state.rejected = true
    expect((await f.adapter.inspect(f.context, plan, 'TRACE-1')).state).toMatchObject({
      phase: 'rejected',
      errors: [{ field: 'Renk', message: 'Geçersiz değer' }],
    })
  })
})
