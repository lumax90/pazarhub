import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'

for (const theme of ['light', 'dark'] as const) {
  test(`quick search is one inline field with equal-width results and keyboard navigation (${theme})`, async ({
    page,
  }, info) => {
    const state = createSeedState()
    state.preferences.theme = theme
    const longName =
      'Uzun ürün adı — renk, model ve ölçü bilgileriyle birlikte eksiksiz okunması gereken seramik dekorasyon ürünü'
    state.products[0].name = longName
    await page.addInitScript((state) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }, state)
    await page.goto('/dashboard')
    const search = page.getByRole('combobox', { name: 'Genel arama', exact: true })
    const results = page.getByRole('listbox', { name: 'Arama sonuçları', exact: true })
    const checkGeometry = async () => {
      // React Aria publishes the new trigger width via ResizeObserver after a breakpoint.
      await expect
        .poll(() =>
          page.locator('.command-popover').evaluate((popover) => {
            const box = popover.getBoundingClientRect()
            const field = document.querySelector('.global-search input')!.getBoundingClientRect()
            return Math.max(Math.abs(box.width - field.width), Math.abs(box.left - field.left))
          }),
        )
        .toBeLessThan(1)
      const geometry = await page.locator('.command-popover').evaluate((popover) => {
        const box = popover.getBoundingClientRect()
        const input = document.querySelector('.global-search input')!.getBoundingClientRect()
        const list = popover.querySelector('[role="listbox"]')!
        return {
          width: box.width,
          left: box.left,
          right: box.right,
          top: box.top,
          input: { width: input.width, left: input.left, bottom: input.bottom },
          available: list.clientWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
          rows: [...list.querySelectorAll<HTMLElement>('[data-slot="list-box-item"]')].map(
            (row) => {
              const rect = row.getBoundingClientRect()
              return {
                width: rect.width,
                top: rect.top,
                bottom: rect.bottom,
                right: rect.right,
                text: [...row.querySelectorAll<HTMLElement>('.label,.description')].map((text) => {
                  const rect = text.getBoundingClientRect()
                  return { top: rect.top, bottom: rect.bottom, right: rect.right }
                }),
              }
            },
          ),
        }
      })
      expect(geometry.overflow).toBe(false)
      expect(Math.abs(geometry.width - geometry.input.width)).toBeLessThan(1)
      expect(Math.abs(geometry.left - geometry.input.left)).toBeLessThan(1)
      expect(geometry.top).toBeGreaterThan(geometry.input.bottom)
      expect(geometry.rows.length).toBeGreaterThan(0)
      for (const row of geometry.rows) {
        expect(row.width).toBeGreaterThanOrEqual(geometry.available - 12)
        for (const text of row.text) {
          expect(text.top).toBeGreaterThanOrEqual(row.top)
          expect(text.bottom).toBeLessThanOrEqual(row.bottom)
          expect(text.right).toBeLessThanOrEqual(row.right)
        }
      }
      for (let i = 1; i < geometry.rows.length; i++)
        expect(geometry.rows[i].top).toBeGreaterThanOrEqual(geometry.rows[i - 1].bottom)
    }
    for (const width of [1440, 1000, 440, 360]) {
      await page.setViewportSize({ width, height: 852 })
      await expect(search).toBeVisible()
      await expect(search).toHaveAttribute('placeholder', 'Ara…')
      await search.fill('Uzun ürün')
      await expect(results).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.app-backdrop')).toHaveCount(0)
      await expect(page.locator('.global-search input')).toHaveCount(1)
      await expect(results.getByRole('option').filter({ hasText: longName })).toBeVisible()
      await checkGeometry()
      expect((await nativeSkinDifferences(page)).differences).toEqual([])
      await page.screenshot({
        path: info.outputPath(`quick-search-${theme}-${width}.png`),
        animations: 'disabled',
      })
      // ComboBox exposes only the input/options to screen readers while open.
      // Verify the visible clear control with the pointer; Escape exposes it to Tab below.
      await page.locator('.global-search .quick-search-clear').click()
      await expect(search).toHaveValue('')
      await expect(search).toBeFocused()
      await search.fill('SonucuOlmayanArama123')
      await expect(
        results.getByRole('heading', { name: 'Sonuç bulunamadı', exact: true }),
      ).toBeVisible()
      await expect(results.locator('[data-slot="list-box-item"]')).toHaveCount(0)
      await search.press('Enter')
      await expect(page).toHaveURL(/\/dashboard$/)
      await search.press('Escape')
      await expect(results).toHaveCount(0)
      await expect(search).toBeFocused()
      await search.press('Tab')
      await expect(page.getByRole('button', { name: 'Aramayı temizle', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(search).toHaveValue('')
      await search.press('Escape')
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await search.fill(state.products[0].variants[0].sku)
    await expect(results.getByRole('option').filter({ hasText: longName })).toBeVisible()
    await search.fill(state.products[0].variants[0].barcode)
    await expect(results.getByRole('option').filter({ hasText: longName })).toBeVisible()
    await page.mouse.click(350, 650)
    await expect(results).toHaveCount(0)
    await page.keyboard.press('Meta+k')
    await expect(search).toBeFocused()
    await search.fill('Siparişler')
    await page.setViewportSize({ width: 390, height: 852 })
    await expect(search).toHaveValue('Siparişler')
    await expect(search).toBeFocused()
    await expect(results).toBeVisible()
    await checkGeometry()
    await search.press('ArrowDown')
    await search.press('Enter')
    await expect(page.getByRole('heading', { name: 'Siparişler', level: 1 })).toBeVisible()
    await expect(results).toHaveCount(0)
    const orderSearch = page.getByRole('searchbox', { name: 'Siparişlerde ara', exact: true })
    await search.fill('Ürün')
    await expect(results).toBeVisible()
    await search.press('Escape')
    await orderSearch.fill('SP')
    await expect(orderSearch).toHaveAttribute('value', 'SP')
    await expect(search).toHaveValue('Ürün')
    await page.keyboard.press('Control+k')
    await expect(search).toBeFocused()
    await search.press('Escape')
    await expect(search).toBeFocused()
    await expect(results).toHaveCount(0)
    await expect(orderSearch).toHaveValue('SP')
  })
}
