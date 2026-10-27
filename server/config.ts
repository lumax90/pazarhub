import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ServerConfig {
  environment: 'development' | 'test' | 'production'
  port: number
  host: string
  publicOrigin: string
  databaseUrl?: string
  dataDirectory: string
  encryptionKey: Buffer
  cookieName: string
  secureCookies: boolean
  sessionHours: number
  registrationEnabled: boolean
  embeddedWorker: boolean
  serveFrontend: boolean
  integrationName: string
  smtp?: {
    host: string
    port: number
    secure: boolean
    username?: string
    password?: string
    from: string
  }
}

export function loadConfig(): ServerConfig {
  const environment =
    process.env.NODE_ENV === 'production'
      ? 'production'
      : process.env.NODE_ENV === 'test'
        ? 'test'
        : 'development'
  const origin = process.env.PUBLIC_ORIGIN?.trim() || 'http://localhost:5173'
  let publicOrigin: string
  try {
    publicOrigin = new URL(origin).origin
  } catch {
    throw new Error(
      `PUBLIC_ORIGIN is not a URL: "${origin}". Set it to the address people open, e.g. https://panel.example.com`,
    )
  }
  const dataDirectory = resolve(process.env.DATA_DIR ?? '.data')
  let key: Buffer
  if (process.env.ENCRYPTION_KEY) {
    if (!/^[a-f\d]{64}$/i.test(process.env.ENCRYPTION_KEY))
      // The length helps tell a wrong generator from a typo; the key itself is never logged.
      throw new Error(
        `ENCRYPTION_KEY must contain 64 hexadecimal characters (got ${process.env.ENCRYPTION_KEY.length}).`,
      )
    key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  } else {
    if (environment === 'production') throw new Error('ENCRYPTION_KEY is required in production.')
    mkdirSync(dataDirectory, { recursive: true })
    const path = resolve(dataDirectory, 'development.key')
    if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' })
    key = readFileSync(path)
    if (key.length !== 32) throw new Error('Invalid development encryption key.')
  }
  if (environment === 'production') {
    if (!process.env.DATABASE_URL)
      throw new Error('A PostgreSQL DATABASE_URL is required in production.')
    if (!publicOrigin.startsWith('https://'))
      throw new Error('Production PUBLIC_ORIGIN must use HTTPS.')
  }
  const port = Number(process.env.API_PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT.')
  return {
    environment,
    port,
    host: process.env.API_HOST ?? (environment === 'production' ? '0.0.0.0' : '127.0.0.1'),
    publicOrigin,
    dataDirectory,
    encryptionKey: key,
    databaseUrl: process.env.DATABASE_URL,
    cookieName: environment === 'production' ? '__Host-pazarhub' : 'pazarhub_session',
    secureCookies: environment === 'production',
    sessionHours: 12,
    registrationEnabled: process.env.REGISTRATION_ENABLED !== 'false',
    embeddedWorker: process.env.EMBEDDED_WORKER !== 'false' && environment !== 'production',
    serveFrontend: environment === 'production' || process.env.SERVE_FRONTEND === 'true',
    integrationName: process.env.INTEGRATION_NAME ?? 'Pazarhub',
    smtp:
      process.env.SMTP_HOST && process.env.MAIL_FROM
        ? {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: process.env.SMTP_SECURE === 'true',
            username: process.env.SMTP_USER,
            password: process.env.SMTP_PASSWORD,
            from: process.env.MAIL_FROM,
          }
        : undefined,
  }
}
