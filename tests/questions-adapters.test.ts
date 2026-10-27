import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withNativeQuestions } from '../server/marketplace/questions'
import type { AdapterContext, ProviderAdapter } from '../server/integrations/contracts'
import { ProviderHttp } from '../server/integrations/http'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'

const base: ProviderAdapter = {
  capabilities: [],
  execute: async () => {
    throw new Error('Unexpected base adapter call')
  },
}
const context = (provider: AdapterContext['provider']): AdapterContext => ({
  provider,
  connectionId: randomUUID(),
  workspaceId: randomUUID(),
  integrationName: 'Test',
  state: createEmptyState('Questions'),
  settings: defaultIntegrationSettings,
  credentials: {
    appKey: 'fixture',
    appSecret: 'fixture',
    apiKey: 'fixture',
    sellerId: '123',
    clientId: 'fixture',
    clientSecret: 'fixture',
  },
})
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const answer = 'Merhaba, ürünlerimiz siparişinizin ardından kargoya verilir.'
describe('native marketplace question adapters', () => {
  it('reads and answers n11 SOAP questions once and preserves XML escaping', async () => {
    const ctx = context('n11')
    let saved = '',
      writes = 0
    const adapter = withNativeQuestions(
      new ProviderHttp(async (_url, init) => {
        const body = String(init?.body),
          reply = (name: string, data: string) =>
            new Response(
              `<Envelope><Body><${name}Response><result><status>success</status></result>${data}</${name}Response></Body></Envelope>`,
            )
        if (body.includes('SaveProductAnswerRequest')) {
          expect(body).toContain('&amp;')
          saved = answer + ' & teşekkürler'
          writes++
          return reply('SaveProductAnswer', '')
        }
        if (body.includes('GetProductQuestionDetailRequest'))
          return reply(
            'GetProductQuestionDetail',
            `<productQuestion><question>Ne zaman kargoya verilir?</question><status>${saved ? 'CLOSED' : 'OPEN'}</status><answer>${saved.replace('&', '&amp;')}</answer><productTitle>Ürün</productTitle></productQuestion>`,
          )
        return reply(
          'GetProductQuestionList',
          '<productQuestions><productQuestion><id>10</id><question>Ne zaman kargoya verilir?</question><productTitle>Ürün</productTitle></productQuestion></productQuestions><pagingData><pageCount>1</pageCount></pagingData>',
        )
      }),
      'n11',
      base,
    )
    const list = await adapter.execute('questions.pull', ctx, {})
    expect(list.records?.[0].data.status).toBe('WAITING_FOR_ANSWER')
    const payload = {
      questionId: '10',
      questionText: 'Ne zaman kargoya verilir?',
      text: answer + ' & teşekkürler',
    }
    expect(
      (await adapter.execute('question.answer', ctx, payload)).marketplaceAction?.confirmed,
    ).toBe(false)
    expect(
      (await adapter.execute('question.answer', ctx, payload)).marketplaceAction?.confirmed,
    ).toBe(true)
    expect(writes).toBe(1)
  })
  it('uses Ciceksepeti public-answer action without conflicting private-action fields', async () => {
    const ctx = context('ciceksepeti'),
      question = {
        id: 'question',
        question: 'Ne zaman kargoya verilir?',
        answered: false,
        answer: '',
        product: { name: 'Ürün' },
      }
    let writes = 0
    const adapter = withNativeQuestions(
      new ProviderHttp(async (_url, init) => {
        if (init?.method === 'PUT') {
          expect(JSON.parse(String(init.body))).toEqual({ answer, branchActionId: 1 })
          question.answer = answer
          question.answered = true
          writes++
          throw new Error('Response lost')
        }
        return json({ items: [question], hasNextPage: false })
      }),
      'ciceksepeti',
      base,
    )
    const payload = { questionId: 'question', questionText: question.question, text: answer }
    await expect(adapter.execute('question.answer', ctx, payload)).rejects.toMatchObject({
      uncertain: true,
    })
    const verified = await adapter.execute('questions.pull', ctx, { questionId: 'question' })
    expect(verified.records?.[0].data).toMatchObject({ status: 'ANSWERED', answer })
    expect(writes).toBe(1)
  })
  it('keeps Pazarama moderation pending until the actual approved answer is returned', async () => {
    const ctx = context('pazarama'),
      question = {
        questionId: 'q1',
        question: 'Ne zaman kargoya verilir?',
        questionStatus: 0,
        barcode: 'BAR',
        productName: 'Ürün',
        answer: '',
      }
    let writes = 0
    const adapter = withNativeQuestions(
      new ProviderHttp(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/connect/token'))
          return json({ access_token: 'token', expires_in: 3600 })
        if (path.endsWith('/sellerAnswer')) {
          question.answer = JSON.parse(String(init?.body)).text
          question.questionStatus = 2
          writes++
          return json({ success: true, data: false })
        }
        if (path.endsWith('/getApprovalAnswerById'))
          return json({ success: true, data: { ...question, answer: undefined } })
        return json({
          success: true,
          data: { approvalAnswersByMerchantSearchs: [question], pageResponse: { totalPages: 1 } },
        })
      }),
      'pazarama',
      base,
    )
    await adapter.execute('question.answer', ctx, {
      questionId: 'q1',
      questionText: question.question,
      text: answer,
    })
    expect(
      (await adapter.execute('questions.pull', ctx, { questionId: 'q1' })).records?.[0].data.status,
    ).toBe('ON_REVIEW')
    question.questionStatus = 1
    expect(
      (await adapter.execute('questions.pull', ctx, { questionId: 'q1' })).records?.[0].data,
    ).toMatchObject({ status: 'ANSWERED', answer })
    expect(writes).toBe(1)
  })
})
