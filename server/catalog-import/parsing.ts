import { AppError, ProviderError } from '../errors'
import { parseXml } from '../integrations/soap'
import type { ImportField } from '../../src/domain/catalog-import'

export interface ImportData {
  columns: string[]
  rows: Record<string, string>[]
  recordPath?: string
  recordPaths: { path: string; count: number }[]
}
function invalid(message: string): never {
  throw new AppError(422, 'IMPORT_FILE_INVALID', message)
}
function csvRecords(text: string, delimiter: string, firstOnly = false): string[][] {
  const records: string[][] = [],
    row: string[] = [],
    buffer: string[] = []
  let quoted = false,
    closed = false
  const cell = () => {
    row.push(buffer.join(''))
    buffer.length = 0
    closed = false
    if (row.length > 80) invalid('Dosyada en fazla 80 sütun kullanılabilir.')
  }
  const record = () => {
    cell()
    if (row.some((v) => v.trim())) records.push([...row])
    row.length = 0
    if (records.length > 501) invalid('Bir dosyada en fazla 500 varyant içe alınabilir.')
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          buffer.push('"')
          i++
        } else {
          quoted = false
          closed = true
        }
      } else buffer.push(char)
      continue
    }
    if (char === '"') {
      if (buffer.length || closed)
        invalid('CSV tırnak yapısı geçersiz. Metin içindeki çift tırnakları iki kez yazın.')
      quoted = true
    } else if (char === delimiter) cell()
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      record()
      if (firstOnly && records.length) return records
    } else if (closed) {
      if (!/\s/.test(char)) invalid('CSV kapanış tırnağından sonra ayraç bekleniyor.')
    } else buffer.push(char)
  }
  if (quoted) invalid('CSV dosyasında kapanmamış çift tırnak var.')
  if (buffer.length || row.length || closed) record()
  return records
}
const flatten = (row: Record<string, unknown>, prefix = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))
      .flatMap(([key, value]) => {
        const name = prefix ? `${prefix}.${key}` : key
        if (Array.isArray(value)) {
          if (value.every((v) => typeof v === 'string' || typeof v === 'number'))
            return [[name, value.join('|')]]
          return []
        }
        if (value && typeof value === 'object')
          return Object.entries(flatten(value as Record<string, unknown>, name))
        return [[name, value == null ? '' : String(value)]]
      }),
  )
export function parseImport(text: string, format: 'csv' | 'xml', path?: string): ImportData {
  text = text.replace(/^\uFEFF/, '')
  if (!text.trim() || text.includes('\0') || Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024)
    invalid('Boş olmayan, en fazla 2 MB UTF-8 CSV veya XML dosyası seçin.')
  if (format === 'csv') {
    const choices = [';', ',', '\t']
      .map((delimiter) => {
        try {
          return { delimiter, count: csvRecords(text, delimiter, true)[0]?.length ?? 0 }
        } catch {
          return { delimiter, count: 0 }
        }
      })
      .sort((a, b) => b.count - a.count)
    const records = csvRecords(text, choices[0].delimiter),
      columns = (records.shift() ?? []).map((s) => s.trim())
    if (
      !columns.length ||
      columns.some((s) => !s || s.length > 160) ||
      new Set(columns).size !== columns.length
    )
      invalid('CSV sütun başlıkları dolu ve benzersiz olmalı.')
    if (!records.length) invalid('CSV dosyasında başlıktan sonra en az bir kayıt olmalı.')
    const rows = records.map((row, index) => {
      if (row.length !== columns.length)
        invalid(`${index + 1}. kayıttaki sütun sayısı başlıkla uyuşmuyor.`)
      return Object.fromEntries(columns.map((c, i) => [c, row[i]]))
    })
    return { columns, rows, recordPaths: [] }
  }
  let document: Record<string, unknown>
  try {
    document = parseXml(text)
  } catch (error) {
    if (error instanceof ProviderError)
      invalid('XML geçerli olmalı; DTD veya özel entity tanımları desteklenmez.')
    throw error
  }
  const candidates = new Map<string, Record<string, unknown>[]>()
  const walk = (value: unknown, parts: string[], depth: number) => {
    if (depth > 20) invalid('XML kayıt yolu en fazla 20 seviye olabilir.')
    if (Array.isArray(value)) {
      for (const item of value) walk(item, parts, depth)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>,
      key = parts.join('.')
    const scalars = Object.values(record).filter((v) => v == null || typeof v !== 'object').length
    if (key && scalars >= 2) {
      const items = candidates.get(key) ?? []
      items.push(record)
      if (items.length > 500) invalid('Bir dosyada en fazla 500 varyant içe alınabilir.')
      candidates.set(key, items)
    }
    for (const [name, child] of Object.entries(record))
      if (!name.startsWith('?')) walk(child, [...parts, name], depth + 1)
  }
  walk(document, [], 0)
  const recordPaths = [...candidates]
    .map(([path, items]) => ({ path, count: items.length }))
    .sort((a, b) => b.count - a.count || a.path.length - b.path.length)
  const recordPath = path || recordPaths[0]?.path
  const selected = recordPath ? candidates.get(recordPath) : undefined
  if (!selected?.length)
    invalid('XML içinde alanları olan ürün kayıtları bulunamadı. Kayıt yolunu kontrol edin.')
  const rows = selected!.map((row) => flatten(row)),
    columns = [...new Set(rows.flatMap(Object.keys))]
  if (columns.length > 80) invalid('XML kaydında en fazla 80 alan kullanılabilir.')
  return { columns, rows, recordPaths, recordPath }
}
const key = (value: string) =>
  value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replaceAll('ı', 'i')
    .replace(/[^a-z0-9]/g, '')
export function suggestMapping(columns: string[]): Partial<Record<ImportField, string>> {
  const aliases: Record<ImportField, string[]> = {
    sku: ['sku', 'stokkodu', 'stockcode'],
    name: ['urun', 'urunadi', 'productname', 'name', 'title'],
    model: ['model', 'modelkodu', 'ortakmodelkodu', 'groupcode', 'productmainid'],
    variant: ['varyant', 'varyantadi', 'variant', 'variantname'],
    barcode: ['barkod', 'barcode', 'gtin'],
    category: ['kategori', 'category', 'categoryname'],
    brand: ['marka', 'brand', 'brandname'],
    currency: ['parabirimi', 'currency', 'doviz'],
    price: ['satisfiyati', 'satisfiyatitl', 'price', 'saleprice', 'fiyat'],
    cost: ['alismaliyeti', 'alisfiyati', 'cost', 'purchaseprice'],
    stock: ['stok', 'depootogu', 'quantity', 'stock', 'stockcount', 'anadepostoku'],
    taxRate: ['kdv', 'kdvorani', 'vatrate', 'taxrate'],
    description: ['aciklama', 'description', 'fullDescription'],
    images: ['gorseller', 'images', 'imageurl', 'resimler'],
  }
  return Object.fromEntries(
    Object.entries(aliases).flatMap(([field, names]) => {
      const column = columns.find((c) => names.map(key).includes(key(c.split('.').at(-1)!)))
      return column ? [[field, column]] : []
    }),
  )
}
export function parseImportNumber(value: string, decimal: ',' | '.', money = false) {
  const group = decimal === ',' ? '\\.' : ',',
    point = decimal === ',' ? ',' : '\\.'
  const regex = new RegExp(
    `^(?:\\d+|\\d{1,3}(?:${group}\\d{3})+)(?:${point}\\d{1,${money ? 2 : 4}})?$`,
  )
  const clean = value.trim()
  if (!regex.test(clean))
    invalid(`“${value.slice(0, 35)}” geçerli sayı değil. Ondalık ayracı ${decimal} olmalı.`)
  const normalized = clean.replaceAll(decimal === ',' ? '.' : ',', '').replace(decimal, '.')
  const amount = money ? Math.round(Number(normalized) * 100) : Number(normalized)
  if (!Number.isFinite(amount) || amount < 0 || amount > (money ? 1_000_000_000 : 100_000_000))
    invalid('Sayı desteklenen aralığın dışında.')
  return amount
}
