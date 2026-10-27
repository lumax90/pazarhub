const currency = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 2,
})
const number = new Intl.NumberFormat('tr-TR')

export const money = (cents: number) => currency.format(cents / 100)
export function moneyTicks(value: string | null | undefined) {
  if (value == null) return '—'
  const ticks = BigInt(value),
    absolute = ticks < 0n ? -ticks : ticks
  const fraction = (absolute % 10000n)
    .toString()
    .padStart(4, '0')
    .replace(/0{1,2}$/, '')
  return `${ticks < 0n ? '−' : ''}₺${(absolute / 10000n).toLocaleString('tr-TR')},${fraction}`
}
export const count = (value: number) => number.format(value)
export const compactMoney = (cents: number) =>
  new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(
    cents / 100,
  ) + ' ₺'
export const dateLabel = (date: string, withTime = false) =>
  new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(date))
export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase('tr-TR')
export const searchText = (value: string) =>
  value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replaceAll('ı', 'i')
export const matches = (value: string, query: string) =>
  searchText(value).includes(searchText(query.trim()))
export const dayKey = (date: string | Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date))

export function parseMoney(value: string): number {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return NaN
  return Math.round(Number(normalized) * 100)
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    let text = String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  const content = '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
