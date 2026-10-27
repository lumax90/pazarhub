import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'

const preferenceKey = 'pazarhub.ui.sidebar.compact.v1'

for (const theme of ['light', 'dark'] as const) {
  test(`sidebar rail preserves destinations, tooltips and its preference (${theme})`, async ({
    page,
  }, info) => {
    const state = createSeedState()
    state.preferences.theme = theme
    await page.addInitScript((state) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      if (!localStorage.getItem('pazarhub.workspace.v1'))
        localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }, state)
    await page.goto('/dashboard')
    const shell = page.locator('.app-shell')
    const sidebar = page.getByRole('complementary', { name: 'Ana gezinme' })
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    const help = sidebar.getByRole('button', { name: 'Yardım ve kısayollar', exact: true })
    await expect(help.locator('svg')).toHaveCount(1)
    await expect(help).toHaveText('Yardım ve kısayollar')
    await expect(help.locator('.help-key')).toHaveCount(0)
    await help.focus()
    await page.keyboard.press('Enter')
    const helpDialog = page.getByRole('dialog', {
      name: 'Çalışma alanınıza hoş geldiniz',
      exact: true,
    })
    await expect(helpDialog).toBeVisible()
    await helpDialog.getByRole('button', { name: 'Anladım', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'MUHASEBE YÖNETİMİ', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('button', { name: 'Menüyü daralt', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(shell).toHaveAttribute('data-sidebar', 'compact')
    await expect.poll(() => sidebar.evaluate((e) => e.getBoundingClientRect().width)).toBe(72)
    expect(await page.locator('.main-shell').evaluate((e) => e.getBoundingClientRect().left)).toBe(
      72,
    )
    await expect(page.getByRole('button', { name: 'Menüyü genişlet', exact: true })).toBeFocused()
    await expect(help.locator('svg')).toHaveCount(1)
    await expect(help).toHaveText('')
    await expect(
      page.locator('.sidebar-navigation').getByRole('link', { name: 'Faturalar', exact: true }),
    ).toBeVisible()
    const orders = page
      .locator('.sidebar-navigation')
      .getByRole('link', { name: 'Siparişler', exact: true })
    for (const height of [1000, 700]) {
      await page.setViewportSize({ width: 1440, height })
      await orders.hover()
      const sections = await page
        .locator('.sidebar-navigation .nav-section-items')
        .evaluateAll((items) =>
          items.map((section) => {
            const rect = section.getBoundingClientRect()
            return {
              width: section.clientWidth,
              scroll: section.scrollWidth,
              left: rect.left,
              right: rect.right,
              buttons: [...section.querySelectorAll('.nav-item')].map((button) => {
                const rect = button.getBoundingClientRect()
                return { left: rect.left, right: rect.right }
              }),
            }
          }),
        )
      for (const section of sections) {
        expect(section.scroll).toBe(section.width)
        for (const button of section.buttons) {
          expect(button.left).toBeGreaterThanOrEqual(section.left)
          expect(button.right).toBeLessThanOrEqual(section.right)
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.mouse.move(350, 200)
    await page.keyboard.press('ArrowRight')
    await orders.focus()
    await expect(page.getByRole('tooltip')).toContainText('Siparişler')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Siparişler', level: 1 })).toBeVisible()
    await page.reload()
    await expect(shell).toHaveAttribute('data-sidebar', 'compact')
    expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe('true')

    const definitions = page.getByRole('button', { name: 'Tanımlamalar', exact: true })
    await definitions.click()
    await expect(page.getByRole('menu')).toBeVisible()
    expect(
      await page.getByRole('menu').evaluate((e) => e.getBoundingClientRect().left),
    ).toBeGreaterThan(72)
    await page.getByRole('menuitemradio', { name: 'Renkler', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Renkler', level: 1 })).toBeVisible()
    await definitions.click()
    await expect(page.getByRole('menuitemradio', { name: 'Renkler', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.keyboard.press('Escape')
    await expect(definitions).toBeFocused()

    const company = page.getByRole('button', {
      name: `${state.preferences.businessName} Çalışma alanı`,
      exact: true,
    })
    await expect(company.locator('.company-avatar')).toBeVisible()
    await expect(company.locator('.company-copy')).toBeHidden()
    await company.click()
    await expect(
      page.getByRole('menuitem', { name: 'Çalışma alanı ayarları', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    expect((await nativeSkinDifferences(page)).differences).toEqual([])
    await page.screenshot({
      path: info.outputPath(`sidebar-${theme}-compact.png`),
      fullPage: true,
      animations: 'disabled',
    })

    await page.getByRole('button', { name: 'Menüyü genişlet', exact: true }).click()
    await expect(shell).toHaveAttribute('data-sidebar', 'expanded')
    await expect.poll(() => sidebar.evaluate((e) => e.getBoundingClientRect().width)).toBe(228)
    await expect(
      page.getByRole('button', { name: 'MUHASEBE YÖNETİMİ', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(company.locator('.company-copy')).toBeVisible()
    await page.screenshot({
      path: info.outputPath(`sidebar-${theme}-expanded.png`),
      fullPage: true,
      animations: 'disabled',
    })
  })
}

test('desktop rail preference keeps the full mobile drawer and compact header usable', async ({
  page,
}, info) => {
  await page.addInitScript(() => sessionStorage.setItem('pazarhub.mode', 'demo'))
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Menüyü daralt', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'expanded')
  await expect(page.locator('.sidebar-toggle')).toBeHidden()
  await page.getByRole('button', { name: 'Menüyü aç', exact: true }).click()
  await expect(page.locator('.app-sidebar')).toBeVisible()
  await expect(page.locator('.company-copy')).toBeVisible()
  await page
    .locator('.sidebar-navigation')
    .getByRole('link', { name: /Siparişler/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Siparişler', level: 1 })).toBeVisible()
  await expect(page.locator('.app-sidebar')).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.getByRole('combobox', { name: 'Genel arama', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Arama sonuçları', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({
    path: info.outputPath('header-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 1000, height: 900 })
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'compact')
  await expect(page.getByRole('button', { name: 'Menüyü aç', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Menüyü genişlet', exact: true }).click()
  await expect
    .poll(() => page.locator('.app-sidebar').evaluate((e) => e.getBoundingClientRect().width))
    .toBe(211)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.getByRole('radio', { name: 'Perakende', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Perakende', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'E-Ticaret', exact: true })).not.toBeChecked()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Menüyü daralt', exact: true }).click()
  await page
    .locator('.sidebar-navigation')
    .getByRole('link', { name: 'Yeni Satış', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Yeni satış', level: 1 })).toBeVisible()
})

test('sidebar and content resize together with a short transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => sessionStorage.setItem('pazarhub.mode', 'demo'))
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.evaluate(() => {
    const samples: { width: number; left: number }[] = []
    Object.assign(window, { sidebarMotionSamples: samples })
    const sample = () => {
      if (document.querySelector('.app-shell')?.getAttribute('data-sidebar') === 'compact')
        samples.push({
          width: document.querySelector('.app-sidebar')!.getBoundingClientRect().width,
          left: document.querySelector('.main-shell')!.getBoundingClientRect().left,
        })
      if (samples.length < 30) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.getByRole('button', { name: 'Menüyü daralt', exact: true }).click()
  await page.waitForFunction(
    () =>
      (window as unknown as { sidebarMotionSamples: unknown[] }).sidebarMotionSamples.length >= 30,
  )
  const samples = await page.evaluate(
    () =>
      (window as unknown as { sidebarMotionSamples: { width: number; left: number }[] })
        .sidebarMotionSamples,
  )
  expect(samples.some((sample) => sample.width > 72 && sample.width < 228)).toBe(true)
  expect(samples.at(-1)!.width).toBe(72)
  for (const sample of samples) expect(Math.abs(sample.width - sample.left)).toBeLessThan(1)
})
