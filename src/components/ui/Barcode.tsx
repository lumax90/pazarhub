import { code128Widths, QUIET_ZONE } from '../../lib/code128'

/** One dot of a 203 dpi thermal printer, the coarsest printer a label meets. */
const DOT_MM = 25.4 / 203

/**
 * Code 128 drawn in physical units. The module width is snapped to whole printer dots so
 * every bar keeps its exact width ratio when a thermal printer rasterises it.
 */
export function Barcode({
  value,
  widthMm,
  heightMm,
}: {
  value: string
  widthMm: number
  heightMm: number
}) {
  const widths = code128Widths(value)
  const modules = widths.reduce((sum, width) => sum + width, 0) + QUIET_ZONE * 2
  const fitted = widthMm / modules
  // Two dots per module is the readable minimum; past four dots a wider bar adds nothing.
  const module = fitted >= DOT_MM * 2 ? Math.min(Math.floor(fitted / DOT_MM), 4) * DOT_MM : fitted
  let path = ''
  for (let index = 0, x = QUIET_ZONE; index < widths.length; x += widths[index++])
    if (index % 2 === 0) path += `M${x} 0h${widths[index]}v1h-${widths[index]}z`
  return (
    <svg
      className="order-print-label-barcode"
      role="img"
      aria-label={`Barkod ${value}`}
      viewBox={`0 0 ${modules} 1`}
      preserveAspectRatio="none"
      width={`${(modules * module).toFixed(3)}mm`}
      height={`${heightMm}mm`}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}
