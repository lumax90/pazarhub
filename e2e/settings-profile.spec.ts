import { expect, test } from '@playwright/test'
import type { AppState } from '../src/domain/types'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('pazarhub.mode', 'demo'))
})

test('business details reach the order sheet and a muted alert leaves the bell', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Çalışma Alanı Ayarları', level: 1 }),
  ).toBeVisible()
  await expect(page.getByRole('tab', { name: 'İşletme bilgileri' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText(/HeroUI|React|PostgreSQL/)).toHaveCount(0)

  await page.getByLabel('Ticari unvan').fill('Kuzey Studio Tasarım Ltd. Şti.')
  await page.getByLabel('Vergi no / T.C. kimlik no').fill('12')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(
    page.getByText('Vergi numarası 10, T.C. kimlik numarası 11 haneli olmalı.'),
  ).toBeVisible()
  await page.getByLabel('Vergi no / T.C. kimlik no').fill('1234567890')
  await page.getByLabel('Vergi dairesi').fill('Kadıköy')
  await page.getByLabel('İl', { exact: true }).fill('İstanbul')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByText('İşletme bilgileri kaydedildi.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kaydet', exact: true })).toBeDisabled()

  const orderId = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('pazarhub.workspace.v1')!) as AppState).orders[0].id,
  )
  await page.goto(`/orders/print?ids=${orderId}`)
  const sender = page.locator('.order-print-sender').first()
  await expect(sender).toContainText('Kuzey Studio Tasarım Ltd. Şti.')
  await expect(sender).toContainText('İstanbul')
  await expect(sender).toContainText('Kadıköy V.D. · 1234567890')

  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Bildirimler' }).click()
  await expect(page).toHaveURL(/\/settings\/notifications$/)
  const bell = page.getByRole('button', { name: 'Bildirimler', exact: true })
  await bell.click()
  await expect(page.getByRole('menuitem', { name: /ilan kontrol bekliyor/ })).toBeVisible()
  await page.keyboard.press('Escape')
  const listingsSwitch = page.getByRole('switch', { name: 'Kontrol bekleyen ilanlar' })
  // React Aria keeps the input visually hidden; people press its label.
  await page.getByText('Kontrol bekleyen ilanlar', { exact: true }).click()
  await expect(listingsSwitch).not.toBeChecked()
  await expect(page.getByText('Bildirim tercihiniz kaydedildi.')).toBeVisible()
  await bell.click()
  await expect(page.getByRole('menuitem', { name: /sipariş gönderim bekliyor/ })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /ilan kontrol bekliyor/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('the profile renames the person and swaps the generated avatar', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Hesap menüsü', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Profilim' }).click()
  await expect(page.getByRole('heading', { name: 'Profilim', level: 1 })).toBeVisible()
  const headerAvatar = page.locator('.profile-button .avatar__image')
  await expect(headerAvatar).toHaveAttribute('src', /^data:image\/svg\+xml/)
  const before = await headerAvatar.getAttribute('src')

  await page.getByRole('radio', { name: 'Avatar 4' }).click()
  await page.getByLabel('Ad soyad').fill('Ayşe Kaya')
  await page.getByRole('button', { name: 'Profili kaydet' }).click()
  await expect(page.getByText('Profiliniz kaydedildi.')).toBeVisible()
  await expect(page.locator('.profile-name')).toHaveText('Ayşe Kaya')
  await expect(headerAvatar).not.toHaveAttribute('src', before!)

  await page.reload()
  await expect(page.locator('.profile-name')).toHaveText('Ayşe Kaya')
  await expect(page.getByRole('radio', { name: 'Avatar 4' })).toBeChecked()
  await page.getByRole('button', { name: 'Koyu', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
