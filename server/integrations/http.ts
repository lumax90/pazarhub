import { ProviderError } from '../errors'

export interface HttpOptions {
  method?: string
  headers?: Record<string, string>
  json?: unknown
  body?: string | FormData
  idempotent?: boolean
  responseType?: 'json' | 'text'
}

export class ProviderHttp {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly beforeRequest?: (url: string, options: HttpOptions) => Promise<void>,
  ) {}

  async request(url: string, options: HttpOptions = {}): Promise<unknown> {
    if (!url.startsWith('https://'))
      throw new ProviderError('INVALID_ENDPOINT', 'Entegrasyon adresi HTTPS olmalı.')
    await this.beforeRequest?.(url, options)
    const method = options.method ?? 'GET'
    const retrySafe = options.idempotent ?? ['GET', 'HEAD'].includes(method)
    let response: Response
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          accept: options.responseType === 'text' ? 'text/xml' : 'application/json',
          ...(options.json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(25000),
      })
    } catch {
      throw new ProviderError(
        'NETWORK_ERROR',
        retrySafe
          ? 'Sağlayıcıya ulaşılamadı; yeniden denenecek.'
          : 'İstek gönderildi ancak sonucu doğrulanamadı. Tekrar oluşturmadan önce sağlayıcı kaydı kontrol edilmeli.',
        retrySafe,
        30,
        !retrySafe,
      )
    }
    if (!response.ok) await response.body?.cancel().catch(() => undefined)
    if (response.status === 401 || response.status === 403)
      throw new ProviderError(
        'AUTH_REJECTED',
        'Sağlayıcı yetkilendirmeyi reddetti. API bilgilerini ve hesap izinlerini kontrol edin.',
      )
    if (response.status === 429) {
      const header = response.headers.get('retry-after')
      const seconds =
        header && /^\d+$/.test(header)
          ? Number(header)
          : header
            ? Math.ceil((Date.parse(header) - Date.now()) / 1000)
            : 60
      throw new ProviderError(
        'RATE_LIMIT',
        'Sağlayıcı istek sınırına ulaşıldı.',
        true,
        Math.max(10, Math.min(3600, seconds || 60)),
      )
    }
    if (response.status >= 500 || response.status === 408)
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        'Sağlayıcı geçici bir hata döndürdü.',
        retrySafe,
        30,
        !retrySafe,
      )
    if (response.status >= 300 && response.status < 400)
      throw new ProviderError(
        'UNEXPECTED_REDIRECT',
        'Sağlayıcı beklenmeyen bir yönlendirme döndürdü.',
      )
    if (!response.ok)
      throw new ProviderError(
        `HTTP_${response.status}`,
        `Sağlayıcı isteği kabul etmedi (HTTP ${response.status}). İstek alanlarını ve hesap yetkisini kontrol edin.`,
      )
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 10 * 1024 * 1024) {
            await reader.cancel()
            throw new ProviderError(
              'RESPONSE_TOO_LARGE',
              'Sağlayıcı yanıtı boyut sınırını aştı.',
              false,
              undefined,
              !retrySafe,
            )
          }
          chunks.push(value)
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError(
        'RESPONSE_INTERRUPTED',
        'Sağlayıcı yanıtı tamamlanmadan bağlantı kesildi.',
        retrySafe,
        30,
        !retrySafe,
      )
    }
    const body = Buffer.concat(chunks).toString('utf8')
    if (options.responseType === 'text') return body
    if (!body.trim()) return {}
    try {
      return JSON.parse(body) as unknown
    } catch {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Sağlayıcı geçerli JSON yanıtı döndürmedi.',
        retrySafe,
        30,
        !retrySafe,
      )
    }
  }
}

export function requireCredential(credentials: Record<string, string>, key: string) {
  const value = credentials[key]
  if (!value || !value.trim() || /[\r\n]/.test(value))
    throw new ProviderError('MISSING_CREDENTIAL', `Bağlantı alanı eksik veya geçersiz: ${key}.`)
  return value
}
export const basicAuth = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
