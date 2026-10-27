import { expect, test } from '@playwright/test'
import { providers } from '../src/domain/integrations'
import { nativeSkinDifferences } from './native-skin'
import { useSeededSession } from './seeded-session'
import { nativeThemeOwners } from '../tests/native-theme-fixture'
import { checkProviderLogos } from './provider-logo-checks'
import type { LogoProvider } from '../src/lib/provider-logos'

test.use({ baseURL: 'http://localhost:4174' })

for (const theme of ['light', 'dark'] as const) {
  test(`live-only integration and import forms keep their native skin (${theme})`, async ({
    page,
  }, info) => {
    test.setTimeout(120000)
    // Isolated e2e database only; no production account, credentials or provider calls.
    await useSeededSession(page, nativeThemeOwners[theme].email)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Koyu temaya geç', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    for (const kind of ['marketplace', 'cargo', 'invoice'] as const) {
      await page.goto(`/connections/${kind}`)
      const definitions = providers.filter((provider) => provider.kind === kind)
      await expect(page.locator('.provider-card')).toHaveCount(definitions.length)
      if (kind !== 'invoice') {
        const logos = await checkProviderLogos(
          page,
          definitions.map((provider) => provider.id as LogoProvider),
        )
        for (const logo of logos) expect(logo.width).toBe(kind === 'cargo' ? 48 : 44)
      }
      if (kind === 'cargo') {
        await page.screenshot({
          path: info.outputPath(`cargo-logos-${theme}.png`),
          animations: 'disabled',
        })
        await page.setViewportSize({ width: 390, height: 844 })
        const logos = await checkProviderLogos(
          page,
          definitions.map((provider) => provider.id as LogoProvider),
        )
        for (const logo of logos) expect(logo.width).toBe(48)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await page.screenshot({
          path: info.outputPath(`cargo-logos-${theme}-mobile.png`),
          fullPage: true,
          animations: 'disabled',
        })
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      expect((await nativeSkinDifferences(page)).differences, `${kind} provider list`).toEqual([])
      for (const provider of definitions) {
        const card = page
          .locator('.provider-card')
          .filter({ has: page.getByRole('heading', { name: provider.name, exact: true }) })
        const connect = card.getByRole('button', { name: 'Bağla', exact: true })
        if (await connect.isDisabled()) continue
        await connect.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        expect(
          (await nativeSkinDifferences(page)).differences,
          `${provider.name} account form`,
        ).toEqual([])
        if (['trendyol', 'parasut'].includes(provider.id))
          await page.screenshot({
            path: info.outputPath(`${provider.id}-form-${theme}.png`),
            fullPage: true,
            animations: 'disabled',
          })
        if (['trendyol', 'parasut'].includes(provider.id)) {
          await page.setViewportSize({ width: 390, height: 844 })
          await expect(page.getByRole('dialog')).toHaveCSS('padding-left', '16px')
          expect(
            (await nativeSkinDifferences(page)).differences,
            `${provider.name} mobile form`,
          ).toEqual([])
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)
          await page.screenshot({
            path: info.outputPath(`${provider.id}-form-${theme}-mobile.png`),
            fullPage: true,
            animations: 'disabled',
          })
          await page.setViewportSize({ width: 1440, height: 1000 })
        }
        await page.getByRole('button', { name: 'Pencereyi kapat', exact: true }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
    }
    for (const route of [
      '/orders/new',
      '/products/new',
      '/ecommerce-settings',
      '/definitions/categories',
      '/jobs',
      '/team',
    ]) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      expect((await nativeSkinDifferences(page)).differences, route).toEqual([])
      if (route === '/products/new') {
        await page.getByRole('button', { name: 'Yeni kategori ekle', exact: true }).click()
        await page.getByLabel('Kategori adı', { exact: true }).fill('Tema test kategorisi')
        await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.getByRole('button', { name: 'Devam', exact: true }).click()
        await expect(
          page.getByRole('radio', { name: 'Varyantsız ürün', exact: true }),
        ).toBeVisible()
        expect((await nativeSkinDifferences(page)).differences, 'product variation step').toEqual(
          [],
        )
        await page.getByLabel('Stok kodu', { exact: true }).fill('THEME-TEST')
        await page.getByRole('button', { name: 'Devam', exact: true }).click()
        await expect(page.getByLabel('Ürün adı', { exact: true })).toBeVisible()
        expect((await nativeSkinDifferences(page)).differences, 'product final step').toEqual([])
      }
    }
    await page.goto('/products')
    await page.getByRole('button', { name: 'İçe aktar', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect((await nativeSkinDifferences(page)).differences, 'import file dialog').toEqual([])
    await page.getByLabel('CSV veya XML dosyası', { exact: true }).setInputFiles({
      name: 'tema-katalog.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        '\uFEFFSKU;Ürün adı;Satış fiyatı;Stok\nTHEME-TEST;Tema test ürünü;149,90;5',
      ),
    })
    await expect(page.locator('.import-file-summary')).toContainText('1 kayıt')
    expect((await nativeSkinDifferences(page)).differences, 'import mapping form').toEqual([])
    await page.screenshot({
      path: info.outputPath(`catalog-import-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Pencereyi kapat', exact: true }).click()
    const workspace = await (await page.context().request.get('/api/workspace')).json()
    expect(workspace.state.products).toHaveLength(0)
    expect(
      (await (await page.context().request.get('/api/integrations')).json()).connections,
    ).toHaveLength(0)
  })
}
