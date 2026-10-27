export const currencyCodes = [
  'TRY',
  'USD',
  'EUR',
  'GBP',
  'CHF',
  'JPY',
  'AUD',
  'CAD',
  'SEK',
  'NOK',
] as const
export type CurrencyCode = (typeof currencyCodes)[number]
export type ExchangeRateType = 'forexBuying' | 'forexSelling' | 'banknoteBuying' | 'banknoteSelling'
export interface ExchangeRates {
  date: string
  fetchedAt: string
  source: 'TCMB'
  rates: Partial<Record<CurrencyCode, Record<ExchangeRateType, string>>>
}
export function multiplyMoney(amount: number, numerator: bigint, denominator: bigint): number {
  if (!Number.isSafeInteger(amount) || denominator <= 0n) return NaN
  const sign = amount < 0 ? -1n : 1n,
    value = BigInt(Math.abs(amount)) * numerator
  const result = sign * ((value * 2n + denominator) / (denominator * 2n))
  return result <= BigInt(Number.MAX_SAFE_INTEGER) && result >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(result)
    : NaN
}
export function exchangeRate(
  rates: ExchangeRates | undefined,
  currency: CurrencyCode = 'TRY',
  type: ExchangeRateType = 'forexSelling',
) {
  if (currency === 'TRY') return '100000000'
  const rate = rates?.rates[currency]?.[type]
  return rate && /^\d+$/.test(rate) && BigInt(rate) > 0n ? rate : undefined
}
export function toTry(
  amount: number,
  currency: CurrencyCode = 'TRY',
  rates?: ExchangeRates,
  type: ExchangeRateType = 'forexSelling',
) {
  const rate = exchangeRate(rates, currency, type)
  return rate ? multiplyMoney(amount, BigInt(rate), 100000000n) : NaN
}
export function fromTry(
  amount: number,
  currency: CurrencyCode = 'TRY',
  rates?: ExchangeRates,
  type: ExchangeRateType = 'forexSelling',
) {
  const rate = exchangeRate(rates, currency, type)
  return rate ? multiplyMoney(amount, 100000000n, BigInt(rate)) : NaN
}
export const inclusivePrice = (net: number, taxRate: number) =>
  Number.isInteger(taxRate) ? multiplyMoney(net, BigInt(100 + taxRate), 100n) : NaN
export const exclusivePrice = (gross: number, taxRate: number) =>
  Number.isInteger(taxRate) ? multiplyMoney(gross, 100n, BigInt(100 + taxRate)) : NaN
export const currencyMoney = (amount: number, currency: CurrencyCode = 'TRY') =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100)
export function currencySnapshot(
  currency: CurrencyCode = 'TRY',
  rates?: ExchangeRates,
  type?: ExchangeRateType,
) {
  return currency === 'TRY'
    ? {}
    : {
        catalogCurrency: currency,
        catalogExchangeRate: exchangeRate(rates, currency, type),
        exchangeRateDate: rates?.date,
      }
}
