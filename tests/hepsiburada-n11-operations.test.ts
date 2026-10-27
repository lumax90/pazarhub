import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AdapterContext, ProviderAdapter } from '../server/integrations/contracts'
import { ProviderHttp } from '../server/integrations/http'
import { withNativeClaims } from '../server/marketplace/claims'
import {
  withHepsiburadaFinance,
  normalizeHepsiburadaFinancial,
} from '../server/marketplace/hepsiburada-finance'
import { N11Publisher } from '../server/publishing/n11'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'
import { financialBreakdown } from '../src/domain/marketplace'

const base: ProviderAdapter = {
  capabilities: [],
  execute: async () => {
    throw new Error('Unexpected operation')
  },
}
const context = (provider: AdapterContext['provider']): AdapterContext => ({
  provider,
  workspaceId: randomUUID(),
  connectionId: randomUUID(),
  credentials: {
    merchantId: 'merchant',
    username: 'fixture',
    password: 'fixture',
    appKey: 'fixture',
    appSecret: 'fixture',
  },
  settings: defaultIntegrationSettings,
  state: createEmptyState('Operations'),
  integrationName: 'Test',
})
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const soap = (method: string, body: string) =>
  new Response(
    `<Envelope><Body><${method}Response><result><status>success</status></result>${body}</${method}Response></Body></Envelope>`,
  )
describe('Hepsiburada finance and n11/HB returns', () => {
  it('keeps exact HB income and expenses without treating the sales Payment as a bank payout', async () => {
    const ctx = context('hepsiburada'),
      rows = [
        {
          id: 'sale',
          merchantId: 'merchant',
          transactionType: 'Payment',
          amount: { currencyCode: 949, value: '120.1234' },
          isIncome: true,
          orderNumber: '001',
          status: 'Paid',
        },
        {
          id: 'commission',
          merchantId: 'merchant',
          transactionType: 'Commission',
          amount: { currencyCode: '949', value: '24.0247' },
          isIncome: false,
          orderNumber: '001',
          status: 'Paid',
        },
      ]
    const documents = rows.map((row) => normalizeHepsiburadaFinancial(row, 'merchant'))
    expect(financialBreakdown(documents).netTicks).toBe('960987')
    expect(documents.every((row) => row.kind === 'entry' && !row.paymentOrderId)).toBe(true)
    expect(() =>
      normalizeHepsiburadaFinancial(
        { ...rows[0], amount: { currencyCode: 840, value: 120 } },
        'merchant',
      ),
    ).toThrow('TRY')
    expect(() =>
      normalizeHepsiburadaFinancial({ ...rows[0], merchantId: 'another' }, 'merchant'),
    ).toThrow('mağaza')
    const adapter = withHepsiburadaFinance(
      new ProviderHttp(async (url) => {
        expect(new URL(String(url)).pathname).toBe('/transactions/merchantid/merchant')
        return json({ items: rows, count: rows.length })
      }),
      'hepsiburada',
      base,
    )
    const result = await adapter.execute('settlements.pull', ctx, {})
    expect(result.records?.map((row) => row.id)).toEqual(['hb:sale', 'hb:commission'])
    expect(result.nextPayload).toBeUndefined()
  })
  it('approves only a return and reconciles a lost HB rejection without resubmitting it', async () => {
    const ctx = context('hepsiburada'),
      claim = {
        id: 'claim-id',
        number: 'CLAIM1',
        claimType: 'Return',
        status: 'AwaitingAction',
        priceCurrency: 'TRY',
        quantity: 2,
        totalPriceAmount: 240,
        sku: 'SKU',
        orderNumber: '001',
      }
    let writes = 0
    const adapter = withNativeClaims(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (init?.method === 'POST') {
          expect(path).toBe('/claims/number/CLAIM1/reject')
          expect(JSON.parse(String(init.body))).toMatchObject({
            ClaimRejectionReason: 'ReturnedProductIsNotDelivered',
          })
          claim.status = 'InDispute'
          writes++
          throw new Error('Lost response')
        }
        return json([claim])
      }),
      'hepsiburada',
      base,
    )
    const payload = {
      claimId: 'CLAIM1',
      itemIds: ['claim-id'],
      decision: 'reject',
      reasonId: 'ReturnedProductIsNotDelivered',
      description: 'Ürün ulaşmadı.',
    }
    await expect(adapter.execute('claim.decide', ctx, payload)).rejects.toMatchObject({
      uncertain: true,
    })
    expect(
      (await adapter.execute('claims.pull', ctx, { claimId: 'CLAIM1' })).records?.[0].data.items,
    ).toMatchObject([{ status: 'RejectedBySeller', quantity: 2, amount: 24000 }])
    expect((await adapter.execute('claim.decide', ctx, payload)).marketplaceAction?.confirmed).toBe(
      true,
    )
    expect(writes).toBe(1)
    claim.claimType = 'MissingInvoice'
    claim.status = 'AwaitingAction'
    await expect(
      adapter.execute('claim.decide', ctx, { ...payload, decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'CLAIM_CLOSED' })
  })
  it('uses WSDL n11 return IDs, loads provider reasons and carries explicit investigation days', async () => {
    const ctx = context('n11')
    let status = 'REQUESTED'
    const writes: string[] = []
    const adapter = withNativeClaims(
      new ProviderHttp(async (_url, init) => {
        const xml = String(init?.body)
        if (xml.includes('ClaimReturnDenyReasonTypesRequest'))
          return soap(
            'ClaimReturnDenyReasonTypes',
            '<denyReasonTypeDataList><denyReasonTypeData><id>41</id><value>İade Ürün Mağazaya Ulaşmadı</value></denyReasonTypeData></denyReasonTypeDataList>',
          )
        if (xml.includes('ClaimReturnPendingReasonTypesRequest'))
          return soap(
            'ClaimReturnPendingReasonTypes',
            '<pendingReasonTypeDataList><pendingReasonTypeData><id>21</id><value>Acente incelemesi</value></pendingReasonTypeData></pendingReasonTypeDataList>',
          )
        if (xml.includes('ClaimReturnListRequest'))
          return soap(
            'ClaimReturnList',
            `<claimReturnList><claimReturn><claimReturnId>123</claimReturnId><status>${status}</status><quantity>2</quantity><finalPrice>240</finalPrice><orderNumber>001</orderNumber><requestDate>23/10/2026</requestDate><productName>Ürün</productName></claimReturn></claimReturnList><pagingData><pageCount>1</pageCount></pagingData>`,
          )
        expect(xml).toContain('<claimReturnId>123</claimReturnId>')
        expect(xml).not.toContain('claimCancelId')
        writes.push(xml)
        if (xml.includes('ClaimReturnPendingRequest')) {
          expect(xml).toContain('<pendingReasonId>21</pendingReasonId>')
          expect(xml).toContain('<pendingDayCount>3</pendingDayCount>')
          status = 'PENDED'
          return soap('ClaimReturnPending', '')
        }
        status = 'APPROVED'
        return soap('ClaimReturnApprove', '')
      }),
      'n11',
      base,
    )
    await adapter.execute('claim.decide', ctx, {
      claimId: '123',
      itemIds: ['123'],
      decision: 'investigate',
      reviewType: '21',
      reviewDays: 3,
      description: 'Acente inceleyecek.',
    })
    expect(
      (await adapter.execute('claims.pull', ctx, { claimId: '123' })).records?.[0].data.items,
    ).toMatchObject([{ status: 'InAnalysis' }])
    status = 'REQUESTED'
    await adapter.execute('claim.decide', ctx, {
      claimId: '123',
      itemIds: ['123'],
      decision: 'approve',
    })
    expect(
      (
        await adapter.execute('claim.decide', ctx, {
          claimId: '123',
          itemIds: ['123'],
          decision: 'approve',
        })
      ).marketplaceAction?.confirmed,
    ).toBe(true)
    expect(writes).toHaveLength(2)
    ctx.settings = { ...ctx.settings, environment: 'sandbox' }
    await expect(adapter.execute('claims.pull', ctx, {})).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    })
  })
  it('reads the authenticated n11 shipment template and validates its exact name without creating a template', async () => {
    const ctx = context('n11'),
      publisher = new N11Publisher(
        new ProviderHttp(async (_url, init) => {
          const xml = String(init?.body)
          expect(xml).not.toContain('CreateOrUpdateShipmentTemplate')
          return xml.includes('GetShipmentTemplateListRequest')
            ? soap(
                'GetShipmentTemplateList',
                '<shipmentTemplates><shipmentTemplate><templateName>Depo &amp; Kargo</templateName></shipmentTemplate></shipmentTemplates>',
              )
            : soap(
                'GetShipmentTemplate',
                '<shipmentTemplate><templateName>Depo &amp; Kargo</templateName></shipmentTemplate>',
              )
        }),
      )
    expect((await publisher.metadata(ctx, { resource: 'shipmentTemplates' })).options).toEqual([
      { id: 'Depo & Kargo', name: 'Depo & Kargo' },
    ])
    expect(
      (await publisher.metadata(ctx, { resource: 'shipmentTemplates', query: 'Depo & Kargo' }))
        .options?.[0].id,
    ).toBe('Depo & Kargo')
  })
})
