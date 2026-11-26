import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import { enqueue } from '../server/jobs'
import { ProviderHttp } from '../server/integrations/http'
import { ProviderError } from '../server/errors'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import type { IntegrationErrorEntry } from '../src/domain/integrations'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 9),
  cookieName: 'pazarhub_test',
  secureCookies: false,
  sessionHours: 12,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Pazarhub',
}
const rejection = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let app: FastifyInstance, database: Database, worker: IntegrationWorker
beforeAll(async () => {
  database = await createDatabase(config, true)
  const built = await createApp(config, {
    database,
    worker: false,
    logger: false,
    // The provider echoes the password back, as some do in their error text.
    fetcher: async () =>
      rejection(400, { message: 'Kullanıcı adı veya parola hatalı: fixture-secret' }),
  })
  app = built.app
  worker = built.worker
}, 30000)
afterAll(async () => {
  await app.close()
  await database.close()
})

describe('error log', () => {
  it('keeps the rejected request and the provider answer, without the query or secrets', async () => {
    const http = new ProviderHttp(async () => rejection(422, { errors: ['barcode boş'] }))
    const error = await http
      .request('https://api.example.com/v1/products?apiKey=k', { method: 'POST', json: {} })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).detail).toEqual({
      request: 'POST https://api.example.com/v1/products',
      status: 422,
      response: '{"errors":["barcode boş"]}',
    })
  })

  it('logs every failed job attempt with the exchange, managers only', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: config.publicOrigin },
      payload: {
        name: 'Owner',
        workspaceName: 'Errors',
        email: `${randomUUID()}@example.com`,
        password: 'Errors1234',
      },
    })
    expect(registered.statusCode).toBe(201)
    const cookie = registered.headers['set-cookie']!.toString().split(';')[0]
    const session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
    const headers = {
      cookie,
      origin: config.publicOrigin,
      'x-csrf-token': session.csrfToken,
      'idempotency-key': randomUUID(),
    }
    const connected = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers,
      payload: {
        provider: 'toptantr',
        name: 'ToptanTR',
        enabled: false,
        settings: defaultIntegrationSettings,
        credentials: { username: 'fixture-user', password: 'fixture-secret' },
      },
    })
    expect(connected.statusCode, connected.body).toBe(201)
    await enqueue(database, {
      workspaceId: session.workspace.id,
      connectionId: connected.json().id,
      kind: 'test',
    })
    while (await worker.processOne());
    const listed = await app.inject({ url: '/api/integration-errors', headers: { cookie } })
    expect(listed.statusCode, listed.body).toBe(200)
    const [entry] = listed.json().errors as IntegrationErrorEntry[]
    expect(entry).toMatchObject({
      provider: 'toptantr',
      connectionName: 'ToptanTR',
      kind: 'test',
      attempt: 1,
      status: 400,
    })
    expect(entry.request).toMatch(/^POST https:\/\//)
    expect(entry.response).toContain('Kullanıcı adı veya parola hatalı: [gizli]')
    expect(JSON.stringify(listed.json())).not.toContain('fixture-secret')
  })
})
