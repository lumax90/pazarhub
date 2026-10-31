import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { ServerConfig } from '../server/config'
import { publishingFixture } from '../tests/publishing-fixture'
import { marketplaceFixture } from '../tests/marketplace-fixture'
import { productWorkspaceOwner } from '../tests/product-workspace-fixture'
import { orderWorkspaceOwner } from '../tests/order-workspace-fixture'
import { catalogWorkspaceOwner } from '../tests/catalog-workspace-fixture'
import { pricingWorkspaceOwner } from '../tests/pricing-workspace-fixture'
import { pttavmFixture } from '../tests/pttavm-fixture'
import { fulfillmentFixture } from '../tests/fulfillment-fixture'
import { orderFulfillmentFixture } from '../tests/order-fulfillment-fixture'
import { orderCoreOwner, orderCoreRates } from '../tests/order-core-fixture'
import { invoiceWorkspaceOwner } from '../tests/invoice-workspace-fixture'
import { invoiceToolsOwner } from '../tests/invoice-tools-fixture'
import { manualInvoiceOwner } from '../tests/manual-invoice-fixture'
import { invoiceAutomationOwner } from '../tests/invoice-automation-fixture'
import { nativeThemeOwners } from '../tests/native-theme-fixture'
import {
  groupedPublicationOwner,
  fulfillmentOwner,
  reconciliationOwner,
  marketplaceOwner,
} from '../tests/integration-workspace-fixtures'

const config: ServerConfig = {
  environment: 'test',
  port: 4174,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:4174',
  dataDirectory: '.data/e2e',
  encryptionKey: randomBytes(32),
  cookieName: 'pazarhub_e2e',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: true,
  integrationName: 'Pazarhub E2E',
  hepsiburadaIntegrator: 'fixture',
}
const database = await createDatabase(config, true)
const fixture = publishingFixture()
fixture.state.approved = true
const marketplace = marketplaceFixture(fixture.fetcher)
const pttavm = pttavmFixture()
const fulfillment = fulfillmentFixture()
const invoiceAutomationFixtures = new Map([
  ['987651', fulfillmentFixture()],
  ['987652', fulfillmentFixture()],
])
fulfillment.state.drop = 'invoice'
const orderFulfillment = orderFulfillmentFixture()
const { app } = await createApp(config, {
  database,
  worker: true,
  logger: false,
  fetcher: (url, init) =>
    new URL(String(url)).hostname.endsWith('.hepsiburada.com')
      ? orderFulfillment.fetcher(url, init)
      : String(url).startsWith('https://api.parasut.com/')
        ? (
            invoiceAutomationFixtures.get(new URL(String(url)).pathname.split('/')[2]) ??
            fulfillment
          ).fetcher(url, init)
        : String(url).startsWith('https://integration-api.pttavm.com/')
          ? pttavm.fetcher(url, init)
          : marketplace.fetcher(url, init),
})
const seededCookies: Record<
  string,
  {
    name: string
    value: string
    domain: string
    path: string
    httpOnly: boolean
    secure: boolean
    sameSite: 'Lax'
  }[]
> = {}
for (const [index, account] of [
  productWorkspaceOwner,
  orderWorkspaceOwner,
  catalogWorkspaceOwner,
  pricingWorkspaceOwner,
  orderCoreOwner,
  invoiceWorkspaceOwner,
  invoiceToolsOwner,
  manualInvoiceOwner,
  invoiceAutomationOwner,
  groupedPublicationOwner,
  fulfillmentOwner,
  reconciliationOwner,
  marketplaceOwner,
  nativeThemeOwners.light,
  nativeThemeOwners.dark,
].entries()) {
  const seeded = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.1.${20 + index}`,
    headers: { origin: config.publicOrigin },
    payload: account,
  })
  if (seeded.statusCode !== 201) throw new Error(`Workspace fixture: ${seeded.statusCode}`)
  const cookie = seeded.headers['set-cookie']!.toString().split(';')[0]
  seededCookies[account.email] = [
    {
      name: config.cookieName,
      value: cookie.slice(cookie.indexOf('=') + 1),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]
  if (account === orderCoreOwner) {
    const cookie = seeded.headers['set-cookie']!.toString().split(';')[0],
      session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
    await database.query(
      "UPDATE workspace_states SET document=jsonb_set(document,'{exchangeRates}',$1::jsonb) WHERE workspace_id=$2",
      [JSON.stringify(orderCoreRates), session.workspace.id],
    )
  }
}
await mkdir('.data', { recursive: true })
await writeFile('.data/e2e-sessions.json', JSON.stringify(seededCookies))
await app.listen({ port: config.port, host: config.host })
const stop = async () => {
  await app.close()
  await database.close()
  process.exit(0)
}
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
