import type { ClaimDecision, MarketplaceClaim } from '../../src/domain/marketplace'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, cents, integer, record, remoteInteger, text } from '../integrations/contracts'
import { ProviderHttp } from '../integrations/http'
import { soapArray } from '../integrations/soap'
import { n11ReturnCall } from '../integrations/n11-api'
import { AppError, ProviderError } from '../errors'
import { claimDecisionOptions, validateClaimDecision } from './claim-options'

export function normalizeN11Claim(raw: unknown): MarketplaceClaim {
  const item = record(raw),
    id = text(item.claimReturnId),
    quantity = remoteInteger(item.quantity),
    amount = cents(item.finalPrice)
  if (!id || quantity < 1 || !Number.isSafeInteger(amount))
    throw new ProviderError('INVALID_CLAIM', 'n11 iade kimliği, miktarı veya tutarı okunamadı.')
  const date = text(item.requestDate),
    parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date),
    stamp = parts ? `${parts[3]}-${parts[2]}-${parts[1]}T00:00:00+03:00` : date
  const status = text(item.status),
    mapped = ['APPROVED', 'MANUAL_REFUND'].includes(status)
      ? 'Accepted'
      : status === 'DENIED'
        ? 'Rejected'
        : status === 'CANCELLED'
          ? 'Cancelled'
          : ['PENDING', 'PENDED'].includes(status)
            ? 'InAnalysis'
            : ['REQUESTED', 'APPROVAL_WAITING'].includes(status)
              ? 'WaitingInAction'
              : 'Created'
  return {
    kind: 'claim',
    externalId: id,
    orderNumber: text(item.orderNumber),
    createdAt: stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null,
    trackingNumber: text(item.trackingNumber) || text(item.sellerCampaignNumber),
    claimType: 'return',
    items: [
      {
        id,
        orderLineId: text(item.orderItemId),
        productName: [text(item.productName), text(item.attributesNames)]
          .filter(Boolean)
          .join(' · '),
        sku: text(item.skuId),
        barcode: '',
        quantity,
        amount,
        status: mapped,
        reason: text(item.returnReasonType),
        customerNote: text(item.returnReasonDescription),
      },
    ],
  }
}
export class N11Claims {
  constructor(private readonly http: ProviderHttp) {}
  private async page(context: AdapterContext, payload: Record<string, unknown>) {
    const page = integer(payload.page),
      format = (stamp: number) =>
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul' }).format(new Date(stamp))
    const response = await n11ReturnCall(this.http, context, 'ClaimReturnList', {
      searchData: {
        status: 'ALL',
        executer: '',
        searchInfoType: payload.orderNumber ? 'ORDERID' : '',
        searchQuery: text(payload.orderNumber),
        period: payload.from
          ? { startDate: format(Number(payload.from)), endDate: format(Number(payload.to)) }
          : { startDate: '', endDate: '' },
        sender: 'SELLER',
      },
      pagingData: { currentPage: page },
    })
    if (record(response.result).status !== 'success')
      throw new ProviderError('CLAIMS_REJECTED', 'n11 iade listesi alınamadı.')
    const rows = soapArray(record(response.claimReturnList).claimReturn).map(normalizeN11Claim)
    return { rows, page, more: page + 1 < integer(record(response.pagingData).pageCount) }
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
        throw new ProviderError('INVALID_WINDOW', 'İade sorgusu en fazla 31 gün olmalı.')
      const page = await this.page(context, { ...payload, from, to })
      return {
        message: `${page.rows.length} n11 iade talebi alındı.`,
        records: page.rows.map((claim) => ({
          id: claim.externalId,
          resource: 'claim',
          data: { ...claim },
        })),
        ...(page.more
          ? { nextPayload: { ...payload, from, to, page: page.page + 1 }, delaySeconds: 2 }
          : {}),
      }
    }
    let claim: MarketplaceClaim | undefined
    for (let page = 0; page < 100; page++) {
      const result = await this.page(context, { page, orderNumber: payload.orderNumber })
      claim = result.rows.find((claim) => claim.externalId === text(payload.claimId))
      if (claim || !result.more) break
    }
    if (!claim) throw new ProviderError('CLAIM_NOT_FOUND', 'n11 iade talebi bulunamadı.')
    const records = [{ id: claim.externalId, resource: 'claim' as const, data: { ...claim } }]
    if (operation === 'claims.pull') return { message: 'n11 iade sonucu okundu.', records }
    const decision = (text(payload.decision) || 'approve') as ClaimDecision,
      ids = array(payload.itemIds).map(text)
    if (ids.length !== 1 || ids[0] !== claim.externalId)
      throw new ProviderError('CLAIM_ITEMS_INVALID', 'n11 talebinin tüm miktarı seçilmeli.')
    const expected =
      decision === 'approve' ? 'Accepted' : decision === 'reject' ? 'Rejected' : 'InAnalysis'
    if (claim.items[0].status === expected)
      return {
        message: 'n11 iade kararı zaten doğrulandı.',
        records,
        marketplaceAction: {
          resource: 'claim',
          externalId: claim.externalId,
          itemIds: ids,
          decision,
          confirmed: true,
        },
      }
    if (claim.items[0].status !== 'WaitingInAction')
      throw new ProviderError('CLAIM_CLOSED', 'n11 talebi karar beklemiyor.')
    const rules = await claimDecisionOptions(context, this.http)
    try {
      validateClaimDecision('n11', rules, {
        decision,
        reasonId: text(payload.reasonId),
        description: text(payload.description),
        reviewType: text(payload.reviewType),
        reviewDays: integer(payload.reviewDays),
        files: array(payload.files),
      })
    } catch (error) {
      if (error instanceof AppError) throw new ProviderError(error.code, error.message)
      throw error
    }
    const operationName =
      decision === 'approve'
        ? 'ClaimReturnApprove'
        : decision === 'reject'
          ? 'ClaimReturnDeny'
          : 'ClaimReturnPending'
    const fields: Record<string, unknown> = { claimReturnId: claim.externalId }
    if (decision === 'approve') fields.splitQuantity = ''
    if (decision === 'reject')
      Object.assign(fields, {
        denyReasonId: payload.reasonId,
        denyReasonNote: payload.description,
        returnShipmentType: payload.reasonId === '41' ? '' : 'CAMPAIGN',
        shipmentCompanyId: '',
        trackingNumber: '',
        deliveryReceiptNumber: '',
        imageFirstUrl: '',
        imageSecondUrl: '',
        imageThirdUrl: '',
        videoUrl: '',
        splitQuantity: '',
      })
    if (decision === 'investigate')
      Object.assign(fields, {
        pendingReasonId: payload.reviewType,
        pendingDayCount: payload.reviewDays,
        pendingReasonNote: payload.description,
      })
    const response = await n11ReturnCall(this.http, context, operationName, fields, false)
    if (record(response.result).status !== 'success')
      throw new ProviderError(
        'CLAIM_REJECTED',
        text(record(response.result).errorMessage) || 'n11 karar isteğini reddetti.',
      )
    return {
      message: 'n11 iade kararı gönderildi; sonucu sorgulanacak.',
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
