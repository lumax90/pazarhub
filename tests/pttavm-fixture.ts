import { array, record, text } from '../server/integrations/contracts'

export function pttavmFixture() {
  const state = {
    products: new Map<string, Record<string, unknown>>(),
    writes: [] as { path: string; body: Record<string, unknown> }[],
    batches: new Map<string, string>(),
    drop: false,
    partial: false,
    reject: false,
    onParentRead: undefined as undefined | (() => Promise<void>),
  }
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname
    if (path.endsWith('/orders/search')) return json([])
    if (path.endsWith('/categories/category-tree'))
      return json({
        success: true,
        category_tree: [{ id: 1, name: 'Ev', children: [{ id: 52, name: 'Banyo', children: [] }] }],
      })
    if (path.endsWith('/products') && init?.method === 'GET') {
      if (state.onParentRead) {
        const callback = state.onParentRead
        state.onParentRead = undefined
        await callback()
      }
      const product = state.products.get(url.searchParams.get('barcode') ?? '')
      if (!product) return json({ message: 'Bulunamadı' }, 404)
      return json(
        state.partial
          ? { ...product, variantListesi: array(product.variantListesi).slice(0, 1) }
          : product,
      )
    }
    if (path.endsWith('/products/search'))
      return json(
        [...state.products.values()]
          .filter(
            (product) =>
              product.aktif === (url.searchParams.get('isActive') === 'true') &&
              Number(product.miktar) > 0 === (url.searchParams.get('isInStock') === 'true'),
          )
          .map((product) => ({ ...product, rowCount: state.products.size })),
      )
    if (path.includes('/tracking-result/')) {
      const barcode = state.batches.get(path.split('/').at(-1)!)
      if (!barcode) throw new Error('Unknown fixture tracking ID')
      return json({
        status: state.reject ? 'Cancelled' : 'Completed',
        productsSubTrackingResult: {
          countOfCancelledProducts: state.reject ? 1 : 0,
          productBasedInfos: [
            {
              barcode,
              status: state.reject ? 'Cancelled' : 'Completed',
              failureReasons: state.reject ? ['Kilitli ürün'] : [],
            },
          ],
        },
      })
    }
    if (path.endsWith('/upsert') || path.endsWith('/stock-prices')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>,
        item = record(array(body.items)[0]),
        barcode = text(item.barcode)
      state.writes.push({ path, body })
      if (path.endsWith('/upsert')) {
        const previous = state.products.get(barcode)
        if (previous) {
          for (const [key, target] of Object.entries({
            name: 'urunAdi',
            longDescription: 'uzunAciklama',
            images: 'resimListesi',
            quantity: 'miktar',
          }))
            if (item[key] !== undefined) previous[target] = item[key]
          previous.variantListesi = array(item.variants).map((value) => {
            const variant = record(value),
              existing = array(previous.variantListesi)
                .map(record)
                .find((old) => old.variantBarkod === variant.variantBarcode),
              attributes = array(variant.attributes).map(record)
            return {
              ...existing,
              variantBarkod: variant.variantBarcode,
              variant1Deger: attributes[0]?.value,
              variant2Deger: attributes[1]?.value,
              ...(variant.quantity !== undefined ? { miktar: variant.quantity } : {}),
              ...(variant.price !== undefined ? { fiyat: variant.price, fiyatFarkiMi: true } : {}),
            }
          })
        } else {
          const price =
            item.priceWithVat ?? (Number(item.priceWithoutVat) * (100 + Number(item.vatRate))) / 100
          state.products.set(barcode, {
            urunId: state.products.size + 1,
            barkod: barcode,
            urunKodu: item.productCode,
            urunAdi: item.name,
            gtin: item.gtin,
            miktar: item.quantity,
            aktif: item.active,
            kdvOran: item.vatRate,
            kdVli: price,
            yeniKategoriId: item.categoryId,
            resimListesi: item.images,
            uzunAciklama: item.longDescription,
            variantListesi: array(item.variants).map((value) => {
              const variant = record(value),
                attributes = array(variant.attributes).map(record)
              return {
                variantBarkod: variant.variantBarcode,
                variant1Deger: attributes[0]?.value,
                variant2Deger: attributes[1]?.value,
                miktar: variant.quantity,
                fiyat: variant.price,
                fiyatFarkiMi: true,
              }
            }),
          })
        }
      } else {
        const product = state.products.get(barcode)
        if (!product) throw new Error('Stock write attempted on missing parent')
        product.miktar = item.quantity
        product.kdVli =
          item.priceWithVAT ?? (Number(item.priceWithoutVAT) * (100 + Number(item.vatRate))) / 100
        product.kdvOran = item.vatRate
        product.aktif = item.active
        for (const value of array(item.variants)) {
          const variant = record(value),
            attributes = array(variant.attributes).map(record)
          const found = array(product.variantListesi)
            .map(record)
            .find(
              (item) =>
                item.variant1Deger === attributes[0]?.value &&
                item.variant2Deger === attributes[1]?.value,
            )
          if (!found) throw new Error('Fixture variant attributes do not match')
          found.miktar = variant.quantity
          found.fiyat = variant.price
          found.fiyatFarkiMi = true
        }
      }
      const trackingId = `tracking-${state.writes.length}`
      state.batches.set(trackingId, barcode)
      if (state.drop) throw new Error('Response lost after commit')
      return json({ success: true, trackingId, countOfProductsToBeProcessed: 1 })
    }
    throw new Error(`Unexpected PttAVM fixture request: ${init?.method} ${path}`)
  }
  return { state, fetcher }
}
