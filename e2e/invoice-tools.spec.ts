import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { invoiceToolsOwner } from '../tests/invoice-tools-fixture'
import type { AppState, Command, InvoiceInput } from '../src/domain/types'
import { useSeededSession } from './seeded-session'

test.use({ baseURL: 'http://localhost:4174' })
test('manages stable invoice categories and collects only selected pending invoices together', async ({
  page,
}, info) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const request = page.context().request
  await useSeededSession(page, invoiceToolsOwner.email)
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
      id: 'customer',
      name: 'Tahsilat Müşterisi',
      email: '',
      phone: '5551234567',
      address: 'Test Mahallesi Sokak 1',
      city: 'İstanbul',
    },
  })
  await page.goto('/finance/invoices')
  await page.getByRole('button', { name: 'Fatura kategorileri', exact: true }).click()
  await page.getByLabel('Yeni kategori adı', { exact: true }).fill('Bayi')
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bayi', exact: true })).toBeVisible()
  await page.getByLabel('Yeni kategori adı', { exact: true }).fill('Boş kategori')
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Boş kategori', exact: true })).toBeVisible()
  await page.getByLabel('Yeni kategori adı', { exact: true }).fill('Kaydedilmemiş taslak')
  await page
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'Boş kategori etkin', exact: true }) })
    .click()
  await expect(page.getByLabel('Yeni kategori adı', { exact: true })).toHaveValue(
    'Kaydedilmemiş taslak',
  )
  await page.getByRole('button', { name: 'Bayi', exact: true }).click()
  await page.getByLabel('Kategori adı düzenle', { exact: true }).fill('Toptan')
  await page.getByRole('button', { name: 'Kategori adını kaydet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Toptan', exact: true })).toBeVisible()
  await page.locator('.dialog-footer').getByRole('button', { name: 'Tamam', exact: true }).click()
  const category = (await state()).invoiceCategories!.find(
    (category) => category.name === 'Toptan',
  )!
  const input: InvoiceInput = {
    customerId: 'customer',
    title: 'Tahsilat testi',
    note: '',
    issueDate: '2026-10-25',
    currency: 'TRY',
    localOnly: true,
    categoryId: category.id,
    items: [{ kind: 'free', title: 'Hizmet', quantity: 1, unitPrice: 10000, taxRate: 0 }],
  }
  for (const [id, change] of [
    ['first', {}],
    [
      'second',
      {
        currency: 'USD',
        rateSource: 'manual',
        exchangeRate: '4000000000',
        items: [{ kind: 'free', title: 'Döviz hizmeti', quantity: 1, unitPrice: 2000, taxRate: 0 }],
      },
    ],
    ['paid', { payment: { method: 'cash', at: '2026-10-25T10:00:00Z', warehouseId: 'main' } }],
    ['cancelled', {}],
  ] as [string, Partial<InvoiceInput>][])
    await command({ type: 'invoice.create', id, input: { ...input, ...change } })
  await command({ type: 'invoice.cancel', id: 'cancelled', expectedVersion: 1 })
  await page.reload()
  await page.getByRole('button', { name: 'Fatura kategorileri', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Toptan kategorisini sil', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Boş kategori kategorisini sil', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Boş kategori', exact: true })).toHaveCount(0)
  await page
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'Toptan etkin', exact: true }) })
    .click()
  await page.locator('.dialog-footer').getByRole('button', { name: 'Tamam', exact: true }).click()
  await page.getByRole('button', { name: 'Fatura kategorisi filtresi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Toptan (pasif)', exact: true }).click()
  const invoices = (await state()).invoices,
    grid = page.getByRole('grid', { name: 'Faturalar', exact: true })
  await expect(grid).toContainText('Toptan')
  await expect(
    grid
      .getByRole('row', {
        name: invoices.find((invoice) => invoice.id === 'paid')!.number,
        exact: true,
      })
      .getByRole('checkbox'),
  ).toBeDisabled()
  await expect(
    grid
      .getByRole('row', {
        name: invoices.find((invoice) => invoice.id === 'cancelled')!.number,
        exact: true,
      })
      .getByRole('checkbox'),
  ).toBeDisabled()
  await grid
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', {
        name: 'Bu sayfadaki ödeme bekleyen faturaları seç',
        exact: true,
      }),
    })
    .click()
  await expect(page.locator('.invoice-bulk-toolbar')).toContainText('2 fatura')
  await expect(page.locator('.invoice-bulk-toolbar')).toContainText('900,00')
  await page
    .locator('.invoice-bulk-toolbar')
    .getByRole('button', { name: 'Ödendi işaretle', exact: true })
    .click()
  const footer = page.locator('.dialog-footer')
  await expect(footer.getByRole('button', { name: 'Ödendi işaretle', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Toplu ödeme yöntemi', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Havale / EFT', exact: true }).click()
  await page.getByLabel('Toplu ödeme tarihi / saati', { exact: true }).fill('2026-10-25T15:30')
  await footer.getByRole('button', { name: 'Ödendi işaretle', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '2 faturayı ödendi işaretle', exact: true }),
  ).toHaveCount(0)
  await page.reload()
  const final = await state()
  expect(final.cash).toHaveLength(3)
  expect(
    final.cash
      .filter((entry) => entry.method === 'transfer')
      .map((entry) => entry.amount)
      .sort((a, b) => a - b),
  ).toEqual([10000, 80000])
  expect(
    final.cash
      .filter((entry) => entry.method === 'transfer')
      .every((entry) => entry.createdAt === '2026-10-25T12:30:00.000Z'),
  ).toBe(true)
  expect(final.invoices.find((invoice) => invoice.id === 'cancelled')?.status).toBe('cancelled')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Faturalar', exact: true })).toBeVisible()
  await expect(
    grid.getByRole('link', {
      name: invoices.find((invoice) => invoice.id === 'first')!.number,
      exact: true,
    }),
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('invoice-tools-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Fatura kategorileri', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Fatura kategorileri', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toptan', exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('invoice-categories-mobile.png'), fullPage: true })
  await page.locator('.dialog-footer').getByRole('button', { name: 'Tamam', exact: true }).click()
  expect(errors).toEqual([])
})
