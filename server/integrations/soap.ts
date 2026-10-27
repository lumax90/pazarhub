import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import { ProviderError } from '../errors'
import { record } from './contracts'
import type { ProviderHttp } from './http'

export const soapArray = (value: unknown): unknown[] =>
  value === undefined || value === null || value === ''
    ? []
    : Array.isArray(value)
      ? value
      : [value]
export function parseXml(xml: string): Record<string, unknown> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new ProviderError('INVALID_XML', 'Sağlayıcı geçerli XML yanıtı döndürmedi.')
  return record(
    new XMLParser({
      removeNSPrefix: true,
      parseTagValue: false,
      processEntities: true,
      ignoreAttributes: true,
      maxNestedTags: 60,
    }).parse(xml),
  )
}
export async function soapCall(
  http: ProviderHttp,
  endpoint: string,
  namespace: string,
  operation: string,
  fields: Record<string, unknown>,
  options: { qualified?: boolean; action?: string; safe?: boolean; requestName?: string } = {},
) {
  const builder = new XMLBuilder({ ignoreAttributes: false, processEntities: true })
  const body = builder.build({
    'soap:Envelope': {
      '@_xmlns:soap': 'http://schemas.xmlsoap.org/soap/envelope/',
      'soap:Body': {
        [`m:${options.requestName ?? operation}`]: {
          '@_xmlns:m': namespace,
          ...(options.qualified ? { '@_xmlns': namespace } : {}),
          ...fields,
        },
      },
    },
  }) as string
  const xml = String(
    await http.request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'text/xml; charset=utf-8',
        SOAPAction: options.action ?? `${namespace}/${operation}`,
      },
      body,
      responseType: 'text',
      idempotent: options.safe ?? false,
    }),
  )
  const parsed = record(record(parseXml(xml).Envelope).Body)
  if (parsed.Fault)
    throw new ProviderError(
      'SOAP_FAULT',
      'Sağlayıcı web servis isteğini reddetti. Hesap ve gönderi alanlarını kontrol edin.',
    )
  const response = parsed[`${operation}Response`]
  if (!response) throw new ProviderError('INVALID_SOAP', 'Beklenen web servis yanıtı alınamadı.')
  return record(response)
}

export function qualifiedFields(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        `t:${key}`,
        Array.isArray(value)
          ? value.map((v) =>
              typeof v === 'object' && v ? qualifiedFields(v as Record<string, unknown>) : v,
            )
          : value && typeof value === 'object'
            ? qualifiedFields(value as Record<string, unknown>)
            : value,
      ]),
  )
}
