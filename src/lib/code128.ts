/**
 * Code 128 bar/space widths for symbol values 0–106, the standard table (106 is the stop
 * symbol including its final bar). Each symbol is 11 modules wide; the stop is 13.
 */
const patterns = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212',
  '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221',
  '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221',
  '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321',
  '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131',
  '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131',
  '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111',
  '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242',
  '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311',
  '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] // prettier-ignore
export const code128Patterns: readonly string[] = patterns

const CODE_C = 99,
  CODE_B = 100,
  START_B = 104,
  START_C = 105,
  STOP = 106
/** Quiet zone on each side, in modules; scanners need at least ten. */
export const QUIET_ZONE = 10

export function code128Encodable(text: string) {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text)
}

/** Check symbol: start value plus each data value times its position, modulo 103. */
export function code128Checksum(values: number[]) {
  return values.reduce((sum, value, index) => sum + value * Math.max(index, 1), 0) % 103
}

/**
 * Symbol values (start and data, without check and stop). Runs of four or more digits
 * use code set C, two digits per symbol; everything else uses code set B.
 */
export function code128Values(text: string) {
  if (!code128Encodable(text))
    throw new Error('Barkod yalnız Latin harf, rakam ve işaret içerebilir.')
  const values: number[] = []
  let set: 'B' | 'C' | undefined
  const switchTo = (next: 'B' | 'C') => {
    if (set === next) return
    values.push(set ? (next === 'C' ? CODE_C : CODE_B) : next === 'C' ? START_C : START_B)
    set = next
  }
  const digits = (from: number) => /^\d*/.exec(text.slice(from))![0].length
  let index = 0
  while (index < text.length) {
    const run = digits(index)
    const edge = index === 0 || index + run === text.length
    if (run >= 2 && (set === 'C' || run >= (edge ? 4 : 6))) {
      // An odd run leaves its first digit in code set B so the rest pairs up.
      if (set !== 'C' && run % 2) {
        switchTo('B')
        values.push(text.charCodeAt(index++) - 32)
      }
      switchTo('C')
      while (digits(index) >= 2) {
        values.push(Number(text.slice(index, index + 2)))
        index += 2
      }
    } else {
      switchTo('B')
      values.push(text.charCodeAt(index++) - 32)
    }
  }
  return values
}

/** Bar and space widths in modules, starting with a bar; quiet zones not included. */
export function code128Widths(text: string) {
  const values = code128Values(text)
  return [...values, code128Checksum(values), STOP].flatMap((value) =>
    [...patterns[value]].map(Number),
  )
}
