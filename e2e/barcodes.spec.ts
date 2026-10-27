import { expect, test } from '@playwright/test'
import { isGtin } from '../src/domain/barcodes'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('pazarhub.mode', 'demo'))
})

const openNewProduct = async (page: import('@playwright/test').Page) => {
  await page.goto('/products/new')
  await page
    .locator('.product-category-choices')
    .getByRole('button', { name: /Ev & Dekorasyon/ })
    .click()
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
  await page.getByRole('button', { name: 'Devam', exact: true }).click()
}

test('generates check-digited EAN-13 barcodes from the GS1 prefix in settings', async ({
  page,
}) => {
  await openNewProduct(page)
  const generate = page.getByRole('button', { name: 'Boş barkodları üret', exact: true })
  await expect(generate).toBeDisabled()
  await page
    .locator('.variant-barcode-tools')
    .getByRole('link', { name: 'E-Ticaret Ayarları', exact: true })
    .click()

  await expect(page).toHaveURL(/\/ecommerce-settings\?tab=stock$/)
  const prefix = page.getByRole('textbox', { name: 'GS1 firma öneki', exact: true })
  await prefix.fill('2001234')
  await expect(page.getByText('2 ile başlayan önekler mağaza içi kullanım içindir')).toBeVisible()
  await prefix.fill('8691234')
  await expect(page.getByText(/sıradaki: 8691234\d{6}/)).toBeVisible()
  await page.getByRole('button', { name: 'Ayarları kaydet', exact: true }).click()
  await expect(page.getByText('E-ticaret ayarları kaydedildi.')).toBeVisible()

  await openNewProduct(page)
  await expect(
    page.getByText('GS1 önekinizle (8691234) kontrol haneli EAN-13 üretilir.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Boş barkodları üret', exact: true }).click()
  const barcode = page.getByRole('textbox', { name: 'Barkod', exact: true })
  await expect(barcode).toHaveValue(/^8691234\d{6}$/)
  expect(isGtin(await barcode.inputValue())).toBe(true)
  await expect(generate).toBeDisabled()

  await barcode.fill('8691234000010')
  await expect(page.getByText('Kontrol hanesi hatalı; son hane 4 olmalı.')).toBeVisible()
})
