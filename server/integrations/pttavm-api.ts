import { randomUUID } from 'node:crypto'
import type { AdapterContext } from './contracts'
import { array, record, remoteInteger, text } from './contracts'
import { ProviderHttp, requireCredential } from './http'
import type { HttpOptions } from './http'
import { ProviderError } from '../errors'

export class PttAvmApi {
  constructor(private readonly http: ProviderHttp) {}
  request(context: AdapterContext, path: string, options: HttpOptions = {}) {
    return this.send(context, 'https://integration-api.pttavm.com/api/v1', path, options)
  }
  shipment(context: AdapterContext, path: string, options: HttpOptions = {}) {
    return this.send(context, 'https://shipment.pttavm.com/api/v1', path, options)
  }
  private send(context: AdapterContext, base: string, path: string, options: HttpOptions) {
    if (context.settings.environment === 'sandbox')
      throw new ProviderError(
        'SANDBOX_UNAVAILABLE',
        'PttAVM için sağlayıcının test hesabı kullanılmalı; ayrı sandbox adresi tanımlı değil.',
      )
    return this.http.request(`${base}${path}`, {
      ...options,
      headers: {
        'Api-Key': requireCredential(context.credentials, 'apiKey'),
        'Access-Token': requireCredential(context.credentials, 'accessToken'),
        'X-Correlation-Id': randomUUID(),
        ...options.headers,
      },
    })
  }
  async parent(context: AdapterContext, barcode: string) {
    try {
      const response = record(
        await this.request(context, `/products?barcode=${encodeURIComponent(barcode)}`),
      )
      if (remoteInteger(response.urunId) > 0) return response
      if (response.urunId === 0 && response.durum === 'Yeni') return undefined
      throw new ProviderError('INVALID_PRODUCT', 'PttAVM ürün sorgusu doğrulanamadı.')
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'HTTP_404') return undefined
      throw error
    }
  }
  async tracking(context: AdapterContext, id: string, barcode: string) {
    const response = record(
      await this.request(context, `/products/tracking-result/${encodeURIComponent(id)}`, {
        method: 'POST',
        idempotent: true,
      }),
    )
    const summary = record(response.productsSubTrackingResult),
      rows = array(summary.productBasedInfos).map(record)
    if (
      response.status === 'Cancelled' ||
      remoteInteger(summary.countOfCancelledProducts, 0) > 0 ||
      rows.some((row) => row.status === 'Cancelled' || array(row.failureReasons).length)
    )
      throw new ProviderError(
        'BATCH_FAILED',
        rows
          .flatMap((row) => array(row.failureReasons))
          .map(text)
          .join(' · ') || 'PttAVM ürün isteği reddedildi.',
      )
    if (response.status !== 'Completed') return false
    const row = rows.find((row) => text(row.barcode) === barcode)
    if (!row || row.status !== 'Completed')
      throw new ProviderError(
        'ROW_NOT_CONFIRMED',
        'PttAVM hedef ürün satırının sonucu doğrulanamadı.',
      )
    return true
  }
}
