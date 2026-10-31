import type { MarketplaceClaim } from '../../src/domain/marketplace'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, cents, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { hepsiburadaHeaders } from '../integrations/hepsiburada'
import { AppError, ProviderError } from '../errors'
import { claimDecisionOptions, validateClaimDecision } from './claim-options'

export function normalizeHepsiburadaClaim(raw: unknown): MarketplaceClaim {
  const item = record(raw),
    number = text(item.number),
    type = text(item.claimType),
    status = text(item.status),
    line = record(item.line)
  if (!number || !text(item.id) || !['TRY', '949'].includes(text(item.priceCurrency)))
    throw new ProviderError(
      'CLAIM_IDENTITY_MISMATCH',
      'Hepsiburada talep numarası, kimliği veya para birimi doğrulanamadı.',
    )
  const actionable = type === 'Return' && status === 'AwaitingAction'
  return {
    kind: 'claim',
    externalId: number,
    orderNumber: text(item.orderNumber),
    claimType: type === 'RenewProduct' ? 'exchange' : 'return',
    createdAt:
      text(item.claimDate) && Number.isFinite(Date.parse(text(item.claimDate)))
        ? new Date(text(item.claimDate)).toISOString()
        : null,
    items: [
      {
        id: text(item.id),
        orderLineId: text(line.lineItemId),
        productName: text(line.productName) || text(item.productName) || text(item.sku),
        sku: text(line.merchantSku) || text(item.sku),
        barcode: '',
        quantity: remoteInteger(item.quantity),
        amount: Number.isSafeInteger(cents(item.totalPriceAmount))
          ? cents(item.totalPriceAmount)
          : null,
        status: actionable
          ? 'WaitingInAction'
          : ['Accepted', 'Refunded'].includes(status)
            ? 'Accepted'
            : status === 'InDispute'
              ? 'RejectedBySeller'
              : status === 'Rejected'
                ? 'Rejected'
                : status === 'Cancelled'
                  ? 'Cancelled'
                  : status,
        reason: text(item.reason) || type,
        customerNote: text(item.explanation),
      },
    ],
  }
}
export class HepsiburadaClaims {
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext) {
    return {
      base: `https://oms-external${context.settings.environment === 'sandbox' ? '-sit' : ''}.hepsiburada.com`,
      merchant: encodeURIComponent(requireCredential(context.credentials, 'merchantId')),
      headers: hepsiburadaHeaders(context),
    }
  }
  private async page(context: AdapterContext, payload: Record<string, unknown>) {
    const { base, merchant, headers } = this.api(context),
      offset = remoteInteger(payload.offset, 0),
      query = new URLSearchParams({ offset: String(offset), limit: '100' })
    const format = (stamp: number) => {
      const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(stamp))
      return parts.replace(',', '')
    }
    if (payload.from) {
      query.set('beginDate', format(Number(payload.from)))
      query.set('endDate', format(Number(payload.to)))
    }
    const response = await this.http.request(`${base}/claims/merchantId/${merchant}?${query}`, {
      headers,
    })
    if (!Array.isArray(response))
      throw new ProviderError('INVALID_CLAIMS', 'Hepsiburada talep listesi okunamadı.')
    return { rows: response.map(normalizeHepsiburadaClaim), more: response.length === 100, offset }
  }
  async execute(
    operation: string,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    if (operation === 'claims.pull' && !payload.claimId) {
      const to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - 14 * 86400000)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 31 * 86400000)
        throw new ProviderError('INVALID_WINDOW', 'Talep sorgusu en fazla 31 gün olmalı.')
      const page = await this.page(context, { ...payload, from, to })
      return {
        message: `${page.rows.length} Hepsiburada talebi alındı.`,
        records: page.rows.map((claim) => ({
          id: claim.externalId,
          resource: 'claim',
          data: { ...claim },
        })),
        ...(page.more
          ? { nextPayload: { ...payload, from, to, offset: page.offset + 100 }, delaySeconds: 2 }
          : {}),
      }
    }
    let claim: MarketplaceClaim | undefined
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await this.page(context, { offset })
      claim = page.rows.find((claim) => claim.externalId === text(payload.claimId))
      if (claim || !page.more) break
    }
    if (!claim) throw new ProviderError('CLAIM_NOT_FOUND', 'Hepsiburada talebi bulunamadı.')
    const records = [{ id: claim.externalId, resource: 'claim' as const, data: { ...claim } }]
    if (operation === 'claims.pull') return { message: 'Hepsiburada talep sonucu okundu.', records }
    const ids = array(payload.itemIds).map(text),
      decision = payload.decision === 'reject' ? 'reject' : 'approve',
      selected = claim.items[0]
    if (payload.decision === 'investigate' || ids.length !== 1 || ids[0] !== selected.id)
      throw new ProviderError(
        'CLAIM_ITEMS_INVALID',
        'İade talebinin tüm miktarını ve desteklenen kararı seçin.',
      )
    const expected = decision === 'reject' ? ['Rejected', 'RejectedBySeller'] : ['Accepted']
    if (expected.includes(selected.status))
      return {
        message: 'Hepsiburada talep sonucu zaten doğrulandı.',
        records,
        marketplaceAction: {
          resource: 'claim',
          externalId: claim.externalId,
          itemIds: ids,
          decision,
          confirmed: true,
        },
      }
    if (selected.status !== 'WaitingInAction' || claim.claimType === 'exchange')
      throw new ProviderError(
        'CLAIM_CLOSED',
        'Bu talep normal iade kararı beklemiyor; talep tipini sağlayıcıda kontrol edin.',
      )
    const rules = await claimDecisionOptions(context, this.http)
    try {
      validateClaimDecision('hepsiburada', rules, {
        decision,
        reasonId: text(payload.reasonId),
        description: text(payload.description),
        files: array(payload.files),
      })
    } catch (error) {
      if (error instanceof AppError) throw new ProviderError(error.code, error.message)
      throw error
    }
    const { base, headers } = this.api(context)
    await this.http.request(
      `${base}/claims/number/${encodeURIComponent(claim.externalId)}/${decision === 'approve' ? 'accept' : 'reject'}`,
      {
        method: 'POST',
        headers,
        json:
          decision === 'approve'
            ? { FinalizedWith: 'Refund' }
            : { ClaimRejectionReason: payload.reasonId, MerchantStatement: payload.description },
      },
    )
    return {
      message: 'Hepsiburada iade kararı gönderildi; sağlayıcı sonucu izlenecek.',
      marketplaceAction: {
        resource: 'claim',
        externalId: claim.externalId,
        itemIds: ids,
        decision,
        confirmed: false,
      },
    }
  }
}
