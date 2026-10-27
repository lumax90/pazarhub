import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { AppState, Command } from '../src/domain/types'
import { catalogParts, catalogWorkspaceOwner } from '../tests/catalog-workspace-fixture'

test.use({ baseURL: 'http://localhost:4174', actionTimeout: 10000 })
test('manages definitions, creates a shared-stock package and records its warehouse movements', async ({
  page,
}, testInfo) => {
  test.setTimeout(150000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const request = page.context().request
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin: 'http://localhost:4174' },
        data: { email: catalogWorkspaceOwner.email, password: catalogWorkspaceOwner.password },
      })
    ).ok(),
  ).toBe(true)
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
    return response.json()
  }
  const snapshot = async () =>
    (await (await request.get('/api/workspace')).json()).state as AppState
  await command({
    type: 'warehouse.save',
    warehouse: { id: 'shop', name: 'Mağaza', code: 'MAGAZA', active: true },
  })
  for (const product of catalogParts()) await command({ type: 'product.save', product })

  await page.goto('/definitions/categories')
  await page.getByRole('button', { name: 'Yeni kategori', exact: true }).click()
  await page.getByLabel('Kategori adı', { exact: true }).fill('Ev')
  await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Banyo işlemleri', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Düzenle', exact: true }).click()
  await page.getByRole('button', { name: 'Üst kategori', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Ev', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await snapshot()).products.every((p) => p.category === 'Ev / Banyo')).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('category-tree-desktop.png') })

  await page.goto('/definitions/colors')
  await page.getByRole('button', { name: 'Yeni renk', exact: true }).click()
  await page.getByLabel('Renk adı', { exact: true }).fill('Tebeşir')
  await page.getByLabel('Renk kodu', { exact: true }).fill('#f2e9df')
  await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/definitions/variants')
  await page.getByRole('button', { name: 'Yeni varyant', exact: true }).click()
  await page.getByLabel('Varyant adı', { exact: true }).fill('Beden')
  await page.getByLabel('Seçenekler', { exact: true }).fill('S, M')
  await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.definition-option-cards')).toContainText('Tebeşir')

  await page.goto('/definitions/specs')
  await page.getByRole('button', { name: 'Yeni özellik', exact: true }).click()
  await page.getByLabel('Özellik adı', { exact: true }).fill('Malzeme')
  await page.getByLabel('Yeni değerler', { exact: true }).fill('Pamuk\nKeten')
  await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/products/part-a?tab=attributes')
  await page.getByRole('combobox', { name: 'Tanımlı özellik ekle', exact: true }).fill('Malzeme')
  await page.getByRole('option', { name: 'Malzeme', exact: true }).click()
  await page.getByRole('button', { name: 'Malzeme değerleri', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Pamuk', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Keten', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Teknik özellikleri kaydet', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Teknik özellikleri kaydet', exact: true }),
  ).toBeDisabled()
  expect(
    (await snapshot()).products.find((p) => p.id === 'part-a')?.technicalAttributes?.[0]
      .valueLabels,
  ).toEqual(['Pamuk', 'Keten'])

  await page.goto('/products')
  await page.getByRole('button', { name: 'Paket oluştur', exact: true }).click()
  await page
    .locator('.product-category-choices')
    .getByRole('button', { name: 'Ev / Banyo', exact: true })
    .click()
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
  await page.getByRole('combobox', { name: 'Ürün ekle', exact: true }).fill('HAVLU')
  await page.getByRole('option').filter({ hasText: 'Pamuklu havlu' }).click()
  await page.getByLabel('HAVLU paket adedi', { exact: true }).fill('2')
  await page.getByRole('combobox', { name: 'Ürün ekle', exact: true }).fill('SABUN')
  await page.getByRole('option').filter({ hasText: 'El yapımı sabun' }).click()
  await expect(page.locator('.bundle-summary-strip')).toContainText('2 ürün · 3 adet')
  await page.screenshot({
    path: testInfo.outputPath('bundle-components-desktop.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
  await page.getByLabel('Paket adı', { exact: true }).fill('Banyo hediye paketi')
  await page.getByLabel('Paket stok kodu', { exact: true }).fill('PAKET-TEST')
  await page.getByLabel('Paket barkodu', { exact: true }).fill('009900')
  await page.getByLabel('Paket indirimi (%)', { exact: true }).fill('12.5')
  await page
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', { name: 'Paket içeriğini açıklamaya ekle', exact: true }),
    })
    .click()
  await expect(page.locator('.bundle-final-price')).toContainText('35,04')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('bundle-information-desktop.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Paketi kaydet', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Banyo hediye paketi', level: 1 })).toBeVisible()
  let state = await snapshot(),
    bundle = state.products.find((p) => p.bundle)!
  expect(bundle.variants[0]).toMatchObject({ stock: 0, price: 0, cost: 0, barcode: '009900' })
  expect(bundle.description).toContain('<td>HAVLU</td>')
  expect(bundle.description).toContain('<td>2</td>')
  await page.getByRole('tab', { name: 'Fiyatlar', exact: true }).click()
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Fiyatı sabit tut', exact: true }) })
    .click()
  await page.getByLabel('Sabit paket fiyatı (₺)', { exact: true }).fill('49,90')
  await page.getByRole('button', { name: 'Fiyatları kaydet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fiyatları kaydet', exact: true })).toBeDisabled()
  bundle = (await snapshot()).products.find((p) => p.id === bundle.id)!
  expect(bundle.variants[0].price).toBe(4990)

  await command({
    type: 'customer.save',
    customer: {
      id: 'catalog-customer',
      name: 'Paket müşterisi',
      city: 'İstanbul',
      address: 'Test sokak',
      phone: '',
      email: '',
    },
  })
  const created = await command({
    type: 'order.create',
    input: {
      customerId: 'catalog-customer',
      channel: 'manual',
      shipping: 0,
      note: '',
      items: [{ variantId: bundle.variants[0].id, quantity: 2, bundleVersion: bundle.version }],
    },
  })
  await page.goto(`/orders/${created.result.id}`)
  await page.locator('.sale-bundle-contents summary').click()
  await expect(page.locator('.sale-bundle-contents')).toContainText('4 adet')
  await page.getByRole('button', { name: 'Siparişi onayla', exact: true }).click()
  await expect(page.locator('.order-detail-summary')).toContainText('Onaylandı')
  state = await snapshot()
  expect(state.products.find((p) => p.id === 'part-a')?.variants[0].stockByWarehouse?.main).toBe(8)
  await command({ type: 'order.transition', id: created.result.id, status: 'cancelled' })
  await page.goto('/inventory/levels')
  await page.getByRole('button', { name: 'HAVLU stok işlemleri', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Stok girişi', exact: true }).click()
  await page.getByLabel('Miktar', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Hareket sebebi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Üretim', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  state = await snapshot()
  expect(state.movements[0]).toMatchObject({
    balance: 13,
    author: catalogWorkspaceOwner.name,
    reason: 'Üretim',
  })
  await page.getByRole('button', { name: 'Depo transferi', exact: true }).click()
  await page.getByLabel('Transfer açıklaması', { exact: true }).fill('Depo dengeleme')
  await page.getByRole('button', { name: 'Hedef depo', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Mağaza', exact: true }).click()
  await page.getByRole('button', { name: 'Transfer edilecek varyant', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Pamuklu havlu · HAVLU', exact: true }).click()
  await page.getByLabel('Transfer adedi', { exact: true }).fill('2')
  await page.getByRole('dialog').getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/inventory/transfers')
  await expect(page.getByRole('row').filter({ hasText: 'Depo dengeleme' })).toBeVisible()
  await page.goto('/inventory/movements')
  await expect(page.getByRole('grid', { name: 'Stok hareketleri' })).toContainText(
    catalogWorkspaceOwner.name,
  )
  await page.screenshot({
    path: testInfo.outputPath('stock-movements-desktop.png'),
    fullPage: true,
  })
  state = await snapshot()
  expect(state.products.find((p) => p.id === 'part-a')?.variants[0].stockByWarehouse).toEqual({
    main: 11,
    shop: 5,
  })
  await command({
    type: 'preferences.update',
    preferences: { ...state.preferences, theme: 'dark' },
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/products/${bundle.id}?tab=stocks`)
  await expect(page.getByRole('heading', { name: 'Banyo hediye paketi', level: 1 })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('bundle-stock-mobile-dark.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
})
