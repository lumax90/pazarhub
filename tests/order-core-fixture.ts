import type { ExchangeRates } from '../src/domain/money'

export const orderCoreOwner = {
  name: 'Sipariş Sorumlusu',
  workspaceName: 'Ana Sipariş Testi',
  email: 'order-core@example.com',
  password: 'OrderCore1234',
}
export const orderCoreRates: ExchangeRates = {
  source: 'TCMB',
  date: '2026-10-23',
  fetchedAt: '2026-10-24T10:00:00Z',
  rates: {
    USD: {
      forexBuying: '3950000000',
      forexSelling: '4000000000',
      banknoteBuying: '3900000000',
      banknoteSelling: '4050000000',
    },
    EUR: {
      forexBuying: '4450000000',
      forexSelling: '4500000000',
      banknoteBuying: '4400000000',
      banknoteSelling: '4550000000',
    },
    GBP: {
      forexBuying: '4950000000',
      forexSelling: '5000000000',
      banknoteBuying: '4900000000',
      banknoteSelling: '5050000000',
    },
  },
}
