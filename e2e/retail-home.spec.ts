import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'

const shortcutTitles = ['Yeni satış', 'Yeni iade', 'Yeni alış', 'Kasa', 'Eski satışlar', 'Stok']
const shortcutPaths = [
  '/retail/sale',
  '/retail/returns?new=1',
  '/retail/finance/expenses?new=purchase',
  '/retail/finance/cash',
  '/retail/history',
  '/retail/inventory',
]

for (const theme of ['light', 'dark'] as const) {
  test(`retail home shortcuts stay compact and readable without changing destinations (${theme})`, async ({
    page,
  }, info) => {
    const state = createSeedState()
    state.preferences.theme = theme
    await page.addInitScript((state) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }, state)
    await page.goto('/retail')
    await expect(page.getByRole('heading', { name: 'Perakende', level: 1 })).toBeVisible()
    const cards = page.locator('.retail-shortcut')
    await expect(cards).toHaveCount(6)
    await expect(cards.locator('h2')).toHaveText(shortcutTitles)
    for (let index = 0; index < shortcutPaths.length; index++) {
      await expect(cards.nth(index)).toHaveAttribute('href', shortcutPaths[index])
    }

    for (const width of [1440, 1100, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      const geometry = await page.locator('.retail-shortcuts').evaluate((grid) => ({
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        overflow: document.documentElement.scrollWidth > innerWidth,
        cards: [...grid.querySelectorAll<HTMLElement>('.retail-shortcut')].map((card) => {
          const box = card.getBoundingClientRect()
          const heading = card.querySelector('h2')!.getBoundingClientRect()
          const description = card.querySelector('p')!
          const text = description.getBoundingClientRect()
          const footer = card.querySelector('.retail-shortcut-bottom')!.getBoundingClientRect()
          const icon = card.querySelector('.retail-shortcut-icon')!.getBoundingClientRect()
          return {
            height: box.height,
            padding: getComputedStyle(card).paddingLeft,
            left: box.left,
            right: box.right,
            bottom: box.bottom,
            headingBottom: heading.bottom,
            textTop: text.top,
            textBottom: text.bottom,
            textWidth: text.width,
            textScrollWidth: description.scrollWidth,
            footerTop: footer.top,
            footerBottom: footer.bottom,
            iconWidth: icon.width,
          }
        }),
      }))
      expect(geometry.columns).toBe(width > 720 ? 3 : 2)
      expect(geometry.overflow).toBe(false)
      for (const card of geometry.cards) {
        expect(card.height).toBeLessThan(width > 720 ? 235 : 250)
        expect(card.padding).toBe(width > 720 ? '20px' : '14px')
        expect(card.iconWidth).toBe(width > 720 ? 40 : 36)
        expect(card.textScrollWidth).toBeLessThanOrEqual(Math.ceil(card.textWidth))
        expect(card.headingBottom).toBeLessThan(card.textTop)
        expect(card.textBottom).toBeLessThan(card.footerTop)
        expect(card.footerBottom).toBeLessThan(card.bottom)
      }
      for (let index = 1; index < geometry.cards.length; index++) {
        if (index % geometry.columns !== 0) {
          expect(geometry.cards[index].left).toBeGreaterThan(geometry.cards[index - 1].right)
          expect(geometry.cards[index].height).toBe(geometry.cards[index - 1].height)
        }
      }
      expect((await nativeSkinDifferences(page)).differences).toEqual([])
      if (width === 1440 || width === 390) {
        await page.screenshot({
          path: info.outputPath(`retail-home-${theme}-${width}.png`),
          animations: 'disabled',
        })
      }
    }
    await cards.first().focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/retail\/sale$/)
    await expect(page.getByRole('heading', { name: 'Yeni satış', level: 1 })).toBeVisible()
  })
}
