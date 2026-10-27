import { describe, expect, it } from 'vitest'
import {
  barcodePrefixProblem,
  barcodeScheme,
  gs1PrefixProblem,
  gtinCheckDigit,
  gtinProblem,
  isGtin,
  nextBarcodes,
} from '../src/domain/barcodes'

describe('GTIN check digit', () => {
  it('matches published GS1 examples for every length', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1) // EAN-13 4006381333931
    expect(gtinCheckDigit('9638507')).toBe(4) // GTIN-8 96385074
    expect(gtinCheckDigit('03600029145')).toBe(2) // UPC-A 036000291452
    expect(gtinCheckDigit('1001234500001')).toBe(7) // GTIN-14 10012345000017
    for (const code of ['4006381333931', '96385074', '036000291452', '10012345000017'])
      expect(isGtin(code)).toBe(true)
  })
  it('flags numeric codes with a wrong last digit and leaves internal codes alone', () => {
    expect(isGtin('4006381333932')).toBe(false)
    expect(gtinProblem('4006381333932')).toBe('Kontrol hanesi hatalı; son hane 1 olmalı.')
    expect(gtinProblem('4006381333931')).toBeUndefined()
    expect(gtinProblem('MARKA000001')).toBeUndefined()
    expect(gtinProblem('12345')).toBeUndefined()
    expect(isGtin('MARKA000001')).toBe(false)
  })
})

describe('barcode prefixes', () => {
  it('accepts GS1 company prefixes and rejects restricted or malformed ones', () => {
    expect(gs1PrefixProblem('8691234')).toBeUndefined()
    expect(gs1PrefixProblem('869')).toMatch(/6–11 rakam/)
    expect(gs1PrefixProblem('2001234')).toMatch(/mağaza içi/)
    expect(barcodePrefixProblem('MARKA')).toBeUndefined()
    expect(barcodePrefixProblem('marka')).toMatch(/Latin büyük harf/)
  })
  it('prefers a valid GS1 prefix and skips invalid ones', () => {
    expect(barcodeScheme({ gs1Prefix: '8691234', barcodePrefix: 'MARKA' })).toEqual({
      kind: 'gs1',
      prefix: '8691234',
    })
    expect(barcodeScheme({ gs1Prefix: '86', barcodePrefix: 'MARKA' })).toEqual({
      kind: 'internal',
      prefix: 'MARKA',
    })
    expect(barcodeScheme({})).toBeUndefined()
  })
})

describe('barcode generation', () => {
  it('continues after the highest GS1 number and adds the check digit', () => {
    const codes = nextBarcodes({ kind: 'gs1', prefix: '8691234' }, ['8691234000045'], 2)
    expect(codes).toEqual(['8691234000052', '8691234000069'])
    expect(codes.every(isGtin)).toBe(true)
  })
  it('ignores codes under the prefix that are not real GTINs', () => {
    expect(nextBarcodes({ kind: 'gs1', prefix: '8691234' }, ['8691234999990'], 1)).toEqual([
      '8691234000014',
    ])
  })
  it('numbers internal codes after the highest one and skips taken codes', () => {
    expect(
      nextBarcodes({ kind: 'internal', prefix: 'MARKA' }, ['MARKA000007', 'BASKA000099'], 2),
    ).toEqual(['MARKA000008', 'MARKA000009'])
  })
  it('stops when the GS1 prefix has no item numbers left', () => {
    const last = '86912345678' + '9'
    expect(() =>
      nextBarcodes({ kind: 'gs1', prefix: '86912345678' }, [last + gtinCheckDigit(last)], 1),
    ).toThrow(/doldu/)
  })
})
