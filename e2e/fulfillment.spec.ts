import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { AppState, Command } from '../src/domain/types'
import { fulfillmentOwner } from '../tests/integration-workspace-fixtures'

test.use({ baseURL: 'http://localhost:4174' })
test('packages marketplace order lines and downloads a verified carrier label from the order workspace', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const request = page.context().request,
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin: 'http://localhost:4174' },
        data: {
          email: fulfillmentOwner.email,
          password: fulfillmentOwner.password,
        },
      })
    ).status(),
  ).toBe(200)
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
  for (const [index, name] of ['Havlu', 'Sabun'].entries())
    await command({
      type: 'product.save',
      product: {
        id: `product-${index}`,
        name,
        category: 'Banyo',
        brand: 'Marka',
        description: '',
        art: 'towel',
        color: '#cccccc',
        taxRate: 20,
        active: true,
        lowStock: 1,
        variants: [
          {
            id: `v${index}`,
            name: 'Standart',
            sku: `SKU-${index === 0 ? 'A' : 'B'}`,
            barcode: `869123456789${index}`,
            price: index === 0 ? 12000 : 5000,
            cost: 1000,
            stock: 10,
          },
        ],
      },
    })
  const input = {
    provider: 'hepsiburada',
    name: 'Hepsiburada Kargo',
    enabled: false,
    settings: defaultIntegrationSettings,
    credentials: {
      merchantId: '11111111-1111-4111-8111-111111111111',
      password: 'fixture',
    },
  }
  const created = await request.post('/api/integrations', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: input,
  })
  expect(created.status()).toBe(201)
  const storeId = (await created.json()).id
  await request.post(`/api/integrations/${storeId}/jobs`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { operation: 'test' },
  })
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/integrations')).json()).connections.find(
          (connection: { id: string }) => connection.id === storeId,
        )?.status,
      { timeout: 15000 },
    )
    .toBe('verified')
  await request.patch(`/api/integrations/${storeId}`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { ...input, enabled: true },
  })
  await request.post(`/api/integrations/${storeId}/jobs`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { operation: 'orders.pull' },
  })
  const state = async () => (await (await request.get('/api/workspace')).json()).state as AppState
  await expect.poll(async () => (await state()).orders.length, { timeout: 25000 }).toBe(1)
  const orderId = (await state()).orders[0].id
  await command({ type: 'order.transition', id: orderId, status: 'approved' })
  await page.goto(`/orders/${orderId}`)
  await page.getByRole('button', { name: 'Paket işlemleri', exact: true }).click()
  await expect(page.getByRole('grid', { name: 'Pazaryeri sipariş kalemleri' })).toContainText(
    'Havlu',
  )
  await page
    .getByRole('dialog')
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'SKU-B', exact: true }) })
    .click()
  await page.getByRole('button', { name: 'Pazaryerine gönder', exact: true }).click()
  await expect
    .poll(async () => (await state()).orders[0].fulfillmentWorkflow?.state, { timeout: 45000 })
    .toBe('confirmed')
  await page.getByRole('button', { name: 'Paket işlemleri', exact: true }).click()
  await page.getByRole('button', { name: 'Pazaryeri işlemi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Etiket al', exact: true }).click()
  await page.getByRole('button', { name: 'Pazaryerine gönder', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Pazaryeri etiketi', exact: true })).toBeVisible({
    timeout: 25000,
  })
  // Our own label carries the marketplace tracking code as a Code 128 barcode.
  const tracking = (await state()).orders[0].marketplacePackages?.find(
    (item) => item.trackingNumber,
  )?.trackingNumber
  expect(tracking).toBeTruthy()
  const labelPage = await page.context().newPage()
  await labelPage.goto(
    (await page
      .getByRole('link', { name: 'Kargo etiketi', exact: true })
      .first()
      .getAttribute('href'))!,
  )
  await expect(labelPage.locator('.order-print-label')).toHaveCount(1)
  await expect(labelPage.getByRole('img', { name: `Barkod ${tracking}` })).toBeVisible()
  await expect(labelPage.locator('.order-print-label-recipient')).not.toBeEmpty()
  await labelPage.close()
  await page.getByRole('button', { name: 'Paket işlemleri', exact: true }).click()
  await page.getByRole('button', { name: 'Pazaryeri işlemi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Pazaryerinde iptal et', exact: true }).click()
  await page.getByRole('button', { name: 'Pazaryerine gönder', exact: true }).click()
  await expect
    .poll(async () => !!(await state()).orders[0].syncError, { timeout: 30000 })
    .toBe(true)
  await page.getByRole('button', { name: 'Kalemleri uzlaştır', exact: true }).click()
  await page
    .getByLabel('Uzlaştırma notu', { exact: true })
    .fill('Pazaryeri iptali doğrulandı, kullanılmayan ürün depoya döndü.')
  await page.getByRole('button', { name: 'Etkiyi önizle', exact: true }).click()
  await expect(page.getByRole('grid', { name: 'Uygulanacak stok farkları' })).toContainText('+1')
  await page.getByRole('button', { name: 'Doğrulanan planı uygula', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Sipariş uzlaştırması', exact: true }),
  ).toHaveCount(0)
  expect(
    (await state()).products.find((product) => product.id === 'product-1')?.variants[0].stock,
  ).toBe(10)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('marketplace-order-mobile.png'), fullPage: true })
  expect(errors).toEqual([])
})
