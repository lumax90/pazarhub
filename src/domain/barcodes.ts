import type { AppState, EcommerceSettings } from './types'

/** Global trade item number lengths: GTIN-8, UPC-A (12), EAN-13, GTIN-14. */
const gtinLengths = new Set([8, 12, 13, 14])
const internalDigits = 6

/** GS1 check digit for the data digits: weights 3, 1, 3… counted from the right. */
export function gtinCheckDigit(data: string) {
  let sum = 0
  for (let index = 0; index < data.length; index++)
    sum += Number(data[data.length - 1 - index]) * (index % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10
}

/** A numeric GTIN-8/12/13/14 whose last digit is its check digit. */
export function isGtin(code: string) {
  return (
    /^\d+$/.test(code) &&
    gtinLengths.has(code.length) &&
    Number(code.at(-1)) === gtinCheckDigit(code.slice(0, -1))
  )
}

/**
 * Why a barcode that looks like a GTIN cannot be one. Internal or alphanumeric codes pass:
 * only marketplaces that demand a GTIN reject those, at send time.
 */
export function gtinProblem(code: string) {
  if (!/^\d+$/.test(code) || !gtinLengths.has(code.length)) return undefined
  const expected = gtinCheckDigit(code.slice(0, -1))
  return Number(code.at(-1)) === expected
    ? undefined
    : `Kontrol hanesi hatalı; son hane ${expected} olmalı.`
}

/** GS1 company prefix: digits only, leaving room for an item number in an EAN-13. */
export function gs1PrefixProblem(prefix: string) {
  if (!/^\d{6,11}$/.test(prefix)) return 'GS1 firma öneki 6–11 rakamdan oluşmalı.'
  if (prefix.startsWith('2'))
    return '2 ile başlayan önekler mağaza içi kullanım içindir; GS1’in verdiği öneki girin.'
}
export function barcodePrefixProblem(prefix: string) {
  if (!/^[A-Z0-9]{2,12}$/.test(prefix))
    return 'Barkod öneki 2–12 Latin büyük harf veya rakamdan oluşmalı.'
}

export type BarcodeScheme = { kind: 'gs1' | 'internal'; prefix: string }

/** A GS1 prefix wins: its EAN-13s are valid on every marketplace. Invalid prefixes are skipped. */
export function barcodeScheme(
  settings?: Pick<EcommerceSettings, 'gs1Prefix' | 'barcodePrefix'>,
): BarcodeScheme | undefined {
  if (settings?.gs1Prefix && !gs1PrefixProblem(settings.gs1Prefix))
    return { kind: 'gs1', prefix: settings.gs1Prefix }
  if (settings?.barcodePrefix && !barcodePrefixProblem(settings.barcodePrefix))
    return { kind: 'internal', prefix: settings.barcodePrefix }
}

export function usedBarcodes(state: AppState) {
  return state.products.flatMap((product) =>
    product.variants.map((variant) => variant.barcode).filter(Boolean),
  )
}

/**
 * The next free barcodes after the highest number already issued under the prefix.
 * Numbers handed out outside Pazarhub are unknown here; the save still rejects duplicates.
 */
export function nextBarcodes(scheme: BarcodeScheme, used: Iterable<string>, count: number) {
  const taken = new Set(used)
  const width = scheme.kind === 'gs1' ? 12 - scheme.prefix.length : internalDigits
  const issued =
    scheme.kind === 'gs1'
      ? new RegExp(`^${scheme.prefix}(\\d{${width}})\\d$`)
      : new RegExp(`^${scheme.prefix}(\\d{${internalDigits},})$`)
  let next = 1
  for (const code of taken) {
    const match = issued.exec(code)
    if (match && (scheme.kind === 'internal' || isGtin(code)))
      next = Math.max(next, Number(match[1]) + 1)
  }
  const codes: string[] = []
  while (codes.length < count) {
    if (scheme.kind === 'gs1' && next >= 10 ** width)
      throw new Error('GS1 önekinizdeki ürün numaraları doldu. GS1’den yeni önek alın.')
    const number = String(next++).padStart(width, '0')
    const code =
      scheme.kind === 'gs1'
        ? `${scheme.prefix}${number}${gtinCheckDigit(scheme.prefix + number)}`
        : `${scheme.prefix}${number}`
    if (!taken.has(code)) {
      taken.add(code)
      codes.push(code)
    }
  }
  return codes
}
