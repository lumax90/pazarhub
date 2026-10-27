import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { ProviderError } from './errors'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6')

export function isPublicAddress(address: string) {
  const family = isIP(address)
  if (!family) return false
  if (address.toLowerCase().startsWith('::ffff:')) return isPublicAddress(address.slice(7))
  return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/** Resolve and pin the public address before opening the TLS connection. */
export async function downloadPublicFile(
  raw: string,
  limit = 12 * 1024 * 1024,
  redirects = 0,
): Promise<Buffer> {
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    redirects > 3
  )
    throw new ProviderError('INVALID_DOCUMENT_URL', 'Belge indirme adresi geçersiz.')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
    throw new ProviderError(
      'PRIVATE_DOCUMENT_URL',
      'Belge adresi genel erişimli HTTPS adresi olmalı.',
    )
  const response = await new Promise<{ buffer?: Buffer; redirect?: string }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        family: addresses[0].family,
        lookup: (_hostname, _options, callback) =>
          callback(null, addresses[0].address, addresses[0].family),
        headers: { accept: 'application/pdf,image/*,application/octet-stream' },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume()
          resolve({ redirect: new URL(res.headers.location, url).href })
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(
            new ProviderError(
              'DOCUMENT_DOWNLOAD_FAILED',
              'Belge indirilemedi; sağlayıcı bağlantısı yenilenmeli.',
              true,
              30,
            ),
          )
          return
        }
        let length = 0
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          length += chunk.length
          if (length > limit) {
            req.destroy(new ProviderError('DOCUMENT_TOO_LARGE', 'Belge boyut sınırını aştı.'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    req.setTimeout(25000, () =>
      req.destroy(new ProviderError('DOCUMENT_TIMEOUT', 'Belge indirme süresi aşıldı.', true, 30)),
    )
    req.on('error', reject)
    req.end()
  })
  return response.redirect
    ? downloadPublicFile(response.redirect, limit, redirects + 1)
    : response.buffer!
}
