import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test.use({ baseURL: 'http://localhost:4174' })
test('imports a CSV model as two variants with durable warehouse stock', async ({
  page,
}, testInfo) => {
  const request = page.context().request
  const registered = await request.post('/api/auth/register', {
    headers: { origin: 'http://localhost:4174' },
    data: {
      name: 'Dosya Testi',
      workspaceName: 'İçe Aktarma Testi',
      email: `${randomUUID()}@example.com`,
      password: 'catalog-import-e2e-password',
    },
  })
  expect(registered.status()).toBe(201)
  await page.goto('/products')
  await page.getByRole('button', { name: 'İçe aktar', exact: true }).click()
  await page.getByLabel('CSV veya XML dosyası', { exact: true }).setInputFiles({
    name: 'katalog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '\uFEFFModel;SKU;Ürün adı;Varyant;Kategori;Satış fiyatı;Stok\nCSV-TEST;CSV-WHITE;CSV test ürünü;Beyaz;Mutfak;149,90;5\nCSV-TEST;CSV-BLACK;CSV test ürünü;Siyah;Mutfak;159,90;3',
    ),
  })
  await expect(page.locator('.import-file-summary')).toContainText('2 kayıt')
  await page.getByRole('button', { name: 'Önizlemeyi oluştur', exact: true }).click()
  await expect(page.getByRole('grid', { name: 'İçe aktarma önizlemesi' })).toContainText(
    'CSV-WHITE',
  )
  await expect(page.getByRole('grid', { name: 'İçe aktarma önizlemesi' })).toContainText(
    'CSV-BLACK',
  )
  await page.screenshot({ path: testInfo.outputPath('catalog-import-preview.png') })
  await page.getByRole('button', { name: 'İçe aktarmayı uygula', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  const workspace = await (await request.get('/api/workspace')).json()
  expect(workspace.state.products).toHaveLength(1)
  expect(workspace.state.products[0].variants.map((v: { stock: number }) => v.stock)).toEqual([
    5, 3,
  ])
  await expect(page.getByRole('grid')).toContainText('CSV test ürünü')
  await expect(page.getByRole('grid')).toContainText('2 varyant')
})
