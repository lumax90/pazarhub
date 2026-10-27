export interface MarketplaceQuestion {
  kind: 'question'
  externalId: string
  text: string
  productName: string
  customerName: string
  status: string
  createdAt: string | null
  answer?: string
  rejectedAnswer?: string
  rejectedAt?: string
  rejectionReason?: string
  imageUrl?: string
  productUrl?: string
}
export interface MarketplaceClaimItem {
  id: string
  orderLineId: string
  productName: string
  barcode: string
  sku: string
  status: string
  reason: string
  customerNote: string
  amount: number | null
  quantity?: number
}
export interface MarketplaceClaim {
  kind: 'claim'
  externalId: string
  orderNumber: string
  createdAt: string | null
  items: MarketplaceClaimItem[]
  trackingNumber?: string
  claimType?: 'return' | 'exchange'
}
export interface FinancialRecord {
  kind: 'entry' | 'payout'
  externalId: string
  source: 'settlements' | 'otherfinancials' | 'payment-order'
  transactionType: string
  transactionDate: string | null
  orderNumber?: string
  packageId?: string
  paymentOrderId?: string
  barcode?: string
  description?: string
  /** Exact 1/10,000 TRY units, encoded as decimal integer strings. */
  debitTicks?: string | null
  creditTicks?: string | null
  commissionTicks?: string | null
  revenueTicks?: string | null
  amountTicks?: string
  /** Net effect on the merchant balance, only when the provider fields establish its direction. */
  effectTicks?: string | null
  status?: string
  payoutDate?: string
}
export interface RemoteWorkflow {
  state: 'queued' | 'pending' | 'confirmed' | 'rejected' | 'uncertain' | 'failed'
  jobId: string
  message?: string
  answer?: string
  claimItemIds?: string[]
  decision?: ClaimDecision
  updatedAt: string
  requestedAt?: string
}
export type ClaimDecision = 'approve' | 'reject' | 'investigate'
export interface ClaimDecisionOptions {
  decisions: ClaimDecision[]
  reasons: { id: string; label: string }[]
  reviewTypes: { id: string; label: string }[]
  descriptionRequired: boolean
  filesAllowed: boolean
  imagesOnly: boolean
  reviewDaysRequired?: boolean
}
export const workflowBusy = (workflow: RemoteWorkflow | null | undefined) =>
  !!workflow && ['queued', 'pending', 'uncertain'].includes(workflow.state)
export interface MarketplaceRecord<T> {
  id: string
  connectionId: string
  connectionName: string
  provider: string
  externalId: string
  document: T
  workflow: RemoteWorkflow | null
  seenAt: string
  localOrderId?: string | null
}
export interface SettlementMatch {
  id: string
  connectionId: string
  paymentOrderId: string
  cashEntryId: string
  amount: number
  matchedAt: string
}

export function decimalTicks(value: unknown): string {
  const string = String(value ?? '').trim(),
    match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(string)
  if (!match) throw new Error('Finansal değer en fazla dört ondalık basamaklı olmalı.')
  const ticks = BigInt(match[2]) * 10000n + BigInt((match[3] ?? '').padEnd(4, '0'))
  return (match[1] ? -ticks : ticks).toString()
}
export function ticksToCents(ticks: string): number {
  const amount = BigInt(ticks),
    absolute = amount < 0n ? -amount : amount
  const cents = ((absolute + 50n) / 100n) * (amount < 0n ? -1n : 1n),
    value = Number(cents)
  if (!Number.isSafeInteger(value)) throw new Error('Finansal toplam sayı sınırını aştı.')
  return value
}
export function sumTicks(values: (string | null | undefined)[]) {
  return values.reduce<bigint>((sum, value) => sum + BigInt(value ?? '0'), 0n).toString()
}

export const financialTypeLabels: Record<string, string> = {
  'HB.Payment': 'HB satış tutarı',
  'HB.Return': 'HB iade tutarı',
  'HB.Commission': 'HB komisyon',
  'HB.CommissionRefund': 'HB komisyon iadesi',
  'HB.CommissionInvoiceRefund': 'HB komisyon fatura iadesi',
  'HB.ShipmentCostSharingExpense': 'HB kargo katkı payı',
  'HB.ProcessingFeeExpense': 'HB hizmet bedeli',
  'HB.DeliveryProcessingFee': 'HB işlem bedeli',
  'HB.Stoppage': 'HB stopaj',
  'HB.TotalPayment': 'HB toplam ödeme kaydı',
  Sale: 'Satış',
  Return: 'İade',
  Discount: 'İndirim',
  DiscountCancel: 'İndirim iptali',
  Coupon: 'Kupon',
  CouponCancel: 'Kupon iptali',
  ProvisionPositive: 'Provizyon +',
  ProvisionNegative: 'Provizyon −',
  ManualRefund: 'Kısmi iade',
  ManualRefundCancel: 'Kısmi iade iptali',
  TyDiscount: 'TY promosyon',
  TyDiscountCancel: 'TY promosyon iptali',
  TyCoupon: 'TY kupon',
  TyCouponCancel: 'TY kupon iptali',
  SellerRevenuePositive: 'Hakediş pozitif düzeltme',
  SellerRevenueNegative: 'Hakediş negatif düzeltme',
  CommissionPositive: 'Komisyon pozitif düzeltme',
  CommissionNegative: 'Komisyon negatif düzeltme',
  SellerRevenuePositiveCancel: 'Hakediş pozitif düzeltme iptal',
  SellerRevenueNegativeCancel: 'Hakediş negatif düzeltme iptal',
  CommissionPositiveCancel: 'Komisyon pozitif düzeltme iptal',
  CommissionNegativeCancel: 'Komisyon negatif düzeltme iptal',
  DeliveryFee: 'Teslimat ücreti',
  DeliveryFeeCancel: 'Teslimat ücreti iptali',
  PayByLink: 'Pay by Link',
  PaymentOrder: 'Ödeme',
  Stoppage: 'Stopaj',
  CashAdvance: 'Erken ödeme',
  WireTransfer: 'Virman',
  IncomingTransfer: 'Gelen havale',
  ReturnInvoice: 'İade faturası',
  CommissionAgreementInvoice: 'Komisyon mutabakat faturası',
  DeductionInvoices: 'Hizmet faturası',
  FinancialItem: 'Finansal düzeltme',
}

export function financialBreakdown(records: FinancialRecord[]) {
  const entries = records.filter((r) => r.kind === 'entry')
  const balanceEntries = entries.filter((r) => r.transactionType !== 'PaymentOrder')
  const groups = [...new Set(entries.map((r) => `${r.source}:${r.transactionType}`))].map((id) => {
    const items = entries.filter((r) => `${r.source}:${r.transactionType}` === id)
    return {
      id,
      type: items[0].transactionType,
      count: items.length,
      debitTicks: sumTicks(items.map((r) => r.debitTicks)),
      creditTicks: sumTicks(items.map((r) => r.creditTicks)),
      effectTicks: items.some((r) => r.effectTicks == null)
        ? null
        : sumTicks(items.map((r) => r.effectTicks)),
    }
  })
  const unknownCount = balanceEntries.filter((r) => r.effectTicks == null).length
  return {
    entryCount: entries.length,
    unknownCount,
    netTicks: unknownCount ? null : sumTicks(balanceEntries.map((r) => r.effectTicks)),
    groups,
  }
}
export type FinancialBreakdown = ReturnType<typeof financialBreakdown>
export const questionStatusLabels: Record<string, string> = {
  WAITING_FOR_ANSWER: 'Yanıt bekliyor',
  ANSWERED: 'Yanıtlandı',
  REJECTED: 'Yanıt reddedildi',
  REPORTED: 'Bildirildi',
  UNANSWERED: 'Süresi doldu',
  ON_REVIEW: 'Onay bekliyor',
}
export const claimStatusLabels: Record<string, string> = {
  Created: 'İade açıldı',
  WaitingInAction: 'Karar bekliyor',
  WaitingFraudCheck: 'Kontrol ediliyor',
  Accepted: 'Onaylandı',
  Rejected: 'Reddedildi',
  RejectedBySeller: 'Ret talebi incelemede',
  Cancelled: 'İptal edildi',
  Unresolved: 'Çözümlenmedi',
  InAnalysis: 'İnceleniyor',
  AwaitingPreApproval: 'Ön onay bekliyor',
  NewRequest: 'Yeni talep',
}
