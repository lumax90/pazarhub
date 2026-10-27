import type { CargoProvider, MarketplaceProvider } from '../domain/integrations'

export type LogoProvider = MarketplaceProvider | CargoProvider

/** Local, verified brand assets; source URLs and hashes live in docs/provider-logo-sources.json. */
export const providerLogos: Record<LogoProvider, string> = {
  trendyol: '/brands/trendyol.png',
  hepsiburada: '/brands/hepsiburada.png',
  n11: '/brands/n11.png',
  amazon: '/brands/amazon.png',
  ciceksepeti: '/brands/ciceksepeti.png',
  pazarama: '/brands/pazarama.png',
  pttavm: '/brands/pttavm.png',
  toptantr: '/brands/toptantr.png',
  yurtici: '/brands/yurtici.png',
  dhl: '/brands/dhl.png',
  aras: '/brands/aras.png',
  ptt: '/brands/ptt.png',
}
