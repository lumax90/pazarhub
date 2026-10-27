import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../server/app'
import { createDatabase } from '../server/db'
import type { Database } from '../server/db'
import type { ServerConfig } from '../server/config'
import type { IntegrationWorker } from '../server/worker'
import { claimJob, enqueue } from '../server/jobs'
import type { AppState } from '../src/domain/types'
import type {
  FinancialRecord,
  MarketplaceClaim,
  MarketplaceQuestion,
  MarketplaceRecord,
} from '../src/domain/marketplace'
import { decimalTicks, financialBreakdown, sumTicks, ticksToCents } from '../src/domain/marketplace'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { normalizeFinancial } from '../server/marketplace/trendyol'
import { marketplaceFixture } from './marketplace-fixture'

const config: ServerConfig = {
  environment: 'test',
  port: 3001,
  host: '127.0.0.1',
  publicOrigin: 'http://localhost:5173',
  dataDirectory: '.data/test',
  encryptionKey: Buffer.alloc(32, 5),
  cookieName: 'marketplace_test',
  secureCookies: false,
  sessionHours: 1,
  registrationEnabled: true,
  embeddedWorker: false,
  serveFrontend: false,
  integrationName: 'Pazarhub',
}
const fixture = marketplaceFixture()
let app: FastifyInstance,
  db: Database,
  worker: IntegrationWorker,
  sequence = 10
beforeAll(async () => {
  db = await createDatabase(config, true)
  const built = await createApp(config, {
    database: db,
    worker: false,
    logger: false,
    fetcher: fixture.fetcher,
  })
  app = built.app
  worker = built.worker
}, 30000)
afterEach(async () => {
  await db.query(
    `UPDATE integration_jobs SET status='cancelled',worker_id=NULL,lease_until=NULL WHERE status IN ('queued','waiting','running')`,
  )
})
afterAll(async () => {
  await app.close()
  await db.close()
})
async function setup() {
  const seller = String(++sequence)
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    remoteAddress: `127.0.2.${sequence}`,
    headers: { origin: config.publicOrigin },
    payload: {
      name: 'Marketplace Owner',
      workspaceName: 'Pazaryeri Testi',
      email: `${randomUUID()}@example.com`,
      password: 'marketplace-test-password',
    },
  })
  expect(registered.statusCode, registered.body).toBe(201)
  const cookie = registered.headers['set-cookie']!.toString().split(';')[0],
    session = (await app.inject({ url: '/api/session', headers: { cookie } })).json()
  const headers = {
    cookie,
    origin: config.publicOrigin,
    'x-csrf-token': session.csrfToken as string,
    'x-workspace-id': session.workspace.id as string,
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/integrations',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      provider: 'trendyol',
      name: 'Test mağazası',
      enabled: false,
      settings: defaultIntegrationSettings,
      credentials: {
        sellerId: seller,
        apiKey: 'fixture-marketplace-key',
        apiSecret: 'fixture-marketplace-secret',
      },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const storeId = response.json().id as string
  await db.query(`UPDATE integration_connections SET status='verified',enabled=true WHERE id=$1`, [
    storeId,
  ])
  return {
    seller,
    headers,
    storeId,
    workspaceId: session.workspace.id as string,
    userId: session.user.id as string,
    remote: fixture.account(seller),
  }
}
type Setup = Awaited<ReturnType<typeof setup>>
const write = (
  test: Setup,
  url: string,
  payload: Record<string, unknown> = {},
  key = randomUUID(),
) =>
  app.inject({ method: 'POST', url, headers: { ...test.headers, 'idempotency-key': key }, payload })
const read = <T>(test: Setup, url: string) =>
  app.inject({ url, headers: test.headers }).then((r) => {
    expect(r.statusCode, r.body).toBe(200)
    return r.json<T>()
  })
const detail = <T>(test: Setup, id: string) =>
  read<MarketplaceRecord<T>>(test, `/api/marketplace/records/${id}`)
async function nextJob() {
  await db.query(
    `UPDATE integration_jobs SET available_at=now() WHERE status IN ('queued','waiting')`,
  )
  await db.query('UPDATE integration_rate_limits SET next_request_at=now()')
  expect(await worker.processOne()).toBe(true)
}
async function pull(test: Setup, resource: 'question' | 'claim') {
  const operation = resource === 'question' ? 'questions.pull' : 'claims.pull'
  expect(
    (await write(test, '/api/marketplace/sync', { connectionId: test.storeId, operation }))
      .statusCode,
  ).toBe(202)
  await nextJob()
  const response = await read<{
    records: MarketplaceRecord<MarketplaceQuestion | MarketplaceClaim>[]
    hasMore: boolean
  }>(test, `/api/marketplace/records?resource=${resource}`)
  expect(response.records).toHaveLength(1)
  return response.records[0].id
}
async function payout(test: Setup) {
  await enqueue(db, {
    workspaceId: test.workspaceId,
    connectionId: test.storeId,
    kind: 'settlements.pull',
    payload: { source: 2, from: Date.now() - 7 * 86400000, to: Date.now() },
  })
  await nextJob()
  const response = await read<{ records: MarketplaceRecord<FinancialRecord>[] }>(
    test,
    '/api/marketplace/records?resource=settlement&kind=payout',
  )
  expect(response.records).toHaveLength(1)
  return response.records[0].id
}

describe('marketplace decisions and settlement reconciliation', () => {
  it('keeps rejection evidence private, validates ownership and reconciles a lost rejection write', async () => {
    const test = await setup(),
      id = await pull(test, 'claim'),
      boundary = 'claim-evidence-boundary'
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/marketplace/claims/${id}/files`,
      headers: { ...test.headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n%%EOF\r\n--${boundary}--\r\n`,
    })
    expect(uploaded.statusCode, uploaded.body).toBe(201)
    const fileId = uploaded.json().file.id,
      stored = (
        await db.query<{ public_token: string; name: string }>(
          'SELECT public_token,name FROM stored_files WHERE id=$1',
          [fileId],
        )
      ).rows[0]
    expect(
      (await app.inject({ url: `/media/${stored.public_token}/${stored.name}` })).statusCode,
    ).toBe(404)
    const other = await setup()
    expect(
      (await app.inject({ url: `/api/files/${fileId}`, headers: other.headers })).statusCode,
    ).toBe(404)
    await expect(
      db.query('INSERT INTO claim_documents(workspace_id,record_id,file_id) VALUES($1,$2,$3)', [
        other.workspaceId,
        id,
        fileId,
      ]),
    ).rejects.toThrow()
    const missing = await write(test, `/api/marketplace/claims/${id}/decision`, {
      itemIds: ['claim-line-1'],
      decision: 'reject',
      reasonId: '99999',
      description: 'Kanıt eklendi.',
      fileIds: [fileId],
    })
    expect(missing.statusCode).toBe(422)
    expect(test.remote.claimIssues).toHaveLength(0)
    test.remote.claimUncertain = true
    const accepted = await write(test, `/api/marketplace/claims/${id}/decision`, {
      itemIds: ['claim-line-1'],
      decision: 'reject',
      reasonId: '51',
      description: 'Kullanım izi görüldü.',
      fileIds: [fileId],
    })
    expect(accepted.statusCode, accepted.body).toBe(202)
    await nextJob()
    expect((await detail<MarketplaceClaim>(test, id)).workflow?.state).toBe('uncertain')
    await write(test, `/api/marketplace/records/${id}/refresh`)
    await nextJob()
    const result = await detail<MarketplaceClaim>(test, id)
    expect(result.workflow).toMatchObject({ decision: 'reject', state: 'confirmed' })
    expect(result.document.items[1].status).toBe('WaitingInAction')
    expect(test.remote.claimIssues).toMatchObject([
      { ids: ['claim-line-1'], reason: '51', description: 'Kullanım izi görüldü.' },
    ])
    expect(test.remote.claimIssues[0].files).toHaveLength(1)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/marketplace/claims/${id}/files/${fileId}`,
          headers: test.headers,
        })
      ).statusCode,
    ).toBe(409)
  }, 30000)
  it('keeps four-place money exact through signed net effects and only rounds the total', () => {
    expect(ticksToCents(sumTicks([decimalTicks('0.0064'), decimalTicks('0.0064')]))).toBe(1)
    expect(() => decimalTicks('1.00001')).toThrow()
    const returned = normalizeFinancial(
      {
        id: 1,
        transactionType: 'İade',
        debt: 10,
        credit: 0,
        sellerRevenue: 8.5555,
        commissionAmount: 1.4445,
      },
      'settlements',
    )
    expect(returned.effectTicks).toBe('-85555')
    const unknown = normalizeFinancial(
      { id: 2, transactionType: 'Satış', credit: 10, sellerRevenue: 8 },
      'settlements',
    )
    expect(financialBreakdown([unknown]).netTicks).toBeNull()
  })
  it('submits one answer for concurrent idempotent requests and verifies its published text', async () => {
    const test = await setup(),
      id = await pull(test, 'question'),
      key = randomUUID(),
      text = 'Evet, düşük sıcaklıkta bulaşık makinesinde yıkanabilir.'
    expect((await detail<MarketplaceQuestion>(test, id)).document.customerName).toBe('')
    const results = await Promise.all([
      write(test, `/api/marketplace/questions/${id}/answer`, { text }, key),
      write(test, `/api/marketplace/questions/${id}/answer`, { text }, key),
    ])
    expect(results.map((r) => r.statusCode)).toEqual([202, 202])
    expect(results[0].json().jobId).toBe(results[1].json().jobId)
    expect(
      (await write(test, `/api/marketplace/questions/${id}/answer`, { text })).statusCode,
    ).toBe(409)
    await nextJob()
    expect((await detail(test, id)).workflow?.state).toBe('pending')
    await nextJob()
    expect((await detail(test, id)).workflow?.state).toBe('confirmed')
    expect(test.remote.answerWrites).toEqual([text])
  })
  it('rechecks question content before posting and rejects an obsolete draft', async () => {
    const test = await setup(),
      id = await pull(test, 'question')
    await write(test, `/api/marketplace/questions/${id}/answer`, {
      text: 'Ürün bulaşık makinesinde yıkanabilir.',
    })
    test.remote.question.text = 'Ürün fırında kullanılabilir mi?'
    await nextJob()
    expect(test.remote.answerWrites).toHaveLength(0)
    expect((await detail(test, id)).workflow?.state).toBe('failed')
  })
  it('reconciles a lost answer response without a second POST', async () => {
    const test = await setup(),
      id = await pull(test, 'question'),
      text = 'Evet, makinede güvenle yıkanabilir.'
    test.remote.answerUncertain = true
    const submitted = await write(test, `/api/marketplace/questions/${id}/answer`, { text })
    await nextJob()
    expect((await detail(test, id)).workflow?.state).toBe('uncertain')
    expect((await write(test, `/api/jobs/${submitted.json().jobId}/retry`)).statusCode).toBe(409)
    expect(
      (await write(test, `/api/marketplace/questions/${id}/answer`, { text })).statusCode,
    ).toBe(409)
    await write(test, `/api/marketplace/records/${id}/refresh`)
    await nextJob()
    expect((await detail(test, id)).workflow?.state).toBe('confirmed')
    expect(test.remote.answerWrites).toHaveLength(1)
    expect(
      (
        await db.query<{ status: string }>('SELECT status FROM integration_jobs WHERE id=$1', [
          submitted.json().jobId,
        ])
      ).rows[0].status,
    ).toBe('completed')
  })
  it('requires finance permission and tenant ownership for claim decisions', async () => {
    const a = await setup(),
      id = await pull(a, 'claim'),
      b = await setup()
    expect(
      (await write(b, `/api/marketplace/claims/${id}/approve`, { itemIds: ['claim-line-1'] }))
        .statusCode,
    ).toBe(404)
    await db.query(`UPDATE memberships SET role='operator' WHERE workspace_id=$1 AND user_id=$2`, [
      a.workspaceId,
      a.userId,
    ])
    expect(
      (await write(a, `/api/marketplace/claims/${id}/approve`, { itemIds: ['claim-line-1'] }))
        .statusCode,
    ).toBe(403)
    expect(a.remote.claimWrites).toHaveLength(0)
  })
  it('approves only selected remote units and leaves stock and cash ledgers untouched', async () => {
    const test = await setup(),
      id = await pull(test, 'claim'),
      before = await read<{ state: AppState }>(test, '/api/workspace')
    expect(
      (
        await write(test, `/api/marketplace/claims/${id}/approve`, {
          itemIds: ['another-claim-line'],
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (await write(test, `/api/marketplace/claims/${id}/approve`, { itemIds: ['claim-line-1'] }))
        .statusCode,
    ).toBe(202)
    await nextJob()
    await nextJob()
    const claim = (await detail<MarketplaceClaim>(test, id)).document
    expect(claim.items.map((i) => i.status)).toEqual(['Accepted', 'WaitingInAction'])
    const after = await read<{ state: AppState }>(test, '/api/workspace')
    expect(after.state.products).toEqual(before.state.products)
    expect(after.state.cash).toEqual(before.state.cash)
    expect(after.state.returns).toEqual(before.state.returns)
    expect(test.remote.claimWrites).toEqual([['claim-line-1']])
  })
  it('marks an expired claim-write lease uncertain and blocks duplicate approval', async () => {
    const test = await setup(),
      id = await pull(test, 'claim'),
      queued = await write(test, `/api/marketplace/claims/${id}/approve`, {
        itemIds: ['claim-line-1'],
      })
    const claimed = await claimJob(db, 'expired-marketplace-worker')
    expect(claimed?.id).toBe(queued.json().jobId)
    await db.query(
      `UPDATE integration_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1`,
      [claimed!.id],
    )
    await claimJob(db, 'replacement-worker')
    expect((await detail(test, id)).workflow?.state).toBe('uncertain')
    expect(
      (await write(test, `/api/marketplace/claims/${id}/approve`, { itemIds: ['claim-line-1'] }))
        .statusCode,
    ).toBe(409)
  })
  it('loads every payout detail page, excludes stale scans and compares net revenue without double-subtracting commission', async () => {
    const test = await setup(),
      id = await payout(test)
    await db.query(
      `INSERT INTO external_records(id,workspace_id,connection_id,resource,external_id,document) VALUES($1,$2,$3,'settlement','stale-row',$4)`,
      [
        randomUUID(),
        test.workspaceId,
        test.storeId,
        JSON.stringify({
          kind: 'entry',
          source: 'settlements',
          externalId: 'stale-row',
          paymentOrderId: '112360',
          transactionType: 'Sale',
          effectTicks: '9000000',
        }),
      ],
    )
    expect((await write(test, `/api/marketplace/payouts/${id}/refresh`)).statusCode).toBe(202)
    await nextJob()
    expect(
      (await read<{ complete: boolean }>(test, `/api/marketplace/payouts/${id}`)).complete,
    ).toBe(false)
    await nextJob()
    await nextJob()
    const result = await read<{
      complete: boolean
      differenceTicks: string
      summary: { netTicks: string; entryCount: number }
    }>(test, `/api/marketplace/payouts/${id}`)
    expect(result.complete).toBe(true)
    expect(result.summary.entryCount).toBe(4)
    expect(result.summary.netTicks).toBe('9700000')
    expect(result.differenceTicks).toBe('0')
    const requests = test.remote.requests.filter((r) => r.includes('paymentOrderId='))
    expect(requests).toHaveLength(3)
    expect(requests.every((r) => !r.includes('startDate') && !r.includes('endDate'))).toBe(true)
    const records = await read<{ records: MarketplaceRecord<FinancialRecord>[] }>(
      test,
      '/api/marketplace/records?resource=settlement&kind=entry',
    )
    expect(records.records.filter((r) => r.document.externalId === '725041340')).toHaveLength(2)
  })
  it('matches an exact incoming bank receipt once and can reverse the association', async () => {
    const test = await setup(),
      id = await payout(test),
      cashId = randomUUID()
    expect(
      (
        await write(test, '/api/commands', {
          type: 'cash.record',
          id: cashId,
          kind: 'in',
          method: 'transfer',
          amount: 97000,
          description: 'Trendyol banka ödemesi',
        })
      ).statusCode,
    ).toBe(200)
    const matches = await Promise.all([
      write(test, `/api/marketplace/payouts/${id}/match`, { cashEntryId: cashId }),
      write(test, `/api/marketplace/payouts/${id}/match`, { cashEntryId: cashId }),
    ])
    expect(matches.map((r) => r.statusCode)).toEqual([200, 200])
    const state = (await read<{ state: AppState }>(test, '/api/workspace')).state
    expect(state.settlementMatches).toHaveLength(1)
    expect(state.cash).toHaveLength(1)
    const undone = await app.inject({
      method: 'DELETE',
      url: `/api/marketplace/payouts/${id}/match`,
      headers: test.headers,
      payload: { matchId: state.settlementMatches![0].id },
    })
    expect(undone.statusCode).toBe(200)
    const after = (await read<{ state: AppState }>(test, '/api/workspace')).state
    expect(after.settlementMatches).toHaveLength(0)
    expect(after.cash).toEqual(state.cash)
  })
  it('never reuses one bank receipt for two payout orders or accepts a different amount', async () => {
    const test = await setup(),
      id = await payout(test),
      cashId = randomUUID()
    await write(test, '/api/commands', {
      type: 'cash.record',
      id: cashId,
      kind: 'in',
      method: 'transfer',
      amount: 90000,
      description: 'Başka tahsilat',
    })
    expect(
      (await write(test, `/api/marketplace/payouts/${id}/match`, { cashEntryId: cashId }))
        .statusCode,
    ).toBe(409)
    const matching = randomUUID()
    await write(test, '/api/commands', {
      type: 'cash.record',
      id: matching,
      kind: 'in',
      method: 'transfer',
      amount: 97000,
      description: 'Hakediş tahsilatı',
    })
    expect(
      (await write(test, `/api/marketplace/payouts/${id}/match`, { cashEntryId: matching }))
        .statusCode,
    ).toBe(200)
    const second = randomUUID(),
      document = (await detail<FinancialRecord>(test, id)).document
    await db.query(
      `INSERT INTO external_records(id,workspace_id,connection_id,resource,external_id,document) VALUES($1,$2,$3,'settlement','payment-order:112361',$4)`,
      [
        second,
        test.workspaceId,
        test.storeId,
        JSON.stringify({ ...document, externalId: '112361', paymentOrderId: '112361' }),
      ],
    )
    expect(
      (await write(test, `/api/marketplace/payouts/${second}/match`, { cashEntryId: matching }))
        .statusCode,
    ).toBe(409)
  })
})
