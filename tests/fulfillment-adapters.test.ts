import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ProviderHttp } from '../server/integrations/http'
import type { AdapterContext } from '../server/integrations/contracts'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { createEmptyState } from '../src/domain/empty-state'
import type { Order } from '../src/domain/types'
import type { OrderFulfillmentPlan, OrderFulfillmentView } from '../src/domain/order-fulfillment'
import { ToptanTrFulfillment } from '../server/order-fulfillment/toptantr'
import { PttAvmFulfillment } from '../server/order-fulfillment/pttavm'
import { AmazonFulfillment } from '../server/order-fulfillment/amazon'
import { AMAZON_TR } from '../server/integrations/amazon'
import { N11Fulfillment } from '../server/order-fulfillment/n11'
import { CiceksepetiFulfillment } from '../server/order-fulfillment/ciceksepeti'
import { PazaramaFulfillment } from '../server/order-fulfillment/pazarama'

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const order: Order = {
  id: 'local',
  number: 'SP-1',
  externalId: '10',
  externalNumber: 'ORDER-1',
  storeId: 'store',
  channel: 'toptantr',
  customerId: 'c',
  status: 'approved',
  createdAt: '2026-10-24T10:00:00Z',
  dueAt: '2026-10-25T10:00:00Z',
  shipping: 0,
  paid: false,
  note: '',
  lines: [],
  events: [],
  inventoryApplied: true,
}
const context = (provider: AdapterContext['provider']): AdapterContext => ({
  workspaceId: randomUUID(),
  connectionId: randomUUID(),
  provider,
  credentials: {
    username: 'fixture',
    password: 'fixture',
    apiKey: 'fixture',
    accessToken: 'fixture',
    clientId: 'fixture',
    clientSecret: 'fixture',
    refreshToken: 'fixture',
  },
  settings: defaultIntegrationSettings,
  integrationName: 'Test',
  state: createEmptyState('Fulfillment'),
})
const plan = (
  view: OrderFulfillmentView,
  overrides: Partial<OrderFulfillmentPlan> = {},
): OrderFulfillmentPlan => ({
  action: 'pack',
  orderId: 'local',
  externalId: '10',
  orderNumber: 'ORDER-1',
  localKey: 'key',
  remoteKey: view.fingerprint,
  reference: 'PH-REFERENCE',
  lines: view.lines.map((line) => ({ id: line.id, quantity: line.quantity })),
  parcels: 1,
  desi: 1,
  ...overrides,
})

describe('additional marketplace fulfillment contracts', () => {
  it('confirms n11 Picking rows and uses the documented SOAP cancellation reason service while preserving exact line totals', async () => {
    const ctx = context('n11')
    ctx.credentials = { appKey: 'fixture', appSecret: 'fixture' }
    const raw = {
      id: 10,
      orderNumber: 'ORDER-1',
      lastModifiedDate: Date.parse(order.createdAt),
      shipmentPackageStatus: 'Created',
      shippingAddress: {},
      billingAddress: {},
      lines: [
        {
          orderLineId: 20,
          stockCode: 'SKU',
          productName: 'Ürün',
          quantity: 3,
          sellerInvoiceAmount: 100.01,
          vatRate: 20,
          orderItemLineItemStatusName: 'Created',
        },
      ],
    }
    let writes = 0
    const adapter = new N11Fulfillment(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/shipmentPackages')) return json({ content: [raw], totalPages: 1 })
        if (path.endsWith('/order/v1/update')) {
          expect(JSON.parse(String(init?.body))).toEqual({
            lines: [{ lineId: 20 }],
            status: 'Picking',
          })
          raw.shipmentPackageStatus = 'Picking'
          raw.lines[0].orderItemLineItemStatusName = 'Picking'
          writes++
          return json({ content: [{ lineId: 20, status: 'SUCCESS' }] })
        }
        const body = String(init?.body)
        if (body.includes('ClaimCancelPartialReasonTypeRequest'))
          return new Response(
            '<Envelope><Body><ClaimCancelPartialReasonTypeResponse><result><status>success</status></result><cancelReasonTypeDataList><cancelReasonTypeData><id>61</id><value>Stok Tükendi</value></cancelReasonTypeData></cancelReasonTypeDataList></ClaimCancelPartialReasonTypeResponse></Body></Envelope>',
          )
        expect(body).toContain('<cancelQuantity>3</cancelQuantity>')
        raw.shipmentPackageStatus = 'UnSupplied'
        raw.lines[0].orderItemLineItemStatusName = 'UnSupplied'
        writes++
        return new Response(
          '<Envelope><Body><ClaimCancelPartialResponse><result><status>success</status></result></ClaimCancelPartialResponse></Body></Envelope>',
        )
      }),
    )
    const initial = plan(await adapter.load(ctx, order))
    await adapter.execute(ctx, order, initial, false, { plan: initial })
    const prepared = await adapter.execute(ctx, order, initial, true, { plan: initial })
    expect(prepared.orderFulfillment?.confirmed).toBe(true)
    expect(prepared.orders?.[0].total).toBe(10001)
    const cancel = plan(await adapter.load(ctx, order), { action: 'cancel', reasonId: '61' })
    await adapter.execute(ctx, order, cancel, false, { plan: cancel })
    expect(
      (await adapter.execute(ctx, order, cancel, true, { plan: cancel })).orders?.[0]
        .normalizedStatus,
    ).toBe('cancelled')
    expect(writes).toBe(2)
  })
  it('honors the actual Ciceksepeti cargo model and verifies supplier tracking rather than declaring success from the write response', async () => {
    const ctx = context('ciceksepeti')
    ctx.credentials.sellerId = '123'
    const raw = {
      orderItemId: 10,
      orderId: 'ORDER-1',
      orderCreateDate: '24/10/2026',
      orderCreateTime: '10:00',
      orderModifyDate: '24/10/2026',
      orderModifyTime: '10:01',
      quantity: 2,
      invoicePrice: 240,
      cargoPrice: 0,
      tax: 20,
      orderItemStatusId: 1,
      isOrderStatusActive: true,
      cargoModelType: 1,
      partialNumber: '',
      cargoNumber: '',
      shipmentTrackingUrl: '',
      code: 'SKU',
      name: 'Ürün',
    }
    const paths: string[] = []
    const adapter = new CiceksepetiFulfillment(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/GetOrders'))
          return json({ supplierOrderListWithBranch: [raw], orderListCount: 1 })
        paths.push(path)
        if (path.endsWith('/readyforcargowithcsintegration')) {
          raw.orderItemStatusId = 11
          raw.partialNumber = 'CS-PKG'
          return json({
            statusUpdateResponse: [
              { isSuccess: true, orderItems: [{ orderItemId: 10, partialNumber: 'CS-PKG' }] },
            ],
          })
        }
        const item = JSON.parse(String(init?.body)).orderItems[0]
        expect(item.orderItemStatusId).toBe(5)
        expect(item.cargoBusinessId).toBe(43)
        raw.orderItemStatusId = 5
        raw.cargoNumber = item.shipmentNumber
        raw.shipmentTrackingUrl = item.shipmentTrackingUrl
        return json({ statusUpdateResponse: [{ isSuccess: true, orderItemId: 10 }] })
      }),
    )
    const initial = plan(await adapter.load(ctx, order))
    expect(
      (await adapter.execute(ctx, order, initial, false, { plan: initial })).delaySeconds,
    ).toBe(61)
    expect(
      (await adapter.execute(ctx, order, initial, true, { plan: initial })).orderFulfillment
        ?.confirmed,
    ).toBe(true)
    raw.cargoModelType = 2
    ctx.settings = { ...ctx.settings, cargoConnectionId: 'own-cargo' }
    const ship = plan(await adapter.load(ctx, order), {
      action: 'ship',
      carrierId: '43',
      trackingNumber: 'ARAS-1',
      trackingUrl: 'https://example.com/ARAS-1',
    })
    await adapter.execute(ctx, order, ship, false, { plan: ship })
    expect(
      (await adapter.execute(ctx, order, ship, true, { plan: ship })).orders?.[0].normalizedStatus,
    ).toBe('shipped')
    expect(paths).toEqual([
      '/api/v1/Order/readyforcargowithcsintegration',
      '/api/v1/Order/statusupdatewithsupplierintegration',
    ])
  })
  it('keeps Pazarama preparation, package creation and cargo notification separate and verifies returned package membership', async () => {
    const ctx = context('pazarama')
    ctx.credentials.sellerId = '11111111-1111-4111-8111-111111111111'
    const id = '22222222-2222-4222-8222-222222222222',
      lineId = '33333333-3333-4333-8333-333333333333',
      cargoId = '44444444-4444-4444-8444-444444444444',
      local = { ...order, externalId: id, externalNumber: '123456' }
    const raw = {
        orderId: id,
        orderNumber: 123456,
        orderDate: local.createdAt,
        currency: 'TL',
        orderAmount: 120,
        shipmentAmount: 0,
        items: [
          {
            orderItemId: lineId,
            orderItemStatus: 3,
            quantity: 1,
            salePrice: 120,
            totalPrice: 120,
            product: { stockCode: 'SKU', code: 'BARCODE', name: 'Ürün', vatRate: 20 },
            cargo: { companyId: cargoId, companyName: 'Aras', trackingNumber: '' },
          },
        ],
      },
      packages: Record<string, unknown>[] = []
    const writes: string[] = []
    const adapter = new PazaramaFulfillment(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/connect/token'))
          return json({ access_token: 'token', expires_in: 3600 })
        if (path.endsWith('/getOrdersForApi')) return json({ success: true, data: [raw] })
        if (path.includes('/shipment-packages/orderId='))
          return json({ success: true, data: { shipmentPackageDtos: packages } })
        writes.push(path)
        const body = JSON.parse(String(init?.body))
        if (path.endsWith('/bulk-status-update')) {
          raw.items[0].orderItemStatus = body.updateShipmentDto.status
          raw.items[0].cargo.trackingNumber = body.updateShipmentDto.shippingTrackingNumber || ''
          return json({ success: true })
        }
        expect(body.apiOrderItemPackages[0].orderItemIds).toEqual([lineId])
        expect(body.sellerId).toBe(ctx.credentials.sellerId)
        packages.push({
          packageNumber: 'PKG-1',
          packageStatus: '10 - PACKED',
          shipmentNumber: 'PZ-1',
          cargoCompanyName: 'Aras',
          cargoCompanyId: cargoId,
          shipmentOrderItems: [{ orderItemIds: [lineId], quantity: 1 }],
        })
        return json({ success: true })
      }),
    )
    const prepare = plan(await adapter.load(ctx, local), { action: 'prepare', externalId: id })
    await adapter.execute(ctx, local, prepare, false, { plan: prepare })
    expect(
      (await adapter.execute(ctx, local, prepare, true, { plan: prepare })).orderFulfillment
        ?.confirmed,
    ).toBe(true)
    const packed = plan(await adapter.load(ctx, local), { externalId: id, carrierId: cargoId })
    await adapter.execute(ctx, local, packed, false, { plan: packed })
    expect(
      (await adapter.execute(ctx, local, packed, true, { plan: packed })).orderFulfillment
        ?.packages[0].lines,
    ).toEqual([{ id: lineId, quantity: 1 }])
    ctx.settings = { ...ctx.settings, cargoConnectionId: 'own-cargo' }
    const ship = plan(await adapter.load(ctx, local), {
      action: 'ship',
      externalId: id,
      packageId: 'PKG-1',
      carrierId: cargoId,
      trackingNumber: 'ARAS-TRACK',
    })
    await adapter.execute(ctx, local, ship, false, { plan: ship })
    expect(
      (await adapter.execute(ctx, local, ship, true, { plan: ship })).orderFulfillment?.confirmed,
    ).toBe(true)
    expect(writes).toEqual([
      '/order/api/bulk-status-update',
      '/order/api/packages-split',
      '/order/api/bulk-status-update',
    ])
  })
  it('creates ToptanTR multi-parcel shipments with variation counts, reconciles by reference, labels and notifies dispatch', async () => {
    const ctx = context('toptantr'),
      shipments: Record<string, unknown>[] = [],
      writes: string[] = []
    const raw = {
      id: 10,
      customOrderNumber: 'ORDER-1',
      currencyCode: 'TRY',
      orderDate: '2026-10-24T10:00:00Z',
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
          sku: 'PACK',
          barcode: 'PACK',
          quantity: 12,
          itemPerPackage: 6,
          unitPriceInclTax: 125,
          priceInclTax: 1500,
        },
      ],
    }
    const adapter = new ToptanTrFulfillment(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/token')) return json({ access_token: 'token', expires_in: 3600 })
        if (path.endsWith('/orders/search')) return json({ content: [raw], page: 0, totalPages: 1 })
        if (path.endsWith('/shipments/search'))
          return json({ content: shipments, page: 0, totalPages: 1 })
        if (path.endsWith('/cargoes'))
          return json({ cargoes: [{ id: 1, name: 'Yurtiçi', isContracted: true }] })
        if (path.endsWith('/addshipment')) {
          const body = JSON.parse(String(init?.body)).shipment
          expect(body).toMatchObject({
            isToptanTRContract: true,
            shipmentItems: [{ orderItemId: 20, quantityToAdd: 12 }],
            shipmentPackages: [
              { weight: 2, packageTypeId: 14 },
              { weight: 2, packageTypeId: 14 },
            ],
          })
          shipments.push({
            ...body,
            id: 55,
            isShipped: false,
            canShip: true,
            shipmentItems: [{ orderItemId: 20, quantityInThisShipment: 12 }],
            trackingNumber: 'T55',
          })
          writes.push('create')
          throw new Error('Lost create response')
        }
        if (path.endsWith('/shipments/label'))
          return json({
            success: true,
            label: {
              shipmentId: 55,
              orderId: 10,
              format: 'zpl',
              encoding: 'utf8',
              content: '^XA^FD1/2^XZ^XA^FD2/2^XZ',
            },
          })
        if (path.endsWith('/setasshipped/55')) {
          shipments[0].isShipped = true
          shipments[0].canShip = false
          writes.push('ship')
          return json({ success: true })
        }
        throw new Error(path)
      }),
    )
    const initial = plan(await adapter.load(ctx, order), {
      carrierId: '1',
      parcels: 2,
      desi: 4,
      weight: 2,
      width: 20,
      height: 30,
      length: 40,
    })
    await expect(
      adapter.execute(ctx, order, initial, false, { plan: initial }),
    ).rejects.toMatchObject({ uncertain: true })
    expect(
      (await adapter.execute(ctx, order, initial, true, { plan: initial })).orderFulfillment
        ?.confirmed,
    ).toBe(true)
    const labelPlan = plan(await adapter.load(ctx, order), {
      action: 'label',
      packageId: '55',
      lines: [],
    })
    expect(
      (
        await adapter.execute(ctx, order, labelPlan, false, { plan: labelPlan })
      ).orderFulfillment?.labels?.[0].data.match(/\^XA/g),
    ).toHaveLength(2)
    const shipPlan = plan(await adapter.load(ctx, order), {
      action: 'ship',
      packageId: '55',
      lines: [],
    })
    await adapter.execute(ctx, order, shipPlan, false, { plan: shipPlan })
    expect(
      (await adapter.execute(ctx, order, shipPlan, true, { plan: shipPlan })).orderFulfillment
        ?.confirmed,
    ).toBe(true)
    expect(writes).toEqual(['create', 'ship'])
  })
  it('confirms Amazon FBM shipment writes with the 2026 read model and a stable numeric package reference', async () => {
    const ctx = context('amazon'),
      local = { ...order, externalId: '123-1234567-1234567', externalNumber: '123-1234567-1234567' }
    const raw = {
      orderId: local.externalId,
      createdTime: local.createdAt,
      lastUpdatedTime: local.createdAt,
      salesChannel: { marketplaceId: AMAZON_TR },
      fulfillment: { fulfilledBy: 'MERCHANT', fulfillmentStatus: 'UNSHIPPED' },
      proceeds: { grandTotal: { amount: 120, currencyCode: 'TRY' } },
      recipient: { deliveryAddress: {} },
      orderItems: [
        {
          orderItemId: 'line1',
          quantityOrdered: 1,
          product: { sellerSku: 'SKU', title: 'Ürün' },
          proceeds: { proceedsTotal: { amount: 120, currencyCode: 'TRY' } },
        },
      ],
      packages: [] as Record<string, unknown>[],
    }
    let writes = 0
    const adapter = new AmazonFulfillment(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/auth/o2/token'))
          return json({ access_token: 'token', expires_in: 3600 })
        if (path.endsWith('/shipmentConfirmation')) {
          const request = JSON.parse(String(init?.body))
          expect(request).toMatchObject({
            marketplaceId: AMAZON_TR,
            packageDetail: {
              packageReferenceId: '123456',
              carrierCode: 'Other',
              carrierName: 'Aras',
              orderItems: [{ orderItemId: 'line1', quantity: 1 }],
            },
          })
          const p = request.packageDetail
          raw.packages.push({
            packageReferenceId: p.packageReferenceId,
            trackingNumber: p.trackingNumber,
            packageStatus: { status: 'SHIPPED' },
            packageItems: p.orderItems,
          })
          raw.fulfillment.fulfillmentStatus = 'SHIPPED'
          writes++
          throw new Error('Lost response')
        }
        return json({ order: raw })
      }),
    )
    const initial = plan(await adapter.load(ctx, local), {
      action: 'ship',
      externalId: local.externalId,
      reference: '123456',
      trackingNumber: 'TRACK',
      carrierName: 'Aras',
      shippedAt: '2026-10-24T12:00:00Z',
    })
    await expect(
      adapter.execute(ctx, local, initial, false, { plan: initial }),
    ).rejects.toMatchObject({ uncertain: true })
    expect(
      (await adapter.execute(ctx, local, initial, true, { plan: initial })).orderFulfillment
        ?.confirmed,
    ).toBe(true)
    expect(writes).toBe(1)
    raw.fulfillment.fulfilledBy = 'AMAZON'
    await expect(adapter.load(ctx, local)).rejects.toMatchObject({
      code: 'ORDER_IDENTITY_MISMATCH',
    })
  })
  it('selects a verified PttAVM warehouse, polls every barcode and fetches ZPL without using digital-delivery endpoints', async () => {
    const ctx = context('pttavm'),
      local = { ...order, externalId: 'PTT-ORDER', externalNumber: 'PTT-ORDER' }
    const raw = {
      siparisNo: 'PTT-ORDER',
      islemTarihi: local.createdAt,
      kargoTutari: 0,
      kargoBarkod: '',
      barcodes: [] as { barcode: string }[],
      siparisUrunler: [
        {
          lineItemId: 1,
          urun: 'Ürün',
          urunBarkod: 'SKU',
          toplamIslemAdedi: 1,
          kdvDahilToplamTutar: 120,
          kdvOrani: 20,
          siparisDurumu: 'kargo_yapilmasi_bekleniyor',
        },
      ],
    }
    let writes = 0
    const adapter = new PttAvmFulfillment(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/orders/PTT-ORDER')) return json([raw])
        if (path.endsWith('/get-warehouse'))
          return json({ status: true, data: [{ id: 77, name: 'Depo' }] })
        if (path.endsWith('/create-barcode')) {
          expect(JSON.parse(String(init?.body))).toEqual({
            orders: [{ order_id: 'PTT-ORDER', warehouse_id: 77 }],
          })
          writes++
          raw.barcodes = [{ barcode: 'PTT-BAR-1' }, { barcode: 'PTT-BAR-2' }]
          return json({ success: true, tracking_id: 'TRACK-ID' })
        }
        if (path.endsWith('/barcode-status'))
          return json({
            status: 'completed',
            data: [{ order_id: 'PTT-ORDER', barcodes: ['PTT-BAR-1', 'PTT-BAR-2'] }],
          })
        if (path.endsWith('/get-barcode-tag')) {
          expect(JSON.parse(String(init?.body))).toEqual({
            barcode: 'PTT-BAR-1',
            order_id: 'PTT-ORDER',
            type: 'zpl',
          })
          return new Response('^XA^FDPTT-BAR-1^FS^XZ')
        }
        throw new Error(path)
      }),
    )
    const initial = plan(await adapter.load(ctx, local), {
      externalId: 'PTT-ORDER',
      warehouseId: '77',
    })
    const queued = await adapter.execute(ctx, local, initial, false, { plan: initial })
    const result = await adapter.execute(ctx, local, initial, true, queued.nextPayload!)
    expect(result.orderFulfillment?.packages).toHaveLength(2)
    expect(result.orderFulfillment?.confirmed).toBe(true)
    const labelPlan = plan(await adapter.load(ctx, local), {
      action: 'label',
      externalId: 'PTT-ORDER',
      packageId: 'PTT-BAR-1',
      lines: [],
    })
    expect(
      (await adapter.execute(ctx, local, labelPlan, false, { plan: labelPlan })).orderFulfillment
        ?.labels?.[0].data,
    ).toContain('PTT-BAR-1')
    expect(writes).toBe(1)
  })
})
