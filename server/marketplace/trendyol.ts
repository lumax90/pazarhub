import type {
  MarketplaceClaim,
  MarketplaceQuestion,
  FinancialRecord,
} from '../../src/domain/marketplace'
import { decimalTicks, financialTypeLabels } from '../../src/domain/marketplace'
import type { AdapterContext, AdapterResult, ProviderAdapter } from '../integrations/contracts'
import { array, cents, integer, pathPart, record, text, urls } from '../integrations/contracts'
import { basicAuth, ProviderHttp, requireCredential } from '../integrations/http'
import { AppError, ProviderError } from '../errors'
import { claimDecisionOptions, validateClaimDecision } from './claim-options'
import type { IntegrationOperation } from '../../src/domain/integrations'

const date = (value: unknown) => {
  if (value === undefined || value === null) return null
  const parsed = new Date(typeof value === 'number' ? value : text(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}
const typeKey = (value: string) =>
  value.toLocaleLowerCase('tr-TR').replace(/\s+/g, '').replace(/ı/g, 'i')
const financialType = (value: string) =>
  Object.entries(financialTypeLabels).find(([key, label]) =>
    [key, label].some((name) => typeKey(name) === typeKey(value)),
  )?.[0] ?? value
export function normalizeQuestion(raw: unknown): MarketplaceQuestion {
  const row = record(raw),
    answer = record(row.answer),
    rejected = record(row.rejectedAnswer)
  if (!text(row.id) || !text(row.text))
    throw new ProviderError('INVALID_QUESTION', 'Soru kimliği veya metni eksik.')
  return {
    kind: 'question',
    externalId: text(row.id),
    text: text(row.text),
    productName: text(row.productName),
    customerName: row.showUserName ? text(row.userName) : '',
    status: text(row.status),
    createdAt: date(row.creationDate),
    answer: text(answer.text) || undefined,
    rejectedAnswer: text(rejected.text) || undefined,
    rejectedAt: date(row.rejectedDate ?? rejected.creationDate) ?? undefined,
    rejectionReason: text(rejected.reason ?? row.reason) || undefined,
    imageUrl: urls([row.imageUrl])[0],
    productUrl: urls([row.webUrl])[0],
  }
}
export function normalizeClaim(raw: unknown): MarketplaceClaim {
  const row = record(raw),
    id = text(row.id ?? row.claimId)
  if (!id) throw new ProviderError('INVALID_CLAIM', 'İade kimliği eksik.')
  const items = array(row.items).flatMap((raw) => {
    const group = record(raw),
      order = record(group.orderLine)
    return array(group.claimItems).map((raw) => {
      const item = record(raw),
        amount = cents(order.price)
      if (!text(item.id)) throw new ProviderError('INVALID_CLAIM_ITEM', 'İade satır kimliği eksik.')
      return {
        id: text(item.id),
        orderLineId: text(order.id),
        productName: text(order.productName),
        barcode: text(order.barcode),
        sku: text(order.merchantSku),
        status: text(record(item.claimItemStatus).name),
        reason: text(record(item.customerClaimItemReason).name),
        customerNote: text(item.customerNote),
        amount: Number.isFinite(amount) ? amount : null,
        quantity: 1,
      }
    })
  })
  if (!items.length) throw new ProviderError('INVALID_CLAIM', 'İade satırları bulunamadı.')
  return {
    kind: 'claim',
    externalId: id,
    orderNumber: text(row.orderNumber),
    createdAt: date(row.claimDate ?? row.createdDate),
    items,
    trackingNumber: text(row.cargoTrackingNumber) || undefined,
  }
}
export function normalizeFinancial(
  raw: unknown,
  source: FinancialRecord['source'],
): FinancialRecord {
  const row = record(raw),
    id = text(row.id)
  if (!id) throw new ProviderError('INVALID_FINANCIAL', 'Finansal kayıt kimliği eksik.')
  const money = (value: unknown) => {
    try {
      return decimalTicks(value)
    } catch {
      throw new ProviderError(
        'INVALID_FINANCIAL_AMOUNT',
        'Finansal kayıtta geçersiz veya desteklenmeyen ondalık tutar var.',
      )
    }
  }
  if (source === 'payment-order') {
    const payoutDate = date(row.payoutDate)
    if (!payoutDate)
      throw new ProviderError('INVALID_PAYOUT_DATE', 'Ödeme emrinin tarihi okunamadı.')
    return {
      kind: 'payout',
      source,
      externalId: id,
      transactionType: 'PaymentOrder',
      transactionDate: payoutDate,
      paymentOrderId: id,
      amountTicks: money(row.amount),
      status: text(row.status),
      payoutDate,
    }
  }
  const result: FinancialRecord = {
    kind: 'entry',
    source,
    externalId: id,
    transactionType: financialType(text(row.transactionType)),
    transactionDate: date(row.transactionDate),
    orderNumber: text(row.orderNumber) || undefined,
    packageId: text(row.shipmentPackageId) || undefined,
    paymentOrderId: text(row.paymentOrderId) || undefined,
    barcode: text(row.barcode) || undefined,
    description: text(row.description) || undefined,
    debitTicks: row.debt == null ? null : money(row.debt),
    creditTicks: row.credit == null ? null : money(row.credit),
    commissionTicks: row.commissionAmount == null ? null : money(row.commissionAmount),
    revenueTicks: row.sellerRevenue == null ? null : money(row.sellerRevenue),
  }
  result.effectTicks = null
  if (result.debitTicks !== null && result.creditTicks !== null) {
    const delta = BigInt(result.creditTicks!) - BigInt(result.debitTicks!)
    if (source === 'otherfinancials' || result.transactionType.startsWith('Commission'))
      result.effectTicks = delta.toString()
    else if (result.revenueTicks != null) {
      const revenue = BigInt(result.revenueTicks),
        absolute = revenue < 0n ? -revenue : revenue
      if (delta !== 0n) result.effectTicks = ((delta < 0n ? -1n : 1n) * absolute).toString()
      else if (revenue === 0n) result.effectTicks = '0'
    }
  }
  return result
}

const settlementTypes = [
  'Sale',
  'Return',
  'Discount',
  'DiscountCancel',
  'Coupon',
  'CouponCancel',
  'ProvisionPositive',
  'ProvisionNegative',
  'ManualRefund',
  'ManualRefundCancel',
  'TyDiscount',
  'TyDiscountCancel',
  'TyCoupon',
  'TyCouponCancel',
  'SellerRevenuePositive',
  'SellerRevenueNegative',
  'CommissionPositive',
  'CommissionNegative',
  'SellerRevenuePositiveCancel',
  'SellerRevenueNegativeCancel',
  'CommissionPositiveCancel',
  'CommissionNegativeCancel',
  'DeliveryFee',
  'DeliveryFeeCancel',
  'PayByLink',
]
const otherTypes = [
  'Stoppage',
  'CashAdvance',
  'WireTransfer',
  'IncomingTransfer',
  'ReturnInvoice',
  'CommissionAgreementInvoice',
  'PaymentOrder',
  'DeductionInvoices',
  'FinancialItem',
]

export class TrendyolMarketplace {
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext) {
    const seller = requireCredential(context.credentials, 'sellerId')
    if (!/^\d+$/.test(seller))
      throw new ProviderError('INVALID_SELLER', 'Satıcı ID sayısal olmalı.')
    return {
      seller: pathPart(seller),
      base:
        context.settings.environment === 'sandbox'
          ? 'https://stageapigw.trendyol.com/integration'
          : 'https://apigw.trendyol.com/integration',
      headers: {
        authorization: basicAuth(
          requireCredential(context.credentials, 'apiKey'),
          requireCredential(context.credentials, 'apiSecret'),
        ),
        'user-agent': `${seller} - ${context.integrationName}`,
      },
    }
  }
  private async details(
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    const { base, headers, seller } = this.api(context)
    const paymentOrderId = text(payload.paymentOrderId),
      sourceIndex = integer(payload.source),
      source = sourceIndex === 0 ? 'settlements' : 'otherfinancials',
      page = integer(payload.page)
    if (!/^\d+$/.test(paymentOrderId) || sourceIndex > 1)
      throw new ProviderError('INVALID_PAYMENT_ORDER', 'Geçerli ödeme emri seçin.')
    const params = new URLSearchParams({
      supplierId: seller,
      paymentOrderId,
      page: String(page),
      size: '500',
      transactionTypes: (source === 'settlements' ? settlementTypes : otherTypes).join(','),
    })
    const response = record(
      await this.http.request(`${base}/finance/che/sellers/${seller}/${source}?${params}`, {
        headers,
      }),
    )
    if (!Array.isArray(response.content))
      throw new ProviderError('INVALID_FINANCIAL_RESPONSE', 'Hakediş detayları okunamadı.')
    const documents = response.content.map((raw) => normalizeFinancial(raw, source))
    if (documents.some((d) => d.paymentOrderId !== paymentOrderId))
      throw new ProviderError(
        'PAYMENT_ORDER_MISMATCH',
        'Sağlayıcı başka bir ödeme emrine ait kayıt döndürdü.',
      )
    const records = documents.map((document) => ({
      id: `${source}:${document.externalId}`,
      resource: 'settlement' as const,
      data: { ...document },
    }))
    const next =
      page + 1 < integer(response.totalPages)
        ? { ...payload, page: page + 1 }
        : sourceIndex === 0
          ? { ...payload, source: 1, page: 0 }
          : undefined
    return {
      message: `${records.length} hakediş detayı alındı.`,
      records,
      ...(next ? { nextPayload: next, delaySeconds: 2 } : { financialDetails: { paymentOrderId } }),
    }
  }
  private async question(context: AdapterContext, id: string) {
    const { base, headers, seller } = this.api(context)
    const result = normalizeQuestion(
      await this.http.request(`${base}/qna/sellers/${seller}/questions/${pathPart(id)}`, {
        headers,
      }),
    )
    if (result.externalId !== id)
      throw new ProviderError('QUESTION_MISMATCH', 'Soru kimliği sağlayıcı yanıtıyla uyuşmuyor.')
    return result
  }
  private async claim(context: AdapterContext, id: string) {
    const { base, headers, seller } = this.api(context)
    const response = record(
      await this.http.request(
        `${base}/order/sellers/${seller}/claims?${new URLSearchParams({ claimIds: id, page: '0', size: '50' })}`,
        { headers },
      ),
    )
    const item = array(response.content).find(
      (raw) => text(record(raw).id ?? record(raw).claimId) === id,
    )
    if (!item) throw new ProviderError('CLAIM_NOT_FOUND', 'İade talebi sağlayıcıda bulunamadı.')
    return normalizeClaim(item)
  }
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    const { base, headers, seller } = this.api(context)
    if (operation === 'settlements.pull' && payload.paymentOrderId)
      return this.details(context, payload)
    if (operation === 'questions.pull' && payload.questionId) {
      const item = await this.question(context, text(payload.questionId))
      return {
        message: 'Soru durumu sağlayıcıdan alındı.',
        records: [{ id: item.externalId, resource: 'question', data: { ...item } }],
      }
    }
    if (operation === 'claims.pull' && payload.claimId) {
      const item = await this.claim(context, text(payload.claimId))
      return {
        message: 'İade durumu sağlayıcıdan alındı.',
        records: [{ id: item.externalId, resource: 'claim', data: { ...item } }],
      }
    }
    if (operation === 'questions.pull' || operation === 'claims.pull') {
      const to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - 14 * 86400000),
        page = integer(payload.page)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 14 * 86400000)
        throw new ProviderError(
          'INVALID_WINDOW',
          'Soru/iade sorgusu en fazla 14 günlük aralıkta yapılır.',
        )
      const query = new URLSearchParams({
        supplierId: seller,
        startDate: String(from),
        endDate: String(to),
        page: String(page),
        size: '50',
      })
      const endpoint =
        operation === 'questions.pull'
          ? `${base}/qna/sellers/${seller}/questions/filter`
          : `${base}/order/sellers/${seller}/claims`
      const response = record(await this.http.request(`${endpoint}?${query}`, { headers }))
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_RESPONSE', 'Soru/iade listesi beklenen biçimde değil.')
      const records = response.content.map((raw) => {
        if (operation === 'questions.pull') {
          const q = normalizeQuestion(raw)
          return { id: q.externalId, resource: 'question' as const, data: { ...q } }
        }
        const claim = normalizeClaim(raw)
        return { id: claim.externalId, resource: 'claim' as const, data: { ...claim } }
      })
      return {
        message: `${records.length} pazaryeri kaydı okundu.`,
        records,
        ...(page + 1 < integer(response.totalPages)
          ? { nextPayload: { ...payload, page: page + 1, from, to }, delaySeconds: 2 }
          : {}),
      }
    }
    if (operation === 'question.answer') {
      const questionId = text(payload.questionId),
        answer = text(payload.text).trim()
      if (!questionId || answer.length < 10 || answer.length > 2000)
        throw new ProviderError('INVALID_ANSWER', 'Yanıt 10–2000 karakter olmalı.')
      const current = await this.question(context, questionId)
      if (current.status === 'ANSWERED') {
        if (current.answer !== answer)
          throw new ProviderError(
            'ALREADY_ANSWERED',
            'Soru farklı bir yanıtla cevaplanmış; mevcut yanıt değiştirilmedi.',
          )
        return {
          message: 'Aynı yanıt sağlayıcıda zaten mevcut.',
          records: [{ id: questionId, resource: 'question', data: { ...current } }],
          marketplaceAction: {
            resource: 'question',
            externalId: questionId,
            answer,
            confirmed: true,
          },
        }
      }
      if (current.status !== 'WAITING_FOR_ANSWER')
        throw new ProviderError('QUESTION_CLOSED', 'Soru yanıt kabul edilen durumda değil.')
      if (current.text !== payload.questionText)
        throw new ProviderError(
          'QUESTION_CHANGED',
          'Soru metni değişmiş. Güncel soruyu okuyup yeniden yanıtlayın.',
        )
      await this.http.request(
        `${base}/qna/sellers/${seller}/questions/${pathPart(questionId)}/answers`,
        { method: 'POST', headers, json: { text: answer } },
      )
      return {
        message: 'Yanıt iletildi; sağlayıcı kontrolü sonrasında yayınlanır.',
        marketplaceAction: {
          resource: 'question',
          externalId: questionId,
          answer,
          confirmed: false,
        },
      }
    }
    if (operation === 'claim.decide') {
      if (payload.decision === 'reject') {
        const claimId = text(payload.claimId),
          ids = array(payload.itemIds).map(text),
          current = await this.claim(context, claimId),
          selected = ids.map((id) => current.items.find((item) => item.id === id))
        if (!ids.length || new Set(ids).size !== ids.length || selected.some((item) => !item))
          throw new ProviderError('CLAIM_ITEMS_REQUIRED', 'Bu talebin iade satırlarını seçin.')
        if (selected.every((item) => item?.status === 'Rejected'))
          return {
            message: 'Seçilen ret sonucu sağlayıcıda zaten mevcut.',
            records: [{ id: claimId, resource: 'claim', data: { ...current } }],
            marketplaceAction: {
              resource: 'claim',
              externalId: claimId,
              itemIds: ids,
              decision: 'reject',
              confirmed: true,
            },
          }
        if (selected.some((item) => item?.status !== 'WaitingInAction'))
          throw new ProviderError('CLAIM_CLOSED', 'Seçilen kalemler ret talebi beklemiyor.')
        const rules = await claimDecisionOptions(context, this.http)
        try {
          validateClaimDecision('trendyol', rules, {
            decision: 'reject',
            reasonId: text(payload.reasonId),
            description: text(payload.description),
            files: array(payload.files),
          })
        } catch (error) {
          if (error instanceof AppError) throw new ProviderError(error.code, error.message)
          throw error
        }
        const body = new FormData()
        body.append('claimIssueReasonId', text(payload.reasonId))
        body.append('claimItemIdList', ids.join(','))
        body.append('description', text(payload.description))
        for (const value of array(payload.files)) {
          const file = record(value)
          body.append(
            'files',
            new Blob([Buffer.from(text(file.data), 'base64')], { type: text(file.mime) }),
            text(file.name),
          )
        }
        await this.http.request(
          `${base}/order/sellers/${seller}/claims/${pathPart(claimId)}/issue`,
          { method: 'POST', headers, body },
        )
        return {
          message: 'Trendyol ret talebini aldı; değerlendirme sonucu sorgulanacak.',
          marketplaceAction: {
            resource: 'claim',
            externalId: claimId,
            itemIds: ids,
            decision: 'reject',
            confirmed: false,
          },
        }
      }
      if (payload.decision !== 'approve')
        throw new ProviderError('UNSUPPORTED_DECISION', 'Bu işlem iade onayı içindir.')
      const claimId = text(payload.claimId),
        ids = array(payload.itemIds).map(text)
      if (!claimId || !ids.length || ids.some((id) => !id) || new Set(ids).size !== ids.length)
        throw new ProviderError('CLAIM_ITEMS_REQUIRED', 'Onaylanacak iade satırlarını seçin.')
      const current = await this.claim(context, claimId),
        items = ids.map((id) => current.items.find((item) => item.id === id))
      if (items.some((item) => !item))
        throw new ProviderError(
          'CLAIM_ITEM_MISMATCH',
          'Seçilen satırlar bu iade talebine ait değil.',
        )
      if (items.every((item) => item!.status === 'Accepted'))
        return {
          message: 'İade satırları zaten onaylı.',
          records: [{ id: claimId, resource: 'claim', data: { ...current } }],
          marketplaceAction: {
            resource: 'claim',
            externalId: claimId,
            itemIds: ids,
            confirmed: true,
          },
        }
      if (items.some((item) => !['WaitingInAction', 'Accepted'].includes(item!.status)))
        throw new ProviderError(
          'CLAIM_NOT_ACTIONABLE',
          'İade satırlarından biri karar bekleyen durumda değil.',
        )
      const pending = items
        .filter((item) => item!.status === 'WaitingInAction')
        .map((item) => item!.id)
      await this.http.request(
        `${base}/order/sellers/${seller}/claims/${pathPart(claimId)}/items/approve`,
        { method: 'PUT', headers, json: { claimLineItemIdList: pending, params: {} } },
      )
      return {
        message: 'İade onayı iletildi; sonuç sağlayıcıdan kontrol edilecek.',
        marketplaceAction: {
          resource: 'claim',
          externalId: claimId,
          itemIds: ids,
          confirmed: false,
        },
      }
    }
    if (operation === 'settlements.pull') {
      const to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - 45 * 86400000)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 90 * 86400000)
        throw new ProviderError(
          'INVALID_WINDOW',
          'Finans sorgusu en fazla 90 günlük aralıkta başlatılabilir.',
        )
      const sources = ['settlements', 'otherfinancials', 'payment-order'] as const,
        sourceIndex = integer(payload.source),
        source = sources[sourceIndex],
        page = integer(payload.page),
        windowFrom = Number(payload.windowFrom ?? from),
        windowTo = Math.min(to, windowFrom + 14 * 86400000)
      if (!source) return { message: 'Pazaryeri finans kayıtları tamamlandı.' }
      const query = new URLSearchParams({
        page: String(page),
        size: source === 'payment-order' ? '10' : '500',
      })
      if (source !== 'payment-order') {
        query.set('supplierId', seller)
        query.set('startDate', String(windowFrom))
        query.set('endDate', String(windowTo))
        query.set(
          'transactionTypes',
          (source === 'settlements' ? settlementTypes : otherTypes).join(','),
        )
      }
      const response = record(
        await this.http.request(`${base}/finance/che/sellers/${seller}/${source}?${query}`, {
          headers,
        }),
      )
      if (!Array.isArray(response.content))
        throw new ProviderError('INVALID_FINANCIAL_RESPONSE', 'Finans listesi okunamadı.')
      const documents = response.content
        .map((raw) => normalizeFinancial(raw, source))
        .filter(
          (d) =>
            d.kind !== 'payout' ||
            (new Date(d.payoutDate!).getTime() >= from && new Date(d.payoutDate!).getTime() <= to),
        )
      const records = documents.map((document) => ({
        id: `${source}:${document.externalId}`,
        resource: 'settlement' as const,
        data: { ...document },
      }))
      const next =
        page + 1 < integer(response.totalPages)
          ? { ...payload, from, to, windowFrom, page: page + 1, source: sourceIndex }
          : source !== 'payment-order' && windowTo < to
            ? { from, to, windowFrom: windowTo, page: 0, source: sourceIndex }
            : sourceIndex < 2
              ? { from, to, windowFrom: from, page: 0, source: sourceIndex + 1 }
              : undefined
      return {
        message: `${records.length} finans kaydı alındı.`,
        records,
        ...(next ? { nextPayload: next, delaySeconds: 2 } : {}),
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu pazaryeri işlemi desteklenmiyor.')
  }
}
export function withTrendyolOperations(
  http: ProviderHttp,
  adapter: ProviderAdapter,
): ProviderAdapter {
  const operations: IntegrationOperation[] = [
    'questions.pull',
    'question.answer',
    'claims.pull',
    'claim.decide',
    'settlements.pull',
  ]
  return {
    capabilities: [...adapter.capabilities, ...operations],
    execute: (operation, context, payload) =>
      operations.includes(operation)
        ? new TrendyolMarketplace(http).execute(operation, context, payload)
        : adapter.execute(operation, context, payload),
  }
}
