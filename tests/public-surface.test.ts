import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { createApp, isAppPage } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'

describe('app page detection', () => {
  it('serves the app shell for app routes only', () => {
    for (const path of [
      '/',
      '/dashboard',
      '/orders/order-12',
      '/products/2f1c9a3e-1b2c-4d5e-8f90-123456789abc?tab=prices',
      '/orders/print?ids=a,b',
      '/settings/notifications',
    ])
      expect(isAppPage(path), path).toBe(true)
    for (const path of [
      '/.env',
      '/.git/HEAD',
      '/.ssh/id_rsa',
      '/api/../.env',
      '/wp-config.php',
      '/backup.sql',
      '/docker-compose.yml',
      '/storage/logs/laravel.log',
    ])
      expect(isAppPage(path), path).toBe(false)
  })
})

// The production build is needed to serve the shell; `npm run build` produces it.
describe.skipIf(!existsSync('dist/index.html'))('public surface in production', () => {
  const config: ServerConfig = {
    environment: 'production',
    port: 3001,
    host: '127.0.0.1',
    publicOrigin: 'https://panel.example.com',
    dataDirectory: '.data/test',
    encryptionKey: Buffer.alloc(32, 9),
    cookieName: '__Host-pazarhub',
    secureCookies: true,
    sessionHours: 12,
    registrationEnabled: false,
    embeddedWorker: false,
    serveFrontend: true,
    integrationName: 'Pazarhub',
  }
  let app: FastifyInstance, database: Database
  beforeAll(async () => {
    // The embedded database refuses production on purpose; only the app runs as production here.
    database = await createDatabase({ ...config, environment: 'test' }, true)
    app = (await createApp(config, { database, worker: false, logger: false })).app
  }, 30000)
  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  it('answers probes for secret files with 404, never with a file', async () => {
    for (const url of ['/.env', '/.git/HEAD', '/wp-config.php', '/backup.sql', '/server.key']) {
      const response = await app.inject({ url })
      expect(response.statusCode, url).toBe(404)
      expect(response.body, url).not.toContain('<html')
    }
    const page = await app.inject({ url: '/orders/order-1' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
  })

  it('sends hardening headers and keeps the health check anonymous', async () => {
    const response = await app.inject({ url: '/api/health' })
    expect(response.json()).toEqual({ status: 'ok' })
    expect(response.headers['cache-control']).toBe('no-store')
    const page = await app.inject({ url: '/' })
    expect(page.headers['content-security-policy']).toContain("default-src 'self'")
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(page.headers['strict-transport-security']).toBeTruthy()
    expect(page.headers['x-content-type-options']).toBe('nosniff')
    expect(page.headers['x-powered-by']).toBeUndefined()
  })

  it('keeps registration closed when the deployment turns it off', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: config.publicOrigin },
      payload: {
        name: 'Bot',
        workspaceName: 'Bot',
        email: 'bot@example.com',
        password: 'Auth1234',
      },
    })
    expect(response.statusCode).toBe(403)
  })
})
