import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'
import { normalizeTheme } from '../scripts/theme-contract.mjs'

const ocean = normalizeTheme(
  readFileSync(new URL('./fixtures/ocean-theme.css', import.meta.url), 'utf8'),
)

for (const mode of ['light', 'dark'] as const) {
  test(`a token-only theme replacement reaches the whole application (${mode})`, async ({
    page,
  }, info) => {
    test.setTimeout(120000)
    const state = createSeedState()
    state.preferences.theme = mode
    await page.addInitScript((state) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }, state)
    const routes = [
      '/dashboard',
      '/orders/new',
      '/products/new',
      `/products/${state.products[0].id}?tab=prices`,
      '/inventory',
      '/finance/invoices/new',
      '/retail/sale',
      '/connections',
      '/settings',
      '/profile',
    ]
    for (const route of routes) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      // Same operation as replacing the imported token file; no app selector or component changes.
      await page.addStyleTag({ content: ocean })
      await expect(page.locator('.main-shell')).toHaveCSS('font-family', 'Arial, sans-serif')
      const native = await nativeSkinDifferences(page)
      expect(native.compared).toBeGreaterThan(0)
      expect(native.differences, route).toEqual([])
      if (route === '/dashboard') {
        await page.getByRole('combobox', { name: 'Genel arama', exact: true }).click()
        await expect(
          page.getByRole('listbox', { name: 'Arama sonuçları', exact: true }),
        ).toBeVisible()
        await page.getByLabel('Genel arama', { exact: true }).fill('Siparişler')
        expect(
          (await nativeSkinDifferences(page)).differences,
          'token-only theme in command search',
        ).toEqual([])
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      const card = page.locator('.card').first()
      if (await card.count()) await expect(card).toHaveCSS('border-radius', '32px')
      // Page fields follow the theme's field radius; the header search is a pill like its neighbours.
      const field = page.locator('main input.input:not([type=file])').first()
      if (await field.count()) {
        await expect(field).toHaveCSS('border-radius', '18px')
        await expect(field).toHaveCSS('border-top-width', '1px')
      }
      await expect(page.locator('.global-search input')).toHaveCSS(
        'border-radius',
        await page
          .locator('.workspace-switch-surface')
          .evaluate((surface) => getComputedStyle(surface).borderTopLeftRadius),
      )
      if (route === '/retail/sale') {
        await page.addStyleTag({
          content: '@layer base { :root { --radius: 0; --field-radius: 0; } }',
        })
        for (const frame of await page.locator('.product-art').all())
          await expect(frame).toHaveCSS('border-radius', '0px')
        expect(
          (await nativeSkinDifferences(page)).differences,
          'square-corner token preset',
        ).toEqual([])
      }
      if (route === '/profile') {
        const previews = page.locator('.theme-preview-pane')
        expect(await previews.count()).toBe(4)
        expect(await previews.nth(0).evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(
          await previews.nth(1).evaluate((e) => getComputedStyle(e).backgroundColor),
        )
        await page.screenshot({
          path: info.outputPath(`ocean-${mode}.png`),
          fullPage: true,
          animations: 'disabled',
        })
      }
      if (route === '/connections') {
        await page.getByRole('button', { name: 'Bildirimler', exact: true }).click()
        await expect(page.getByRole('menu')).toBeVisible()
        expect((await nativeSkinDifferences(page)).differences, 'ocean notifications').toEqual([])
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Demo mağaza ekle', exact: true }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        expect((await nativeSkinDifferences(page)).differences, 'ocean dialog').toEqual([])
        await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '32px')
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const route of ['/dashboard', '/orders', '/settings', '/profile']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await page.addStyleTag({ content: ocean })
      expect((await nativeSkinDifferences(page)).differences, `ocean mobile ${route}`).toEqual([])
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        route,
      ).toBe(true)
    }
  })
}
