import type { IntegrationOperation } from '../../src/domain/integrations'
import type { MarketplaceQuestion } from '../../src/domain/marketplace'
import type { AdapterContext, AdapterResult, ProviderAdapter } from '../integrations/contracts'
import { array, integer, record, text } from '../integrations/contracts'
import { ProviderHttp, requireCredential } from '../integrations/http'
import { PazaramaApi } from '../integrations/pazarama'
import { soapArray, soapCall } from '../integrations/soap'
import { n11Headers } from '../integrations/n11-api'
import { ProviderError } from '../errors'

const date = (value: unknown) => {
  const source = text(value)
  return source && !Number.isNaN(Date.parse(source)) ? new Date(source).toISOString() : null
}
const questionRecord = (question: MarketplaceQuestion) => ({
  id: question.externalId,
  resource: 'question' as const,
  data: { ...question },
})
export function normalizeNativeQuestion(
  provider: 'n11' | 'ciceksepeti' | 'pazarama',
  raw: unknown,
  scope?: string,
): MarketplaceQuestion {
  const data = record(raw),
    product = record(data.product),
    answer = text(data.answer) || undefined
  const id = text(data.id ?? data.questionId),
    question = text(data.question)
  if (!id || !question)
    throw new ProviderError('INVALID_QUESTION', 'Soru kimliği veya metni okunamadı.')
  if (provider === 'n11')
    return {
      kind: 'question',
      externalId: id,
      text: question,
      productName: text(data.productTitle),
      customerName: text(data.fullName),
      createdAt: date(data.questionDate),
      status: answer
        ? 'ANSWERED'
        : (data.status ?? scope) === 'OPEN'
          ? 'WAITING_FOR_ANSWER'
          : 'UNANSWERED',
      answer,
    }
  if (provider === 'ciceksepeti')
    return {
      kind: 'question',
      externalId: id,
      text: question,
      productName: text(product.name),
      customerName: '',
      createdAt: date(data.questionDate),
      status:
        data.answered === true
          ? answer
            ? 'ANSWERED'
            : 'ON_REVIEW'
          : data.branchActionId === 3
            ? 'REPORTED'
            : data.branchActionId === 4
              ? 'UNANSWERED'
              : 'WAITING_FOR_ANSWER',
      answer,
      imageUrl: text(product.imageUrl) || undefined,
      productUrl: text(product.url)
        ? new URL(text(product.url), 'https://www.ciceksepeti.com/').href
        : undefined,
    }
  const status = integer(data.questionStatus, -1)
  return {
    kind: 'question',
    externalId: id,
    text: question,
    productName: text(data.productName),
    customerName: text(data.maskedUserName),
    createdAt: date(data.questionDate),
    status:
      status === 0
        ? 'WAITING_FOR_ANSWER'
        : status === 1 && answer
          ? 'ANSWERED'
          : status === 3
            ? 'REJECTED'
            : 'ON_REVIEW',
    ...(status === 3
      ? { rejectedAnswer: answer, rejectedAt: date(data.answerDate) ?? undefined }
      : { answer }),
    imageUrl: text(data.productImageUrl) || undefined,
  }
}

class NativeQuestions {
  constructor(private readonly http: ProviderHttp) {}
  private cicek(context: AdapterContext) {
    return {
      base: `https://${context.settings.environment === 'sandbox' ? 'sandbox-apis' : 'apis'}.ciceksepeti.com/api/v1`,
      headers: {
        'x-api-key': requireCredential(context.credentials, 'apiKey'),
        'user-agent': `${requireCredential(context.credentials, 'sellerId')}-${context.integrationName}`,
      },
    }
  }
  private n11(
    context: AdapterContext,
    method: string,
    fields: Record<string, unknown>,
    safe = true,
  ) {
    n11Headers(context)
    return soapCall(
      this.http,
      'https://api.n11.com/ws/productService/',
      'http://www.n11.com/ws/schemas',
      method,
      {
        auth: {
          appKey: requireCredential(context.credentials, 'appKey'),
          appSecret: requireCredential(context.credentials, 'appSecret'),
        },
        ...fields,
      },
      { requestName: `${method}Request`, action: '', safe },
    )
  }
  private async get(context: AdapterContext, id: string): Promise<MarketplaceQuestion> {
    if (context.provider === 'n11') {
      const response = await this.n11(context, 'GetProductQuestionDetail', {
        productQuestionId: id,
      })
      if (record(response.result).status !== 'success')
        throw new ProviderError('QUESTION_NOT_FOUND', 'n11 sorusu okunamadı.')
      return normalizeNativeQuestion('n11', { ...record(response.productQuestion), id })
    }
    if (context.provider === 'ciceksepeti') {
      const { base, headers } = this.cicek(context),
        response = record(
          await this.http.request(`${base}/sellerquestions?Id=${encodeURIComponent(id)}`, {
            headers,
          }),
        ),
        raw = array(response.items).find((item) => text(record(item).id) === id)
      if (!raw) throw new ProviderError('QUESTION_NOT_FOUND', 'Çiçeksepeti sorusu bulunamadı.')
      return normalizeNativeQuestion('ciceksepeti', raw)
    }
    const api = new PazaramaApi(this.http),
      detail = record(
        (
          await api.request(
            context,
            `/QuestionAnswer/getApprovalAnswerById?questionId=${encodeURIComponent(id)}`,
          )
        ).data,
      )
    if (text(detail.questionId) !== id)
      throw new ProviderError('QUESTION_NOT_FOUND', 'Pazarama soru kimliği eşleşmiyor.')
    if (detail.questionStatus === 0 || typeof detail.answer === 'string')
      return normalizeNativeQuestion('pazarama', detail)
    for (let page = 1; page <= 100; page++) {
      const response = await api.request(
          context,
          '/QuestionAnswer/getApprovalAnswersByMerchantSearch',
          {
            method: 'POST',
            json: { barcode: detail.barcode, questionStatus: null, pageIndex: page, pageSize: 100 },
            idempotent: true,
          },
        ),
        data = record(response.data),
        rows = array(data.approvalAnswersByMerchantSearchs),
        raw = rows.find((item) => text(record(item).questionId) === id)
      if (raw) return normalizeNativeQuestion('pazarama', raw)
      if (page >= integer(record(data.pageResponse).totalPages, 1)) break
    }
    throw new ProviderError(
      'ANSWER_NOT_CONFIRMED',
      'Pazarama yanıt metni henüz doğrulanamadı.',
      true,
      60,
    )
  }
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    if (operation === 'questions.pull' && payload.questionId) {
      const question = await this.get(context, text(payload.questionId))
      return { message: 'Soru ve yanıt sağlayıcıdan alındı.', records: [questionRecord(question)] }
    }
    if (operation === 'question.answer') {
      const id = text(payload.questionId),
        answer = text(payload.text).trim(),
        current = await this.get(context, id)
      if (answer.length < 10 || answer.length > 2000)
        throw new ProviderError('INVALID_ANSWER', 'Yanıt 10–2000 karakter olmalı.')
      if (current.status === 'ANSWERED') {
        if (current.answer !== answer)
          throw new ProviderError('ALREADY_ANSWERED', 'Soru farklı bir yanıtla cevaplanmış.')
        return {
          message: 'Aynı yanıt sağlayıcıda doğrulandı.',
          records: [questionRecord(current)],
          marketplaceAction: { resource: 'question', externalId: id, answer, confirmed: true },
        }
      }
      if (current.status !== 'WAITING_FOR_ANSWER' || current.text !== payload.questionText)
        throw new ProviderError(
          'QUESTION_CHANGED',
          'Soru veya yanıt verme durumu değişti. Güncel kaydı açın.',
        )
      if (context.provider === 'n11') {
        const response = await this.n11(
          context,
          'SaveProductAnswer',
          { productQuestionId: id, answer },
          false,
        )
        if (record(response.result).status !== 'success')
          throw new ProviderError(
            'ANSWER_REJECTED',
            text(record(response.result).errorMessage) || 'n11 yanıtı kabul etmedi.',
          )
      } else if (context.provider === 'ciceksepeti') {
        const { base, headers } = this.cicek(context)
        const response = record(
          await this.http.request(`${base}/sellerquestions/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers,
            json: { answer, branchActionId: 1 },
          }),
        )
        if (response.isSuccess === false || response.success === false)
          throw new ProviderError('ANSWER_REJECTED', 'Çiçeksepeti yanıtı kabul etmedi.')
      } else
        await new PazaramaApi(this.http).request(context, '/QuestionAnswer/sellerAnswer', {
          method: 'PUT',
          json: { questionId: id, text: answer },
        })
      return {
        message: 'Yanıt gönderildi; sağlayıcıdaki sonucu ayrıca doğrulanacak.',
        marketplaceAction: { resource: 'question', externalId: id, answer, confirmed: false },
      }
    }
    const to = Number(payload.to ?? Date.now()),
      from = Number(payload.from ?? to - 14 * 86400000)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 31 * 86400000)
      throw new ProviderError('INVALID_WINDOW', 'Soru sorgusu en fazla 31 gün olmalı.')
    if (context.provider === 'n11') {
      const page = integer(payload.page),
        scope = text(payload.scope) || 'OPEN',
        format = (stamp: number) =>
          new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul' }).format(new Date(stamp))
      const response = await this.n11(context, 'GetProductQuestionList', {
        productQuestionSearch: { status: scope, startDate: format(from), endDate: format(to) },
        pagingData: { currentPage: page, pageSize: 50 },
      })
      if (record(response.result).status !== 'success')
        throw new ProviderError('QUESTIONS_REJECTED', 'n11 soru listesi alınamadı.')
      const questions = soapArray(record(response.productQuestions).productQuestion).map((item) =>
        normalizeNativeQuestion('n11', item, scope),
      )
      const more = page + 1 < integer(record(response.pagingData).pageCount)
      return {
        message: `${questions.length} n11 sorusu alındı.`,
        records: questions.map(questionRecord),
        ...(more || scope === 'OPEN'
          ? {
              nextPayload: {
                ...payload,
                from,
                to,
                scope: more ? scope : 'CLOSED',
                page: more ? page + 1 : 0,
              },
              delaySeconds: 61,
            }
          : {}),
      }
    }
    if (context.provider === 'ciceksepeti') {
      const { base, headers } = this.cicek(context),
        page = integer(payload.page, 1),
        response = record(
          await this.http.request(
            `${base}/sellerquestions?${new URLSearchParams({ CreateStartDate: String(from), CreateEndDate: String(to), Page: String(page) })}`,
            { headers },
          ),
        )
      if (!Array.isArray(response.items))
        throw new ProviderError('INVALID_QUESTIONS', 'Çiçeksepeti soru listesi okunamadı.')
      return {
        message: `${response.items.length} Çiçeksepeti sorusu alındı.`,
        records: response.items.map((item) =>
          questionRecord(normalizeNativeQuestion('ciceksepeti', item)),
        ),
        ...(response.hasNextPage === true
          ? { nextPayload: { ...payload, from, to, page: page + 1 }, delaySeconds: 11 }
          : {}),
      }
    }
    const page = integer(payload.page, 1),
      response = await new PazaramaApi(this.http).request(
        context,
        '/QuestionAnswer/getApprovalAnswersByMerchantSearch',
        {
          method: 'POST',
          json: {
            questionStartDate: new Date(from).toISOString(),
            questionEndDate: new Date(to).toISOString(),
            questionStatus: null,
            pageIndex: page,
            pageSize: 100,
          },
          idempotent: true,
        },
      ),
      data = record(response.data)
    if (!Array.isArray(data.approvalAnswersByMerchantSearchs))
      throw new ProviderError('INVALID_QUESTIONS', 'Pazarama soru listesi okunamadı.')
    return {
      message: `${data.approvalAnswersByMerchantSearchs.length} Pazarama sorusu alındı.`,
      records: data.approvalAnswersByMerchantSearchs.map((item) =>
        questionRecord(normalizeNativeQuestion('pazarama', item)),
      ),
      ...(page < integer(record(data.pageResponse).totalPages, 1)
        ? { nextPayload: { ...payload, from, to, page: page + 1 }, delaySeconds: 2 }
        : {}),
    }
  }
}
export function withNativeQuestions(
  http: ProviderHttp,
  provider: string,
  adapter: ProviderAdapter,
): ProviderAdapter {
  if (!['n11', 'ciceksepeti', 'pazarama'].includes(provider)) return adapter
  const questions = new NativeQuestions(http)
  return {
    capabilities: [...adapter.capabilities, 'questions.pull', 'question.answer'],
    execute: (operation, context, payload) =>
      ['questions.pull', 'question.answer'].includes(operation)
        ? questions.execute(operation, context, payload)
        : adapter.execute(operation, context, payload),
  }
}
