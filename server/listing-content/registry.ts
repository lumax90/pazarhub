import type { ProviderId } from '../../src/domain/integrations'
import { contentDefinitions } from '../../src/domain/listing-content'
import type { ProviderAdapter } from '../integrations/contracts'
import type { ProviderHttp } from '../integrations/http'
import { ListingContentAdapter } from './adapters'
import type { ContentPlan } from './contracts'
import { contentLocalKey, contentMatches } from './contracts'
import { ProviderError } from '../errors'

export function withListingContent(
  provider: ProviderId,
  http: ProviderHttp,
  adapter: ProviderAdapter,
): ProviderAdapter {
  if (!Object.hasOwn(contentDefinitions, provider)) return adapter
  return {
    capabilities: [...adapter.capabilities, 'listing.content', 'listing.content.status'],
    execute: async (operation, context, payload) => {
      if (!['listing.content', 'listing.content.status'].includes(operation))
        return adapter.execute(operation, context, payload)
      const plan = payload.plan as ContentPlan | undefined,
        listing = context.state.listings.find(
          (item) => item.id === plan?.listingId && item.storeId === context.connectionId,
        )
      if (!plan || !listing || plan.provider !== provider)
        throw new ProviderError(
          'CONTENT_PLAN_REQUIRED',
          'İçerik önizlemesi veya ilan ilişkisi bulunamadı.',
        )
      const content = new ListingContentAdapter(http)
      if (operation === 'listing.content' && !payload.verify) {
        if (contentLocalKey(context.state, listing) !== plan.localKey)
          throw new ProviderError(
            'CONTENT_STALE',
            'İlan veya ürün kartı değişti. Güncel içerik önizlemesi hazırlayın.',
          )
        const current = await content.read(context, listing)
        if (current.key !== plan.source.key)
          throw new ProviderError('CONTENT_IDENTITY_CHANGED', 'İlanın uzak içerik kimliği değişti.')
        if (contentMatches(current, plan.changes, contentDefinitions[listing.channel]?.imageSlots))
          return {
            message: 'İstenen içerik sağlayıcıda zaten doğrulandı.',
            contentUpdate: {
              listingId: listing.id,
              state: 'applied',
              message: 'İstenen içerik sağlayıcıda zaten doğrulandı.',
              resourceKey: current.key,
              changes: plan.changes,
            },
          }
        if (current.fingerprint !== plan.source.fingerprint)
          throw new ProviderError(
            'CONTENT_STALE',
            'Pazaryeri içeriği önizlemeden sonra değişti. Güncel kaydı açın.',
          )
        const reference = await content.send(context, plan)
        return {
          message: 'İçerik güncellemesi kabul edildi; alanların sonucu izleniyor.',
          reference,
          contentUpdate: {
            listingId: listing.id,
            state: 'pending',
            message: 'Sağlayıcı içerik güncellemesini işliyor.',
            resourceKey: current.key,
            changes: plan.changes,
          },
          nextPayload: { ...payload, reference, verify: true, polls: 0 },
          delaySeconds: provider === 'ciceksepeti' ? 601 : 20,
        }
      }
      const update = await content.inspect(context, listing, plan, String(payload.reference ?? ''))
      if (!update) throw new ProviderError('CONTENT_RESULT_REQUIRED', 'İçerik sonucu alınamadı.')
      return {
        message: update.message,
        contentUpdate: update,
        reference: String(payload.reference ?? ''),
        ...(update.state === 'pending'
          ? {
              nextPayload: { ...payload, verify: true, polls: Number(payload.polls ?? 0) + 1 },
              delaySeconds: provider === 'ciceksepeti' ? 601 : 60,
            }
          : {}),
        ...(update.state === 'rejected'
          ? { failure: { code: 'CONTENT_REJECTED', message: update.message } }
          : {}),
      }
    },
  }
}
