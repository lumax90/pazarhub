import { expect, test } from '@playwright/test'
import { createSeedState } from '../src/domain/seed'
import { nativeSkinDifferences } from './native-skin'

for (const theme of ['light', 'dark'] as const) {
  test(`selected HeroUI theme is consistent across application surfaces (${theme})`, async ({
    page,
  }, info) => {
    test.setTimeout(120000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const state = createSeedState()
    state.preferences.theme = theme
    await page.addInitScript((example) => {
      sessionStorage.setItem('pazarhub.mode', 'demo')
      if (!localStorage.getItem('pazarhub.workspace.v1'))
        localStorage.setItem('pazarhub.workspace.v1', JSON.stringify(example))
    }, state)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const routes = [
      '/dashboard',
      '/orders',
      '/orders/new',
      '/products',
      '/products/new',
      '/products/new/bundle',
      '/customers',
      '/inventory',
      '/inventory/transfers',
      '/inventory/counts',
      '/inventory/movements',
      '/definitions/colors',
      '/listings',
      '/finance/invoices',
      '/finance/invoices/new',
      '/finance/cash',
      '/finance/expenses',
      '/finance/customers',
      '/retail',
      '/retail/sale',
      '/connections',
      '/shipments',
      '/returns',
      '/jobs',
      '/team',
      '/margins',
      '/ecommerce-settings',
      '/settings',
      '/settings/notifications',
      '/profile',
      '/questions',
      '/reports',
    ]
    await page.setViewportSize({ width: 1440, height: 1000 })
    for (const route of routes) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await expect(page.locator('vite-error-overlay')).toHaveCount(0)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      if (route === '/profile') {
        // Prove the audit catches the observed bug even in the lower app layer.
        const legacyStyle = await page.addStyleTag({
          content: '@layer app-layout { .theme-option { border: 1px solid var(--border); } }',
        })
        const legacy = await nativeSkinDifferences(page)
        expect(
          legacy.differences.some(
            (entry) => entry.classes?.includes('theme-option') && 'border-top-width' in entry.diff,
          ),
          'detects lower-layer border leaking into a native button',
        ).toBe(true)
        await legacyStyle.evaluate((style) => {
          style.parentNode?.removeChild(style)
        })
      }
      const native = await nativeSkinDifferences(page)
      expect(native.compared, route).toBeGreaterThan(0)
      expect(native.differences, route).toEqual([])
      if (route === '/products') {
        const contrast = await page
          .locator('.list-search .search-field__group')
          .evaluate((field) => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const context = canvas.getContext('2d')!
            const rgb = (element: Element) => {
              context.fillStyle = getComputedStyle(element).backgroundColor
              context.fillRect(0, 0, 1, 1)
              return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
            }
            const fieldRgb = rgb(field),
              cardRgb = rgb(field.closest('.card')!)
            return Math.max(...fieldRgb.map((value, index) => Math.abs(value - cardRgb[index])))
          })
        expect(contrast, 'native secondary field stays distinct on its card').toBeGreaterThan(8)
      }
      if (route === '/retail/sale') {
        const drawings = await page
          .locator('.retail-product-card .product-art svg')
          .evaluateAll((images) =>
            images.map((image) => ({
              actual: image.getBoundingClientRect().width,
              frame: image.parentElement!.getBoundingClientRect().width,
            })),
          )
        expect(drawings.length).toBeGreaterThan(0)
        for (const image of drawings) expect(image.actual).toBeCloseTo(image.frame, 0)
      }
      if (['/dashboard', '/orders', '/retail/sale', '/settings', '/profile'].includes(route))
        await page.screenshot({
          path: info.outputPath(`${route.replaceAll('/', '-')}-${theme}-desktop.png`),
          fullPage: true,
          animations: 'disabled',
        })
    }
    await page.goto('/connections')
    for (const trigger of ['Bildirimler', 'Hesap menüsü']) {
      await page.getByRole('button', { name: trigger, exact: true }).click()
      await expect(page.getByRole('menu')).toBeVisible()
      expect((await nativeSkinDifferences(page)).differences, trigger).toEqual([])
      await page.keyboard.press('ArrowDown')
      expect((await nativeSkinDifferences(page)).differences, `${trigger} keyboard`).toEqual([])
      await page.keyboard.press('Escape')
    }
    await page.getByRole('button', { name: 'Demo mağaza ekle', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect((await nativeSkinDifferences(page)).differences, 'store editor dialog').toEqual([])
    await page.screenshot({
      path: info.outputPath(`store-editor-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await page.keyboard.press('Escape')
    await page.goto('/ecommerce-settings')
    await page.getByRole('button', { name: 'Varsayılan döviz', exact: true }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    expect((await nativeSkinDifferences(page)).differences, 'currency menu').toEqual([])
    await page.screenshot({
      path: info.outputPath(`currency-menu-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await page.keyboard.press('ArrowDown')
    expect(
      (await nativeSkinDifferences(page)).differences,
      'keyboard-focused currency menu',
    ).toEqual([])
    await page.keyboard.press('Escape')
    await page.goto('/orders')
    await page.getByRole('button', { name: 'Filtre', exact: true }).click()
    await expect(page.locator('.order-filter-panel')).toBeVisible()
    expect((await nativeSkinDifferences(page)).differences, 'expanded order filters').toEqual([])
    await page.goto('/products/new/bundle')
    await page.locator('.product-category-choices button').first().click()
    await page.getByRole('button', { name: 'Devam', exact: true }).click()
    await page
      .getByRole('combobox', { name: 'Ürün ekle', exact: true })
      .fill(state.products[0].variants[0].sku)
    await expect(page.getByRole('option').first()).toBeVisible()
    expect((await nativeSkinDifferences(page)).differences, 'searchable product popup').toEqual([])
    await page.getByRole('option').first().click()
    await page
      .getByLabel(`${state.products[0].variants[0].sku} paket adedi`, { exact: true })
      .fill('2')
    await page.getByRole('button', { name: 'Devam', exact: true }).click()
    await expect(page.getByRole('radio', { name: 'Fiyatı sabit tut', exact: true })).toBeVisible()
    expect((await nativeSkinDifferences(page)).differences, 'bundle price choices').toEqual([])
    for (const tab of [
      'information',
      'prices',
      'stocks',
      'variants',
      'images',
      'attributes',
      'integrations',
    ]) {
      await page.goto(`/products/${state.products[0].id}?tab=${tab}`)
      await expect(page.getByRole('tab', { selected: true })).toBeVisible()
      expect((await nativeSkinDifferences(page)).differences, `product ${tab}`).toEqual([])
    }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const route of [
      '/dashboard',
      '/orders',
      '/products',
      '/finance/invoices',
      '/retail',
      '/ecommerce-settings',
      '/settings',
      '/profile',
    ]) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
          message: route,
        })
        .toBe(true)
      expect((await nativeSkinDifferences(page)).differences, `mobile ${route}`).toEqual([])
      await page.screenshot({
        path: info.outputPath(`${route.replaceAll('/', '-')}-${theme}-mobile.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }
    expect(errors).toEqual([])
  })

  test(`login and registration use the selected native field styles (${theme})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    expect((await nativeSkinDifferences(page)).differences, 'login').toEqual([])
    await page.screenshot({ path: info.outputPath(`login-${theme}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Hesap oluştur', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Çalışma alanını oluştur', exact: true }),
    ).toBeVisible()
    expect((await nativeSkinDifferences(page)).differences, 'registration').toEqual([])
  })
}
