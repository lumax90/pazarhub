import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { AppState, Command } from '../src/domain/types'
import { productWorkspaceOwner } from '../tests/product-workspace-fixture'

test.use({ baseURL: 'http://localhost:4174' })

test('creates a variant matrix, edits product sections and sells from the selected warehouse', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const request = page.context().request
  const registered = await request.post('/api/auth/login', {
    headers: { origin: 'http://localhost:4174' },
    data: { email: productWorkspaceOwner.email, password: productWorkspaceOwner.password },
  })
  expect(registered.status()).toBe(200)
  const session = await (await request.get('/api/session')).json()
  const command = (input: Command) =>
    request.post('/api/commands', {
      headers: {
        origin: 'http://localhost:4174',
        'x-csrf-token': session.csrfToken,
        'idempotency-key': randomUUID(),
      },
      data: input,
    })
  expect(
    (
      await command({
        type: 'warehouse.save',
        warehouse: { id: 'shop', name: 'Mağaza', active: true },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/products/new')
  await page.getByRole('button', { name: 'Yeni kategori ekle', exact: true }).click()
  await page.getByLabel('Kategori adı', { exact: true }).fill('Giyim')
  await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Varyantlı ürün', exact: true }) })
    .click()
  await page.getByLabel('Stok kodu öneki', { exact: true }).fill('TSHIRT')
  await page.getByLabel('Renk değerleri', { exact: true }).fill('Siyah, Beyaz')
  await page.getByRole('button', { name: 'Değerleri ekle', exact: true }).click()
  await page.getByRole('button', { name: 'Varyant tipi ekle', exact: true }).click()
  await page.getByLabel('Varyant tipi 2', { exact: true }).fill('Beden')
  await page.getByLabel('Beden değerleri', { exact: true }).fill('S, M')
  await page.getByRole('button', { name: 'Değerleri ekle', exact: true }).last().click()
  await expect(page.locator('.variant-combination-summary')).toContainText('4 kombinasyon')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('product-variant-step.png'), fullPage: true })
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
  await page.getByLabel('Ürün adı', { exact: true }).fill('Varyantlı Test Tişört')
  await page.getByLabel('Fatura adı', { exact: true }).fill('Pamuklu tişört seti')
  await page.getByRole('button', { name: 'Ürün birimi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Set', exact: true }).click()
  await page.getByLabel('Menşei ülke kodu', { exact: true }).fill('TR')
  await page.getByLabel('Desi', { exact: true }).fill('2.5')
  await page.getByRole('button', { name: 'Açılış deposu', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Mağaza', exact: true }).click()
  await page.getByLabel('Ortak satış fiyatı (₺)', { exact: true }).fill('149,90')
  await page.getByRole('button', { name: 'Satış fiyatını uygula', exact: true }).click()
  await page.getByLabel('Ortak alış maliyeti (₺)', { exact: true }).fill('70,00')
  await page.getByRole('button', { name: 'Maliyeti uygula', exact: true }).click()
  await page.getByLabel('Ortak açılış stoğu', { exact: true }).fill('3')
  await page.getByRole('button', { name: 'Stoğu uygula', exact: true }).click()
  await page.getByLabel('Barkod · Siyah / S', { exact: true }).fill('0012345000')
  await page.locator('input[type=file]').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1cAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(page.locator('.product-image-frame img')).toHaveCount(1)
  await page.getByRole('button', { name: 'Ürünü oluştur', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Varyantlı Test Tişört', level: 1 })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(9)
  let workspace = (await (await request.get('/api/workspace')).json()).state as AppState
  expect(workspace.products[0].variants).toHaveLength(4)
  expect(
    workspace.products[0].variants.every(
      (v) =>
        v.stock === 3 && v.stockByWarehouse?.shop === 3 && v.price === 14990 && v.cost === 7000,
    ),
  ).toBe(true)
  expect(workspace.movements).toHaveLength(4)
  expect(workspace.products[0].images).toHaveLength(1)
  await page.getByRole('tab', { name: 'Teknik Özellikler', exact: true }).click()
  await page.getByRole('button', { name: 'Özellik ekle', exact: true }).click()
  await page.getByLabel('Özellik 1', { exact: true }).fill('Materyal')
  await page.getByLabel('Değer 1', { exact: true }).fill('Pamuk')
  await page.getByRole('button', { name: 'Teknik özellikleri kaydet', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Teknik özellikleri kaydet', exact: true }),
  ).toBeDisabled()
  await page.getByRole('tab', { name: 'Stoklar', exact: true }).click()
  await page.getByRole('button', { name: 'Ürün stok deposu', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Mağaza', exact: true }).click()
  await page.getByRole('button', { name: 'TSHIRT-001 stok düzelt', exact: true }).click()
  await page.getByLabel('Yeni stok miktarı', { exact: true }).fill('5')
  await page.getByLabel('Düzeltme nedeni', { exact: true }).fill('Mağaza sayımı')
  await page.getByRole('button', { name: 'Düzeltmeyi kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('tab', { name: 'Ürün Bilgileri', exact: true }).click()
  await expect(page.getByLabel('Fatura adı', { exact: true })).toHaveValue('Pamuklu tişört seti')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('product-detail-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/retail')
  await expect(page.getByRole('heading', { name: 'Perakende', level: 1 })).toBeVisible()
  await expect
    .poll(() => page.locator('.page-frame').evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1')
  await page.screenshot({ path: testInfo.outputPath('retail-home-desktop.png') })
  await page
    .locator('.retail-shortcuts')
    .getByRole('link', { name: /Yeni satış/ })
    .click()
  await page.getByRole('button', { name: 'Perakende deposu', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Mağaza', exact: true }).click()
  await page.getByLabel('Barkod okut', { exact: true }).fill('0012345000')
  await page.getByLabel('Barkod okut', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Satışı tamamla', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Satış tamamlandı', exact: true })).toBeVisible()
  workspace = (await (await request.get('/api/workspace')).json()).state as AppState
  expect(workspace.retailSales[0].lines[0]).toMatchObject({
    invoiceTitle: 'Pamuklu tişört seti · Siyah / S',
    unit: 'Set',
    unitPrice: 14990,
  })
  expect(workspace.products[0].variants[0].stockByWarehouse?.shop).toBe(4)
  expect(workspace.products[0].technicalAttributes?.[0]).toMatchObject({
    name: 'Materyal',
    value: 'Pamuk',
  })
  expect(errors).toEqual([])
})
