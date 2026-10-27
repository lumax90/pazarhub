import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify, { LogController } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { ZodError } from 'zod'
import type { ServerConfig } from './config'
import type { Database } from './db'
import { createDatabase } from './db'
import { migrate } from './schema'
import { registerAuth } from './auth'
import { registerWorkspaceRoutes } from './workspaces'
import { IntegrationService, registerIntegrationRoutes } from './integration-service'
import type { AdapterFactory } from './integrations/registry'
import { AppError, ProviderError } from './errors'
import { IntegrationWorker } from './worker'
import { registerMappingRoutes } from './mapping'
import { registerFileRoutes } from './files'
import { registerFulfillmentRoutes } from './fulfillment'
import { registerTeamRoutes } from './team'
import { registerPublishingRoutes } from './publishing/service'
import { registerMarketplaceRoutes } from './marketplace/service'
import { registerCatalogImportRoutes } from './catalog-import/service'
import { registerValueMappingRoutes } from './publishing/value-mappings'
import { registerExchangeRateRoutes } from './exchange-rates'
import { registerFulfillmentReconciliation } from './fulfillment-reconciliation'
import { registerOrderFulfillment } from './order-fulfillment/service'
import { registerOrderReconciliation } from './order-reconciliation'
import { registerListingContent } from './listing-content/service'
import { registerClaimDocuments } from './marketplace/claim-documents'

/**
 * Unknown paths get the app shell only when they look like an app page. A dot segment
 * (`/.env`, `/.git/HEAD`) or a file extension (`/wp-config.php`, `/backup.sql`) gets a
 * plain 404, so scanners probing for leaked files are not answered with 200.
 */
export function isAppPage(url: string) {
  const segments = url.split('?')[0].split('/').filter(Boolean)
  return (
    !segments.some((segment) => segment.startsWith('.')) &&
    !/\.[a-z\d]{1,8}$/i.test(segments.at(-1) ?? '')
  )
}

export async function createApp(
  config: ServerConfig,
  options: {
    database?: Database
    factory?: AdapterFactory
    fetcher?: typeof fetch
    worker?: boolean
    logger?: boolean
  } = {},
) {
  const database = options.database ?? (await createDatabase(config))
  await migrate(database)
  const app = Fastify({
    trustProxy:
      config.environment === 'production' ? (_address: string, hop: number) => hop < 1 : false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 30000,
    genReqId: () => randomUUID(),
    // Per-request lines come from the onResponse hook below, which keeps only the useful ones.
    logController: new LogController({ disableRequestLogging: true }),
    logger:
      options.logger === false
        ? false
        : {
            level: config.environment === 'production' ? 'info' : 'warn',
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.headers.x-csrf-token',
              'res.headers.set-cookie',
              'password',
              'credentials',
              '*.password',
              '*.apiKey',
              '*.apiSecret',
              '*.clientSecret',
              '*.refreshToken',
            ],
            serializers: {
              req: (request) => ({
                method: request.method,
                url: request.url?.split('?')[0],
                id: request.id,
              }),
            },
          },
  })
  await app.register(cookie)
  await app.register(helmet, {
    contentSecurityPolicy:
      config.environment === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
              fontSrc: ["'self'"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
    crossOriginEmbedderPolicy: false,
  })
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (request) =>
      ['GET', 'HEAD'].includes(request.method) && request.routeOptions.url === '/*',
  })
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store')
  })
  // Log API writes, API refusals, server errors and slow responses; page loads, assets,
  // revision polling and scanner noise stay out of the log.
  app.addHook('onResponse', async (request, reply) => {
    const api = request.url.startsWith('/api/'),
      status = reply.statusCode,
      write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method),
      ms = Math.round(reply.elapsedTime)
    if ((api && (write || status >= 400)) || status >= 500 || ms > 3000)
      request.log.info({ req: request, status, ms }, 'request completed')
  })
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Form alanlarını kontrol edin.',
          fields: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        requestId: request.id,
      })
    if (error instanceof AppError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message }, requestId: request.id })
    if (error instanceof ProviderError)
      return reply
        .code(error.code === 'AUTH_REJECTED' ? 409 : 502)
        .send({ error: { code: error.code, message: error.message }, requestId: request.id })
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500
    if (status === 429)
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMIT',
          message: 'Çok fazla istek gönderildi. Biraz sonra tekrar deneyin.',
        },
        requestId: request.id,
      })
    if (status === 413)
      return reply.code(413).send({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Gönderilen veri boyutu çok büyük.' },
        requestId: request.id,
      })
    request.log.error(
      {
        code: error && typeof error === 'object' && 'code' in error ? error.code : 'INTERNAL_ERROR',
        requestId: request.id,
      },
      'Request failed',
    )
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'İşlem tamamlanamadı. İstek numarasıyla tekrar kontrol edin.',
      },
      requestId: request.id,
    })
  })
  registerAuth(app, database, config)
  registerTeamRoutes(app, database)
  registerWorkspaceRoutes(app, database)
  const integrations = new IntegrationService(database, config, options.factory, options.fetcher)
  registerIntegrationRoutes(app, integrations)
  registerPublishingRoutes(app, integrations)
  registerValueMappingRoutes(app, integrations)
  registerExchangeRateRoutes(app, database, config.environment === 'test')
  registerFulfillmentReconciliation(app, integrations)
  registerOrderFulfillment(app, integrations)
  registerOrderReconciliation(app, integrations)
  registerListingContent(app, integrations)
  registerClaimDocuments(app, integrations)
  registerMarketplaceRoutes(app, integrations)
  registerCatalogImportRoutes(app, integrations)
  registerMappingRoutes(app, integrations)
  registerFulfillmentRoutes(app, integrations)
  await registerFileRoutes(app, database, config)
  const worker = new IntegrationWorker(integrations)
  if (options.worker ?? config.embeddedWorker) worker.start()
  // Public and unauthenticated: say only that the API is up, nothing that fingerprints it.
  app.get('/api/health', async () => ({ status: 'ok' }))
  app.get('/api/ready', async (_request, reply) => {
    await database.query('SELECT 1')
    const heartbeat = (
      await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM worker_heartbeats WHERE updated_at>now()-interval '90 seconds'`,
      )
    ).rows[0]
    const ready = Number(heartbeat.count) > 0
    return reply.code(ready ? 200 : 503).send({ ready, database: true, worker: ready })
  })
  if (config.serveFrontend && existsSync(resolve('dist/index.html'))) {
    await app.register(fastifyStatic, {
      root: resolve('dist'),
      prefix: '/',
      index: 'index.html',
      cacheControl: true,
      maxAge: 0,
      setHeaders: (response, path) => {
        if (path.includes('/assets/') || path.includes('\\assets\\'))
          response.header('cache-control', 'public, max-age=31536000, immutable')
      },
    })
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/media/') &&
        isAppPage(request.url)
      )
        return reply.header('cache-control', 'no-cache').sendFile('index.html')
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Kayıt veya işlem bulunamadı.' } })
    })
  }
  app.addHook('onClose', async () => {
    await worker.stop()
    if (!options.database) await database.close()
  })
  return { app, database, integrations, worker }
}
