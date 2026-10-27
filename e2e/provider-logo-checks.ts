import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { LogoProvider } from '../src/lib/provider-logos'

export async function checkProviderLogos(page: Page, providers: LogoProvider[]) {
  const images = page.locator('img[data-provider-logo]')
  await expect
    .poll(() =>
      images.evaluateAll(
        (images) =>
          images.length > 0 &&
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
      ),
    )
    .toBe(true)
  for (const provider of providers) {
    expect(
      await images.evaluateAll(
        (images, provider) =>
          images.some((image) => image.getAttribute('data-provider-logo') === provider),
        provider,
      ),
      `logo exists for ${provider}`,
    ).toBe(true)
  }
  const geometry = await images.evaluateAll((images) =>
    images.map((element) => {
      const image = element as HTMLImageElement
      const box = image.getBoundingClientRect()
      const wrapper = image.parentElement!
      const frame = wrapper.getBoundingClientRect()
      return {
        provider: image.dataset.providerLogo,
        src: image.currentSrc,
        alt: image.alt,
        fit: getComputedStyle(image).objectFit,
        filter: getComputedStyle(wrapper).filter,
        width: box.width,
        height: box.height,
        frameWidth: frame.width,
        frameHeight: frame.height,
      }
    }),
  )
  for (const image of geometry) {
    expect(image.src).toBe(`${new URL(page.url()).origin}/brands/${image.provider}.png`)
    expect(image.alt).toBe('')
    expect(image.fit).toBe('contain')
    expect(image.filter).toBe('none')
    expect(image.width).toBe(image.frameWidth)
    expect(image.height).toBe(image.frameHeight)
  }
  return geometry
}
