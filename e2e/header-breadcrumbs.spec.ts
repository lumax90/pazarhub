import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'

for (const theme of ['light', 'dark'] as const) {
  test(`header breadcrumbs link records to their parents and fit the header (${theme})`, async ({
    page,
  }, info) => {
    const state = createSeedState()
    state.preferences.theme = theme
    const longName =
      'Aura Seramik Vazo — çok uzun model adı, renk ve ölçü bilgileriyle dekorasyon koleksiyonu'
    state.products[0].name = longName
    await page.addInitScript((state) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }, state)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const trail = page.getByRole('navigation', { name: 'Sayfa yolu', exact: true })
    const current = trail.locator('[aria-current="page"]')
    await page.goto(`/products/${state.products[0].id}?tab=prices`)
    await expect(current).toHaveAccessibleName(longName)
    await expect(trail.getByRole('link', { name: 'Ürünler', exact: true })).toHaveAttribute(
      'href',
      '/products',
    )
    for (const width of [1440, 1100, 1000, 680, 390, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(current).toBeVisible()
      const bounds = await page.locator('.topbar').evaluate((header) => {
        const breadcrumbs = header.querySelector('.header-breadcrumbs')!.getBoundingClientRect()
        const controls = header.querySelector('.topbar-right')!.getBoundingClientRect()
        return {
          breadcrumbsRight: breadcrumbs.right,
          controlsLeft: controls.left,
          controlsRight: controls.right,
          overflow: document.documentElement.scrollWidth > innerWidth,
          labels: [...header.querySelectorAll('.header-crumb-label')].map((label) => {
            const box = label.getBoundingClientRect()
            return { width: box.width, right: box.right }
          }),
        }
      })
      expect(bounds.overflow, `horizontal overflow at ${width}px`).toBe(false)
      expect(bounds.breadcrumbsRight).toBeLessThan(bounds.controlsLeft)
      expect(bounds.controlsRight).toBeLessThanOrEqual(width)
      for (const label of bounds.labels) {
        expect(label.width).toBeGreaterThan(0)
        expect(label.right).toBeLessThanOrEqual(bounds.controlsLeft)
      }
      if (width === 1440 || width === 390) {
        expect((await nativeSkinDifferences(page)).differences).toEqual([])
        await page
          .locator('.topbar')
          .screenshot({ path: info.outputPath(`breadcrumbs-${theme}-${width}.png`) })
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    const sentinel = await page.evaluate(() => {
      const value = crypto.randomUUID()
      document.documentElement.dataset.navigationProbe = value
      return value
    })
    await trail.getByRole('link', { name: 'Ürünler', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Ürünler', level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-navigation-probe', sentinel)
    await page.goBack()
    await expect(current).toHaveAccessibleName(longName)
    await expect(page).toHaveURL(/\?tab=prices$/)

    await page.goto('/products/new/bundle')
    await expect(current).toHaveAccessibleName('Paket oluştur')
    await trail.getByRole('link', { name: 'Ürünler', exact: true }).click()
    await expect(page).toHaveURL(/\/products$/)
    await page.goto(`/orders/${state.orders[0].id}`)
    await expect(current).toHaveAccessibleName(state.orders[0].number)
    await trail.getByRole('link', { name: 'Siparişler', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/orders$/)

    await page.goto(`/finance/invoices/${state.invoices[0].id}/edit`)
    await expect(current).toHaveAccessibleName('Düzenle')
    await expect(trail.getByRole('link', { name: 'Faturalar', exact: true })).toHaveAttribute(
      'href',
      '/finance/invoices',
    )
    await trail.getByRole('link', { name: state.invoices[0].number, exact: true }).click()
    await expect(current).toHaveAccessibleName(state.invoices[0].number)
    await expect(
      page.getByRole('heading', { name: `Fatura ${state.invoices[0].number}`, level: 1 }),
    ).toBeVisible()

    await page.goto('/retail/inventory/transfers')
    await expect(current).toHaveAccessibleName('Transferler')
    await expect(trail.getByRole('link', { name: 'Stok', exact: true })).toHaveAttribute(
      'href',
      '/retail/inventory',
    )
    await trail.getByRole('link', { name: 'Perakende', exact: true }).click()
    await expect(page).toHaveURL(/\/retail$/)
    await page.goto('/definitions/colors')
    await expect(current).toHaveAccessibleName('Renkler')
    await expect(trail.getByRole('link', { name: 'Tanımlamalar', exact: true })).toHaveAttribute(
      'href',
      '/definitions',
    )
    expect(errors).toEqual([])
  })
}
