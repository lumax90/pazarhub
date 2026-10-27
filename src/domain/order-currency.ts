import type { Order, OrderLine } from './types'
import { multiplyMoney } from './money'

export const orderCurrencies = ['TRY', 'USD', 'EUR', 'GBP'] as const
export const foreignOrder = (order: Pick<Order, 'currency'>) =>
  !!order.currency && order.currency !== 'TRY'
export const orderLineCurrencyTotal = (order: Pick<Order, 'currency'>, line: OrderLine) =>
  foreignOrder(order)
    ? (line.currencyTotal ?? NaN)
    : (line.lineTotalOverride ?? line.quantity * line.unitPrice)
export const orderCurrencyShipping = (
  order: Pick<Order, 'currency' | 'currencyShipping' | 'shipping'>,
) => (foreignOrder(order) ? (order.currencyShipping ?? NaN) : order.shipping)
export const orderCurrencyTotal = (
  order: Pick<Order, 'currency' | 'currencyShipping' | 'shipping' | 'lines' | 'totalOverride'>,
) =>
  foreignOrder(order)
    ? order.lines.reduce((sum, line) => sum + orderLineCurrencyTotal(order, line), 0) +
      orderCurrencyShipping(order)
    : (order.totalOverride ??
      order.lines.reduce((sum, line) => sum + orderLineCurrencyTotal(order, line), 0) +
        order.shipping)
export const orderLineCurrencyPrice = (order: Pick<Order, 'currency'>, line: OrderLine) =>
  foreignOrder(order) ? (line.currencyUnitPrice ?? NaN) : line.unitPrice
export function orderRateToTry(order: Pick<Order, 'currency' | 'currencyRate'>, amount: number) {
  if (!foreignOrder(order)) return amount
  const rate = order.currencyRate?.value
  return rate && /^\d+$/.test(rate) && BigInt(rate) > 0n
    ? multiplyMoney(amount, BigInt(rate), 100000000n)
    : NaN
}
