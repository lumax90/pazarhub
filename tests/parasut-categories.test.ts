import { describe, expect, it } from 'vitest'
import { ProviderHttp } from '../server/integrations/http'
import {
  findParasutInvoiceCategory,
  parasutInvoiceCategory,
} from '../server/integrations/parasut-categories'

const category = (id: string, name = 'Bayi', category_type = 'SalesInvoice') => ({
  id,
  type: 'item_categories',
  attributes: { name, category_type },
})
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
describe('Paraşüt sales invoice category contract', () => {
  it('reads every page and accepts only a complete exact sales-invoice category', async () => {
    const calls: URL[] = [],
      http = new ProviderHttp(async (input, init) => {
        const url = new URL(String(input))
        calls.push(url)
        expect(init?.method).toBe('GET')
        return json({
          data:
            url.searchParams.get('page[number]') === '1'
              ? Array.from({ length: 25 }, (_, i) => category(String(i), 'Bayi', 'Product'))
              : [category('match', ' BAYİ ')],
          meta: { total_pages: 2 },
        })
      })
    expect(
      await findParasutInvoiceCategory(http, 'https://api.parasut.com/v4/123', {}, 'Bayi'),
    ).toEqual({ id: 'match', name: ' BAYİ ' })
    expect(calls.map((url) => url.searchParams.get('page[number]'))).toEqual(['1', '2'])
    expect(
      calls.every(
        (url) =>
          url.searchParams.get('filter[category_type]') === 'SalesInvoice' &&
          url.searchParams.get('filter[name]') === 'Bayi',
      ),
    ).toBe(true)
  })
  it('does not select an ambiguous category or an incomplete identity', async () => {
    const ambiguous = new ProviderHttp(async () =>
      json({ data: [category('one'), category('two')] }),
    )
    await expect(
      findParasutInvoiceCategory(ambiguous, 'https://api.parasut.com/v4/123', {}, 'Bayi'),
    ).rejects.toMatchObject({ code: 'CATEGORY_AMBIGUOUS' })
    const missing = new ProviderHttp(async () => json({ data: [category('')] }))
    await expect(
      findParasutInvoiceCategory(missing, 'https://api.parasut.com/v4/123', {}, 'Bayi'),
    ).rejects.toMatchObject({ code: 'CATEGORY_RESPONSE_INVALID' })
  })
  it('does not treat a malformed category listing as absence', async () => {
    const http = new ProviderHttp(async () => json({ data: null }))
    await expect(
      findParasutInvoiceCategory(http, 'https://api.parasut.com/v4/123', {}, 'Bayi'),
    ).rejects.toMatchObject({ code: 'CATEGORY_RESPONSE_INVALID' })
  })
  it('requires the related resource identity and category type to match the included record', () => {
    const response = {
      data: { relationships: { category: { data: { id: 'one', type: 'item_categories' } } } },
      included: [category('one')],
    }
    expect(parasutInvoiceCategory(response)).toEqual({ id: 'one', name: 'Bayi' })
    expect(() => parasutInvoiceCategory({ ...response, included: [category('other')] })).toThrow(
      'kategori ilişkisi',
    )
    expect(() =>
      parasutInvoiceCategory({ ...response, included: [category('one', 'Bayi', 'Product')] }),
    ).toThrow('kategori ilişkisi')
    expect(() =>
      parasutInvoiceCategory({
        ...response,
        data: { relationships: { category: { data: { id: 'one', type: 'products' } } } },
      }),
    ).toThrow('kaynak türü')
  })
  it('returns no category only when the relationship has no resource identity', () => {
    expect(
      parasutInvoiceCategory({ data: { relationships: { category: { data: null } } } }),
    ).toBeUndefined()
  })
})
