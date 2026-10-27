import type { EcommerceSettings } from './types'

export const defaultEcommerceSettings: EcommerceSettings = {
  version: 0,
  pricesIncludeVat: true,
  exchangeRateType: 'forexSelling',
  defaultCurrency: 'TRY',
  defaultTaxRate: 20,
  defaultOrigin: 'TR',
  lowStock: 10,
  criticalStock: 3,
  allowNegativeStock: false,
  orderDays: 7,
  dueDays: 1,
  invoiceTiming: 'on_approval',
}
