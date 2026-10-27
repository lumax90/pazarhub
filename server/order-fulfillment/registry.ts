import type { ProviderId } from '../../src/domain/integrations'
import type { OrderFulfillmentPlan } from '../../src/domain/order-fulfillment'
import type { ProviderAdapter } from '../integrations/contracts'
import type { ProviderHttp } from '../integrations/http'
import { ProviderError } from '../errors'
import { HepsiburadaFulfillment } from './hepsiburada'
import { TrendyolFulfillment } from './trendyol'
import { fulfillmentLocalKey } from './contracts'
import { fulfillmentProviders } from '../../src/domain/order-fulfillment'
import { ToptanTrFulfillment } from './toptantr'
import { PttAvmFulfillment } from './pttavm'
import { AmazonFulfillment } from './amazon'
import { N11Fulfillment } from './n11'
import { CiceksepetiFulfillment } from './ciceksepeti'
import { PazaramaFulfillment } from './pazarama'

export function orderFulfillment(provider: string, http: ProviderHttp) {
  if (provider === 'hepsiburada') return new HepsiburadaFulfillment(http)
  if (provider === 'trendyol') return new TrendyolFulfillment(http)
  if (provider === 'toptantr') return new ToptanTrFulfillment(http)
  if (provider === 'pttavm') return new PttAvmFulfillment(http)
  if (provider === 'amazon') return new AmazonFulfillment(http)
  if (provider === 'n11') return new N11Fulfillment(http)
  if (provider === 'ciceksepeti') return new CiceksepetiFulfillment(http)
  if (provider === 'pazarama') return new PazaramaFulfillment(http)
  throw new ProviderError(
    'FULFILLMENT_UNAVAILABLE',
    'Bu sağlayıcının paket işlemleri henüz kullanıma açık değil.',
  )
}
export function withOrderFulfillment(
  provider: ProviderId,
  http: ProviderHttp,
  adapter: ProviderAdapter,
): ProviderAdapter {
  if (!fulfillmentProviders.some((item) => item === provider)) return adapter
  return {
    capabilities: [...adapter.capabilities, 'order.fulfillment', 'order.fulfillment.status'],
    execute: async (operation, context, payload) => {
      if (!['order.fulfillment', 'order.fulfillment.status'].includes(operation))
        return adapter.execute(operation, context, payload)
      const plan = payload.plan as OrderFulfillmentPlan | undefined
      const order = context.state.orders.find(
        (item) => item.id === plan?.orderId && item.storeId === context.connectionId,
      )
      if (!plan || !order || order.externalId !== plan.externalId)
        throw new ProviderError('ORDER_IDENTITY_MISMATCH', 'Pazaryeri sipariş planı bulunamadı.')
      const checking = operation === 'order.fulfillment.status' || payload.verify === true
      if (!checking && (order.syncError || fulfillmentLocalKey(order) !== plan.localKey))
        throw new ProviderError(
          'FULFILLMENT_STALE',
          'Sipariş kalemleri değişti. Gönderimden önce uzlaştırın.',
        )
      return orderFulfillment(provider, http).execute(context, order, plan, checking, payload)
    },
  }
}
