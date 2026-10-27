import type { CategorySchema, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import { array, record, text, pathPart } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { accessToken } from '../integrations/oauth'
import { AMAZON_TR } from '../integrations/amazon'
import { ProviderError } from '../errors'
import type { PreparedListing, PublicationAdapter, PublicationPlan, Inspection } from './types'
import { failureMessages, failField } from './shared'

export class AmazonPublisher implements PublicationAdapter {
  readonly provider = 'amazon' as const
  constructor(private readonly http: ProviderHttp) {}
  private async api(context: AdapterContext) {
    const token = await accessToken(context, this.http, 'https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      refresh_token: requireCredential(context.credentials, 'refreshToken'),
      client_id: requireCredential(context.credentials, 'clientId'),
      client_secret: requireCredential(context.credentials, 'clientSecret'),
    })
    return {
      base:
        context.settings.environment === 'sandbox'
          ? 'https://sandbox.sellingpartnerapi-eu.amazon.com'
          : 'https://sellingpartnerapi-eu.amazon.com',
      seller: pathPart(requireCredential(context.credentials, 'sellerId')),
      headers: { 'x-amz-access-token': token, 'user-agent': `${context.integrationName}/0.3` },
    }
  }
  async metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    if (query.resource !== 'asin')
      throw new ProviderError(
        'UNSUPPORTED_METADATA',
        'Amazon mevcut ASIN’e teklif akışını kullanır.',
      )
    const value = query.query?.trim().toUpperCase()
    if (!value || !/^[A-Z0-9]{10}$/.test(value)) return { options: [] }
    const { base, headers } = await this.api(context)
    const response = record(
      await this.http.request(
        `${base}/catalog/2022-04-01/items/${pathPart(value)}?marketplaceIds=${AMAZON_TR}&includedData=summaries,images`,
        { headers },
      ),
    )
    const summary = array(response.summaries)
      .map(record)
      .find((item) => item.marketplaceId === AMAZON_TR)
    if (text(response.asin) !== value || !summary)
      throw new ProviderError('ASIN_NOT_FOUND', 'ASIN Türkiye kataloğunda doğrulanamadı.')
    const image = record(array(record(array(response.images)[0]).images)[0])
    return {
      options: [
        {
          id: value,
          name: text(summary.itemName) || value,
          image: text(image.link) || undefined,
          path: text(summary.brand) || undefined,
        },
      ],
    }
  }
  build(
    _context: AdapterContext,
    item: PreparedListing,
    _schema: CategorySchema | null,
  ): Record<string, unknown> {
    if (!item.config.asin || !/^[A-Z0-9]{10}$/.test(item.config.asin))
      failField('ASIN', 'Türkiye kataloğundan bir ASIN seçin.')
    return {
      productType: 'PRODUCT',
      requirements: 'LISTING_OFFER_ONLY',
      attributes: {
        condition_type: [{ value: item.config.condition ?? 'new_new', marketplace_id: AMAZON_TR }],
        merchant_suggested_asin: [{ value: item.config.asin, marketplace_id: AMAZON_TR }],
        fulfillment_availability: [
          { fulfillment_channel_code: 'DEFAULT', quantity: item.quantity },
        ],
        purchasable_offer: [
          {
            marketplace_id: AMAZON_TR,
            currency: 'TRY',
            our_price: [{ schedule: [{ value_with_tax: item.price / 100 }] }],
          },
        ],
      },
    }
  }
  async submit(context: AdapterContext, plan: PublicationPlan) {
    const { base, headers, seller } = await this.api(context)
    const endpoint = `${base}/listings/2021-08-01/items/${seller}/${pathPart(plan.sku)}?marketplaceIds=${AMAZON_TR}`
    try {
      await this.http.request(endpoint, { headers })
      throw new ProviderError(
        'REMOTE_LISTING_EXISTS',
        'Amazon’da bu SKU zaten mevcut. Uzak teklif havuzundan eşleyin.',
      )
    } catch (error) {
      if (!(error instanceof ProviderError && error.code === 'HTTP_404')) throw error
    }
    const response = record(
      await this.http.request(endpoint, { method: 'PUT', headers, json: plan.body }),
    )
    if (response.status === 'INVALID')
      throw new ProviderError('PUBLICATION_REJECTED', 'Amazon teklif isteğini reddetti.')
    const reference = text(response.submissionId)
    if (!reference || response.status !== 'ACCEPTED')
      throw new ProviderError(
        'PUBLICATION_UNCERTAIN',
        'Amazon gönderim numarası alınamadı.',
        false,
        undefined,
        true,
      )
    return reference
  }
  async inspect(
    context: AdapterContext,
    plan: PublicationPlan,
    reference: string,
  ): Promise<Inspection> {
    const { base, headers, seller } = await this.api(context)
    let response: Record<string, unknown>
    try {
      response = record(
        await this.http.request(
          `${base}/listings/2021-08-01/items/${seller}/${pathPart(plan.sku)}?marketplaceIds=${AMAZON_TR}&includedData=summaries,issues,offers`,
          { headers },
        ),
      )
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'HTTP_404')
        return {
          state: { phase: 'submitted', reference, message: 'Amazon teklifi işleniyor.' },
          again: true,
        }
      throw error
    }
    if (text(response.sku) !== plan.sku)
      throw new ProviderError('INVALID_SKU', 'Amazon farklı bir SKU döndürdü.')
    const summary = array(response.summaries)
      .map(record)
      .find((row) => row.marketplaceId === AMAZON_TR)
    if (!summary?.asin)
      return {
        state: {
          phase: 'review',
          reference,
          message: 'Amazon Türkiye teklif kimliği henüz doğrulanmadı.',
        },
        again: true,
      }
    if (text(summary.asin) !== plan.config.asin)
      throw new ProviderError('ASIN_MISMATCH', 'Amazon teklifinin ASIN’i önizlemeden farklı.')
    const errors = array(response.issues).filter((item) => record(item).severity === 'ERROR')
    if (errors.length)
      return {
        externalId: plan.sku,
        state: {
          phase: 'rejected',
          reference,
          message: 'Amazon teklifte düzeltilmesi gereken alanlar bildirdi.',
          errors: failureMessages(errors),
        },
      }
    if (summary && array(summary.status).includes('BUYABLE'))
      return {
        externalId: plan.sku,
        state: {
          phase: 'live',
          reference,
          message: 'Amazon teklifinin satın alınabilir olduğu doğrulandı.',
        },
      }
    if (summary && plan.quantity === 0 && array(summary.status).includes('DISCOVERABLE'))
      return {
        externalId: plan.sku,
        state: {
          phase: 'listed',
          reference,
          message: 'Amazon teklifi kaydedildi; sıfır stok nedeniyle satın alınabilir değil.',
        },
      }
    return {
      externalId: plan.sku,
      state: {
        phase: 'review',
        reference,
        message: 'Amazon teklif işleme/onay süreci devam ediyor.',
      },
      again: true,
    }
  }
}
