import { supportsPublishing } from '../../src/domain/publishing'
import type { AdapterContext, AdapterResult, ProviderAdapter } from '../integrations/contracts'
import { integer, text } from '../integrations/contracts'
import type { ProviderId, IntegrationOperation } from '../../src/domain/integrations'
import { ProviderError } from '../errors'
import type { ProviderHttp } from '../integrations/http'
import type { PublicationAdapter, PublicationPlan } from './types'
import { TrendyolPublisher } from './trendyol'
import { N11Publisher } from './n11'
import { AmazonPublisher } from './amazon'
import { CiceksepetiPublisher } from './ciceksepeti'
import { PazaramaPublisher } from './pazarama'
import { HepsiburadaPublisher } from './hepsiburada'
import { ToptanTrPublisher } from './toptantr'
import { PttAvmPublisher } from './pttavm'

export function publisher(provider: string, http: ProviderHttp): PublicationAdapter {
  if (provider === 'trendyol') return new TrendyolPublisher(http)
  if (provider === 'n11') return new N11Publisher(http)
  if (provider === 'amazon') return new AmazonPublisher(http)
  if (provider === 'ciceksepeti') return new CiceksepetiPublisher(http)
  if (provider === 'pazarama') return new PazaramaPublisher(http)
  if (provider === 'hepsiburada') return new HepsiburadaPublisher(http)
  if (provider === 'toptantr') return new ToptanTrPublisher(http)
  if (provider === 'pttavm') return new PttAvmPublisher(http)
  throw new ProviderError(
    'PUBLISHING_UNAVAILABLE',
    'Bu sağlayıcının yeni ürün yayınlama akışı henüz açık değil.',
  )
}
async function executePublication(
  provider: ProviderId,
  http: ProviderHttp,
  operation: IntegrationOperation,
  context: AdapterContext,
  payload: Record<string, unknown>,
): Promise<AdapterResult> {
  const plan = payload.plan as PublicationPlan | undefined
  if (!plan || plan.provider !== provider || !plan.listingId)
    throw new ProviderError('INVALID_PUBLICATION_PLAN', 'Kaydedilmiş yayın önizlemesi bulunamadı.')
  const adapter = publisher(provider, http)
  if (operation === 'listing.publish') {
    const reference = await adapter.submit(context, plan)
    return {
      message: 'Ürün isteği sağlayıcıya ulaştı; yayın onayı ayrı izleniyor.',
      reference,
      publication: {
        listingId: plan.listingId,
        state: { phase: 'submitted', reference, submittedAt: new Date().toISOString() },
        plan,
        members: plan.group
          ?.filter((member) => member.listingId !== plan.listingId)
          .map((member) => ({
            listingId: member.listingId,
            state: { phase: 'submitted', reference, submittedAt: new Date().toISOString() },
          })),
      },
    }
  }
  const reference = text(payload.reference)
  if (!reference && !payload.reconcile)
    throw new ProviderError(
      'REFERENCE_REQUIRED',
      'Yayın durumu için sağlayıcı işlem numarası gerekli.',
    )
  const inspection = await adapter.inspect(
    context,
    plan,
    reference,
    text(payload.phase) || undefined,
  )
  if (payload.reconcile) {
    const complete =
      !plan.group ||
      plan.group.every((member) =>
        member.listingId === plan.listingId
          ? !!inspection.externalId
          : inspection.members?.some(
              (result) => result.listingId === member.listingId && !!result.externalId,
            ),
      )
    if (inspection.externalId && complete) {
      inspection.state.reconciledByIdentity = true
      for (const member of inspection.members ?? []) member.state.reconciledByIdentity = true
    } else {
      inspection.state = {
        phase: 'uncertain',
        message: 'Uzak ürün henüz doğrulanamadı; yeni oluşturma isteği gönderilmedi.',
      }
      inspection.externalId = undefined
      inspection.members = plan.group
        ?.filter((member) => member.listingId !== plan.listingId)
        .map((member) => ({ listingId: member.listingId, state: { ...inspection.state } }))
    }
  }
  const again = inspection.again && integer(payload.polls) < 120
  return {
    message: inspection.state.message ?? 'Yayın durumu alındı.',
    reference,
    publication: {
      listingId: plan.listingId,
      state: { ...inspection.state, checkedAt: new Date().toISOString() },
      externalId: inspection.externalId,
      attributes: inspection.attributes,
      plan,
      members: inspection.members,
    },
    ...(again
      ? {
          nextPayload: { ...payload, phase: inspection.phase, polls: integer(payload.polls) + 1 },
          delaySeconds:
            inspection.pollAfterSeconds ?? (inspection.state.phase === 'submitted' ? 15 : 60),
        }
      : {}),
    ...(inspection.state.phase === 'rejected'
      ? {
          failure: {
            code: 'PUBLICATION_REJECTED',
            message: inspection.state.message ?? 'Sağlayıcı ürünü reddetti.',
          },
        }
      : {}),
  }
}
export function withPublishing(
  provider: ProviderId,
  http: ProviderHttp,
  adapter: ProviderAdapter,
): ProviderAdapter {
  if (!supportsPublishing(provider)) return adapter
  return {
    capabilities: [...adapter.capabilities, 'listing.publish', 'listing.status'],
    execute: (operation, context, payload) =>
      operation === 'listing.publish' || operation === 'listing.status'
        ? executePublication(provider, http, operation, context, payload)
        : adapter.execute(operation, context, payload),
  }
}
