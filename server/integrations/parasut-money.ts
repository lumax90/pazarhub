import type { Order } from '../../src/domain/types'
import {
  foreignOrder,
  orderCurrencyShipping,
  orderCurrencyTotal,
  orderRateToTry,
} from '../../src/domain/order-currency'
import { lineTotal } from '../../src/domain/selectors'
import { ProviderError } from '../errors'
import { cents, text } from './contracts'

export function parasutCurrencyAttributes(order: Order) {
  const currency = order.currency ?? 'TRY',
    total = orderCurrencyTotal(order)
  if (!['TRY', 'USD', 'EUR', 'GBP'].includes(currency) || !Number.isSafeInteger(total))
    throw new ProviderError(
      'INVOICE_CURRENCY_REQUIRED',
      'Fatura para birimi veya döviz kalemleri doğrulanamadı.',
    )
  if (!foreignOrder(order)) return { currency: 'TRL' }
  if (
    !order.currencyRate?.value ||
    orderRateToTry(order, orderCurrencyShipping(order)) !== order.shipping ||
    order.lines.some((line) => orderRateToTry(order, line.currencyTotal ?? NaN) !== lineTotal(line))
  )
    throw new ProviderError(
      'INVOICE_RATE_MISMATCH',
      'Siparişin dondurulmuş kuru ve TRY karşılıkları uyuşmuyor.',
    )
  return { currency, exchange_rate: Number(order.currencyRate.value) / 100000000 }
}
export function parasutMoneyMatches(
  order: Order,
  attributes: Record<string, unknown>,
  requireCurrency = false,
) {
  const expected = parasutCurrencyAttributes(order),
    actualCurrency = text(attributes.currency)
  if (
    (requireCurrency || foreignOrder(order) || actualCurrency) &&
    ![expected.currency, expected.currency === 'TRL' ? 'TRY' : expected.currency].includes(
      actualCurrency,
    )
  )
    return false
  const amount = cents(attributes.net_total)
  if (!Number.isSafeInteger(amount) || Math.abs(amount - orderCurrencyTotal(order)) > 1)
    return false
  if (foreignOrder(order)) {
    const actualRate = Number(attributes.exchange_rate)
    if (
      !Number.isFinite(actualRate) ||
      actualRate <= 0 ||
      actualRate.toFixed(8) !== (Number(order.currencyRate!.value) / 100000000).toFixed(8)
    )
      return false
  }
  return true
}
