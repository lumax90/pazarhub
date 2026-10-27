import { describe, expect, it } from 'vitest'
import bwipjs from 'bwip-js/browser'
import { barcodeWidths } from '../src/lib/linear-barcode'
import type { Symbology } from '../src/lib/linear-barcode'
import { productSymbology } from '../src/domain/barcodes'

const samples: [string, Symbology][] = [
  ['73300123', 'code128'],
  ['7330012345678901', 'code128'],
  ['7330098765432109', 'code128'],
  ['HB1234567890', 'code128'],
  ['ABC-123456-XY', 'code128'],
  ['12345678', 'code128'],
  ['1234567', 'code128'],
  ['X1Y', 'code128'],
  ['TR.2026/10-27_00042', 'code128'],
  ['abcdefghijklmnopqrstuvwxyz', 'code128'],
  ['4006381333931', 'ean13'],
  ['8691234000014', 'ean13'],
  ['96385074', 'ean8'],
  ['036000291452', 'upca'],
]

describe('linear barcodes via bwip-js', () => {
  it('reads back exactly the bars bwip-js encodes', () => {
    for (const [code, symbology] of samples) {
      const [symbol] = bwipjs.raw(symbology, code, {})
      expect('sbs' in symbol && symbol.sbs, `${symbology} ${code}`).toEqual(
        barcodeWidths(code, symbology),
      )
    }
  })
  it('matches the standard Code 128 table for a digit-only tracking code', () => {
    // Start C, 73, 30, 01, 23, check 24 ((105 + 73 + 2·30 + 3·1 + 4·23) mod 103), stop.
    expect(barcodeWidths('73300123').join('')).toBe(
      ['211232', '142112', '212123', '222122', '312131', '311222', '2331112'].join(''),
    )
  })
  it('returns whole Code 128 symbols: 11 modules each and a 13-module stop', () => {
    for (const [code, symbology] of samples.filter(([, kind]) => kind === 'code128')) {
      const widths = barcodeWidths(code, symbology)
      const modules = widths.reduce((sum, width) => sum + width, 0)
      expect((widths.length - 7) % 6, code).toBe(0)
      expect(modules, code).toBe(((widths.length - 7) / 6) * 11 + 13)
      expect(widths.slice(-7).join(''), code).toBe('2331112')
    }
  })
  it('draws an EAN-13 as 95 modules between its guards', () => {
    const widths = barcodeWidths('4006381333931', 'ean13')
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(95)
    expect(widths.slice(0, 3)).toEqual([1, 1, 1])
    expect(widths.slice(-3)).toEqual([1, 1, 1])
  })
  it('prints a real GTIN in its own symbology and anything else as Code 128', () => {
    expect(productSymbology('4006381333931')).toBe('ean13')
    expect(productSymbology('96385074')).toBe('ean8')
    expect(productSymbology('036000291452')).toBe('upca')
    expect(productSymbology('4006381333932')).toBe('code128')
    expect(productSymbology('MARKA000001')).toBe('code128')
  })
})
