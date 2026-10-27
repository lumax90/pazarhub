import { XMLParser } from 'fast-xml-parser'
import { array, record, text } from '../server/integrations/contracts'

export function fulfillmentFixture() {
  const state = {
    drop: '' as
      | ''
      | 'category'
      | 'contact'
      | 'product'
      | 'invoice'
      | 'finalize'
      | 'shipment'
      | 'marketplace-link',
    writes: [] as string[],
    contacts: new Map<string, Record<string, unknown>>(),
    categories: new Map<string, Record<string, unknown>>(),
    products: new Map<string, Record<string, unknown>>(),
    invoices: new Map<
      string,
      { data: Record<string, unknown>; included: Record<string, unknown>[] }
    >(),
    shipments: new Set<string>(),
  }
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  const fail = (stage: typeof state.drop) => {
    if (state.drop === stage) {
      state.drop = ''
      throw new Error('Response lost after provider commit')
    }
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname,
      post = init?.method === 'POST'
    if (url.hostname === 'ws.yurticikargo.com') {
      const body = record(
        record(
          new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(String(init?.body))
            .Envelope,
        ).Body,
      )
      const operation = Object.keys(body)[0],
        fields = record(body[operation]),
        reference = text(record(fields.ShippingOrderVO).cargoKey) || text(fields.keys)
      const xml = (text: string) =>
        new Response(
          `<Envelope><Body><${operation}Response>${text}</${operation}Response></Body></Envelope>`,
        )
      if (operation === 'createShipment') {
        state.writes.push('shipment')
        state.shipments.add(reference)
        fail('shipment')
        return xml(
          `<ShippingOrderResultVO><outFlag>0</outFlag><shippingOrderDetailVO><cargoKey>${reference}</cargoKey><errCode>0</errCode></shippingOrderDetailVO></ShippingOrderResultVO>`,
        )
      }
      if (operation === 'queryShipment')
        return xml(
          `<ShippingDeliveryVO><outFlag>0</outFlag>${state.shipments.has(reference) ? `<shippingDeliveryDetailVO><cargoKey>${reference}</cargoKey><errCode>0</errCode><shippingDeliveryItemDetailVO><docId>TRACK-1</docId></shippingDeliveryItemDetailVO></shippingDeliveryDetailVO>` : ''}</ShippingDeliveryVO>`,
        )
      throw new Error(`Unexpected carrier operation ${operation}`)
    }
    if (path === '/oauth/token')
      return json({ access_token: 'fulfillment-token', expires_in: 3600 })
    if (url.hostname === 'apigw.trendyol.com' && path.endsWith('/seller-invoice-links')) {
      state.writes.push('marketplace-invoice-link')
      fail('marketplace-link')
      return json({})
    }
    if (path.endsWith('/item_categories')) {
      if (post) {
        const data = record(JSON.parse(String(init?.body)).data),
          id = String(state.categories.size + 1)
        state.categories.set(id, { ...data, id })
        state.writes.push('category')
        fail('category')
        return json({ data: state.categories.get(id) })
      }
      return json({
        data: [...state.categories.values()].filter(
          (item) =>
            record(item.attributes).category_type ===
              url.searchParams.get('filter[category_type]') &&
            String(record(item.attributes).name).toLocaleLowerCase('tr-TR') ===
              (url.searchParams.get('filter[name]') ?? '').toLocaleLowerCase('tr-TR'),
        ),
        meta: { total_pages: 1 },
      })
    }
    if (path.endsWith('/contacts')) {
      if (post) {
        const item = record(JSON.parse(String(init?.body)).data),
          id = String(state.contacts.size + 1)
        state.contacts.set(id, { ...item, id })
        state.writes.push('contact')
        fail('contact')
        return json({ data: state.contacts.get(id) })
      }
      return json({
        data: [...state.contacts.values()].filter(
          (item) =>
            !url.searchParams.has('filter[name]') ||
            record(item.attributes).name === url.searchParams.get('filter[name]'),
        ),
      })
    }
    if (path.endsWith('/products')) {
      if (post) {
        const item = record(JSON.parse(String(init?.body)).data),
          id = String(state.products.size + 1)
        state.products.set(id, { ...item, id })
        state.writes.push('product')
        fail('product')
        return json({ data: state.products.get(id) })
      }
      return json({
        data: [...state.products.values()].filter(
          (item) => record(item.attributes).code === url.searchParams.get('filter[code]'),
        ),
      })
    }
    if (path.endsWith('/sales_invoices')) {
      if (!post)
        return json({
          data: [...state.invoices.values()]
            .map((item) => item.data)
            .filter(
              (item) =>
                record(item.attributes).issue_date === url.searchParams.get('filter[issue_date]'),
            ),
          meta: { total_pages: 1 },
        })
      const item = record(JSON.parse(String(init?.body)).data),
        id = String(9000 + state.invoices.size),
        details: Record<string, unknown>[] = array(
          record(record(item.relationships).details).data,
        ).map((value, index) => ({ ...record(value), id: `${id}-${index}` }))
      const included: Record<string, unknown>[] = [
        ...details,
        ...state.products.values(),
        ...state.contacts.values(),
        ...state.categories.values(),
      ]
      const total = details.reduce((sum, detail) => {
        const attrs = record(detail.attributes)
        return (
          sum +
          Number(attrs.quantity) * Number(attrs.unit_price) * (1 + Number(attrs.vat_rate) / 100)
        )
      }, 0)
      const data = {
        ...item,
        id,
        attributes: { ...record(item.attributes), net_total: total },
        relationships: {
          ...record(item.relationships),
          details: {
            data: details.map((detail) => ({ id: detail.id, type: 'sales_invoice_details' })),
          },
          active_e_document: { data: null },
        },
      }
      state.invoices.set(id, { data, included })
      state.writes.push('invoice')
      fail('invoice')
      return json({ data })
    }
    if (/\/sales_invoices\/\d+$/.test(path))
      return json(state.invoices.get(path.split('/').at(-1)!))
    if (path.endsWith('/e_invoice_inboxes')) return json({ data: [] })
    if (path.endsWith('/e_archives') && post) {
      const id = text(
        record(record(record(JSON.parse(String(init?.body)).data.relationships).sales_invoice).data)
          .id,
      )
      const invoice = state.invoices.get(id)!
      record(invoice.data.relationships).active_e_document = {
        data: { id: `doc-${id}`, type: 'e_archives' },
      }
      state.writes.push('finalize')
      fail('finalize')
      return json({ data: { id: `job-${id}`, type: 'trackable_jobs' } })
    }
    if (/\/e_archives\/doc-\d+\/pdf$/.test(path))
      return json({ data: { attributes: { url: 'https://example.com/fixture.pdf' } } })
    if (/\/e_archives\/doc-\d+$/.test(path))
      return json({
        data: {
          id: path.split('/').at(-1),
          attributes: { status: 'sent', invoice_number: 'TEST202600000001' },
        },
      })
    throw new Error(`Unexpected fulfillment fixture request ${init?.method} ${path}`)
  }
  return { state, fetcher }
}
