import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { defaultIntegrationSettings } from '../src/domain/integrations'

test.use({ baseURL: 'http://localhost:4174' })

test('publishes a prepared listing through required attributes and server-side preview', async ({
  page,
}) => {
  test.setTimeout(90000)
  const request = page.context().request
  const registered = await request.post('/api/auth/register', {
    headers: { origin: 'http://localhost:4174' },
    data: {
      name: 'Yayın Testi',
      workspaceName: 'Yayın Ekibi',
      email: `${randomUUID()}@example.com`,
      password: 'publishing-e2e-password',
    },
  })
  expect(registered.status()).toBe(201)
  const session = await (await request.get('/api/session')).json()
  const headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const input = {
    provider: 'trendyol',
    name: 'Yayın Mağazası',
    enabled: false,
    settings: defaultIntegrationSettings,
    credentials: {
      sellerId: '123',
      apiKey: 'fixture-publishing-key',
      apiSecret: 'fixture-publishing-secret',
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
      async () => {
        const body = await (await request.get('/api/integrations')).json()
        return body.connections.find((c: { id: string }) => c.id === storeId)?.status
      },
      { timeout: 15000 },
    )
    .toBe('verified')
  const enabled = await request.patch(`/api/integrations/${storeId}`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { ...input, enabled: true },
  })
  expect(enabled.ok()).toBe(true)
  const productId = randomUUID(),
    variantId = randomUUID(),
    sku = `TEST-${randomUUID().slice(0, 10)}`
  const saved = await request.post('/api/commands', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      type: 'product.save',
      product: {
        id: productId,
        name: 'Yayın testi ürünü',
        category: 'Seramik',
        brand: 'TestMarka',
        description: 'Katalogdan yayınlanacak seramik ürün.',
        art: 'vase',
        color: '#aabbcc',
        taxRate: 20,
        active: true,
        lowStock: 2,
        origin: 'TR',
        dimensions: { desi: 2 },
        technicalAttributes: [{ id: 'material', name: 'Materyal', value: 'Seramik' }],
        variantAxes: [{ id: 'color', name: 'Renk', values: [{ id: 'white', name: 'Beyaz' }] }],
        images: ['https://example.com/product.jpg'],
        variants: [
          {
            id: variantId,
            name: 'Beyaz',
            sku,
            barcode: randomUUID().replaceAll('-', ''),
            stock: 5,
            price: 10000,
            cost: 5000,
            options: { color: 'white' },
          },
        ],
      },
    },
  })
  expect(saved.ok()).toBe(true)
  await page.goto(`/products/${productId}?tab=integrations`)
  await page.getByRole('button', { name: 'İlan hazırla', exact: true }).click()
  await page.getByRole('button', { name: 'Yayınlanacak mağaza', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Yayın Mağazası', exact: true }).click()
  await page.getByRole('button', { name: 'Hazırlamaya başla' }).click()
  await expect(page.getByRole('heading', { name: 'İlan hazırlama', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Kategori ve özellikler', exact: true }).click()
  await page.getByRole('button', { name: 'Son seviye kategori seçin', exact: true }).click()
  await page.getByRole('dialog').getByRole('button').filter({ hasText: 'Dekorasyon' }).click()
  await page.getByRole('button', { name: 'Trendyol markası seçin', exact: true }).click()
  await page.getByRole('searchbox').fill('TestMarka')
  await page.getByRole('dialog').getByRole('button').filter({ hasText: 'TestMarka' }).click()
  await page.getByRole('button', { name: 'Üründen doldur', exact: true }).click()
  await expect(page.locator('.product-attribute-fill')).toContainText(
    '2 özellik ürün/varyant kartından dolduruldu.',
  )
  await page.getByRole('button', { name: 'Önizleme oluştur', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Gönderilecek bilgiler hazır' })).toBeVisible()
  await page.getByRole('button', { name: 'Bu önizlemeyi pazaryerine gönder', exact: true }).click()
  await expect(page.locator('.publication-status')).toContainText('Yayında', { timeout: 25000 })
  await expect
    .poll(
      async () => {
        const workspace = await (await request.get('/api/workspace')).json()
        return workspace.state.listings.find(
          (l: { variantId: string }) => l.variantId === variantId,
        )?.lastSent?.quantity
      },
      { timeout: 15000 },
    )
    .toBe(5)
  await page.reload()
  await expect(page.locator('.publication-status')).toContainText('Yayında')
  await page.getByRole('link', { name: 'İçeriği güncelle', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'İlan içeriği', exact: true })).toBeVisible()
  await page
    .locator('label')
    .filter({ has: page.getByRole('checkbox', { name: 'Başlık alanını güncelle', exact: true }) })
    .click()
  await page.getByLabel('Pazaryeri başlığı', { exact: true }).fill('Güncellenmiş mağaza başlığı')
  await page
    .locator('label')
    .filter({
      has: page.getByRole('checkbox', { name: 'Görseller alanını güncelle', exact: true }),
    })
    .click()
  const images = page.getByLabel('Görsel adresleri (her satıra bir HTTPS adresi)', { exact: true })
  await images.fill('https://example.com/new-1.jpg')
  await images.press('End')
  await images.press('Enter')
  await images.pressSequentially('https://example.com/new-2.jpg')
  await expect(images).toHaveValue('https://example.com/new-1.jpg\nhttps://example.com/new-2.jpg')
  await page.getByRole('button', { name: 'İçeriği önizle', exact: true }).click()
  await page.getByRole('button', { name: 'Bu içeriği pazaryerine gönder', exact: true }).click()
  // Content confirmation is scheduled after 20s, followed by worker and
  // workspace polling ticks. 30s races a valid result under parallel load.
  await expect(page.getByText('Güncellendi', { exact: true })).toBeVisible({ timeout: 45000 })
  const updated = (await (await request.get('/api/workspace')).json()).state
  expect(updated.products.find((product: { id: string }) => product.id === productId).name).toBe(
    'Yayın testi ürünü',
  )
  expect(
    updated.listings.find((listing: { variantId: string }) => listing.variantId === variantId)
      .titleOverride,
  ).toBe('Güncellenmiş mağaza başlığı')
})
test('server workspace survives reload and keeps its data out of demo storage', async ({
  page,
}) => {
  const email = `${randomUUID()}@example.com`
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Hesap oluştur', exact: true }).click()
  await page.getByLabel('Ad soyad', { exact: true }).fill('Canlı Test Kullanıcısı')
  await page.getByLabel('İşletme / çalışma alanı', { exact: true }).fill('API Çalışma Alanı')
  await page.getByLabel('E-posta', { exact: true }).fill(email)
  await page.getByLabel('Parola', { exact: true }).fill('Test1234')
  await page.getByRole('button', { name: 'Çalışma alanını oluştur', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Çalışma alanınız hazır.' })).toBeVisible()
  await page.goto('/customers')
  await page.getByRole('button', { name: 'Yeni müşteri', exact: true }).click()
  await page.getByLabel('Ad soyad', { exact: true }).fill('Kalıcı Müşteri')
  await page.getByRole('button', { name: 'Müşteriyi kaydet', exact: true }).click()
  await expect(
    page
      .getByRole('grid', { name: 'Müşteri listesi' })
      .getByText('Kalıcı Müşteri', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole('grid', { name: 'Müşteri listesi' })
      .getByText('Kalıcı Müşteri', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('pazarhub.workspace.v1'))).toBeNull()
  await page.getByRole('button', { name: 'Hesap menüsü', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Oturumu kapat' }).click()
  await expect(page.getByRole('heading', { name: 'Tekrar hoş geldiniz.' })).toBeVisible()
  await page.getByLabel('E-posta', { exact: true }).fill(email)
  await page.getByLabel('Parola', { exact: true }).fill('Test1234')
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click()
  await expect(
    page
      .getByRole('grid', { name: 'Müşteri listesi' })
      .getByText('Kalıcı Müşteri', { exact: true }),
  ).toBeVisible()
})

test('team invitation creates a restricted account with an isolated server session', async ({
  browser,
}) => {
  const owner = await browser.newContext({ baseURL: 'http://localhost:4174' })
  const response = await owner.request.post('/api/auth/register', {
    headers: { origin: 'http://localhost:4174' },
    data: {
      name: 'Davet Eden',
      workspaceName: 'Davet Test Alanı',
      email: `${randomUUID()}@example.com`,
      password: 'e2e-owner-password-123',
    },
  })
  expect(response.status()).toBe(201)
  const session = await (await owner.request.get('/api/session')).json()
  const invitedEmail = `${randomUUID()}@example.com`
  const invitation = await owner.request.post('/api/team/invitations', {
    headers: { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken },
    data: { email: invitedEmail, role: 'viewer' },
  })
  expect(invitation.ok()).toBe(true)
  const url = (await invitation.json()).url
  const guest = await browser.newContext({ baseURL: 'http://localhost:4174' })
  const page = await guest.newPage()
  await page.goto(url)
  await page.getByLabel('Ad soyad', { exact: true }).fill('Davetli İzleyici')
  await page.getByLabel('Parola', { exact: true }).fill('Test5678')
  await page.getByRole('button', { name: 'Daveti kabul et' }).click()
  await expect(page.getByRole('heading', { name: 'Gününüz, bir bakışta.' })).toBeVisible()
  const invitedSession = await (await guest.request.get('/api/session')).json()
  expect(invitedSession.user.role).toBe('viewer')
  const forbidden = await guest.request.post('/api/commands', {
    headers: {
      origin: 'http://localhost:4174',
      'x-csrf-token': invitedSession.csrfToken,
      'idempotency-key': randomUUID(),
    },
    data: { type: 'stock.adjust', variantId: 'missing', quantity: 100, note: 'Test' },
  })
  expect(forbidden.status()).toBe(403)
  await guest.close()
  await owner.close()
})
