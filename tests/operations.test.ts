import { describe, expect, it } from 'vitest'
import { createSeedState } from '../src/domain/seed'
import { executeCommand } from '../src/domain/operations'
import {
  availableStock,
  findVariant,
  orderTotal,
  reservedStock,
  taxTotal,
} from '../src/domain/selectors'
import type { AppState, Command } from '../src/domain/types'

const now = '2026-10-22T10:00:00.000Z'
const variantId = 'aura-sand'
const customerId = 'customer-1'

function workspace() {
  const state = createSeedState(new Date(now))
  state.orders = []
  state.invoices = []
  state.movements = []
  state.cash = []
  state.retailSales = []
  findVariant(state, variantId)!.variant.stock = 5
  return state
}

let sequence = 0
const apply = (state: AppState, command: Command) =>
  executeCommand(state, command, now, () => `test-${++sequence}`)
const createOrder = (state: AppState, quantity = 2) =>
  apply(state, {
    type: 'order.create',
    input: {
      customerId,
      channel: 'manual',
      items: [{ variantId, quantity }],
      shipping: 0,
      note: '',
    },
  })

describe('Ortak sipariş, stok ve perakende modeli', () => {
  it('onay bekleyen sipariş stoğu ayırır; henüz stok veya fatura hareketi oluşturmaz', () => {
    const { state, result } = createOrder(workspace())
    expect(result.ok).toBe(true)
    expect(findVariant(state, variantId)!.variant.stock).toBe(5)
    expect(reservedStock(state, variantId)).toBe(2)
    expect(availableStock(state, variantId)).toBe(3)
    expect(state.movements).toHaveLength(0)
    expect(state.invoices).toHaveLength(0)
  })

  it('onayın tekrar gelmesi ikinci kez stok düşmez veya fatura oluşturmaz', () => {
    const initial = createOrder(workspace()).state
    const order = initial.orders[0]
    const first = apply(initial, { type: 'order.transition', id: order.id, status: 'approved' })
    const replay = apply(first.state, {
      type: 'order.transition',
      id: order.id,
      status: 'approved',
    })
    expect(replay.result.ok).toBe(true)
    expect(findVariant(replay.state, variantId)!.variant.stock).toBe(3)
    expect(reservedStock(replay.state, variantId)).toBe(0)
    expect(replay.state.invoices).toHaveLength(1)
    expect(replay.state.movements).toHaveLength(1)
  })

  it('bekleyen siparişin iptali rezervasyonu kaldırır, hayali stok girişi yazmaz', () => {
    const state = createOrder(workspace()).state
    const cancelled = apply(state, {
      type: 'order.transition',
      id: state.orders[0].id,
      status: 'cancelled',
    }).state
    expect(availableStock(cancelled, variantId)).toBe(5)
    expect(cancelled.movements).toHaveLength(0)
  })

  it('onaylı ve tahsil edilmiş sipariş iptalinde stok ve tahsilat yalnız bir kez geri alınır', () => {
    let state = createOrder(workspace()).state
    const id = state.orders[0].id
    state = apply(state, { type: 'order.transition', id, status: 'approved' }).state
    state = apply(state, { type: 'order.pay', id }).state
    state = apply(state, { type: 'order.transition', id, status: 'cancelled' }).state
    state = apply(state, { type: 'order.transition', id, status: 'cancelled' }).state
    expect(findVariant(state, variantId)!.variant.stock).toBe(5)
    expect(state.movements).toHaveLength(2)
    expect(state.cash.filter((entry) => entry.kind === 'in')).toHaveLength(1)
    expect(state.cash.filter((entry) => entry.kind === 'out')).toHaveLength(1)
    expect(
      state.cash.reduce(
        (sum, entry) => sum + (entry.kind === 'in' ? entry.amount : -entry.amount),
        0,
      ),
    ).toBe(0)
  })

  it('perakende satışı, pazaryeri siparişine ayrılmış stoğu tüketemez', () => {
    const reserved = createOrder(workspace(), 3).state
    const result = apply(reserved, {
      type: 'retail.sale',
      input: { items: [{ variantId, quantity: 3 }], method: 'card' },
    })
    expect(result.result.ok).toBe(false)
    expect(result.state).toBe(reserved)
    expect(result.state.retailSales).toHaveLength(0)
    expect(result.state.cash).toHaveLength(0)
    expect(findVariant(result.state, variantId)!.variant.stock).toBe(5)
  })

  it('müşterisiz perakende satışında stok, satış ve kasa birlikte işlenir', () => {
    const reserved = createOrder(workspace(), 3).state
    const { state, result } = apply(reserved, {
      type: 'retail.sale',
      input: { items: [{ variantId, quantity: 2 }], method: 'cash' },
    })
    expect(result.ok).toBe(true)
    expect(findVariant(state, variantId)!.variant.stock).toBe(3)
    expect(availableStock(state, variantId)).toBe(0)
    expect(state.retailSales).toHaveLength(1)
    expect(state.retailSales[0].customerId).toBeUndefined()
    expect(state.retailSales[0].total).toBe(129980)
    expect(state.cash[0].amount).toBe(129980)
    expect(state.cash[0].reference).toBe(state.retailSales[0].id)
    expect(state.invoices).toHaveLength(0)
  })

  it('aynı stok kodu iki satırda gelince toplam miktara göre kontrol eder', () => {
    const original = workspace()
    const result = apply(original, {
      type: 'retail.sale',
      input: {
        items: [
          { variantId, quantity: 3 },
          { variantId, quantity: 3 },
        ],
        method: 'card',
      },
    })
    expect(result.result.ok).toBe(false)
    expect(result.state).toBe(original)
  })

  it('bir sepetin tek kalemi geçersizse hiçbir kalemin stoğunu değiştirmez', () => {
    const original = workspace()
    const result = apply(original, {
      type: 'retail.sale',
      input: {
        items: [
          { variantId, quantity: 1 },
          { variantId: 'everyday-natural', quantity: 1 },
        ],
        method: 'cash',
      },
    })
    expect(result.result.ok).toBe(false)
    expect(findVariant(result.state, variantId)!.variant.stock).toBe(5)
    expect(result.state.movements).toHaveLength(0)
  })

  it('ürün fiyatı ve müşteri adresi değişince geçmiş siparişin değerlerini korur', () => {
    let state = createOrder(workspace()).state
    const initialAddress = state.orders[0].shippingAddress?.address
    const product = structuredClone(state.products[0])
    product.variants[0].price = 99900
    state = apply(state, { type: 'product.save', product }).state
    state = apply(state, {
      type: 'customer.save',
      customer: { ...state.customers[0], address: 'Yeni adres' },
    }).state
    expect(orderTotal(state.orders[0])).toBe(129980)
    expect(state.orders[0].lines[0].unitCost).toBe(24800)
    expect(state.orders[0].shippingAddress?.address).toBe(initialAddress)
  })

  it('fiyat ve vergiyi kuruş bazında tutar', () => {
    const state = createOrder(workspace()).state
    expect(orderTotal(state.orders[0])).toBe(129980)
    expect(taxTotal(state.orders[0].lines)).toBe(21663)
  })

  it('rezervasyonun altına stok düzeltmesine izin vermez', () => {
    const state = createOrder(workspace(), 3).state
    const result = apply(state, { type: 'stock.adjust', variantId, quantity: 2, note: 'Sayım' })
    expect(result.result.ok).toBe(false)
    expect(result.state.movements).toHaveLength(0)
  })

  it('ürün düzenlemesi, stok hareket defterini atlayarak stok değiştiremez', () => {
    const original = workspace()
    const product = structuredClone(original.products[0])
    product.variants[0].stock = 999
    const state = apply(original, { type: 'product.save', product }).state
    expect(findVariant(state, variantId)!.variant.stock).toBe(5)
  })

  it('tekrar tahsilat ikinci kasa girişi yazmaz', () => {
    let state = createOrder(workspace()).state
    const id = state.orders[0].id
    state = apply(state, { type: 'order.pay', id }).state
    state = apply(state, { type: 'order.pay', id }).state
    expect(state.cash).toHaveLength(1)
  })

  it('iptal edilmiş siparişi tekrar onaylayamaz', () => {
    let state = createOrder(workspace()).state
    const id = state.orders[0].id
    state = apply(state, { type: 'order.transition', id, status: 'cancelled' }).state
    expect(apply(state, { type: 'order.transition', id, status: 'approved' }).result.ok).toBe(false)
  })
})

describe('Katalog ve mağaza ayrımı', () => {
  it('bir mağazanın özel fiyatı başka mağazanın ilanını etkilemez', () => {
    let state = workspace()
    const first = state.listings.find(
      (listing) => listing.variantId === variantId && listing.channel === 'trendyol',
    )!
    const second = state.listings.find(
      (listing) => listing.variantId === variantId && listing.channel === 'hepsiburada',
    )!
    const beforeSecond = second.priceOverride
    state = apply(state, { type: 'listing.update', id: first.id, priceOverride: 74990 }).state
    expect(state.listings.find((listing) => listing.id === second.id)!.priceOverride).toBe(
      beforeSecond,
    )
    expect(findVariant(state, variantId)!.variant.price).toBe(64990)
    state = apply(state, { type: 'listing.update', id: first.id, priceOverride: null }).state
    expect(state.listings.find((listing) => listing.id === first.id)!.priceOverride).toBeUndefined()
  })

  it('aynı pazaryerindeki ikinci mağaza ilk bağlantıyı değiştirmez', () => {
    const original = workspace()
    const result = apply(original, {
      type: 'connection.update',
      connection: {
        id: 'another-trendyol',
        name: 'İkinci mağaza',
        channel: 'trendyol',
        active: true,
      },
    })
    expect(
      result.state.connections.filter((connection) => connection.channel === 'trendyol'),
    ).toHaveLength(2)
    expect(
      result.state.connections.find((connection) => connection.id === 'store-trendyol'),
    ).toEqual(original.connections[0])
  })

  it('mükerrer SKU veya barkod ile ürün kaydını reddeder', () => {
    const original = workspace()
    const product = structuredClone(original.products[1])
    product.variants[0].barcode = original.products[0].variants[0].barcode
    expect(apply(original, { type: 'product.save', product }).result.ok).toBe(false)
    product.variants[0].barcode = original.products[1].variants[0].barcode
    product.variants[0].sku = original.products[0].variants[0].sku
    expect(apply(original, { type: 'product.save', product }).result.ok).toBe(false)
  })

  it('kısmi değişiklik sonrası doğrulama hatası gelirse ilk kaydı korur', () => {
    const original = workspace()
    const listing = original.listings[0]
    const result = apply(original, {
      type: 'listing.update',
      id: listing.id,
      titleOverride: 'Yeni başlık',
      priceOverride: -100,
    })
    expect(result.result.ok).toBe(false)
    expect(result.state).toBe(original)
    expect(result.state.listings[0].titleOverride).toBeUndefined()
  })
})
