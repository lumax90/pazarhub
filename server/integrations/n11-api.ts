import type { AdapterContext } from './contracts'
import { ProviderHttp, requireCredential } from './http'
import { soapCall } from './soap'
import { ProviderError } from '../errors'

export function n11Headers(context: AdapterContext) {
  if (context.settings.environment !== 'production')
    throw new ProviderError(
      'SANDBOX_UNAVAILABLE',
      'n11 testleri sağlayıcının verdiği test mağazasıyla ve canlı API ortamı seçilerek yapılır.',
    )
  return {
    appKey: requireCredential(context.credentials, 'appKey'),
    appSecret: requireCredential(context.credentials, 'appSecret'),
  }
}
export function n11ReturnCall(
  http: ProviderHttp,
  context: AdapterContext,
  operation: string,
  fields: Record<string, unknown>,
  safe = true,
) {
  return soapCall(
    http,
    'https://api.n11.com/ws/returnService/',
    'http://www.n11.com/ws/schemas',
    operation,
    { auth: n11Headers(context), ...fields },
    { requestName: `${operation}Request`, action: '', safe },
  )
}
