import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'

test('workspace selector keeps its monogram, long names and menu aligned in both themes', async ({
  page,
}, info) => {
  const example = createSeedState()
  example.preferences.businessName = 'PixlData'
  example.preferences.theme = 'light'
  await page.addInitScript((state) => {
    sessionStorage.setItem('pazarhub.mode', 'demo')
    if (!localStorage.getItem('pazarhub.workspace.v1')) {
      localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }
  }, example)
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.goto('/dashboard')
  const company = page.locator('.workspace-company')
  const avatar = company.locator('.company-avatar')
  let lightBackground = ''
  for (const theme of ['light', 'dark'] as const) {
    const name =
      theme === 'light' ? 'PixlData' : 'PixlData Çok Uzun Çalışma Alanı Adı ve Operasyon Ekibi'
    if (theme === 'dark') {
      await page.evaluate(
        ({ name, theme }) => {
          const state = JSON.parse(localStorage.getItem('pazarhub.workspace.v1')!)
          state.preferences.businessName = name
          state.preferences.theme = theme
          localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
        },
        { name, theme },
      )
      await page.reload()
    }
    await expect(company.locator('.company-copy strong')).toHaveText(name)
    await page.evaluate(() => document.fonts.ready)
    await company.screenshot({ path: info.outputPath(`workspace-selector-${theme}.png`) })
    const layout = await company.evaluate((element) => {
      const avatar = element.querySelector<HTMLElement>('.company-avatar')!
      const label = element.querySelector<HTMLElement>('.company-copy strong')!
      const icon = element.querySelector<SVGElement>(':scope > svg')!
      const rect = element.getBoundingClientRect(),
        avatarRect = avatar.getBoundingClientRect(),
        iconRect = icon.getBoundingClientRect()
      return {
        width: avatarRect.width,
        height: avatarRect.height,
        lineHeight: parseFloat(getComputedStyle(avatar).lineHeight),
        innerHeight: avatar.clientHeight,
        background: getComputedStyle(avatar).backgroundColor,
        avatarCenter: avatarRect.y + avatarRect.height / 2,
        iconCenter: iconRect.y + iconRect.height / 2,
        rightInside: iconRect.right <= rect.right,
        ellipsis: getComputedStyle(label).textOverflow,
        clipped: label.scrollWidth > label.clientWidth,
      }
    })
    expect(layout.lineHeight).toBeLessThanOrEqual(layout.innerHeight)
    expect(layout.width).toBe(32)
    expect(layout.height).toBe(32)
    expect(Math.abs(layout.avatarCenter - layout.iconCenter)).toBeLessThanOrEqual(1)
    expect(layout.rightInside).toBe(true)
    await expect(avatar).toHaveText('P')
    await expect(avatar).toHaveAttribute('aria-hidden', 'true')
    await expect(company).toHaveAccessibleName(`${name} Çalışma alanı`)
    if (theme === 'light') lightBackground = layout.background
    else {
      expect(layout.background).not.toBe(lightBackground)
      expect(layout.ellipsis).toBe('ellipsis')
      expect(layout.clipped).toBe(true)
    }
    await company.focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('menu', { name: `${name} Çalışma alanı`, exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(company).toBeFocused()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Menüyü aç', exact: true }).click()
  await expect(company).toBeVisible()
  await expect(avatar).toHaveCSS('width', '32px')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})
