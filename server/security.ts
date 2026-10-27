import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'

export const token = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  )
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return `scrypt-v1$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split('$')
  if (algorithm !== 'scrypt-v1' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await derive(password, Buffer.from(salt, 'base64url'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function seal(value: Record<string, string>, key: Buffer, context: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(context))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

export function unseal(encoded: string, key: Buffer, context: string): Record<string, string> {
  const [version, iv, tag, encrypted] = encoded.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted)
    throw new Error('Invalid encrypted credential envelope.')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  )
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
