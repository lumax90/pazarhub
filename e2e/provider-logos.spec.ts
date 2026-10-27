import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { providers } from '../src/domain/integrations'
import type { MarketplaceProvider } from '../src/domain/integrations'
import { nativeSkinDifferences } from './native-skin'
import { checkProviderLogos } from './provider-logo-checks'

for (const theme of ['light', 'dark'] as const) {
  test(`real marketplace logos keep their original icon footprints (${theme})`, async ({
    page,
  }, info) => {
    const state = createSeedState()
    state.preferences.theme = theme
    const marketplaces = providers
      .filter((provider) => provider.kind === 'marketplace')
      .map((provider) => provider.id as MarketplaceProvider)
    state.connections = marketplaces.map(
      (channel) =>
        state.connections.find((connection) => connection.channel === channel) ?? {
          id: `logo-${channel}`,
          channel,
          name: channel,
          active: true,
        },
    )
    await page.addInitScript((state) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(state))
    }, state)
    const externalImages: string[] = []
    page.on('request', (request) => {
      if (
        request.resourceType() === 'image' &&
        new URL(request.url()).origin !== new URL(page.url()).origin
      )
        externalImages.push(request.url())
    })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await checkProviderLogos(page, marketplaces)
    const channelIcons = page.locator('.channel-totals .channel-icon')
    await expect(channelIcons).toHaveCount(9)
    for (const icon of await channelIcons.all()) await expect(icon).toHaveCSS('width', '22px')
    await expect(page.locator('.channel-icon--manual')).toHaveText('m')
    await page.screenshot({
      path: info.outputPath(`dashboard-logos-${theme}.png`),
      animations: 'disabled',
    })

    await page.goto('/products')
    await checkProviderLogos(page, ['trendyol', 'hepsiburada'])
    const stacked = page.locator('.channel-icon-stack .channel-icon')
    expect(await stacked.count()).toBeGreaterThan(0)
    for (const icon of await stacked.all()) await expect(icon).toHaveCSS('width', '20px')
    expect((await nativeSkinDifferences(page)).differences).toEqual([])

    await page.goto('/connections')
    const connections = await checkProviderLogos(page, marketplaces)
    for (const logo of connections) expect(logo.width).toBe(44)
    await page.screenshot({
      path: info.outputPath(`marketplace-logos-${theme}.png`),
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    const mobile = await checkProviderLogos(page, marketplaces)
    for (const logo of mobile) expect(logo.width).toBe(37)
    expect((await nativeSkinDifferences(page)).differences).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: info.outputPath(`marketplace-logos-${theme}-mobile.png`),
      animations: 'disabled',
    })
    expect(externalImages).toEqual([])
  })
}
