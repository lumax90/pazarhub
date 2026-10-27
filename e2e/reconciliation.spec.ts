import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { AppState, Command } from '../src/domain/types'
import { reconciliationOwner } from '../tests/integration-workspace-fixtures'

test.use({ baseURL: 'http://localhost:4174' })
test('reconciles an uncertain invoice from the operation center without creating another document', async ({
  page,
}) => {
  test.setTimeout(90000)
  const request = page.context().request
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin: 'http://localhost:4174' },
        data: {
          email: reconciliationOwner.email,
          password: reconciliationOwner.password,
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
  const connectionInput = {
    provider: 'parasut',
    name: 'Paraşüt Test Firması',
    enabled: false,
    settings: defaultIntegrationSettings,
    credentials: {
      companyId: '123',
      clientId: 'fixture',
      clientSecret: 'fixture',
      email: 'fixture@example.com',
      password: 'fixture',
    },
  }
  const created = await request.post('/api/integrations', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: connectionInput,
  })
  expect(created.status()).toBe(201)
  const connectionId = (await created.json()).id
  await request.post(`/api/integrations/${connectionId}/jobs`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { operation: 'test' },
  })
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/integrations')).json()).connections.find(
          (connection: { id: string }) => connection.id === connectionId,
        )?.status,
      { timeout: 15000 },
    )
    .toBe('verified')
  expect(
    (
      await request.patch(`/api/integrations/${connectionId}`, {
        headers: { ...headers, 'idempotency-key': randomUUID() },
        data: { ...connectionInput, enabled: true },
      })
    ).ok(),
  ).toBe(true)
  await command({
    type: 'customer.save',
    customer: {
      id: 'invoice-customer',
      name: 'Fatura Alıcısı',
      city: 'İstanbul',
      address: 'Test Mahallesi Sokak 1',
      email: '',
      phone: '5551234567',
    },
  })
  const order = await command({
    type: 'order.create',
    input: {
      channel: 'manual',
      customerId: 'invoice-customer',
      note: '',
      shipping: 0,
      billingAddress: {
        name: 'Fatura Alıcısı',
        address: 'Test Mahallesi Sokak 1',
        city: 'İstanbul',
        district: 'Kadıköy',
        phone: '5551234567',
        taxId: '11111111111',
      },
      items: [
        { kind: 'free', title: 'Kurulum hizmeti', quantity: 1, unitPrice: 12000, taxRate: 20 },
      ],
    },
  })
  const invoice = await command({ type: 'order.invoice', id: order.result.id }),
    invoiceId = invoice.result.id
  const started = await request.post(`/api/invoices/${invoiceId}/action`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { operation: 'create', connectionId },
  })
  expect(started.status()).toBe(202)
  const sourceId = (await started.json()).jobId
  const current = async () =>
    ((await (await request.get('/api/workspace')).json()).state as AppState).invoices.find(
      (invoice) => invoice.id === invoiceId,
    )!
  await expect.poll(async () => (await current()).uncertainJobId, { timeout: 25000 }).toBe(sourceId)
  await page.goto('/jobs')
  await page.getByRole('button', { name: /^Paraşüt taslağı/ }).click()
  await page.getByRole('button', { name: 'Sonucu uzlaştır', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Fatura sonucunu uzlaştır', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sağlayıcı kaydını doğrula', exact: true }).click()
  await expect.poll(async () => (await current()).status, { timeout: 25000 }).toBe('draft')
  const verified = await current()
  expect(verified.externalId).toBeTruthy()
  expect(verified.uncertainJobId).toBeUndefined()
  await expect(page.getByText('Uzlaştırma bekleyen işlem yok.', { exact: true })).toBeVisible()
})
