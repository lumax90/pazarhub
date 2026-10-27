import { readFileSync, readdirSync } from 'node:fs'
import type { Page } from '@playwright/test'

const componentDirectory = new URL(
  '../node_modules/@heroui/styles/dist/components/',
  import.meta.url,
)
const nativeClasses = [
  ...new Set(
    readdirSync(componentDirectory)
      .filter((name) => name.endsWith('.css'))
      .flatMap((name) =>
        [
          ...readFileSync(new URL(name, componentDirectory), 'utf8').matchAll(/\.([a-z][\w-]*)/g),
        ].map((match) => match[1]),
      ),
  ),
]

/** Compare rendered primitives with the same DOM/theme without application CSS.
 * Keep the complete DOM and native states: stripping a menu's ancestors loses
 * its inherited font, while synthesizing keyboard state adds a false focus ring.
 * Layout dimensions are intentionally excluded (wide dialogs, table density).
 */
export async function nativeSkinDifferences(page: Page) {
  await page.mouse.move(0, 0)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
  return page.evaluate(async (names) => {
    const native = new Set(names)
    // Browsers may serialize identical colors as oklab or oklch during style
    // updates. Compare the rendered RGBA, not their textual representation.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const colors = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (color: string) => {
      colors.clearRect(0, 0, 1, 1)
      colors.fillStyle = color
      colors.fillRect(0, 0, 1, 1)
      return [...colors.getImageData(0, 0, 1, 1).data].join(',')
    }
    const properties = [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'color',
      'background-color',
      'background-image',
      'border-radius',
      'border-top-width',
      'border-top-color',
      'border-bottom-width',
      'border-bottom-color',
      'box-shadow',
      'text-decoration-line',
    ]
    const selector = '[data-slot], .button, input.input, textarea.textarea, .label, .header'
    const originals = [...document.querySelectorAll<HTMLElement>(selector)]
    const rootStyle = getComputedStyle(document.documentElement)
    const sheets = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter(
        (rule) =>
          !(
            rule instanceof CSSLayerBlockRule && ['app-layout', 'app-structure'].includes(rule.name)
          ),
      )
    const clone = document.body.cloneNode(true) as HTMLBodyElement
    clone.querySelectorAll('script,style,link').forEach((node) => node.remove())
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.inert = true
    frame.tabIndex = -1
    Object.assign(frame.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      width: `${innerWidth}px`,
      height: `${innerHeight}px`,
      pointerEvents: 'none',
      border: 'none',
    })
    document.body.append(frame)
    try {
      const doc = frame.contentDocument!
      doc.head.innerHTML = ''
      const base = doc.createElement('base')
      base.href = document.baseURI
      doc.head.append(base)
      for (const attr of document.documentElement.attributes)
        doc.documentElement.setAttribute(attr.name, attr.value)
      const style = doc.createElement('style')
      // A detached reference cannot hold the real document's focus. Preserve
      // native pseudo-classes, including :has(input:focus), with reference-only
      // attributes rather than inventing React Aria state on the cloned input.
      const referenceStyles = sheets
        .map((rule) => rule.cssText)
        .join('\n')
        .replace(/:focus-visible(?![\w-])/g, '[data-native-focus-visible]')
        .replace(/:focus-within(?![\w-])/g, '[data-native-focus-within]')
        .replace(/:focus(?![\w-])/g, '[data-native-focus]')
      style.textContent =
        referenceStyles +
        `\n:root { font-family: ${rootStyle.fontFamily}; font-size: ${rootStyle.fontSize}; line-height: ${rootStyle.lineHeight}; color: var(--foreground); background: var(--background); }\n*, *::before, *::after { transition: none !important; animation: none !important; }`
      doc.head.append(style)
      doc.body.replaceWith(clone)
      await doc.fonts.ready
      const references = [...doc.querySelectorAll<HTMLElement>(selector)]
      if (originals.length !== references.length) throw new Error('Native reference DOM mismatch')
      for (let i = 0; i < originals.length; i++) {
        for (const pseudo of ['focus', 'focus-visible', 'focus-within']) {
          if (originals[i].matches(`:${pseudo}`))
            references[i].setAttribute(`data-native-${pseudo}`, '')
        }
      }
      let compared = 0
      const differences = []
      for (let i = 0; i < originals.length; i++) {
        const element = originals[i]
        if (
          ![...element.classList].some((name) => native.has(name)) ||
          !element.getBoundingClientRect().width ||
          !element.getBoundingClientRect().height ||
          element.closest('[hidden]')
        )
          continue
        const reference = references[i]
        const actual = getComputedStyle(element)
        const expected = frame.contentWindow!.getComputedStyle(reference)
        const diff: Record<string, { actual: string; native: string }> = {}
        const checkedProperties =
          element.dataset.slot === 'modal-dialog' && innerWidth > 600
            ? [...properties, 'padding-left', 'padding-right']
            : properties
        for (const property of checkedProperties) {
          if (
            property.startsWith('border') &&
            property.endsWith('color') &&
            actual.getPropertyValue(property.replace('color', 'width')) === '0px' &&
            expected.getPropertyValue(property.replace('color', 'width')) === '0px'
          )
            continue
          const actualValue = actual.getPropertyValue(property)
          const expectedValue = expected.getPropertyValue(property)
          if (property === 'color' || property.endsWith('-color')) {
            if (rgba(actualValue) === rgba(expectedValue)) continue
          }
          if (actualValue !== expectedValue)
            diff[property] = {
              actual: actual.getPropertyValue(property),
              native: expected.getPropertyValue(property),
            }
        }
        // Table separators, required asterisks and native control indicators
        // can be hidden or re-skinned without changing the element itself.
        for (const pseudo of ['::before', '::after']) {
          const actualPseudo = getComputedStyle(element, pseudo)
          const nativePseudo = frame.contentWindow!.getComputedStyle(reference, pseudo)
          if (actualPseudo.content === 'none' && nativePseudo.content === 'none') continue
          for (const property of [
            'content',
            'display',
            'background-color',
            'color',
            'border-radius',
          ]) {
            const actualValue = actualPseudo.getPropertyValue(property)
            const expectedValue = nativePseudo.getPropertyValue(property)
            if (
              (property === 'color' || property.endsWith('-color')) &&
              rgba(actualValue) === rgba(expectedValue)
            )
              continue
            if (actualValue !== expectedValue)
              diff[`${pseudo} ${property}`] = { actual: actualValue, native: expectedValue }
          }
        }
        compared++
        if (Object.keys(diff).length)
          differences.push({
            slot: element.dataset.slot || element.tagName.toLowerCase(),
            classes: element.getAttribute('class'),
            text: element.textContent?.trim().slice(0, 55),
            diff,
          })
      }
      return { compared, differences }
    } finally {
      frame.remove()
    }
  }, nativeClasses)
}
