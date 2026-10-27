import { describe, expect, it } from 'vitest'
import bwipjs from 'bwip-js/browser'
import { code128Widths } from '../src/lib/code128'

const samples = [
  '73300123',
  '7330012345678901',
  '7330098765432109',
  'HB1234567890',
  'ABC-123456-XY',
  '12345678',
  '1234567',
  'X1Y',
  'TR.2026/10-27_00042',
  'abcdefghijklmnopqrstuvwxyz',
]

describe('Code 128 via bwip-js', () => {
  it('reads back exactly the bars bwip-js encodes', () => {
    for (const code of samples) {
      const [symbol] = bwipjs.raw('code128', code, {})
      expect('sbs' in symbol && symbol.sbs, code).toEqual(code128Widths(code))
    }
  })
  it('matches the standard symbol table for a digit-only tracking code', () => {
    // Start C, 73, 30, 01, 23, check 24 ((105 + 73 + 2·30 + 3·1 + 4·23) mod 103), stop.
    expect(code128Widths('73300123').join('')).toBe(
      ['211232', '142112', '212123', '222122', '312131', '311222', '2331112'].join(''),
    )
  })
  it('returns whole symbols: 11 modules each and a 13-module stop', () => {
    for (const code of samples) {
      const widths = code128Widths(code)
      const modules = widths.reduce((sum, width) => sum + width, 0)
      expect((widths.length - 7) % 6, code).toBe(0)
      expect(modules, code).toBe(((widths.length - 7) / 6) * 11 + 13)
      expect(widths.slice(-7).join(''), code).toBe('2331112')
    }
  })
})
