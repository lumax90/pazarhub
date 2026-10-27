import { code128 } from 'bwip-js/browser'
import type BwipJs from 'bwip-js/browser'

/** Quiet zone on each side, in modules; scanners need at least ten. */
export const QUIET_ZONE = 10
/** An even device scale keeps every bar edge on a whole unit. */
const SCALE = 2

/**
 * Bar and space widths in modules, starting with a bar, as encoded by BWIPP (bwip-js).
 * Only the Code 128 encoder is imported, so the label page does not load every barcode
 * type. bwip-js draws linear bars as stroked vertical lines; we record them instead of
 * painting. tests/code128.test.ts checks the result against bwip-js's own raw() output.
 * Quiet zones are not included. BWIPP encodes any bytes, so callers keep to printable
 * ASCII if a scanner must read the text back unchanged.
 */
export function code128Widths(text: string) {
  const bars: [left: number, width: number][] = []
  const drawing: BwipJs.DrawingContext<void> = {
    scale: () => null,
    measure: () => ({ width: 0, ascent: 0, descent: 0 }),
    init: () => {},
    line: (x0, _y0, x1, _y1, width) => {
      if (x0 === x1) bars.push([x0 - width / 2, width])
    },
    polygon: () => {},
    hexagon: () => {},
    ellipse: () => {},
    fill: () => {},
    text: () => {},
    end: () => {},
  }
  // No ink-spread compensation: we want the nominal widths, not thinned print bars.
  code128({ bcid: 'code128', text, scale: SCALE, inkspread: 0, includetext: false }, drawing)
  if (!bars.length) throw new Error('Code 128 barkodu oluşturulamadı.')
  bars.sort((a, b) => a[0] - b[0])
  return bars.flatMap(([left, width], index) =>
    index
      ? [(left - bars[index - 1][0] - bars[index - 1][1]) / SCALE, width / SCALE]
      : [width / SCALE],
  )
}
