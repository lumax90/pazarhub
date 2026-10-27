import type { MarketplaceClaim, ClaimDecision } from '../../src/domain/marketplace'
import type { AdapterContext, AdapterResult, ProviderAdapter } from '../integrations/contracts'
import { array, cents, integer, record, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { PazaramaApi, pazaramaMoney } from '../integrations/pazarama'
import { AppError, ProviderError } from '../errors'
import { claimDecisionOptions, validateClaimDecision } from './claim-options'
import { HepsiburadaClaims } from './hepsiburada-claims'
import { N11Claims } from './n11-claims'

const knownDate = (value: unknown) => {
  const source = text(value)
  return source && !Number.isNaN(Date.parse(source)) ? new Date(source).toISOString() : null
}
export function normalizeNativeClaim(
  provider: 'ciceksepeti' | 'pazarama',
  value: unknown,
): MarketplaceClaim {
  const raw = record(value),
    id = text(provider === 'pazarama' ? raw.refundId : raw.orderItemId)
  if (!id) throw new ProviderError('INVALID_CLAIM', 'İade talep kimliği eksik.')
  const pz = integer(raw.refundStatus, -1),
    cs = text(raw.orderItemCancelStatus),
    stage = text(raw.orderItemStatus)
  const status =
    provider === 'pazarama'
      ? [2, 4, 6, 8].includes(pz)
        ? 'Accepted'
        : pz === 3
          ? 'RejectedBySeller'
          : pz === 5
            ? 'Rejected'
            : pz === 7
              ? 'Cancelled'
              : pz === 9
                ? 'InAnalysis'
                : pz === 1
                  ? 'WaitingInAction'
                  : 'Created'
      : ['Bayi Onay', 'Müşteri Haklı'].includes(cs)
        ? 'Accepted'
        : cs === 'Bayi Red'
          ? 'RejectedBySeller'
          : cs === 'Bayi Haklı'
            ? 'Rejected'
            : cs === 'İptal/İknadan Geri Çekildi'
              ? 'Cancelled'
              : ['İade Tedarikçide', 'İade Tedarikçi Onayı Bekliyor'].includes(stage)
                ? 'WaitingInAction'
                : 'Created'
  const amount = provider === 'pazarama' ? pazaramaMoney(raw.refundAmount) : cents(raw.price)
  return {
    kind: 'claim',
    externalId: id,
    orderNumber: text(raw.orderNumber ?? raw.orderId),
    createdAt: knownDate(raw.refundDate ?? raw.cancellationDate),
    trackingNumber: text(raw.shipmentCode ?? raw.partialNumber ?? raw.shipmentNumber),
    claimType: provider === 'ciceksepeti' && raw.cancelReasonId === 2 ? 'exchange' : 'return',
    items: [
      {
        id,
        orderLineId: text(raw.orderItemId),
        productName: text(raw.productName),
        sku: text(
          raw.productStockCode ?? raw.supplierProductVariantCode ?? raw.supplierProductCode,
        ),
        barcode: text(raw.productCode),
        status,
        reason: text(raw.refundType ?? raw.subCancelReason),
        customerNote: text(raw.description),
        amount: Number.isSafeInteger(amount) ? amount : null,
      },
    ],
  }
}
const asRecord = (claim: MarketplaceClaim) => ({
  id: claim.externalId,
  resource: 'claim' as const,
  data: { ...claim },
})
class NativeClaims {
  constructor(private readonly http: ProviderHttp) {}
  private cicek(context: AdapterContext) {
    return {
      base: `https://${context.settings.environment === 'sandbox' ? 'sandbox-apis' : 'apis'}.ciceksepeti.com/api/v1`,
      headers: {
        'x-api-key': requireCredential(context.credentials, 'apiKey'),
        'user-agent': `${requireCredential(context.credentials, 'sellerId')}-${context.integrationName}`,
      },
    }
  }
  private async page(context: AdapterContext, payload: Record<string, unknown>) {
    if (context.provider === 'ciceksepeti') {
      const { base, headers } = this.cicek(context),
        page = integer(payload.page),
        response = record(
          await this.http.request(`${base}/Order/getcanceledorders`, {
            method: 'POST',
            headers,
            json: {
              page,
              pageSize: 100,
              ...(payload.from
                ? {
                    cancellationStartDate: new Date(Number(payload.from)).toISOString(),
                    cancellationEndDate: new Date(Number(payload.to)).toISOString(),
                  }
                : {}),
            },
            idempotent: true,
          }),
        )
      if (!Array.isArray(response.orderItemList))
        throw new ProviderError('INVALID_CLAIMS', 'Çiçeksepeti iade listesi okunamadı.')
      return {
        claims: response.orderItemList.map((raw) => normalizeNativeClaim('ciceksepeti', raw)),
        more: response.orderItemList.length === 100,
        page,
      }
    }
    const page = integer(payload.page, 1),
      response = await new PazaramaApi(this.http).request(context, '/order/getRefund', {
        method: 'POST',
        json: {
          pageNumber: page,
          pageSize: 100,
          ...(payload.from
            ? {
                requestStartDate: new Date(Number(payload.from)).toISOString(),
                requestEndDate: new Date(Number(payload.to)).toISOString(),
              }
            : {}),
        },
        idempotent: true,
      }),
      data = record(response.data)
    if (!Array.isArray(data.refundList))
      throw new ProviderError('INVALID_CLAIMS', 'Pazarama iade listesi okunamadı.')
    return {
      claims: data.refundList.map((raw) => normalizeNativeClaim('pazarama', raw)),
      more: page < integer(record(data.responsePage).totalPages, 1),
      page,
    }
  }
  private async get(context: AdapterContext, id: string) {
    for (let index = 0; index < 100; index++) {
      const page = await this.page(context, {
          page: context.provider === 'ciceksepeti' ? index : index + 1,
        }),
        matches = page.claims.filter((claim) => claim.externalId === id)
      if (matches.length === 1) return matches[0]
      if (matches.length > 1)
        throw new ProviderError('AMBIGUOUS_CLAIM', 'Aynı kimlikte birden çok iade kaydı var.')
      if (!page.more) break
    }
    throw new ProviderError(
      'CLAIM_NOT_FOUND',
      'İade talebi sağlayıcının güncel listesinde bulunamadı.',
    )
  }
  async execute(
    operation: string,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    if (operation === 'claims.pull') {
      if (payload.claimId) {
        const claim = await this.get(context, text(payload.claimId))
        return { message: 'İade talebi sağlayıcıdan alındı.', records: [asRecord(claim)] }
      }
      const to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - 14 * 86400000)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 31 * 86400000)
        throw new ProviderError('INVALID_WINDOW', 'İade sorgusu en fazla 31 gün olmalı.')
      const page = await this.page(context, { ...payload, from, to })
      return {
        message: `${page.claims.length} iade talebi alındı.`,
        records: page.claims.map(asRecord),
        ...(page.more
          ? {
              nextPayload: { ...payload, from, to, page: page.page + 1 },
              delaySeconds: context.provider === 'ciceksepeti' ? 6 : 2,
            }
          : {}),
      }
    }
    const id = text(payload.claimId),
      ids = array(payload.itemIds).map(text),
      decision = (text(payload.decision) || 'approve') as ClaimDecision,
      current = await this.get(context, id)
    if (ids.length !== 1 || ids[0] !== id)
      throw new ProviderError(
        'CLAIM_ITEMS_INVALID',
        'Bu sağlayıcıda seçilen iade talebinin tamamı işlenir.',
      )
    const target =
      decision === 'reject'
        ? ['Rejected', 'RejectedBySeller']
        : decision === 'investigate'
          ? ['InAnalysis']
          : ['Accepted']
    if (target.includes(current.items[0].status))
      return {
        message: 'Talep kararı sağlayıcıda zaten doğrulandı.',
        records: [asRecord(current)],
        marketplaceAction: {
          resource: 'claim',
          externalId: id,
          itemIds: ids,
          decision,
          confirmed: true,
        },
      }
    if (current.items[0].status !== 'WaitingInAction')
      throw new ProviderError('CLAIM_CLOSED', 'İade talebi karar beklemiyor.')
    const rules = await claimDecisionOptions(context, this.http)
    try {
      validateClaimDecision(context.provider, rules, {
        decision,
        reasonId: text(payload.reasonId),
        description: text(payload.description),
        reviewType: text(payload.reviewType),
        files: array(payload.files),
      })
    } catch (error) {
      if (error instanceof AppError) throw new ProviderError(error.code, error.message)
      throw error
    }
    if (context.provider === 'ciceksepeti') {
      const { base, headers } = this.cicek(context),
        response = record(
          await this.http.request(`${base}/Order/cancelevaluation`, {
            method: 'POST',
            headers,
            json: { orderItemId: Number(id), process: decision === 'approve' ? 1 : 3 },
          }),
        )
      if (response.isSuccess !== true)
        throw new ProviderError(
          'CLAIM_REJECTED',
          text(response.message) || 'Çiçeksepeti kararı kabul etmedi.',
        )
    } else {
      await new PazaramaApi(this.http).request(context, '/order/updateRefund', {
        method: 'POST',
        json: {
          refundId: id,
          status: decision === 'approve' ? 2 : decision === 'reject' ? 3 : 9,
          ...(decision === 'reject' ? { refundRejectType: Number(payload.reasonId) } : {}),
          ...(decision === 'investigate' ? { refundReviewType: Number(payload.reviewType) } : {}),
          ...(payload.description ? { description: payload.description } : {}),
          ...(array(payload.files).length
            ? {
                documentObjects: array(payload.files).map((value) => ({
                  name: text(record(value).name),
                  bytes: text(record(value).data),
                })),
              }
            : {}),
        },
      })
    }
    return {
      message:
        decision === 'approve'
          ? 'İade onayı gönderildi; sonucu sorgulanacak.'
          : decision === 'reject'
            ? 'Ret talebi gönderildi; sağlayıcı değerlendirmesi izlenecek.'
            : 'İnceleme talebi gönderildi; sonucu sorgulanacak.',
      marketplaceAction: {
        resource: 'claim',
        externalId: id,
        itemIds: ids,
        decision,
        confirmed: false,
      },
    }
  }
}
export function withNativeClaims(
  http: ProviderHttp,
  provider: string,
  adapter: ProviderAdapter,
): ProviderAdapter {
  if (!['ciceksepeti', 'pazarama', 'hepsiburada', 'n11'].includes(provider)) return adapter
  const claims =
    provider === 'hepsiburada'
      ? new HepsiburadaClaims(http)
      : provider === 'n11'
        ? new N11Claims(http)
        : new NativeClaims(http)
  return {
    capabilities: [...adapter.capabilities, 'claims.pull', 'claim.decide'],
    execute: (operation, context, payload) =>
      ['claims.pull', 'claim.decide'].includes(operation)
        ? claims.execute(operation, context, payload)
        : adapter.execute(operation, context, payload),
  }
}
