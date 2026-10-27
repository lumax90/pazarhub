import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { invoiceWorkspaceOwner } from '../tests/invoice-workspace-fixture'
import type { AppState, Command } from '../src/domain/types'
import { catalogParts } from '../tests/catalog-workspace-fixture'

test.use({ baseURL: 'http://localhost:4174' })
test('manages an independent invoice through currency, stock, cash, editing, cancellation and restoration', async ({
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
        data: { email: invoiceWorkspaceOwner.email, password: invoiceWorkspaceOwner.password },
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
  await command({
    type: 'customer.save',
    customer: {
      id: 'invoice-customer',
      name: 'Fatura Müşterisi',
      phone: '5551234567',
      email: '',
      city: 'İstanbul',
      district: 'Kadıköy',
      address: 'Test Mahallesi Sokak 1',
      taxId: '11111111111',
    },
  })
  const product = catalogParts()[0]
  product.variants[0].stock = 10
  product.variants[0].stockByWarehouse = { main: 10 }
  product.variants[0].price = 48000
  await command({ type: 'product.save', product })
  await page.goto('/finance/invoices')
  await page.getByRole('link', { name: 'Fatura oluştur', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Fatura müşterisi', exact: true })
    .fill('Fatura Müşterisi')
  await page.getByRole('option').filter({ hasText: 'Fatura Müşterisi' }).click()
  await page.getByLabel('Fatura adı / açıklama', { exact: true }).fill('Bağımsız satış')
  await page.getByLabel('Fatura etiketleri', { exact: true }).fill('bayi, kampanya')
  await page.getByLabel('Fatura notları', { exact: true }).fill('Banka havalesi ile ödeme.')
  await page.getByLabel('Vade tarihi', { exact: true }).fill('2026-11-10')
  await page.getByRole('button', { name: 'Fatura para birimi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'USD', exact: true }).click()
  await page.getByLabel('Fatura döviz kuru (1 döviz = TRY)', { exact: true }).fill('40')
  await page
    .getByRole('combobox', { name: 'Fatura ürününden satır ekle', exact: true })
    .fill('Havlu')
  await page.getByRole('option').filter({ hasText: 'Havlu' }).first().click()
  await page.getByLabel('Fatura miktarı · satır 1', { exact: true }).fill('2')
  await page.getByLabel('Fatura birim fiyatı (KDV hariç) · satır 1', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Satır ekle', exact: true }).click()
  await page.getByLabel('2. fatura satırı açıklaması', { exact: true }).fill('Paketleme hizmeti')
  await page.getByLabel('Fatura birim fiyatı (KDV hariç) · satır 2', { exact: true }).fill('5')
  await expect(page.locator('.order-summary-totals')).toContainText('30,00')
  await expect(page.locator('.order-summary-totals')).toContainText('1.200,00')
  await page.getByRole('button', { name: 'Faturayı oluştur', exact: true }).click()
  await expect(page).toHaveURL(/\/finance\/invoices\/[^/]+$/)
  let current = await state()
  const invoice = current.invoices[0]
  expect(current.orders).toHaveLength(0)
  expect(current.products[0].variants[0].stock).toBe(8)
  await expect(page.getByRole('grid', { name: 'Fatura kalemleri' })).toContainText(
    'Paketleme hizmeti',
  )
  await page.getByRole('button', { name: 'Ödendi işaretle', exact: true }).click()
  await page.getByRole('button', { name: 'Tahsilat yöntemi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Kart', exact: true }).click()
  await page.getByLabel('Tahsilat tarihi / saati', { exact: true }).fill('2026-10-25T13:15')
  await page.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ödemeyi geri al', exact: true })).toBeVisible()
  expect((await state()).cash[0]).toMatchObject({
    method: 'card',
    amount: 120000,
    createdAt: '2026-10-25T10:15:00.000Z',
  })
  await expect(page.getByRole('link', { name: 'Faturayı düzenle', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ödemeyi geri al', exact: true }).click()
  await page.getByRole('button', { name: 'Onayla', exact: true }).click()
  await page.getByRole('link', { name: 'Faturayı düzenle', exact: true }).click()
  await page.getByLabel('Fatura miktarı · satır 1', { exact: true }).fill('3')
  await page.getByRole('button', { name: 'Faturayı kaydet', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: `Fatura ${invoice.number}`, exact: true }),
  ).toBeVisible()
  expect((await state()).products[0].variants[0].stock).toBe(7)
  await page.getByRole('button', { name: 'Resmileştirme / Paraşüt', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Paraşüt’e aktar', exact: true })).toBeDisabled()
  await page.locator('.dialog-footer').getByRole('button', { name: 'Kapat', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('independent-invoice-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Yerel faturayı iptal et', exact: true }).click()
  await page.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Geri al', exact: true })).toBeVisible()
  expect((await state()).products[0].variants[0].stock).toBe(10)
  await page.getByRole('button', { name: 'Geri al', exact: true }).click()
  await page.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Yerel faturayı iptal et', exact: true }),
  ).toBeVisible()
  expect((await state()).products[0].variants[0].stock).toBe(7)
  await page.goto('/finance/invoices')
  await expect(page.getByRole('grid', { name: 'Faturalar', exact: true })).toContainText(
    invoice.number,
  )
  await page.getByRole('button', { name: 'Fatura etiketi filtresi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'bayi', exact: true }).click()
  await page.getByRole('link', { name: invoice.number, exact: true }).click()
  await page.getByRole('button', { name: 'Sil', exact: true }).click()
  await page.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(page).toHaveURL('/finance/invoices')
  current = await state()
  expect(current.invoices).toHaveLength(0)
  expect(current.products[0].variants[0].stock).toBe(10)
  expect(current.orders).toHaveLength(0)
  expect(errors).toEqual([])
})
