import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { AppState, Command } from '../src/domain/types'
import { orderWorkspaceOwner } from '../tests/order-workspace-fixture'

test.use({ baseURL: 'http://localhost:4174' })
test('runs the verified manual order, preparation, notes, invoice and return workflow', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const request = page.context().request
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin: 'http://localhost:4174' },
        data: { email: orderWorkspaceOwner.email, password: orderWorkspaceOwner.password },
      })
    ).status(),
  ).toBe(200)
  const session = await (await request.get('/api/session')).json()
  const command = async (input: Command) => {
    const response = await request.post('/api/commands', {
      headers: {
        origin: 'http://localhost:4174',
        'x-csrf-token': session.csrfToken,
        'idempotency-key': randomUUID(),
      },
      data: input,
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await command({
    type: 'customer.save',
    customer: {
      id: 'order-customer',
      name: 'Sipariş Test Müşterisi',
      email: 'customer@example.test',
      phone: '5551234567',
      address: 'Test teslimat adresi',
      city: 'İstanbul',
      district: 'Kadıköy',
    },
  })
  await command({ type: 'warehouse.save', warehouse: { id: 'shop', name: 'Mağaza', active: true } })
  await command({
    type: 'product.save',
    product: {
      id: 'order-product',
      name: 'Sipariş Test Ürünü',
      category: 'Test',
      brand: 'Test',
      description: '',
      art: 'cup',
      color: '#aabbcc',
      active: true,
      taxRate: 20,
      lowStock: 1,
      variants: [
        {
          id: 'order-variant',
          name: 'Standart',
          sku: 'ORD-SKU',
          barcode: '0012345678',
          price: 12000,
          cost: 5000,
          stock: 14,
          stockByWarehouse: { main: 4, shop: 10 },
        },
      ],
    },
  })
  await page.goto('/orders')
  await page.getByRole('button', { name: 'Sipariş oluştur', exact: true }).click()
  await expect(page).toHaveURL(/\/orders\/new$/)
  await page.getByRole('combobox', { name: 'Müşteri', exact: true }).fill('customer@example.test')
  await page.getByRole('option').filter({ hasText: 'Sipariş Test Müşterisi' }).click()
  await page.getByLabel('Ad soyad', { exact: true }).fill('Farklı Alıcı')
  await page.getByLabel('Kaynak sipariş no', { exact: true }).fill('PHONE-11')
  await page.getByRole('button', { name: 'Sipariş ödeme yöntemi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Nakit', exact: true }).click()
  const paid = page.getByRole('checkbox', { name: 'Tahsil edildi', exact: true })
  await page.locator('label').filter({ has: paid }).click()
  await page.getByRole('button', { name: 'Sipariş deposu', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Mağaza', exact: true }).click()
  const draft = page.getByRole('radio', { name: 'Resmîleşmesin', exact: true })
  await page.locator('label').filter({ has: draft }).click()
  await page.getByRole('combobox', { name: 'Üründen satır ekle', exact: true }).fill('ORD-SKU')
  await page.getByRole('option').filter({ hasText: 'Sipariş Test Ürünü' }).click()
  await page.getByLabel('Miktar · satır 1', { exact: true }).fill('2')
  await page.getByLabel('İndirim (%) · satır 1', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Satır ekle', exact: true }).click()
  await page.getByLabel('2. satır açıklaması', { exact: true }).fill('Montaj hizmeti')
  await page.getByLabel('Birim fiyat (KDV dahil) · satır 2', { exact: true }).fill('50,00')
  await page.getByLabel('Kargo ücreti (KDV dahil, TRY)', { exact: true }).fill('10,00')
  await page.getByLabel('Müşteri notu', { exact: true }).fill('Zile basın')
  await page.getByLabel('İç not', { exact: true }).fill('Paketleme ekibi kontrol edecek')
  await expect(page.locator('.order-summary-totals .is-total')).toContainText('276,00')
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo(0, 0)
  })
  await page.screenshot({ path: testInfo.outputPath('new-order-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Siparişi oluştur', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^Sipariş SP-/, level: 1 })).toBeVisible()
  let state = (await (await request.get('/api/workspace')).json()).state as AppState
  expect(state.orders[0]).toMatchObject({
    paid: true,
    paymentMethod: 'cash',
    externalNumber: 'PHONE-11',
    invoicePreference: 'draft',
    shippingAddress: { name: 'Farklı Alıcı' },
  })
  expect(state.orders[0].lines.map((line) => line.kind)).toEqual(['catalog', 'free'])
  expect(state.cash).toHaveLength(1)
  expect(state.cash[0].amount).toBe(27600)
  expect(state.movements).toHaveLength(2)
  const ready = page.getByRole('checkbox', { name: 'Hepsi hazır', exact: true })
  await page.locator('label').filter({ has: ready }).click()
  await expect(ready).toBeChecked()
  await page.getByLabel('Yeni not', { exact: true }).fill('Hazırlık tamamlandı')
  await page.getByRole('button', { name: 'Not ekle', exact: true }).click()
  await expect(page.locator('.order-team-notes')).toContainText('Hazırlık tamamlandı')
  await page.getByRole('button', { name: 'Fatura kes', exact: true }).click()
  await expect(page.locator('.order-invoice-state')).toContainText('FT-')
  await page.getByRole('button', { name: 'Siparişi onayla', exact: true }).click()
  await expect(page.locator('.order-detail-summary')).toContainText('Onaylandı')
  await page.getByLabel('Sipariş eki', { exact: true }).setInputFiles({
    name: 'siparis-belgesi.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  })
  await expect(
    page.getByRole('link', { name: 'siparis-belgesi.pdf', exact: true }),
  ).toHaveAttribute('href', /^\/api\/files\//)
  await page.screenshot({ path: testInfo.outputPath('order-detail-desktop.png'), fullPage: true })
  state = (await (await request.get('/api/workspace')).json()).state as AppState
  expect(state.invoices).toHaveLength(1)
  expect(state.products[0].variants[0].stockByWarehouse?.shop).toBe(8)
  expect(state.orders[0].notes).toHaveLength(2)
  expect(state.orders[0].lines.every((line) => line.prepared)).toBe(true)
  await page.getByRole('button', { name: 'Kargoya verildi', exact: true }).click()
  await page.getByLabel('Kargo firması', { exact: true }).fill('Aras')
  await page.getByLabel('Kargo takip numarası', { exact: true }).fill('OFFSITE-001')
  await page.getByRole('button', { name: 'Kargo bilgisini kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Teslim edildi', exact: true }).click()
  await page.getByRole('button', { name: 'İade edildi', exact: true }).click()
  const restock = page.getByRole('checkbox', { name: 'Stoklar depoya geri yüklensin', exact: true })
  await page.locator('label').filter({ has: restock }).click()
  await page.getByLabel('İade notu', { exact: true }).fill('Hasarlı ürün')
  await page.getByRole('button', { name: 'İadeyi kaydet', exact: true }).click()
  await expect(page.locator('.order-detail-summary')).toContainText('İade edildi')
  await page.reload()
  state = (await (await request.get('/api/workspace')).json()).state as AppState
  expect(state.products[0].variants[0].stockByWarehouse?.shop).toBe(8)
  expect(state.cash).toHaveLength(2)
  expect(state.invoices[0].status).toBe('cancelled')
  await page.context().addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printRequested = 'true'
    }
  })
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Sipariş detayı yazdır', exact: true }).click()
  const popup = await popupPromise
  await expect(popup.getByRole('table')).toContainText('Montaj hizmeti')
  await popup.getByRole('button', { name: 'Yazdır', exact: true }).click()
  await expect(popup.locator('html')).toHaveAttribute('data-print-requested', 'true')
  await popup.close()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('order-detail-mobile.png'), fullPage: true })
  await page.getByRole('link', { name: 'Listeye dön', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Siparişlerde ara', exact: true }).fill('OFFSITE-001')
  await expect(page.getByRole('grid')).toContainText('PHONE-11')
  await page.getByRole('button', { name: 'Filtre', exact: true }).click()
  await page.getByRole('button', { name: 'Filtreyi kaydet', exact: true }).click()
  await page.getByLabel('Filtre adı', { exact: true }).fill('Kontrol edilecek')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Kontrol edilecek', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.reload()
  await expect(page.getByRole('grid')).toContainText('PHONE-11')
  await page.getByRole('button', { name: 'Sütunları seç', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Ürünler', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('columnheader', { name: 'Ürünler', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Ürünler', exact: true })).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  expect(errors).toEqual([])
})
