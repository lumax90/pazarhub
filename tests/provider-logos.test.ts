import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { providers } from '../src/domain/integrations'
import { providerLogos } from '../src/lib/provider-logos'

const sources: {
  logos: {
    id: keyof typeof providerLogos
    file: string
    width: number
    height: number
    sourceUrl: string
    sourcePage: string
    sha256: string
  }[]
} = JSON.parse(readFileSync(new URL('../docs/provider-logo-sources.json', import.meta.url), 'utf8'))

test('every marketplace and carrier has exactly one local, documented brand asset', () => {
  const expected = providers
    .filter((provider) => provider.kind !== 'invoice')
    .map((provider) => provider.id)
    .sort()
  expect(Object.keys(providerLogos).sort()).toEqual(expected)
  expect(sources.logos.map((logo) => logo.id).sort()).toEqual(expected)
  expect(readdirSync(new URL('../public/brands/', import.meta.url)).sort()).toEqual(
    sources.logos.map((logo) => logo.file).sort(),
  )
})

test.each(sources.logos)('$id asset retains its verified bytes and decoded dimensions', (logo) => {
  expect(providerLogos[logo.id]).toBe(`/brands/${logo.file}`)
  expect(logo.file).toMatch(/^[a-z0-9]+\.png$/)
  expect(logo.sourceUrl).toMatch(/^https:\/\//)
  expect(logo.sourcePage).toMatch(/^https:\/\//)
  const bytes = readFileSync(new URL(`../public/brands/${logo.file}`, import.meta.url))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(logo.sha256)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.readUInt32BE(16)).toBe(logo.width)
  expect(bytes.readUInt32BE(20)).toBe(logo.height)
})
