import type { ProviderId } from '../../src/domain/integrations'
import { ProviderError } from '../errors'
import type { ProviderAdapter } from './contracts'
import { ProviderHttp } from './http'
import { TrendyolAdapter } from './trendyol'
import { N11Adapter } from './n11'
import { CiceksepetiAdapter } from './ciceksepeti'
import { HepsiburadaAdapter } from './hepsiburada'
import { AmazonAdapter } from './amazon'
import { ParasutAdapter } from './parasut'
import { YurticiAdapter, ArasAdapter, PttCargoAdapter } from './cargo'
import { DhlAdapter } from './dhl'
import { PttAvmAdapter } from './pttavm'
import { withPublishing } from '../publishing/registry'
import { withTrendyolOperations } from '../marketplace/trendyol'
import { PazaramaAdapter } from './pazarama'
import { ToptanTrAdapter } from './toptantr'
import { withOrderFulfillment } from '../order-fulfillment/registry'
import { withListingContent } from '../listing-content/registry'
import { withNativeQuestions } from '../marketplace/questions'
import { withNativeClaims } from '../marketplace/claims'
import { withHepsiburadaFinance } from '../marketplace/hepsiburada-finance'

export type AdapterFactory = (provider: ProviderId, http: ProviderHttp) => ProviderAdapter

const baseAdapter: AdapterFactory = (provider, http) => {
  if (provider === 'trendyol')
    return withOrderFulfillment(
      provider,
      http,
      withTrendyolOperations(http, withPublishing(provider, http, new TrendyolAdapter(http))),
    )
  if (provider === 'n11')
    return withOrderFulfillment(
      provider,
      http,
      withPublishing(provider, http, new N11Adapter(http)),
    )
  if (provider === 'ciceksepeti')
    return withOrderFulfillment(
      provider,
      http,
      withPublishing(provider, http, new CiceksepetiAdapter(http)),
    )
  if (provider === 'hepsiburada')
    return withOrderFulfillment(
      provider,
      http,
      withPublishing(provider, http, new HepsiburadaAdapter(http)),
    )
  if (provider === 'amazon')
    return withOrderFulfillment(
      provider,
      http,
      withPublishing(provider, http, new AmazonAdapter(http)),
    )
  if (provider === 'parasut') return new ParasutAdapter(http)
  if (provider === 'yurtici') return new YurticiAdapter(http)
  if (provider === 'aras') return new ArasAdapter(http)
  if (provider === 'ptt') return new PttCargoAdapter(http)
  if (provider === 'dhl') return new DhlAdapter(http)
  if (provider === 'pttavm')
    return withOrderFulfillment(
      provider,
      http,
      withPublishing(provider, http, new PttAvmAdapter(http)),
    )
  if (provider === 'pazarama')
    return withOrderFulfillment(
      provider,
      http,
      withPublishing(provider, http, new PazaramaAdapter(http)),
    )
  if (provider === 'toptantr')
    return withOrderFulfillment(
      provider,
      http,
      withPublishing(provider, http, new ToptanTrAdapter(http)),
    )
  return {
    capabilities: [],
    execute: async () => {
      throw new ProviderError(
        'CONTRACT_NOT_READY',
        'Bu sağlayıcının API sözleşmesi ve hesap erişimi henüz doğrulanmadı. Bağlantı başarılı olarak gösterilmez.',
      )
    },
  }
}
export const createAdapter: AdapterFactory = (provider, http) =>
  withHepsiburadaFinance(
    http,
    provider,
    withNativeClaims(
      http,
      provider,
      withNativeQuestions(
        http,
        provider,
        withListingContent(provider, http, baseAdapter(provider, http)),
      ),
    ),
  )
