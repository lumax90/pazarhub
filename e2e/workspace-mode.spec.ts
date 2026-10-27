import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'

for (const theme of ['light', 'dark'] as const) {
  test(`workspace mode uses native pill surfaces with search-matched height (${theme})`, async ({
    page,
  }, info) => {
    const state = createSeedState()
    state.preferences.theme = theme
    await page.addInitScript((state) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }, state)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/products')
    const group = page.getByRole('radiogroup', { name: 'Çalışma alanı türü', exact: true })
    const ecommerce = group.getByRole('radio', { name: 'E-Ticaret', exact: true })
    const retail = group.getByRole('radio', { name: 'Perakende', exact: true })
    await expect(group).toHaveClass(/toggle-button-group--detached/)
    await expect(group.locator('..')).toHaveClass(/surface--secondary/)
    await expect(ecommerce).toBeChecked()
    await expect(retail).not.toBeChecked()
    // Clicking the selected mode neither empties the selection nor leaves the current page.
    await ecommerce.click()
    await expect(ecommerce).toBeChecked()
    await expect(page).toHaveURL(/\/products$/)

    for (const width of [1440, 1100, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const geometry = await group.evaluate((group) => {
        const buttons = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        const styles = buttons.map((button) => {
          const css = getComputedStyle(button)
          const box = button.getBoundingClientRect()
          return {
            topLeft: css.borderTopLeftRadius,
            topRight: css.borderTopRightRadius,
            bottomLeft: css.borderBottomLeftRadius,
            bottomRight: css.borderBottomRightRadius,
            background: getComputedStyle(button.querySelector('.workspace-switch-pill') ?? button)
              .backgroundColor,
            left: box.left,
            right: box.right,
          }
        })
        const css = getComputedStyle(group)
        const surface = group.parentElement!
        const surfaceStyle = getComputedStyle(surface)
        const surfaceBox = surface.getBoundingClientRect()
        const searchBox = document.querySelector('.global-search input')!.getBoundingClientRect()
        return {
          styles,
          background: css.backgroundColor,
          padding: css.padding,
          border: css.borderTopWidth,
          surface: {
            radius: surfaceStyle.borderTopLeftRadius,
            background: surfaceStyle.backgroundColor,
            height: surfaceBox.height,
            left: surfaceBox.left,
            right: surfaceBox.right,
            padding: parseFloat(surfaceStyle.paddingLeft),
          },
          searchHeight: searchBox.height,
        }
      })
      expect(geometry.padding).toBe('0px')
      expect(geometry.border).toBe('0px')
      expect(geometry.background).toBe('rgba(0, 0, 0, 0)')
      const [first, last] = geometry.styles
      expect(Math.abs(geometry.surface.height - geometry.searchHeight)).toBeLessThan(1)
      expect(geometry.surface.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(geometry.surface.radius).toBe(first.topLeft)
      expect(first.topLeft).toBe(last.topRight)
      expect(first.bottomLeft).toBe(last.bottomRight)
      expect(parseFloat(first.topLeft)).toBeGreaterThan(0)
      expect(first.topRight).toBe(first.topLeft)
      expect(first.bottomRight).toBe(first.bottomLeft)
      expect(last.topLeft).toBe(last.topRight)
      expect(last.bottomLeft).toBe(last.bottomRight)
      expect(last.left - first.right).toBeGreaterThan(0)
      expect(first.left - geometry.surface.left).toBe(geometry.surface.padding)
      expect(geometry.surface.right - last.right).toBe(geometry.surface.padding)
      expect(first.background).not.toBe(last.background)
      expect((await nativeSkinDifferences(page)).differences).toEqual([])
      if (width === 390) {
        await retail.hover()
        await expect(page.getByRole('tooltip')).toHaveText('Perakende')
      }
      await page.locator('.topbar').screenshot({
        path: info.outputPath(`pill-switch-${theme}-${width}.png`),
        animations: 'disabled',
      })
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await ecommerce.focus()
    await page.keyboard.press('ArrowRight')
    await expect(retail).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/retail$/)
    await expect(retail).toBeChecked()
    await expect(ecommerce).not.toBeChecked()
    await page.goBack()
    await expect(page).toHaveURL(/\/products$/)
    await expect(ecommerce).toBeChecked()
    await page.goto('/retail/history')
    await expect(retail).toBeChecked()
    await retail.click()
    await expect(page).toHaveURL(/\/retail\/history$/)
    await ecommerce.click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(ecommerce).toBeChecked()

    const search = page.getByRole('combobox', { name: 'Genel arama', exact: true })
    await search.fill('Aura')
    await expect(page.getByRole('listbox', { name: 'Arama sonuçları', exact: true })).toBeVisible()
    const searchSkin = await page.locator('.command-popover').evaluate((popover) => {
      const field = document.querySelector('.global-search input')!
      return {
        fieldRadius: getComputedStyle(field).borderTopLeftRadius,
        switchRadius: getComputedStyle(document.querySelector('.workspace-switch-surface')!)
          .borderTopLeftRadius,
        fieldWidth: field.getBoundingClientRect().width,
        popoverWidth: popover.getBoundingClientRect().width,
      }
    })
    // The search field is the same pill as the workspace switch beside it in the header card.
    expect(searchSkin.fieldRadius).toBe(searchSkin.switchRadius)
    expect(Math.abs(searchSkin.fieldWidth - searchSkin.popoverWidth)).toBeLessThan(1)
    expect((await nativeSkinDifferences(page)).differences).toEqual([])
    await page.screenshot({
      path: info.outputPath(`native-search-${theme}.png`),
      animations: 'disabled',
    })
    await search.press('Escape')
    expect(errors).toEqual([])
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`workspace pill slides without moving its labels (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await page.addInitScript(() => sessionStorage.setItem('pazarhub.mode', 'demo'))
    await page.goto('/dashboard')
    const group = page.getByRole('radiogroup', { name: 'Çalışma alanı türü', exact: true })
    const ecommerce = group.getByRole('radio', { name: 'E-Ticaret', exact: true })
    const retail = group.getByRole('radio', { name: 'Perakende', exact: true })
    const settled = () =>
      expect
        .poll(() =>
          group.evaluate((group) => {
            const pill = group.querySelector('.workspace-switch-pill')!
            const selected = group.querySelector('[aria-checked="true"]')!
            return Math.abs(
              pill.getBoundingClientRect().left - selected.getBoundingClientRect().left,
            )
          }),
        )
        .toBeLessThan(1)

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await ecommerce.click()
      await expect(ecommerce).toBeChecked()
      await settled()
      const geometry = await group.evaluate((group) => {
        const surface = group.parentElement!.getBoundingClientRect()
        const selected = group.querySelector('[aria-checked="true"]')!.getBoundingClientRect()
        const target = group.querySelector('[aria-label="Perakende"]')!
        return {
          from: selected.left - surface.left,
          to: target.getBoundingClientRect().left - surface.left,
          iconLeft: target.querySelector('svg')!.getBoundingClientRect().left - surface.left,
        }
      })
      await page.evaluate(() => {
        const samples: { left: number; width: number; iconLeft: number }[] = []
        Object.assign(window, { workspacePillSamples: samples })
        const frame = () => {
          const group = document.querySelector('.workspace-switch')!
          if (
            group.querySelector('[aria-checked="true"]')?.getAttribute('aria-label') === 'Perakende'
          ) {
            const surface = group.parentElement!.getBoundingClientRect()
            const pill = group.querySelector('.workspace-switch-pill')!.getBoundingClientRect()
            const icon = group
              .querySelector('[aria-label="Perakende"] svg')!
              .getBoundingClientRect()
            samples.push({
              left: pill.left - surface.left,
              width: pill.width,
              iconLeft: icon.left - surface.left,
            })
          }
          if (samples.length < 30) requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      })
      await retail.click()
      await expect(retail).toBeChecked()
      await page.waitForFunction(
        () =>
          (window as unknown as { workspacePillSamples: unknown[] }).workspacePillSamples.length >=
          30,
      )
      const samples = await page.evaluate(
        () =>
          (
            window as unknown as {
              workspacePillSamples: { left: number; width: number; iconLeft: number }[]
            }
          ).workspacePillSamples,
      )
      const intermediate = samples.filter(
        (sample) => sample.left > geometry.from + 1 && sample.left < geometry.to - 1,
      )
      if (reducedMotion === 'no-preference') expect(intermediate.length).toBeGreaterThan(0)
      else expect(intermediate).toHaveLength(0)
      expect(Math.abs(samples.at(-1)!.left - geometry.to)).toBeLessThan(1)
      for (const sample of samples) {
        expect(Math.abs(sample.iconLeft - geometry.iconLeft)).toBeLessThan(1)
        expect(sample.width).toBeGreaterThan(0)
      }
      await expect(group.locator('.workspace-switch-pill')).toHaveCount(1)
    }
  })
}
