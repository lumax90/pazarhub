import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { pricingWorkspaceOwner } from '../tests/pricing-workspace-fixture'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { catalogParts } from '../tests/catalog-workspace-fixture'
import type { AppState, Command } from '../src/domain/types'

test.use({ baseURL: 'http://localhost:4174', actionTimeout: 15000 })
test('configures verified margin rules, VAT input and provider-wide brand mappings', async ({
  page,
}, info) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const request = page.context().request
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin: 'http://localhost:4174' },
        data: { email: pricingWorkspaceOwner.email, password: pricingWorkspaceOwner.password },
      })
    ).ok(),
  ).toBe(true)
  const session = await (await request.get('/api/session')).json()
  const headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const command = async (body: Command) => {
    const result = await request.post('/api/commands', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: body,
    })
    expect(result.ok(), await result.text()).toBe(true)
    return result.json()
  }
  const connection = await request.post('/api/integrations', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      provider: 'trendyol',
      name: 'Fiyat Mağazası',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials: { sellerId: '123', apiKey: 'fixture', apiSecret: 'fixture' },
    },
  })
  expect(connection.ok()).toBe(true)
  const storeId = (await connection.json()).id
  await request.post(`/api/integrations/${storeId}/jobs`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { operation: 'test' },
  })
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/integrations')).json()).connections.find(
          (store: { id: string }) => store.id === storeId,
        )?.status,
    )
    .toBe('verified')
  await command({ type: 'warehouse.save', warehouse: { id: 'shop', name: 'Mağaza', active: true } })
  const product = catalogParts()[0]
  product.brand = 'TestMarka'
  product.variants[0].price = 10000
  product.variants[0].cost = 5000
  await command({ type: 'product.save', product })
  const draft = await request.post('/api/listing-drafts', {
    headers,
    data: { storeId, productId: product.id, variantIds: [product.variants[0].id] },
  })
  expect(draft.ok(), await draft.text()).toBe(true)
  await page.goto('/margins')
  await page.getByRole('button', { name: 'Kural ekle', exact: true }).click()
  await page.getByLabel('Marj değeri (%)', { exact: true }).fill('50')
  await page.getByLabel('Kargo ücreti (₺)', { exact: true }).fill('20')
  await page.getByLabel('Sabit gider (₺)', { exact: true }).fill('10')
  await page.getByLabel('Platform komisyonu (%)', { exact: true }).fill('20')
  await expect(page.locator('.margin-example')).toContainText('243,75')
  await page.screenshot({ path: info.outputPath('margin-example.png') })
  await page.getByRole('button', { name: 'Kuralı kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Şablonu düzenle', exact: true }).click()
  await page.getByRole('button', { name: 'Yuvarlama', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Yukarı, ,99 ile bitir', exact: true }).click()
  await page.getByRole('button', { name: 'Şablonu kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('grid', { name: 'Mağaza marj kuralları' })).toContainText('%50')
  await page.goto('/ecommerce-settings')
  await page.getByRole('button', { name: 'Ürün ve Stok', exact: true }).click()
  await page
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', { name: 'Ürün fiyatları KDV dahil girilir', exact: true }),
    })
    .click()
  await page.getByRole('button', { name: 'Ayarları kaydet', exact: true }).click()
  await expect
    .poll(
      async () =>
        ((await (await request.get('/api/workspace')).json()).state as AppState).ecommerce
          ?.pricesIncludeVat,
    )
    .toBe(false)
  await page.goto('/products/part-a?tab=prices')
  await page.getByLabel('Satış fiyatı (₺)', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Fiyatları kaydet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fiyatları kaydet', exact: true })).toBeDisabled()
  expect(
    ((await (await request.get('/api/workspace')).json()).state as AppState).products.find(
      (product) => product.id === 'part-a',
    )?.variants[0].price,
  ).toBe(12000)
  await page.goto('/definitions/mappings')
  await page
    .getByRole('group', { name: 'Eşleme türü', exact: true })
    .getByRole('button', { name: 'Markalar', exact: true })
    .click()
  await page.getByRole('button', { name: 'Eşleme ekle', exact: true }).click()
  await page.getByRole('button', { name: 'Pazaryeri markası', exact: true }).click()
  await page
    .getByRole('searchbox', { name: 'Pazaryeri markası ara', exact: true })
    .fill('TestMarka')
  await page.getByRole('button', { name: /TestMarka.*42/ }).click()
  await page.getByRole('button', { name: 'Eşlemeyi kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const state = (await (await request.get('/api/workspace')).json()).state as AppState
  expect(state.catalogValueMappings?.[0]).toMatchObject({
    provider: 'trendyol',
    kind: 'brand',
    brandId: '42',
  })
  await page.goto('/margins')
  await expect(page.getByRole('grid', { name: 'Hesaplanan ilan fiyatları' })).toContainText(
    '281,99',
  )
  await page.getByRole('button', { name: 'Şablonu düzenle', exact: true }).click()
  await page
    .getByRole('dialog')
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'Otomatik fiyat hesabı', exact: true }) })
    .click()
  await page.getByRole('button', { name: 'Şablonu kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await command({
    type: 'product.patch',
    id: product.id,
    expectedVersion: state.products.find((item) => item.id === product.id)!.version!,
    patch: { variants: [{ id: product.variants[0].id, price: 20000 }] },
  })
  await page.reload()
  await expect(page.getByRole('grid', { name: 'Hesaplanan ilan fiyatları' })).toContainText(
    '281,99',
  )
  await page.getByRole('button', { name: 'Şimdi uygula', exact: true }).click()
  await expect(page.getByRole('grid', { name: 'Hesaplanan ilan fiyatları' })).toContainText(
    '431,99',
  )
  await page.goto('/inventory/levels')
  await page.getByRole('button', { name: 'HAVLU stok işlemleri', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Kritik seviye', exact: true }).click()
  await page.getByLabel('Mağaza kritik seviye', { exact: true }).fill('5')
  await page.getByRole('dialog').getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: 'HAVLU' })).toContainText('Düşük stok')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/margins')
  await expect(page.getByRole('heading', { name: 'Marj Ayarları', exact: true })).toBeVisible()
  await expect(page.getByRole('grid', { name: 'Mağaza marj kuralları' })).toBeVisible()
  await expect
    .poll(() =>
      page.locator('.page-frame').evaluate((element) => getComputedStyle(element).opacity),
    )
    .toBe('1')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('margins-mobile.png'), fullPage: true })
  expect(errors).toEqual([])
})
