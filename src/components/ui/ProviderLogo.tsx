import { providerLogos } from '../../lib/provider-logos'
import type { LogoProvider } from '../../lib/provider-logos'

/** Decorative image: the existing wrapper owns dimensions and the adjacent label owns its name. */
export function ProviderLogo({ provider }: { provider: LogoProvider }) {
  return (
    <img
      src={providerLogos[provider]}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className="channel-icon-image"
      data-provider-logo={provider}
    />
  )
}
