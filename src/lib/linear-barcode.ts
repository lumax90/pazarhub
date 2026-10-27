import { code128, ean13, ean8, upca } from 'bwip-js/browser'
import type BwipJs from 'bwip-js/browser'

// Only these encoders are imported, so print pages do not load every barcode type.
const encoders = { code128, ean13, ean8, upca }
export type Symbology = keyof typeof encoders

/** Quiet zone on each side, in modules: Code 128 needs ten, EAN/UPC eleven. */
export const quietZone = (symbology: Symbology) => (symbology === 'code128' ? 10 : 11)
/** An even device scale keeps every bar edge on a whole unit. */
const SCALE = 2

/**
 * Bar and space widths in modules, starting with a bar, as encoded by BWIPP (bwip-js).
 * bwip-js draws linear bars as stroked vertical lines; we record them instead of
 * painting. tests/linear-barcode.test.ts checks the result against bwip-js's raw()
 * output. Quiet zones are not included. BWIPP's Code 128 encodes any bytes, so callers
 * keep to printable ASCII if a scanner must read the text back unchanged.
 */
export function barcodeWidths(text: string, symbology: Symbology = 'code128') {
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
  encoders[symbology](
    { bcid: symbology, text, scale: SCALE, inkspread: 0, includetext: false },
    drawing,
  )
  if (!bars.length) throw new Error('Barkod oluşturulamadı.')
  bars.sort((a, b) => a[0] - b[0])
  return bars.flatMap(([left, width], index) =>
    index
      ? [(left - bars[index - 1][0] - bars[index - 1][1]) / SCALE, width / SCALE]
      : [width / SCALE],
  )
}
