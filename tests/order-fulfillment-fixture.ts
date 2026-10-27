import { array, record, text } from '../server/integrations/contracts'

export function orderFulfillmentFixture() {
  const merchantId = '11111111-1111-4111-8111-111111111111'
  const state = {
    drop: false,
    writes: [] as string[],
    hbLines: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Havlu',
        merchantSku: 'SKU-A',
        productBarcode: '8691234567890',
        quantity: 2,
        unitPrice: { amount: 120, currency: 'TRY' },
        totalPrice: { amount: 240, currency: 'TRY' },
        vatRate: 20,
        status: 'Open',
        merchantId,
        canCreatePackage: true,
        isCancellable: true,
        packageNumber: '',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Sabun',
        merchantSku: 'SKU-B',
        productBarcode: '8691234567891',
        quantity: 1,
        unitPrice: { amount: 50, currency: 'TRY' },
        totalPrice: { amount: 50, currency: 'TRY' },
        vatRate: 20,
        status: 'Open',
        merchantId,
        canCreatePackage: true,
        isCancellable: true,
        packageNumber: '',
      },
    ],
    packages: new Map<string, Record<string, unknown>>(),
    tyStatus: 'Created',
    tyLabel: false,
  }
  const hbOrder = () => ({
    orderNumber: 'HB-ORDER-1',
    orderDate: '2026-10-24T10:00:00.000Z',
    deliveryAddress: {
      name: 'Alıcı',
      address: 'Test Mahallesi Sokak 1',
      city: 'İstanbul',
      town: 'Kadıköy',
      phoneNumber: '5551234567',
    },
    items: state.hbLines,
  })
  const tyOrder = () => ({
    id: 100,
    orderNumber: 'TY-ORDER-1',
    orderDate: Date.parse('2026-10-24T10:00:00.000Z'),
    lastModifiedDate: Date.parse('2026-10-24T10:00:00.000Z'),
    status: state.tyStatus,
    cargoTrackingNumber: 'TY-CARGO',
    cargoProviderName: 'Aras Kargo',
    totalPrice: 240,
    shipmentAddress: {
      fullName: 'Alıcı',
      fullAddress: 'Test Mahallesi Sokak 1',
      city: 'İstanbul',
      district: 'Kadıköy',
      phone: '5551234567',
    },
    lines: [
      {
        id: 101,
        merchantSku: 'SKU-A',
        barcode: '8691234567890',
        productName: 'Havlu',
        quantity: 2,
        price: 120,
        vatBaseAmount: 20,
      },
    ],
  })
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const accepted = () => {
    if (state.drop) {
      state.drop = false
      throw new Error('Response lost after acceptance')
    }
    return json({})
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname
    if (url.hostname.includes('trendyol.com')) {
      if (path.endsWith('/orders')) return json({ content: [tyOrder()], totalPages: 1 })
      if (path.includes('/common-label/')) {
        if (init?.method === 'POST') {
          state.tyLabel = true
          state.writes.push('ty-label')
          return accepted()
        }
        return state.tyLabel
          ? json({ data: [{ format: 'ZPL', label: '^XA^FDTY-CARGO^FS^XZ' }] })
          : json({}, 404)
      }
      if (path.endsWith('/shipment-packages/100') && init?.method === 'PUT') {
        state.tyStatus = 'Picking'
        state.writes.push('ty-pack')
        return accepted()
      }
      if (path.endsWith('/items/unsupplied')) {
        state.tyStatus = 'Cancelled'
        state.writes.push('ty-cancel')
        return accepted()
      }
      throw new Error(`Unexpected Trendyol fulfillment request: ${path}`)
    }
    if (path.includes('/all-products-of-merchant/')) return json({ success: true, data: [] })
    if (path.endsWith(`/orders/merchantid/${merchantId}`))
      return json({
        items: state.hbLines.map((line) => ({ ...line, orderNumber: 'HB-ORDER-1' })),
        totalCount: state.hbLines.length,
      })
    if (path.endsWith('/cancelled')) return json({ items: [], totalCount: 0 })
    if (
      init?.method !== 'POST' &&
      (path.endsWith(`/packages/merchantid/${merchantId}`) ||
        path.endsWith('/shipped') ||
        path.endsWith('/delivered'))
    )
      return json([])
    if (path.includes('/orders/merchantid/') && path.includes('/ordernumber/'))
      return json(hbOrder())
    if (path.includes('/packageablewith/'))
      return json({
        lineItems: state.hbLines
          .filter((line) => line.id !== path.split('/').at(-1) && line.status === 'Open')
          .map((line) => ({
            lineItemId: line.id,
            quantity: line.quantity,
            orderNumber: 'HB-ORDER-1',
          })),
      })
    if (path.endsWith('/cancelbymerchant')) {
      const id = path.split('/').at(-2)
      state.hbLines.find((line) => line.id === id)!.status = 'CancelledByMerchant'
      state.writes.push('hb-cancel')
      return accepted()
    }
    if (path.endsWith('/labels'))
      return json({ format: 'zpl', data: ['^XA^FDHB-CARGO^FS^XZ'], hasMerchantMutualBarcode: true })
    if (path.includes('/packagenumber/')) {
      const id = path.split('/packagenumber/')[1].split('/')[0],
        target = state.packages.get(id)
      if (!target) return json({}, 404)
      if (path.endsWith('/intransit')) {
        const body = JSON.parse(String(init?.body))
        target.status = 'InTransit'
        target.trackingInfoCode = body.trackingNumber
        target.trackingInfoUrl = body.trackingUrl
        for (const line of state.hbLines) if (line.packageNumber === id) line.status = 'InTransit'
        state.writes.push('hb-ship')
        return accepted()
      }
      return json(target)
    }
    if (path.endsWith(`/packages/merchantid/${merchantId}`) && init?.method === 'POST') {
      const body = JSON.parse(String(init?.body)),
        id = `PKG-${state.packages.size + 1}`
      for (const selected of array(body.lineItemRequests).map(record)) {
        const line = state.hbLines.find((line) => line.id === selected.id)!
        if (line.status !== 'Open') throw new Error('Double packaging')
        line.packageNumber = id
        line.status = 'Packaged'
      }
      state.packages.set(id, {
        packageNumber: id,
        status: 'Open',
        barcode: `CARGO-${id}`,
        cargoCompany: 'Aras Kargo',
      })
      state.writes.push('hb-pack')
      if (state.drop) {
        state.drop = false
        throw new Error('Response lost after package creation')
      }
      return json({ packageNumber: id, barcode: `CARGO-${id}` }, 201)
    }
    throw new Error(`Unexpected HB fulfillment request: ${path} ${text(init?.method)}`)
  }
  return { state, merchantId, fetcher, hbOrder, tyOrder }
}
