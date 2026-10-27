import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { marketplaceOwner } from '../tests/integration-workspace-fixtures'

test.use({ baseURL: 'http://localhost:4174' })

test('answers a question, approves one return unit and reconciles a payout through the live UI', async ({
  page,
}, testInfo) => {
  test.setTimeout(210000)
  const request = page.context().request
  const registered = await request.post('/api/auth/login', {
    headers: { origin: 'http://localhost:4174' },
    data: {
      email: marketplaceOwner.email,
      password: marketplaceOwner.password,
    },
  })
  expect(registered.status()).toBe(200)
  const session = await (await request.get('/api/session')).json()
  const headers = { origin: 'http://localhost:4174', 'x-csrf-token': session.csrfToken }
  const input = {
    provider: 'trendyol',
    name: 'Soru ve Hakediş Mağazası',
    enabled: false,
    settings: defaultIntegrationSettings,
    credentials: {
      sellerId: '900001',
      apiKey: 'fixture-marketplace-key',
      apiSecret: 'fixture-marketplace-secret',
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
  expect(
    (
      await request.patch(`/api/integrations/${storeId}`, {
        headers: { ...headers, 'idempotency-key': randomUUID() },
        data: { ...input, enabled: true },
      })
    ).ok(),
  ).toBe(true)

  await page.goto('/questions')
  await page.getByRole('button', { name: 'Pazaryerinden al', exact: true }).click()
  await page
    .getByRole('button')
    .filter({ hasText: 'Bu ürün bulaşık makinesinde yıkanabilir mi?' })
    .click()
  await page
    .getByLabel('Yanıtınız', { exact: true })
    .fill('Evet, düşük sıcaklıkta bulaşık makinesinde yıkanabilir.')
  await page.getByRole('button', { name: 'Yanıtı gönder', exact: true }).click()
  await expect(page.locator('.marketplace-workflow')).toContainText('Sonuç doğrulandı', {
    timeout: 30000,
  })
  await expect(page.locator('.marketplace-answer-bubble')).toContainText('düşük sıcaklıkta')
  await page.screenshot({ path: testInfo.outputPath('questions-desktop.png') })

  await page.goto('/returns?view=marketplace')
  await page.getByRole('button', { name: 'Pazaryerinden al', exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'TY-ORDER-1' }).click()
  const checkbox = page.getByRole('checkbox', { name: 'Seramik kupa', exact: true }).first()
  await page.locator('.marketplace-claim-item').first().locator('label').click()
  await expect(checkbox).toBeChecked()
  await page.getByRole('button', { name: '1 kalemi onayla', exact: true }).click()
  await expect(page.locator('.marketplace-workflow')).toContainText('Sonuç doğrulandı', {
    timeout: 30000,
  })
  await expect(page.locator('.marketplace-claim-item').first()).toContainText('Onaylandı')
  await expect(page.locator('.marketplace-claim-item').nth(1)).toContainText('Karar bekliyor')
  await page.locator('.marketplace-claim-item').nth(1).locator('label').click()
  await page.getByRole('button', { name: 'Ret talebi', exact: true }).click()
  await page
    .getByLabel('Karar açıklaması', { exact: true })
    .fill('Üründe kullanım izleri var; ek belge ile doğrulandı.')
  await page.getByLabel('İade kanıt dosyası', { exact: true }).setInputFiles({
    name: 'iade-kaniti.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  })
  await expect(page.getByRole('link').filter({ hasText: 'iade-kaniti' })).toBeVisible()
  await page.getByRole('button', { name: 'Ret talebini gönder', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'İade ret talebi', exact: true })).toHaveCount(0)
  await expect(page.locator('.marketplace-claim-item').nth(1)).toContainText('Reddedildi', {
    timeout: 30000,
  })
  await expect(page.locator('.marketplace-workflow')).toContainText('Sonuç doğrulandı', {
    timeout: 30000,
  })

  const cash = await request.post('/api/commands', {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      type: 'cash.record',
      id: randomUUID(),
      kind: 'in',
      method: 'transfer',
      amount: 97000,
      description: 'Banka hakediş tahsilatı',
    },
  })
  expect(cash.ok()).toBe(true)
  await page.goto('/finance/settlements')
  await page.getByRole('button', { name: 'Pazaryerinden al', exact: true }).click()
  await expect(page.getByRole('button').filter({ hasText: '#112360' })).toBeVisible({
    timeout: 60000,
  })
  await page.getByRole('button').filter({ hasText: '#112360' }).click()
  await page.getByRole('button', { name: 'Detayları pazaryerinden al', exact: true }).click()
  await expect(page.getByText('Kuruş bazında uyumlu', { exact: true })).toBeVisible({
    timeout: 30000,
  })
  await page.getByRole('button', { name: 'Eşleştirilecek banka tahsilatı', exact: true }).click()
  await page.getByRole('menuitemradio').filter({ hasText: 'Banka hakediş tahsilatı' }).click()
  await page.getByRole('button', { name: 'Tahsilatla eşleştir', exact: true }).click()
  await expect(page.getByText('Tahsilat eşleşti', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Tahsilat eşleşti', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await testInfo.attach('mobile-layout.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      await page.evaluate(() => ({
        viewport: window.innerWidth,
        width: document.documentElement.scrollWidth,
        overflow: Array.from(document.querySelectorAll('*'))
          .map((el) => ({
            tag: el.tagName,
            class: String(el.className),
            right: el.getBoundingClientRect().right,
            width: el.getBoundingClientRect().width,
            overflow: getComputedStyle(el).overflowX,
          }))
          .filter((r) => r.right > window.innerWidth + 1)
          .slice(0, 25),
      })),
    ),
  })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0)
  await page.screenshot({ path: testInfo.outputPath('payout-mobile.png') })
})
