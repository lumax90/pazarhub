import { describe, expect, it } from 'vitest'
import {
  code128Checksum,
  code128Encodable,
  code128Patterns,
  code128Values,
  code128Widths,
} from '../src/lib/code128'

describe('Code 128 table', () => {
  it('has 107 distinct, well-formed symbols', () => {
    expect(code128Patterns).toHaveLength(107)
    expect(new Set(code128Patterns).size).toBe(107)
    code128Patterns.forEach((pattern, value) => {
      const widths = [...pattern].map(Number)
      const bars = widths.filter((_, index) => index % 2 === 0)
      // Every symbol is 11 modules (stop 13) and its bars cover an even number of modules.
      expect(widths.reduce((a, b) => a + b, 0)).toBe(value === 106 ? 13 : 11)
      expect(bars.reduce((a, b) => a + b, 0) % 2).toBe(0)
      expect(widths.every((width) => width >= 1 && width <= 4)).toBe(true)
    })
  })
  it('computes the check symbol of the standard worked example', () => {
    // "PJJ123C" in code set A: start 103, weighted sum 878, check value 54.
    const data = [...'PJJ123C'].map((char) => char.charCodeAt(0) - 32)
    expect(code128Checksum([103, ...data])).toBe(54)
  })
})

describe('Code 128 encoding', () => {
  it('packs an even run of digits into code set C', () => {
    expect(code128Values('73300123')).toEqual([105, 73, 30, 1, 23])
  })
  it('keeps the first digit of an odd run in code set B', () => {
    expect(code128Values('1234567')).toEqual([104, 17, 99, 23, 45, 67])
  })
  it('uses code set B for short or mixed codes and switches for long digit runs', () => {
    expect(code128Values('AB12')).toEqual([104, 33, 34, 17, 18])
    expect(code128Values('HB123456')).toEqual([104, 40, 34, 99, 12, 34, 56])
    expect(code128Values('X123456Y')).toEqual([104, 56, 99, 12, 34, 56, 100, 57])
  })
  it('ends with the check symbol and the stop pattern', () => {
    const widths = code128Widths('73300123')
    const symbols = 5 + 1
    expect(widths).toHaveLength(symbols * 6 + 7)
    expect(widths.slice(-7).join('')).toBe('2331112')
    expect(widths.reduce((a, b) => a + b, 0)).toBe(symbols * 11 + 13)
  })
  it('rejects characters a scanner cannot read back', () => {
    expect(code128Encodable('ŞİŞLİ')).toBe(false)
    expect(code128Encodable('')).toBe(false)
    expect(() => code128Values('Ç12')).toThrow()
  })
})
