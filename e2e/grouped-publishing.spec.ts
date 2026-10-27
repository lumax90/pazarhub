import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { AppState } from '../src/domain/types'
import { groupedPublicationOwner } from '../tests/integration-workspace-fixtures'

test.use({ baseURL: 'http://localhost:4174' })
test('previews and publishes all PttAVM variants together and follows each resulting listing', async ({
  page,
}) => {
  test.setTimeout(90000)
  const request = page.context().request,
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin: 'http://localhost:4174' },
        data: {
          email: groupedPublicationOwner.email,
          password: groupedPublicationOwner.password,
        },
      })
    ).status(),
  ).toBe(200)
  const session = await (await request.get('/api/session')).json(),
    headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const input = {
    provider: 'pttavm',
    name: 'PttAVM Mağazası',
    enabled: false,
    settings: defaultIntegrationSettings,
    credentials: { shopId: '123', apiKey: 'fixture', accessToken: 'fixture' },
  }
  const connection = await request.post('/api/integrations', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: input,
  })
  expect(connection.status()).toBe(201)
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
      { timeout: 15000 },
    )
    .toBe('verified')
  expect(
    (
      await request.patch(`/api/integrations/${storeId}`, {
        headers: { ...headers, 'idempotency-key': randomUUID() },
        data: { ...input, enabled: true },
      })
    ).ok(),
  ).toBe(true)
  const productId = randomUUID(),
    variantIds = [randomUUID(), randomUUID()]
  const saved = await request.post('/api/commands', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      type: 'product.save',
      product: {
        id: productId,
        name: 'Grup Havlu',
        category: 'Banyo',
        brand: 'Marka',
        description: 'Pamuklu havlu',
        art: 'towel',
        color: '#cccccc',
        taxRate: 20,
        lowStock: 1,
        active: true,
        images: ['https://example.com/photo.jpg'],
        variantAxes: [
          {
            id: 'color',
            name: 'Renk',
            values: [
              { id: 'w', name: 'Beyaz' },
              { id: 'b', name: 'Siyah' },
            ],
          },
        ],
        variants: variantIds.map((id, index) => ({
          id,
          name: index ? 'Siyah' : 'Beyaz',
          sku: `GROUP-${index}`,
          barcode: `869123456789${index}`,
          price: index ? 15000 : 12000,
          cost: 5000,
          stock: index ? 3 : 5,
          options: { color: index ? 'b' : 'w' },
        })),
      },
    },
  })
  expect(saved.ok(), await saved.text()).toBe(true)
  const draft = await request.post('/api/listing-drafts', {
    headers,
    data: { storeId, productId, variantIds },
  })
  expect(draft.status()).toBe(201)
  const ids = (await draft.json()).ids as string[]
  for (const id of ids)
    expect(
      (
        await request.patch(`/api/listing-drafts/${id}`, {
          headers,
          data: { version: 1, config: { categoryId: '52', attributes: {} } },
        })
      ).ok(),
    ).toBe(true)
  await page.goto(`/listings/prepare/${ids[0]}`)
  await expect(page.getByRole('heading', { name: 'İlan hazırlama', exact: true })).toBeVisible()
  await expect(page.getByLabel('Ortak model kodu', { exact: true })).toHaveAttribute('readonly', '')
  await page.getByRole('button', { name: 'Önizleme oluştur', exact: true }).click()
  const manifest = page.getByRole('grid', { name: 'Birlikte gönderilecek varyantlar' })
  await expect(manifest).toContainText('GROUP-0')
  await expect(manifest).toContainText('GROUP-1')
  await page.getByRole('button', { name: 'Bu önizlemeyi pazaryerine gönder', exact: true }).click()
  await expect(page.locator('.publication-status')).toContainText('Yayında', { timeout: 45000 })
  await expect
    .poll(
      async () => {
        const state = (await (await request.get('/api/workspace')).json()).state as AppState
        return state.listings.filter(
          (listing) =>
            ids.includes(listing.id) && listing.publication?.phase === 'live' && listing.lastSent,
        ).length
      },
      { timeout: 30000 },
    )
    .toBe(2)
  await page
    .locator('.publication-siblings')
    .getByRole('link')
    .filter({ hasText: 'GROUP-1' })
    .click()
  await expect(page.locator('.publication-status')).toContainText('Yayında')
  expect(errors).toEqual([])
})
