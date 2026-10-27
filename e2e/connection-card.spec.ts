import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { defaultIntegrationSettings } from '../src/domain/integrations'

test.use({ baseURL: 'http://localhost:4174' })

test('a tested store is enabled from its card with read syncs on and writes off', async ({
  page,
}) => {
  test.setTimeout(60000)
  const request = page.context().request
  const registered = await request.post('/api/auth/register', {
    headers: { origin: 'http://localhost:4174' },
    data: {
      name: 'Bağlantı Testi',
      workspaceName: 'Bağlantı Ekibi',
      email: `${randomUUID()}@example.com`,
      password: 'connection-card-e2e-password',
    },
  })
  expect(registered.status()).toBe(201)
  const session = await (await request.get('/api/session')).json()
  const headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const created = await request.post('/api/integrations', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      provider: 'trendyol',
      name: 'Kart Mağazası',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials: {
        sellerId: '123',
        apiKey: 'fixture-card-key',
        apiSecret: 'fixture-card-secret',
      },
    },
  })
  expect(created.status()).toBe(201)
  const storeId = (await created.json()).id
  const stored = async () =>
    (await (await request.get('/api/integrations')).json()).connections.find(
      (item: { id: string }) => item.id === storeId,
    )
  await request.post(`/api/integrations/${storeId}/jobs`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { operation: 'test' },
  })
  await expect.poll(async () => (await stored())?.status, { timeout: 15000 }).toBe('verified')

  await page.goto('/connections')
  const card = page.locator('.connection-card', {
    has: page.getByRole('heading', { name: 'Kart Mağazası' }),
  })
  await expect(card.getByText('Etkinleştirilmedi')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Siparişleri çek' })).toBeDisabled()
  await expect(card.locator('dl')).toContainText('Kapalı — yalnız elle')

  await card.getByRole('button', { name: 'Etkinleştir' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: 'Siparişler (5 dakikada bir)' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Katalog (30 dakikada bir)' })).toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: 'Siparişleri ve kataloğu şimdi al' }),
  ).toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: 'Stok ve fiyatı pazaryerine gönder' }),
  ).not.toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: 'Eşleşen siparişleri otomatik onayla' }),
  ).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Etkinleştir' }).click()
  await expect(dialog).toBeHidden()

  await expect(card.getByText('Aktif', { exact: true })).toBeVisible()
  await expect(card.locator('dl')).toContainText('Siparişler5 dakikada bir alınır')
  await expect(card.locator('dl')).toContainText('Son çalışma')
  await expect(card.getByRole('button', { name: 'Siparişleri çek' })).toBeEnabled()
  const enabled = await stored()
  expect(enabled).toMatchObject({ enabled: true, status: 'verified' })
  expect(enabled.settings).toMatchObject({
    pullOrders: true,
    pullCatalog: true,
    pushInventory: false,
    autoApproveOrders: false,
  })
  // Unchanged credentials stay stored; the card never sends secrets back.
  expect(enabled.configuredFields).toEqual(expect.arrayContaining(['apiKey', 'apiSecret']))
})
