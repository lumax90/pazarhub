import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { orderCoreOwner } from '../tests/order-core-fixture'
import type { AppState, Command } from '../src/domain/types'

test.use({ baseURL: 'http://localhost:4174' })
test('keeps colored product media, two-warehouse stock, currency/VAT and print status together', async ({
  page,
}, info) => {
  test.setTimeout(90000)
  const request = page.context().request,
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin: 'http://localhost:4174' },
        data: { email: orderCoreOwner.email, password: orderCoreOwner.password },
      })
    ).ok(),
  ).toBe(true)
  const session = await (await request.get('/api/session')).json(),
    headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const command = async (data: Command) => {
    const response = await request.post('/api/commands', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data,
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const state = async () => (await (await request.get('/api/workspace')).json()).state as AppState
  await command({ type: 'warehouse.save', warehouse: { id: 'shop', name: 'Mağaza', active: true } })
  await command({
    type: 'customer.save',
    customer: {
      id: 'customer',
      name: 'Döviz Müşterisi',
      email: '',
      phone: '5551234567',
      address: 'Test Mahallesi Sokak 1',
      city: 'İstanbul',
      district: 'Kadıköy',
    },
  })
  await command({
    type: 'product.save',
    product: {
      id: 'color-product',
      name: 'Renkli Havlu',
      category: 'Banyo',
      brand: 'Marka',
      description: '',
      art: 'towel',
      color: '#ffffff',
      taxRate: 20,
      active: true,
      lowStock: 1,
      variantAxes: [
        {
          id: 'color',
          name: 'Renk',
          values: [
            { id: 'white', name: 'Beyaz' },
            { id: 'black', name: 'Siyah' },
          ],
        },
      ],
      variants: [
        {
          id: 'white',
          name: 'Beyaz',
          sku: 'CORE-W',
          barcode: '8690000000001',
          price: 48000,
          cost: 12000,
          stock: 3,
          stockByWarehouse: { main: 1, shop: 2 },
          options: { color: 'white' },
        },
        {
          id: 'black',
          name: 'Siyah',
          sku: 'CORE-B',
          barcode: '8690000000002',
          price: 48000,
          cost: 12000,
          stock: 2,
          options: { color: 'black' },
        },
      ],
      images: [
        'https://example.com/white.jpg',
        'https://example.com/black.jpg',
        'https://example.com/common.jpg',
      ],
    },
  })
  await page.goto('/ecommerce-settings')
  await page.getByRole('button', { name: 'Ürün ve Stok', exact: true }).click()
  await page
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'E-ticaret deposu · Mağaza', exact: true }) })
    .click()
  await page.getByRole('button', { name: 'Ayarları kaydet', exact: true }).click()
  await expect.poll(async () => (await state()).ecommerce?.warehouseIds).toEqual(['main', 'shop'])
  await page.goto('/products/color-product?tab=images')
  await page.getByRole('button', { name: 'Görsel 1 rengi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Beyaz', exact: true }).click()
  await page.getByRole('button', { name: 'Görsel 2 rengi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Siyah', exact: true }).click()
  await page.getByLabel('Görsel 1 alternatif metni', { exact: true }).fill('Beyaz pamuklu havlu')
  await page.getByRole('button', { name: 'Resimleri kaydet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resimleri kaydet', exact: true })).toBeDisabled()
  await page.goto('/orders/new?customer=customer')
  await page.getByRole('button', { name: 'Sipariş para birimi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'USD', exact: true }).click()
  await page
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', { name: 'Birim fiyatı KDV dahil gir', exact: true }),
    })
    .click()
  await page.getByRole('combobox', { name: 'Üründen satır ekle', exact: true }).fill('Renkli')
  await page.getByRole('option').filter({ hasText: 'Renkli Havlu · Beyaz' }).click()
  await page.getByLabel('Miktar · satır 1', { exact: true }).fill('3')
  await page.getByLabel('Birim fiyat (KDV hariç) · satır 1', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Satır ekle', exact: true }).click()
  await page.getByLabel('2. satır açıklaması', { exact: true }).fill('Paketleme hizmeti')
  await page.getByLabel('Birim fiyat (KDV hariç) · satır 2', { exact: true }).fill('5')
  await page.getByLabel('Kargo ücreti (KDV dahil, USD)', { exact: true }).fill('1')
  await page
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'Tahsil edildi', exact: true }) })
    .click()
  await expect(page.locator('.order-summary-totals')).toContainText('43,00')
  await expect(page.locator('.order-summary-totals')).toContainText('1.720,00')
  await page.getByRole('button', { name: 'Siparişi oluştur', exact: true }).click()
  await expect(page).toHaveURL(/\/orders\/[^/]+$/)
  const order = (await state()).orders[0]
  expect(order.currency).toBe('USD')
  expect(order.stockAllocations?.map((item) => item.warehouseId).sort()).toEqual(['main', 'shop'])
  expect((await state()).cash[0].amount).toBe(172000)
  await command({ type: 'order.transition', id: order.id, status: 'approved' })
  expect(
    (await state()).products.find((product) => product.id === 'color-product')?.variants[0].stock,
  ).toBe(0)
  await page.goto(`/orders/print?ids=${order.id}`)
  await expect(page.locator('.order-print-document')).toContainText('43,00')
  await page
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', { name: 'Yazdırıldı olarak işaretle', exact: true }),
    })
    .click()
  await expect.poll(async () => (await state()).orders[0].printStatus?.printed).toBe(true)
  await page.goto('/orders?printed=1')
  await expect(page.getByRole('grid', { name: 'Sipariş listesi' })).toContainText(order.number)
  await page.goto(`/orders/${order.id}`)
  await expect(
    page.getByRole('heading', { name: `Sipariş ${order.number}`, exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('grid', { name: 'Sipariş depo dağılımı' })).toContainText('Mağaza')
  await expect(page.locator('.order-summary-totals')).toContainText('43,00')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('order-currency-mobile.png'), fullPage: true })
  expect(errors).toEqual([])
})
