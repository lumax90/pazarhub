import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { useSeededSession } from './seeded-session'
import { invoiceAutomationOwner } from '../tests/invoice-automation-fixture'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { AppState, Command } from '../src/domain/types'
import type { PublicIntegration } from '../src/domain/integrations'

test.use({ baseURL: 'http://localhost:4174', actionTimeout: 15000 })
test('keeps company invoice timing, default accounting account and marketplace link automation separate', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await useSeededSession(page, invoiceAutomationOwner.email)
  const request = page.context().request,
    session = await (await request.get('/api/session')).json(),
    headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const command = async (data: Command) => {
    const response = await request.post('/api/commands', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data,
    })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).result
  }
  const state = async () => (await (await request.get('/api/workspace')).json()).state as AppState
  const connections = async () =>
    (await (await request.get('/api/integrations')).json()).connections as PublicIntegration[]
  const connect = async (name: string, companyId: string) => {
    const response = await request.post('/api/integrations', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: {
        provider: 'parasut',
        name,
        enabled: false,
        settings: defaultIntegrationSettings,
        credentials: {
          companyId,
          clientId: 'fixture',
          clientSecret: 'fixture',
          email: 'fixture@example.com',
          password: 'fixture',
        },
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    return (await response.json()) as PublicIntegration
  }
  const enable = async (connection: PublicIntegration) => {
    expect(
      (
        await request.post(`/api/integrations/${connection.id}/jobs`, {
          headers: { ...headers, 'idempotency-key': randomUUID() },
          data: { operation: 'test' },
        })
      ).status(),
    ).toBe(202)
    await expect
      .poll(async () => (await connections()).find((c) => c.id === connection.id)?.status, {
        timeout: 20000,
      })
      .toBe('verified')
    const response = await request.patch(`/api/integrations/${connection.id}`, {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: {
        provider: 'parasut',
        name: connection.name,
        credentials: {},
        enabled: true,
        settings: defaultIntegrationSettings,
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await page.goto('/ecommerce-settings')
  await page
    .getByRole('group', { name: 'E-ticaret ayar bölümleri', exact: true })
    .getByRole('button', { name: 'Siparişler', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Sipariş faturası ne zaman kesilsin?', exact: true })
    .click()
  await page.getByRole('menuitemradio', { name: 'Teslim edildiğinde', exact: true }).click()
  await page.getByRole('button', { name: 'Ayarları kaydet', exact: true }).click()
  await expect.poll(async () => (await state()).ecommerce?.invoiceTiming).toBe('on_delivered')
  const first = await connect('Ana firma', '987651'),
    second = await connect('Diğer firma', '987652')
  expect(first.isDefault).toBe(true)
  expect(second.isDefault).toBe(false)
  await enable(first)
  await enable(second)
  await page.goto('/connections/invoice')
  const secondCard = page.locator('.connection-card').filter({ hasText: 'Diğer firma' })
  await secondCard.getByRole('button', { name: 'Varsayılan yap', exact: true }).click()
  await expect(secondCard).toContainText('Varsayılan fatura hesabı')
  await command({
    type: 'customer.save',
    customer: {
      id: 'customer',
      name: 'Otomasyon Müşterisi',
      email: 'customer@example.com',
      phone: '5551234567',
      city: 'İstanbul',
      district: 'Kadıköy',
      country: 'TR',
      taxId: '1234567890',
      taxOffice: 'Kadıköy',
      address: 'Test Mahallesi Sokak 1',
    },
  })
  const order = await command({
    type: 'order.create',
    input: {
      customerId: 'customer',
      channel: 'manual',
      items: [{ kind: 'free', title: 'Hizmet', quantity: 1, unitPrice: 10000, taxRate: 20 }],
      shipping: 0,
      note: '',
    },
  })
  await command({ type: 'order.transition', id: order.id, status: 'approved' })
  expect((await state()).invoices).toHaveLength(0)
  await command({
    type: 'order.transition',
    id: order.id,
    status: 'shipped',
    shipment: { carrier: 'PTT', trackingNumber: 'TRACK' },
  })
  expect((await state()).invoices).toHaveLength(0)
  await command({ type: 'order.transition', id: order.id, status: 'delivered' })
  await expect
    .poll(async () => (await state()).invoices[0]?.externalId, { timeout: 30000 })
    .toBeTruthy()
  const invoice = (await state()).invoices[0]
  expect(invoice.connectionId).toBe(second.id)
  expect(invoice.status).toBe('draft')
  expect((await state()).cash).toHaveLength(0)
  const firstCard = page.locator('.connection-card').filter({ hasText: 'Ana firma' })
  await firstCard.getByRole('button', { name: 'Varsayılan yap', exact: true }).click()
  await expect(firstCard).toContainText('Varsayılan fatura hesabı')
  expect((await state()).invoices[0].connectionId).toBe(second.id)
  const storeResponse = await request.post('/api/integrations', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      provider: 'trendyol',
      name: 'Link ayarı mağazası',
      enabled: false,
      settings: { ...defaultIntegrationSettings, invoiceMode: 'workspace' },
      credentials: { sellerId: '123', apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
    },
  })
  expect(storeResponse.status()).toBe(201)
  const store = (await storeResponse.json()) as PublicIntegration
  await page.goto('/connections/marketplace')
  await page
    .locator('.connection-card')
    .filter({ hasText: 'Link ayarı mağazası' })
    .getByRole('button', { name: 'Ayarlar', exact: true })
    .click()
  const editor = page.getByRole('dialog', { name: 'Trendyol ayarları', exact: true })
  await editor
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', {
        name: 'Fatura bağlantısını pazaryerine otomatik gönder',
        exact: true,
      }),
    })
    .click()
  await editor.getByRole('button', { name: 'Bağlantıyı kaydet', exact: true }).click()
  await expect
    .poll(
      async () => (await connections()).find((c) => c.id === store.id)?.settings.sendInvoiceLink,
    )
    .toBe(false)
  await page.goto('/ecommerce-settings')
  await page
    .getByRole('group', { name: 'E-ticaret ayar bölümleri', exact: true })
    .getByRole('button', { name: 'Siparişler', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Sipariş faturası ne zaman kesilsin?', exact: true }),
  ).toContainText('Teslim edildiğinde')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'E-Ticaret Ayarları', exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath('invoice-automation-mobile.png'), fullPage: true })
  expect(errors).toEqual([])
})
