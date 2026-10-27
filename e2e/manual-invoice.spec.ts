import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { manualInvoiceOwner } from '../tests/manual-invoice-fixture'
import type { AppState, Command, InvoiceInput } from '../src/domain/types'
import { useSeededSession } from './seeded-session'

test.use({ baseURL: 'http://localhost:4174' })
test('associates an externally issued invoice and keeps local payment, cancellation and link correction distinct', async ({
  page,
}, info) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const request = page.context().request
  await useSeededSession(page, manualInvoiceOwner.email)
  const session = await (await request.get('/api/session')).json(),
    headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const command = async (data: Command) => {
    const response = await request.post('/api/commands', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data,
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const state = async () => (await (await request.get('/api/workspace')).json()).state as AppState
  await command({
    type: 'customer.save',
    customer: {
      id: 'customer',
      name: 'Dış Fatura Müşterisi',
      email: '',
      phone: '5551234567',
      city: 'İstanbul',
      address: 'Test Mahallesi Sokak 1',
    },
  })
  const input: InvoiceInput = {
    customerId: 'customer',
    title: 'Dış belge testi',
    note: '',
    issueDate: '2026-10-25',
    currency: 'TRY',
    localOnly: false,
    items: [{ kind: 'free', title: 'Hizmet', quantity: 1, unitPrice: 10000, taxRate: 20 }],
  }
  await command({ type: 'invoice.create', id: 'invoice', input })
  await page.goto('/finance/invoices/invoice')
  const attach = page.getByRole('button', { name: 'Dış faturayı bağla', exact: true })
  await expect(attach).toBeDisabled()
  await page.getByLabel('Fatura linki', { exact: true }).fill('javascript:alert(1)')
  await expect(attach).toBeDisabled()
  await page
    .getByLabel('Fatura linki', { exact: true })
    .fill('https://invoice.example/document.pdf')
  await attach.click()
  const confirmation = page.getByRole('dialog', {
    name: 'Dışarıda kesilmiş faturayı bağla',
    exact: true,
  })
  await expect(confirmation).toContainText('Paraşüt’te ikinci fatura oluşturulmaz')
  await confirmation.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Dış faturayı aç', exact: true })).toHaveAttribute(
    'href',
    'https://invoice.example/document.pdf',
  )
  await expect(page.getByRole('link', { name: 'Faturayı düzenle', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sil', exact: true })).toHaveCount(0)
  expect((await state()).cash).toHaveLength(0)
  expect((await state()).orders).toHaveLength(0)
  await page.getByRole('button', { name: 'Resmileştirme / Paraşüt', exact: true }).click()
  const manager = page
    .getByRole('dialog')
    .filter({ has: page.getByText('Başka yerde kesilen fatura', { exact: true }) })
  await expect(manager.getByRole('button', { name: 'Paraşüt’e aktar', exact: true })).toHaveCount(0)
  await manager
    .locator('.dialog-footer')
    .getByRole('button', { name: 'Kapat', exact: true })
    .click()
  await page.getByRole('button', { name: 'Ödendi işaretle', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Ödendi işaretle', exact: true })
    .getByRole('button', { name: 'Onayla', exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Ödemeyi geri al', exact: true })).toBeVisible()
  expect((await state()).cash).toHaveLength(1)
  await page.getByRole('button', { name: 'Ödemeyi geri al', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Ödemeyi geri al', exact: true })
    .getByRole('button', { name: 'Onayla', exact: true })
    .click()
  await page.getByRole('button', { name: 'Yerel faturayı iptal et', exact: true }).click()
  const cancel = page.getByRole('dialog', { name: 'Yerel fatura iptali', exact: true })
  await expect(cancel).toContainText('Resmî belge veya Paraşüt iptali bu işlem değildir')
  await cancel.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Geri al', exact: true })).toBeVisible()
  expect((await state()).invoices[0].manualDocument?.url).toBe(
    'https://invoice.example/document.pdf',
  )
  await page.getByRole('button', { name: 'Geri al', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Faturayı geri al', exact: true })
    .getByRole('button', { name: 'Onayla', exact: true })
    .click()
  await page.getByRole('button', { name: 'Belge bağlantısını kaldır', exact: true }).click()
  const unlink = page.getByRole('dialog', { name: 'Dış belge bağlantısını kaldır', exact: true })
  await expect(unlink).toContainText('resmî belge iptal edilmez')
  await unlink.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Faturayı düzenle', exact: true })).toBeVisible()
  await page.getByLabel('Fatura linki', { exact: true }).fill('https://invoice.example/correct.pdf')
  await page.getByLabel('Fatura numarası (isteğe bağlı)', { exact: true }).fill('ABC2026000000001')
  await attach.click()
  await page
    .getByRole('dialog', { name: 'Dışarıda kesilmiş faturayı bağla', exact: true })
    .getByRole('button', { name: 'Onayla', exact: true })
    .click()
  await page.reload()
  await expect(page.getByRole('link', { name: 'Dış faturayı aç', exact: true })).toHaveAttribute(
    'href',
    'https://invoice.example/correct.pdf',
  )
  const final = await state()
  expect(final.invoices[0]).toMatchObject({
    status: 'issued',
    documentNumber: 'ABC2026000000001',
    manualDocument: { number: 'ABC2026000000001', url: 'https://invoice.example/correct.pdf' },
  })
  expect(final.cash).toHaveLength(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: /Fatura FT-/ })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('manual-invoice-mobile.png'), fullPage: true })
  expect(errors).toEqual([])
})
