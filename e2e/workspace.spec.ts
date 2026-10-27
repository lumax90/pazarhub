import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('pazarhub.mode', 'demo'))
})

test('toplu seçim yalnızca görünen sayfayı kapsar', async ({ page }) => {
  await page.goto('/orders')
  const selectAll = page.getByRole('checkbox', {
    name: 'Bu sayfadaki tüm kayıtları seç',
    exact: true,
  })
  await page.locator('label').filter({ has: selectAll }).click()
  await expect(selectAll).toBeChecked()
  await expect(page.locator('.selection-toolbar')).toContainText('10 sipariş seçildi')
  await page.getByRole('button', { name: 'Sonraki sayfa', exact: true }).click()
  await expect(page.locator('.selection-toolbar')).toHaveCount(0)
})

test('ana ekran ve bütün çalışma alanları hatasız açılır', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const routes = [
    ['/dashboard', 'Gününüz, bir bakışta.'],
    ['/orders', 'Siparişler'],
    ['/products', 'Ürünler'],
    ['/customers', 'Müşteriler'],
    ['/inventory', 'Stok durumu'],
    ['/listings', 'Platform Listelemeleri'],
    ['/retail', 'Perakende'],
    ['/connections', 'Pazaryeri Entegrasyonları'],
    ['/finance/invoices', 'Faturalar'],
    ['/finance/cash', 'Kasa Hareketleri'],
    ['/reports', 'Satış Özeti'],
    ['/settings', 'Çalışma Alanı Ayarları'],
    ['/shipments', 'Kargo Gönderileri'],
    ['/returns', 'İade Yönetimi'],
    ['/jobs', 'İşlem Merkezi'],
    ['/team', 'Kullanıcılar ve Roller'],
    ['/margins', 'Marj Ayarları'],
    ['/finance/expenses', 'Giderler ve Alışlar'],
    ['/finance/customers', 'Cari Hesaplar'],
  ]
  for (const [route, title] of routes) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  }
  await page.goto('/dashboard')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: testInfo.outputPath('dashboard-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  })
  expect(errors).toEqual([])
})

test('sipariş oluşturma, onay, fatura ve kalıcılık akışı çalışır', async ({ page }) => {
  await page.goto('/orders')
  await page.getByRole('button', { name: 'Sipariş oluştur', exact: true }).click()
  await page.getByRole('combobox', { name: 'Müşteri', exact: true }).fill('Selin')
  await page.getByRole('combobox', { name: 'Müşteri', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: 'Müşteri', exact: true }).press('Enter')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Üründen satır ekle', exact: true }).fill('KS-001-KUM')
  await page.getByRole('option').filter({ hasText: 'Aura Seramik Vazo' }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Siparişi oluştur', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^Sipariş SP-/, level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Siparişi onayla', exact: true }).click()
  await expect(
    page.locator('.order-detail-summary').getByText('Onaylandı', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.order-invoice-state').getByText(/FT-/)).toBeVisible()
  await page.reload()
  await expect(
    page.locator('.order-detail-summary').getByText('Onaylandı', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Tahsilat kaydet', exact: true }).click()
  await expect(
    page.locator('.order-payment-state').getByText('Tahsilat kaydedildi', { exact: true }),
  ).toBeVisible()
})

test('perakende barkod satışı ortak stok ve kasaya yansır', async ({ page }) => {
  await page.goto('/retail')
  await page
    .locator('.retail-shortcuts')
    .getByRole('link', { name: /Yeni satış/ })
    .click()
  await expect(page.getByRole('button', { name: 'Satışı tamamla', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Barkod okut', exact: true }).fill('8690000000011')
  await page.getByRole('textbox', { name: 'Barkod okut', exact: true }).press('Enter')
  await expect(page.locator('.retail-cart .cart-line')).toHaveCount(1)
  await page.getByRole('button', { name: 'Satışı tamamla', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Satış tamamlandı', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('PS-000001', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Yeni satışa geç' }).click()
  await page.goto('/inventory')
  const row = page.getByRole('row').filter({ hasText: 'KS-001-KUM' })
  await expect(row.getByText('85', { exact: true })).toBeVisible()
  await page.goto('/finance/cash')
  await expect(
    page.getByRole('row').filter({ hasText: 'PS-000001 · perakende satışı' }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('row').filter({ hasText: 'PS-000001 · perakende satışı' }),
  ).toBeVisible()
})

test('yeni ürün formu, varyant fiyatları ve arama çalışır', async ({ page }) => {
  await page.goto('/products')
  await page.getByRole('button', { name: 'Yeni ürün', exact: true }).click()
  await expect(page).toHaveURL(/\/products\/new$/)
  await page
    .locator('.product-category-choices')
    .getByRole('button', { name: /Ev & Dekorasyon/ })
    .click()
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
  await page.getByRole('textbox', { name: /^Ürün adı/ }).fill('Test Seramik Ürün')
  await page.getByRole('textbox', { name: 'Barkod', exact: true }).fill('8691110000123')
  await page.getByRole('spinbutton', { name: 'Açılış stoğu', exact: true }).fill('12')
  await page.getByRole('textbox', { name: 'Satış fiyatı (₺)', exact: true }).fill('499,90')
  await page.getByRole('textbox', { name: 'Alış maliyeti (₺)', exact: true }).fill('199,90')
  await page.getByRole('button', { name: 'Ürünü oluştur', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Test Seramik Ürün', level: 1 })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(9)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('textbox', { name: /^Ürün adı/ }).fill('Test Seramik Güncel')
  await page.getByRole('tab', { name: 'Fiyatlar', exact: true }).click()
  await page.getByRole('textbox', { name: 'Satış fiyatı (₺)', exact: true }).fill('549,90')
  await page.getByRole('button', { name: 'Fiyatları kaydet', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Test Seramik Ürün', level: 1 })).toBeVisible()
  await page.getByRole('tab', { name: /^Ürün Bilgileri/ }).click()
  await expect(page.getByRole('textbox', { name: /^Ürün adı/ })).toHaveValue('Test Seramik Güncel')
  await page.getByRole('button', { name: 'Ürün bilgilerini kaydet', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Test Seramik Güncel', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Ürünler', exact: true }).last().click()
  await page.getByRole('searchbox', { name: 'Ürünlerde ara', exact: true }).fill('Test Seramik')
  await expect(page.getByRole('row').filter({ hasText: 'Test Seramik Güncel' })).toContainText(
    '549,90',
  )
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: 'Test Seramik Güncel' })).toBeVisible()
})

test('mobil gezinme, genel arama ve koyu tema kullanılabilir', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Menüyü aç', exact: true }).click()
  await page
    .locator('.sidebar-navigation')
    .getByRole('link', { name: /Siparişler/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Siparişler', level: 1 })).toBeVisible()
  await expect(page.locator('.app-sidebar')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('combobox', { name: 'Genel arama', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Arama sonuçları', exact: true })).toBeVisible()
  await page.getByLabel('Genel arama', { exact: true }).fill('Aura')
  await page.getByRole('option', { name: /Aura Seramik Vazo/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Aura Seramik Vazo', exact: true }).first(),
  ).toBeVisible()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Koyu', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.goto('/dashboard')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: testInfo.outputPath('dashboard-mobile-dark.png'),
    fullPage: true,
    animations: 'disabled',
  })
})
