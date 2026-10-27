import { useApp } from '../../app/AppProvider'
import type { OrderLine } from '../../domain/types'
import { snapshotBundle } from '../../domain/bundles'

export function BundleContents({ line, expanded }: { line: OrderLine; expanded?: boolean }) {
  const { state } = useApp()
  const parts = line.bundleComponents ?? snapshotBundle(state, line.variantId)
  if (!parts?.length) return null
  return (
    <details className="sale-bundle-contents" open={expanded}>
      <summary>
        {line.bundleComponents ? 'Siparişin paket içeriği' : 'Güncel paket içeriği'}{' '}
        <span>{parts.length} ürün</span>
      </summary>
      <div>
        {parts.map((part) => (
          <div key={part.variantId}>
            <span>
              <strong>{part.title}</strong>
              <small>
                {part.sku} · {part.variantName}
              </small>
            </span>
            <span>
              <small>Pakette {part.quantity}</small>
              <strong>{part.quantity * line.quantity} adet</strong>
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}
