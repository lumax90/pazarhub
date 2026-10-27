import type { ClaimDecisionOptions, ClaimDecision } from '../../src/domain/marketplace'
import type { AdapterContext } from '../integrations/contracts'
import { record, text, array } from '../integrations/contracts'
import { ProviderHttp, basicAuth, requireCredential } from '../integrations/http'
import { AppError } from '../errors'
import { n11ReturnCall } from '../integrations/n11-api'
import { soapArray } from '../integrations/soap'

export async function claimDecisionOptions(
  context: AdapterContext,
  http: ProviderHttp,
): Promise<ClaimDecisionOptions> {
  if (context.provider === 'n11') {
    const deny = await n11ReturnCall(http, context, 'ClaimReturnDenyReasonTypes', {}),
      pending = await n11ReturnCall(http, context, 'ClaimReturnPendingReasonTypes', {})
    if (record(deny.result).status !== 'success' || record(pending.result).status !== 'success')
      throw new AppError(502, 'CLAIM_REASONS_INVALID', 'n11 karar nedenleri alınamadı.')
    const values = (value: unknown, key: string) =>
      soapArray(record(value)[key] ?? value)
        .map(record)
        .map((item) => ({ id: text(item.id), label: text(item.value) }))
        .filter((item) => item.id && item.label)
    return {
      decisions: ['approve', 'reject', 'investigate'],
      reasons: values(deny.denyReasonTypeDataList, 'denyReasonTypeData'),
      reviewTypes: values(pending.pendingReasonTypeDataList, 'pendingReasonTypeData'),
      descriptionRequired: true,
      filesAllowed: false,
      imagesOnly: false,
      reviewDaysRequired: true,
    }
  }
  if (context.provider === 'hepsiburada')
    return {
      decisions: ['approve', 'reject'],
      reasons: Object.entries({
        CustomerReturnedWrongItem: 'İade edilen ürün siparişteki ürün değil',
        ProductIsDamaged: 'İade edilen ürün hasarlı',
        MissingQuantity: 'Ürün adedi eksik',
        NoSuchAccessory: 'Ürün kullanılmış',
        BoxIsEmptyWithoutReport: 'İade paketi boş, tutanak yok',
        SomePartsOrSomeAccessoriesOrSomePapersAreMissing: 'Parça / aksesuar / belge eksik',
        ReturnedProductIsNotDelivered: 'İade ürün teslim edilmedi',
        ExtraProductHasBeenReturned: 'Fazla gönderilen ürün iade edildi',
        ProductNotWrong: 'Gönderilen ürün yanlış değil',
        ProductNotDefective: 'Gönderilen ürün kusurlu değil',
        ReturnedProductHasAccountOrPassword: 'Üründe hesap / şifre mevcut',
      }).map(([id, label]) => ({ id, label })),
      reviewTypes: [],
      descriptionRequired: true,
      filesAllowed: false,
      imagesOnly: false,
    }
  if (context.provider === 'trendyol') {
    const response = await http.request(
      `https://${context.settings.environment === 'sandbox' ? 'stageapigw' : 'apigw'}.trendyol.com/integration/order/claim-issue-reasons`,
      {
        headers: {
          authorization: basicAuth(
            requireCredential(context.credentials, 'apiKey'),
            requireCredential(context.credentials, 'apiSecret'),
          ),
          'user-agent': `${context.credentials.sellerId} - ${context.integrationName}`,
        },
      },
    )
    if (!Array.isArray(response))
      throw new AppError(502, 'CLAIM_REASONS_INVALID', 'Trendyol ret nedenleri okunamadı.')
    return {
      decisions: ['approve', 'reject'],
      reasons: response.map((item) => ({
        id: text(record(item).id),
        label: text(record(item).name),
      })),
      reviewTypes: [],
      descriptionRequired: true,
      filesAllowed: true,
      imagesOnly: false,
    }
  }
  if (context.provider === 'ciceksepeti')
    return {
      decisions: ['approve', 'reject'],
      reasons: [],
      reviewTypes: [],
      descriptionRequired: false,
      filesAllowed: false,
      imagesOnly: false,
    }
  if (context.provider === 'pazarama')
    return {
      decisions: ['approve', 'reject', 'investigate'],
      reasons: [
        'Gelen ürün bana ait değil',
        'Gelen ürün defolu / zarar görmüş',
        'Gelen ürün adedi eksik',
        'Gelen ürün yanlış',
        'Gelen ürün kullanılmış',
        'Gelen ürün sahte',
        'Ürünün parçası / aksesuarı eksik',
        'Gönderdiğim ürün kusurlu değil',
        'Gönderdiğim ürün yanlış değil',
        'İade paketi boş geldi',
        'İade paketi elime ulaşmadı',
        'Diğer',
      ].map((label, index) => ({ id: String(index + 1), label })),
      reviewTypes: [
        { id: '1', label: 'Üretici firma incelemesi' },
        { id: '2', label: 'Yetkili servis incelemesi' },
        { id: '3', label: 'Diğer' },
      ],
      descriptionRequired: true,
      filesAllowed: true,
      imagesOnly: true,
    }
  return {
    decisions: ['approve'],
    reasons: [],
    reviewTypes: [],
    descriptionRequired: false,
    filesAllowed: false,
    imagesOnly: false,
  }
}
export function validateClaimDecision(
  provider: string,
  rules: ClaimDecisionOptions,
  input: {
    decision: ClaimDecision
    reasonId?: string
    description?: string
    reviewType?: string
    reviewDays?: number
    files?: unknown[]
  },
) {
  if (!rules.decisions.includes(input.decision))
    throw new AppError(422, 'DECISION_UNAVAILABLE', 'Sağlayıcı bu iade kararını desteklemiyor.')
  if (input.decision === 'approve') return
  const files = array(input.files)
  if (
    input.decision === 'reject' &&
    rules.reasons.length &&
    !rules.reasons.some((reason) => reason.id === input.reasonId)
  )
    throw new AppError(422, 'CLAIM_REASON_REQUIRED', 'Geçerli ret nedeni seçin.')
  if (
    rules.descriptionRequired &&
    (provider !== 'pazarama' || input.decision !== 'investigate' || input.reviewType === '3') &&
    !(input.description ?? '').trim()
  )
    throw new AppError(422, 'CLAIM_DESCRIPTION_REQUIRED', 'Karar açıklaması girin.')
  if ((input.description?.length ?? 0) > 500)
    throw new AppError(422, 'CLAIM_DESCRIPTION_LONG', 'Karar açıklaması 500 karakteri aşamaz.')
  if (
    input.decision === 'investigate' &&
    !rules.reviewTypes.some((type) => type.id === input.reviewType)
  )
    throw new AppError(422, 'CLAIM_REVIEW_REQUIRED', 'İnceleme türü seçin.')
  if (
    input.decision === 'investigate' &&
    rules.reviewDaysRequired &&
    (!Number.isInteger(input.reviewDays) || input.reviewDays! < 1 || input.reviewDays! > 14)
  )
    throw new AppError(422, 'CLAIM_REVIEW_DAYS', 'Erteleme gün sayısını 1–14 arasında girin.')
  if (files.length > 3 || (!rules.filesAllowed && files.length))
    throw new AppError(422, 'CLAIM_FILES_INVALID', 'Bu karar için ek dosyaları kontrol edin.')
  if (rules.imagesOnly && files.some((file) => !text(record(file).mime).startsWith('image/')))
    throw new AppError(422, 'CLAIM_IMAGES_REQUIRED', 'Bu sağlayıcıda ekler görsel olmalı.')
  if (
    provider === 'pazarama' &&
    input.decision === 'reject' &&
    !['10', '11'].includes(input.reasonId ?? '') &&
    !files.length
  )
    throw new AppError(
      422,
      'CLAIM_IMAGES_REQUIRED',
      'Bu ret nedeni için en az bir ürün görseli ekleyin.',
    )
}
