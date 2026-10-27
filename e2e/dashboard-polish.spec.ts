import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'

for (const theme of ['light', 'dark'] as const) {
  test(`balanced dashboard keeps data, actions and responsive card spacing (${theme})`, async ({
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
    await expect(
      page.getByRole('heading', { name: 'Gününüz, bir bakışta.', level: 1 }),
    ).toBeVisible()
    await expect(page.locator('.metric-card')).toHaveCount(4)
    await expect(page.locator('.channel-total-row')).toHaveCount(9)
    await expect(page.locator('.recent-orders-table tbody tr')).toHaveCount(5)
    const before = await page.locator('.metric-value').allTextContents()
    const panels = await page.locator('.performance-panel, .channel-panel').evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect(),
          css = getComputedStyle(card)
        return {
          height: box.height,
          inset: parseFloat(css.paddingLeft),
          chartGap: card.classList.contains('performance-panel')
            ? box.bottom - card.querySelector('.chart-plot > svg')!.getBoundingClientRect().bottom
            : null,
        }
      }),
    )
    for (const panel of panels) {
      expect(panel.inset).toBeGreaterThan(0)
      expect(panel.height, 'the summary does not expand to the old 557px empty card').toBeLessThan(
        460,
      )
      if (panel.chartGap !== null)
        expect(panel.chartGap, 'chart fills its card without a large empty area').toBeLessThan(72)
    }
    expect((await nativeSkinDifferences(page)).differences).toEqual([])
    await page.screenshot({
      path: info.outputPath(`dashboard-${theme}-desktop.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Grafik tarih aralığı', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Son 14 gün', exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.getByRole('img', { name: /^14 günlük satış grafiği/ })).toBeVisible()
    await expect(page.locator('.channel-panel')).toContainText('Son 14 gündeki satış dağılımı')
    expect(
      await page.locator('.metric-value').allTextContents(),
      'today values are independent of the chart period',
    ).toEqual(before)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await expect(page.locator('.channel-total-row')).toHaveCount(9)
    await page.screenshot({
      path: info.outputPath(`dashboard-${theme}-mobile.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('link', { name: /Mağazaları yönet/ }).click()
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(
      'Pazaryeri Entegrasyonları',
    )
    await page.goto('/products/new')
    const formInset = await page
      .locator('.product-form-card')
      .first()
      .evaluate((card) => parseFloat(getComputedStyle(card).paddingLeft))
    expect(formInset, 'the shared form card uses native inset too').toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const preference of ['no-preference', 'reduce'] as const) {
  test(`panel motion is visible and respects the system preference (${preference})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: preference })
    await page.addInitScript(() => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      const samples: { opacity: number; transform: string; value: string }[] = []
      Object.assign(window, { panelMotionSamples: samples })
      const sample = () => {
        const panel = document.querySelector<HTMLElement>('.metric-card[data-motion-panel]')
        if (panel) {
          const css = getComputedStyle(panel)
          samples.push({
            opacity: Number(css.opacity),
            transform: css.transform,
            value: panel.querySelector('.metric-value')?.textContent ?? '',
          })
        }
        if (samples.length < 65) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.goto('/dashboard')
    await page.waitForFunction(
      () =>
        (window as unknown as { panelMotionSamples: unknown[] }).panelMotionSamples.length >= 65,
    )
    const samples = await page.evaluate(
      () =>
        (
          window as unknown as {
            panelMotionSamples: { opacity: number; transform: string; value: string }[]
          }
        ).panelMotionSamples,
    )
    expect(
      new Set(samples.map((sample) => sample.value)).size,
      'financial values are never counted up or replaced for animation',
    ).toBe(1)
    expect(samples.at(-1)!.opacity).toBeCloseTo(1)
    if (preference === 'reduce') {
      expect(samples.every((sample) => sample.opacity === 1)).toBe(true)
      expect(
        samples.every(
          (sample) =>
            sample.transform === 'none' || sample.transform === 'matrix(1, 0, 0, 1, 0, 0)',
        ),
      ).toBe(true)
    } else {
      expect(
        samples.some((sample) => sample.opacity > 0 && sample.opacity < 1),
        'real intermediate reveal frames exist',
      ).toBe(true)
      expect(
        samples.some(
          (sample) =>
            sample.transform !== 'none' && sample.transform !== 'matrix(1, 0, 0, 1, 0, 0)',
        ),
        'short panel movement is visible',
      ).toBe(true)
    }
  })
}
