import type { FastifyInstance } from 'fastify'
import { XMLParser } from 'fast-xml-parser'
import { currencyCodes } from '../src/domain/money'
import type { CurrencyCode, ExchangeRates, ExchangeRateType } from '../src/domain/money'
import type { AppState } from '../src/domain/types'
import type { Database } from './db'
import { requireAuth, requirePermission } from './auth'
import { AppError } from './errors'

const columns: Record<ExchangeRateType, string> = {
  forexBuying: 'ForexBuying',
  forexSelling: 'ForexSelling',
  banknoteBuying: 'BanknoteBuying',
  banknoteSelling: 'BanknoteSelling',
}
export function parseTcmb(xml: string): ExchangeRates {
  if (xml.length > 200000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new AppError(502, 'INVALID_RATES', 'TCMB kur verisi geçersiz.')
  const root = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(
    xml,
  ).Tarih_Date
  const date = String(root?.['@_Tarih'] ?? '')
    .split('.')
    .reverse()
    .join('-')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new AppError(502, 'INVALID_RATES', 'TCMB kur tarihi okunamadı.')
  const rates: ExchangeRates['rates'] = {}
  for (const row of Array.isArray(root.Currency) ? root.Currency : [root.Currency]) {
    const code = row?.['@_CurrencyCode'] as CurrencyCode
    if (!currencyCodes.includes(code) || code === 'TRY') continue
    const unit = String(row.Unit)
    if (!/^[1-9]\d{0,5}$/.test(unit)) continue
    const values = {} as Record<ExchangeRateType, string>
    for (const [type, field] of Object.entries(columns)) {
      const source = String(row[field] ?? '')
      if (!/^\d+(\.\d{1,8})?$/.test(source))
        throw new AppError(502, 'INVALID_RATES', `${code} kur türü okunamadı.`)
      const [integer, fraction = ''] = source.split('.')
      const raw = BigInt(integer) * 100000000n + BigInt(fraction.padEnd(8, '0'))
      const rate = (raw * 2n + BigInt(unit)) / (2n * BigInt(unit))
      if (rate <= 0n) throw new AppError(502, 'INVALID_RATES', 'TCMB sıfır kur döndürdü.')
      values[type as ExchangeRateType] = rate.toString()
    }
    rates[code] = values
  }
  if (!rates.USD || !rates.EUR)
    throw new AppError(502, 'INVALID_RATES', 'Temel döviz kurları bulunamadı.')
  return { date, rates, source: 'TCMB', fetchedAt: new Date().toISOString() }
}
export async function refreshExchangeRates(database: Database, fetcher: typeof fetch = fetch) {
  const response = await fetcher('https://www.tcmb.gov.tr/kurlar/today.xml', {
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  })
  if (!response.ok) throw new AppError(502, 'RATES_UNAVAILABLE', 'TCMB kurları alınamadı.')
  const rates = parseTcmb(await response.text())
  await database.transaction(async (tx) => {
    const rows = await tx.query<{ workspace_id: string; document: AppState }>(
      'SELECT workspace_id,document FROM workspace_states ORDER BY workspace_id FOR UPDATE',
    )
    for (const row of rows.rows) {
      if (row.document.exchangeRates && row.document.exchangeRates.date > rates.date) continue
      row.document.exchangeRates = rates
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), row.workspace_id],
      )
    }
  })
  return rates
}
export function registerExchangeRateRoutes(app: FastifyInstance, database: Database, test = false) {
  let running: Promise<ExchangeRates> | undefined
  const refresh = () =>
    (running ??= refreshExchangeRates(database).finally(() => {
      running = undefined
    }))
  app.get('/api/exchange-rates', async (request) => {
    const auth = requireAuth(request)
    return {
      rates:
        (
          await database.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1',
            [auth.workspaceId],
          )
        ).rows[0].document.exchangeRates ?? null,
    }
  })
  app.post('/api/exchange-rates/refresh', async (request) => {
    requirePermission(request, 'workspace.manage')
    return { rates: await refresh() }
  })
  if (!test) {
    const timer = setInterval(() => {
      void refresh().catch(() => {})
    }, 3600000)
    timer.unref()
    app.addHook('onClose', async () => {
      clearInterval(timer)
      if (running) await running.catch(() => {})
    })
  }
}
