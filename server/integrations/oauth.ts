import { sha256 } from '../security'
import { ProviderError } from '../errors'
import { record, text } from './contracts'
import type { AdapterContext } from './contracts'
import type { ProviderHttp } from './http'

const tokens = new Map<string, { value: string; expires: number }>()
export async function accessToken(
  context: AdapterContext,
  http: ProviderHttp,
  url: string,
  fields: Record<string, string>,
  options: { headers?: Record<string, string>; json?: boolean } = {},
) {
  const key = `${context.provider}:${context.workspaceId}:${context.connectionId}:${sha256(JSON.stringify({ url, fields, options }))}`
  const current = tokens.get(key)
  if (current && current.expires > Date.now() + 60000) return current.value
  for (const [id, value] of tokens)
    if (value.expires < Date.now() || tokens.size > 500) tokens.delete(id)
  const response = record(
    await http.request(url, {
      method: 'POST',
      headers: {
        'content-type': options.json ? 'application/json' : 'application/x-www-form-urlencoded',
        ...options.headers,
      },
      ...(options.json ? { json: fields } : { body: new URLSearchParams(fields).toString() }),
      idempotent: true,
    }),
  )
  // Standard OAuth puts the token at the top; Pazarama wraps it as data.accessToken.
  const wrapped = record(response.data)
  const token = text(response.access_token) || text(wrapped.accessToken)
  if (!token)
    throw new ProviderError(
      'TOKEN_REJECTED',
      'Sağlayıcı erişim anahtarı vermedi. Uygulama ve hesap izinlerini kontrol edin.',
    )
  const absolute =
    typeof response.expires_at_utc === 'string' ? Date.parse(response.expires_at_utc) : NaN
  const expires = Number.isFinite(absolute)
    ? absolute
    : Date.now() + Math.min(86400, Number(response.expires_in ?? wrapped.expiresIn) || 3600) * 1000
  if (expires <= Date.now())
    throw new ProviderError('TOKEN_EXPIRED', 'Sağlayıcı süresi dolmuş erişim anahtarı döndürdü.')
  tokens.set(key, {
    value: token,
    expires,
  })
  return token
}
export function clearAccessTokens(context: AdapterContext) {
  const prefix = `${context.provider}:${context.workspaceId}:${context.connectionId}:`
  for (const key of tokens.keys()) if (key.startsWith(prefix)) tokens.delete(key)
}
