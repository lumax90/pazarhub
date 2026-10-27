import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../server/config'

const production = {
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: 'https://panel.example.com',
  DATABASE_URL: 'postgresql://pazarhub:secret@database:5432/pazarhub',
  ENCRYPTION_KEY: 'a'.repeat(64),
}
const saved = { ...process.env }
const use = (env: Record<string, string>) => {
  for (const key of Object.keys(production)) delete process.env[key]
  Object.assign(process.env, env)
}
afterEach(() => {
  process.env = { ...saved }
})

describe('production configuration', () => {
  it('accepts a complete deployment', () => {
    use(production)
    expect(loadConfig().publicOrigin).toBe('https://panel.example.com')
  })
  it('names a placeholder left in PUBLIC_ORIGIN instead of a bare URL error', () => {
    use({ ...production, PUBLIC_ORIGIN: 'Set PUBLIC_ORIGIN to your HTTPS domain' })
    expect(() => loadConfig()).toThrow(
      'PUBLIC_ORIGIN is not a URL: "Set PUBLIC_ORIGIN to your HTTPS domain"',
    )
  })
  it('rejects an encryption key that is not 64 hexadecimal characters, naming only its length', () => {
    use({ ...production, ENCRYPTION_KEY: 'ab'.repeat(64) })
    expect(() => loadConfig()).toThrow(
      'ENCRYPTION_KEY must contain 64 hexadecimal characters (got 128).',
    )
    expect(() => loadConfig()).not.toThrow(/abab/)
  })
})
