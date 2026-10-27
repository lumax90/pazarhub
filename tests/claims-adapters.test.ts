import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withNativeClaims } from '../server/marketplace/claims'
import type { AdapterContext, ProviderAdapter } from '../server/integrations/contracts'
import { ProviderHttp } from '../server/integrations/http'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'

const base: ProviderAdapter = {
  capabilities: [],
  execute: async () => {
    throw new Error('Unexpected operation')
  },
}
const context = (provider: AdapterContext['provider']): AdapterContext => ({
  provider,
  connectionId: randomUUID(),
  workspaceId: randomUUID(),
  credentials: { apiKey: 'fixture', sellerId: '123', clientId: 'fixture', clientSecret: 'fixture' },
  settings: defaultIntegrationSettings,
  state: createEmptyState('Claims'),
  integrationName: 'Test',
})
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
describe('native return decisions', () => {
  it('handles the complete Ciceksepeti refund request and keeps a seller rejection distinct from platform review outcome', async () => {
    const ctx = context('ciceksepeti'),
      claim = {
        orderItemId: 10,
        orderId: 100,
        orderItemStatus: 'İade Tedarikçide',
        orderItemCancelStatus: '',
        productName: 'Ürün',
        price: 240,
        cancelReasonId: 1,
      }
    let writes = 0
    const adapter = withNativeClaims(
      new ProviderHttp(async (url, init) => {
        if (String(url).endsWith('/cancelevaluation')) {
          expect(JSON.parse(String(init?.body))).toEqual({ orderItemId: 10, process: 3 })
          claim.orderItemCancelStatus = 'Bayi Red'
          writes++
          return json({ isSuccess: true })
        }
        return json({ orderItemList: [claim] })
      }),
      'ciceksepeti',
      base,
    )
    const first = await adapter.execute('claims.pull', ctx, {})
    expect(first.records?.[0].data.items).toMatchObject([
      { id: '10', status: 'WaitingInAction', amount: 24000 },
    ])
    const pending = await adapter.execute('claim.decide', ctx, {
      claimId: '10',
      itemIds: ['10'],
      decision: 'reject',
    })
    expect(pending.marketplaceAction).toMatchObject({ decision: 'reject', confirmed: false })
    expect(
      (await adapter.execute('claims.pull', ctx, { claimId: '10' })).records?.[0].data.items,
    ).toMatchObject([{ status: 'RejectedBySeller' }])
    expect(writes).toBe(1)
  })
  it('requires Pazarama rejection evidence where documented and submits review type without inventing a quantity', async () => {
    const ctx = context('pazarama'),
      claim = {
        refundId: 'refund-1',
        orderNumber: 100,
        refundStatus: 1,
        productName: 'Ürün',
        refundAmount: { valueInt: 12000 },
        refundDate: '2026-10-24T10:00:00+03:00',
      },
      writes: Record<string, unknown>[] = []
    const adapter = withNativeClaims(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/connect/token'))
          return json({ access_token: 'token', expires_in: 3600 })
        if (path.endsWith('/getRefund'))
          return json({
            success: true,
            data: { refundList: [claim], responsePage: { totalPages: 1 } },
          })
        const body = JSON.parse(String(init?.body))
        writes.push(body)
        claim.refundStatus = body.status
        return json({ success: true, data: { refundId: claim.refundId } })
      }),
      'pazarama',
      base,
    )
    await expect(
      adapter.execute('claim.decide', ctx, {
        claimId: 'refund-1',
        itemIds: ['refund-1'],
        decision: 'reject',
        reasonId: '1',
        description: 'Yanlış ürün geldi.',
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_IMAGES_REQUIRED' })
    expect(writes).toHaveLength(0)
    await adapter.execute('claim.decide', ctx, {
      claimId: 'refund-1',
      itemIds: ['refund-1'],
      decision: 'reject',
      reasonId: '10',
      description: 'İade paketi boş geldi.',
    })
    expect(writes[0]).toMatchObject({ refundId: 'refund-1', status: 3, refundRejectType: 10 })
    expect(writes[0]).not.toHaveProperty('quantity')
    claim.refundStatus = 1
    await adapter.execute('claim.decide', ctx, {
      claimId: 'refund-1',
      itemIds: ['refund-1'],
      decision: 'investigate',
      reviewType: '2',
    })
    expect(writes[1]).toEqual({ refundId: 'refund-1', status: 9, refundReviewType: 2 })
    expect(
      (await adapter.execute('claims.pull', ctx, { claimId: 'refund-1' })).records?.[0].data.items,
    ).toMatchObject([{ status: 'InAnalysis' }])
  })
})
