import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AdapterContext } from '../server/integrations/contracts'
import { ProviderHttp } from '../server/integrations/http'
import { HepsiburadaAdapter } from '../server/integrations/hepsiburada'
import { CiceksepetiAdapter } from '../server/integrations/ciceksepeti'
import { createEmptyState } from '../src/domain/empty-state'
import { defaultIntegrationSettings } from '../src/domain/integrations'

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
function context(
  provider: 'hepsiburada' | 'ciceksepeti',
  credentials: Record<string, string>,
): AdapterContext {
  return {
    provider,
    workspaceId: randomUUID(),
    connectionId: randomUUID(),
    credentials,
    settings: defaultIntegrationSettings,
    integrationName: 'Pazarhub',
    state: createEmptyState('Test'),
  }
}

describe('marketplace authentication', () => {
  it('signs Hepsiburada with merchant ID and service key, integrator as User-Agent', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ success: true, data: [] }),
    )
    await new HepsiburadaAdapter(new ProviderHttp(fetcher)).execute(
      'test',
      context('hepsiburada', {
        merchantId: 'merchant-1',
        username: 'pazarhub_dev',
        password: 'service-key',
      }),
      {},
    )
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('merchant-1:service-key').toString('base64')}`,
      'user-agent': 'pazarhub_dev',
    })
  })

  it('sends Çiçeksepeti user-agent as SellerId-IntegratorName and reads numeric statuses', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({
        totalCount: 1,
        products: [
          {
            productCode: 'P1',
            stockCode: 'S1',
            productName: 'Ürün',
            TotalPrice: 12.5,
            productStatusType: 4,
          },
        ],
      }),
    )
    const result = await new CiceksepetiAdapter(new ProviderHttp(fetcher)).execute(
      'catalog.pull',
      context('ciceksepeti', { sellerId: '12345', apiKey: 'key' }),
      {},
    )
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      'x-api-key': 'key',
      'user-agent': '12345-Pazarhub',
    })
    expect(result.products?.[0]).toMatchObject({ price: 1250, status: 'rejected' })
  })
})
