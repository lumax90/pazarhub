/** Contract-shaped local provider responses. No request is forwarded to a real marketplace. */
export function publishingFixture() {
  const state = {
    approved: false,
    rejected: false,
    networkFailure: false,
    writes: [] as { path: string; body: Record<string, unknown> }[],
    batches: new Map<string, string>(),
    products: new Set<string>(),
    next: 0,
    contents: new Map<string, Record<string, unknown>>(),
    contentBatches: new Map<string, Record<string, unknown>>(),
    contentDrop: false,
    contentOutcome: 'SUCCESS' as 'SUCCESS' | 'RUNNING' | 'FAIL',
    contentCdn: false,
  }
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname,
      method = init?.method ?? 'GET'
    if (path.endsWith('/product/product-categories'))
      return response({
        categories: [
          { id: 1, name: 'Ev', subCategories: [{ id: 10, name: 'Dekorasyon', subCategories: [] }] },
        ],
      })
    if (path.endsWith('/product/categories/10/attributes'))
      return response({
        id: 10,
        name: 'Dekorasyon',
        categoryAttributes: [
          {
            attribute: { id: 100, name: 'Materyal' },
            required: true,
            varianter: false,
            slicer: false,
            allowCustom: false,
            allowMultipleAttributeValues: false,
          },
          {
            attribute: { id: 101, name: 'Renk' },
            required: true,
            varianter: true,
            slicer: true,
            allowCustom: false,
            allowMultipleAttributeValues: false,
          },
          {
            attribute: { id: 102, name: 'Kullanım alanı' },
            required: false,
            varianter: false,
            slicer: false,
            allowCustom: true,
            allowMultipleAttributeValues: true,
          },
        ],
      })
    if (path.endsWith('/attributes/100/values'))
      return response({
        page: 0,
        totalPages: 1,
        content: [
          { attributeValueId: 7, attributeValue: 'Seramik' },
          { attributeValueId: 8, attributeValue: 'Cam' },
        ],
      })
    if (path.endsWith('/attributes/101/values'))
      return response({
        page: 0,
        totalPages: 1,
        content: [
          { attributeValueId: 11, attributeValue: 'Beyaz' },
          { attributeValueId: 12, attributeValue: 'Siyah' },
        ],
      })
    if (path.endsWith('/attributes/102/values'))
      return response({
        page: 0,
        totalPages: 1,
        content: [
          { attributeValueId: 21, attributeValue: 'İç mekân' },
          { attributeValueId: 22, attributeValue: 'Dış mekân' },
        ],
      })
    if (path.endsWith('/product/brands/by-name')) return response([{ id: 42, name: 'TestMarka' }])
    if (path.endsWith('/products/price-and-inventory') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { items: { barcode: string }[] }
      const reference = `stock-${++state.next}`
      state.batches.set(reference, body.items[0].barcode)
      return response({ batchRequestId: reference })
    }
    if (path.endsWith('/v2/products') && method === 'POST') {
      if (state.networkFailure) throw new Error('Disconnected after submission')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      state.writes.push({ path, body })
      const barcode = (body.items as { barcode: string }[])[0].barcode,
        reference = `batch-${++state.next}`
      const item = (body.items as Record<string, unknown>[])[0]
      state.contents.set(barcode, {
        contentId: 1000 + state.contents.size,
        title: item.title,
        description: item.description,
        images: item.images,
        variants: [{ barcode, stockCode: item.stockCode }],
      })
      state.batches.set(reference, barcode)
      return response({ batchRequestId: reference })
    }
    const applyContent = () => {
      if (state.contentOutcome !== 'SUCCESS') return
      for (const item of state.contentBatches.values())
        for (const current of state.contents.values())
          if (current.contentId === item.contentId) {
            for (const key of ['title', 'description', 'images'])
              if (item[key] !== undefined)
                current[key] =
                  key === 'images' && state.contentCdn
                    ? (item.images as { url: string }[]).map((_, i) => ({
                        url: `https://example.com/cdn-${i}.jpg`,
                      }))
                    : item[key]
          }
    }
    if (path.endsWith('/products/approved')) {
      applyContent()
      const current = state.contents.get(url.searchParams.get('barcode') ?? '')
      return response({ content: current ? [current] : [], totalPages: 1 })
    }
    if (path.endsWith('/content-bulk-update')) {
      const body = JSON.parse(String(init?.body)) as { items: Record<string, unknown>[] },
        reference = `content-${++state.next}`
      state.contentBatches.set(reference, body.items[0])
      state.writes.push({ path, body })
      if (state.contentDrop) {
        state.contentDrop = false
        throw new Error('Lost content response after acceptance')
      }
      return response({ batchRequestId: reference })
    }
    if (path.endsWith('/update-audits')) {
      applyContent()
      return response({
        content: [...state.contentBatches].map(([batchRequestId, item]) => ({
          batchRequestId,
          contentId: item.contentId,
          updates: Object.keys(item)
            .filter((key) => key !== 'contentId')
            .map((key) => ({
              type: key === 'title' ? 'TITLE' : key === 'description' ? 'DESCRIPTION' : 'MEDIA',
              status: state.contentOutcome,
              rejectReasons:
                state.contentOutcome === 'FAIL' ? [{ reason: 'İçerik uygun bulunmadı.' }] : [],
            })),
        })),
        totalPage: 1,
      })
    }
    if (path.includes('/batch-requests/')) {
      const id = path.split('/').at(-1)!,
        barcode = state.batches.get(id)
      if (!barcode) return response({}, 404)
      if (!state.rejected) state.products.add(barcode)
      return response({
        status: 'COMPLETED',
        batchRequestId: id,
        items: [
          {
            requestItem: { barcode },
            status: state.rejected ? 'FAILED' : 'SUCCESS',
            failureReasons: state.rejected ? ['Kategori özelliği kabul edilmedi.'] : [],
          },
        ],
      })
    }
    if (path.includes('/product/sellers/') && path.includes('/product/')) {
      const barcode = decodeURIComponent(path.split('/').at(-1)!)
      if (state.products.has(barcode))
        return response({
          barcode,
          approved: state.approved,
          archived: false,
          listingId: `ty-${barcode}`,
        })
      if (path.endsWith('/products'))
        return response({ content: [], totalPages: 0, totalElements: 0 })
      return response({}, 404)
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`)
  }
  return { state, fetcher }
}
