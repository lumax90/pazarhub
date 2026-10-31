import type { FinancialRecord } from '../../src/domain/marketplace'
import { decimalTicks } from '../../src/domain/marketplace'
import type { AdapterResult, ProviderAdapter } from '../integrations/contracts'
import { record, text, remoteInteger } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { hepsiburadaHeaders } from '../integrations/hepsiburada'
import { ProviderError } from '../errors'

function money(value: unknown) {
  const field = record(value)
  if (!['949', 'TRY'].includes(text(field.currencyCode)))
    throw new ProviderError('UNSUPPORTED_CURRENCY', 'Hepsiburada finans kaydı TRY olmalı.')
  try {
    return decimalTicks(field.value)
  } catch {
    throw new ProviderError(
      'INVALID_FINANCIAL_AMOUNT',
      'Hepsiburada finans tutarı dört ondalık kesinliğinde okunamadı.',
    )
  }
}
export function normalizeHepsiburadaFinancial(raw: unknown, merchantId: string): FinancialRecord {
  const item = record(raw),
    id = text(item.id)
  if (
    !id ||
    text(item.merchantId) !== merchantId ||
    typeof item.isIncome !== 'boolean' ||
    !text(item.transactionType)
  )
    throw new ProviderError(
      'FINANCIAL_IDENTITY_MISMATCH',
      'Hepsiburada finans kaydının mağaza, kimlik veya yön alanı eksik.',
    )
  const amount = BigInt(money(item.amount)),
    absolute = amount < 0n ? -amount : amount
  const type = text(item.transactionType),
    effect = (item.isIncome ? absolute : -absolute).toString()
  const stamp =
    text(item.invoiceDate) || text(item.orderDate) || text(item.paymentDate) || text(item.dueDate)
  if (stamp && !Number.isFinite(Date.parse(stamp)))
    throw new ProviderError('INVALID_FINANCIAL_DATE', 'Hepsiburada kayıt tarihi okunamadı.')
  return {
    kind: 'entry',
    source: 'settlements',
    externalId: id,
    transactionType: `HB.${type}`,
    transactionDate: stamp
      ? new Date(
          /Z$|[+-]\d\d:\d\d$/.test(stamp)
            ? stamp
            : `${stamp.slice(0, 10)}T${stamp.includes('T') ? stamp.split('T')[1] : '00:00:00'}+03:00`,
        ).toISOString()
      : null,
    orderNumber: text(item.orderNumber) || undefined,
    packageId: text(item.packageNumber) || undefined,
    description: [text(item.invoiceNumber), text(item.invoiceExplanation), text(item.productName)]
      .filter(Boolean)
      .join(' · '),
    debitTicks: item.isIncome ? '0' : absolute.toString(),
    creditTicks: item.isIncome ? absolute.toString() : '0',
    effectTicks: type === 'TotalPayment' ? null : effect,
    commissionTicks: type === 'Commission' ? absolute.toString() : null,
    status: text(item.status),
  }
}
export function withHepsiburadaFinance(
  http: ProviderHttp,
  provider: string,
  adapter: ProviderAdapter,
): ProviderAdapter {
  if (provider !== 'hepsiburada') return adapter
  return {
    capabilities: [...adapter.capabilities, 'settlements.pull'],
    execute: async (operation, context, payload): Promise<AdapterResult> => {
      if (operation !== 'settlements.pull') return adapter.execute(operation, context, payload)
      if (payload.paymentOrderId)
        throw new ProviderError(
          'PAYOUT_DETAILS_UNAVAILABLE',
          'Hepsiburada muhasebe API’si kayıt bazlıdır; ödeme emri detayı sunmuyor.',
        )
      const to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - 31 * 86400000),
        offset = remoteInteger(payload.offset, 0)
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from > to ||
        to - from > 31 * 86400000 ||
        offset < 0
      )
        throw new ProviderError('INVALID_WINDOW', 'Finans sorgusu en fazla 31 gün olmalı.')
      const merchant = requireCredential(context.credentials, 'merchantId'),
        base = `https://mpfinance-external${context.settings.environment === 'sandbox' ? '-sit' : ''}.hepsiburada.com`
      const query = new URLSearchParams({
        Offset: String(offset),
        Limit: '100',
        RecordDateStart: new Date(from).toISOString(),
        RecordDateEnd: new Date(to).toISOString(),
      })
      const response = record(
        await http.request(
          `${base}/transactions/merchantid/${encodeURIComponent(merchant)}?${query}`,
          {
            headers: hepsiburadaHeaders(context),
          },
        ),
      )
      if (!Array.isArray(response.items))
        throw new ProviderError(
          'INVALID_FINANCIAL_RESPONSE',
          'Hepsiburada muhasebe kayıtları okunamadı.',
        )
      const records = response.items
        .map((item) => normalizeHepsiburadaFinancial(item, merchant))
        .map((document) => ({
          id: `hb:${document.externalId}`,
          resource: 'settlement' as const,
          data: { ...document },
        }))
      return {
        message: `${records.length} Hepsiburada muhasebe kaydı alındı.`,
        records,
        ...(response.items.length === 100
          ? { nextPayload: { ...payload, from, to, offset: offset + 100 }, delaySeconds: 2 }
          : {}),
      }
    },
  }
}
