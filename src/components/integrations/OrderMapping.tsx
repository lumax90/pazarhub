import { useState } from 'react'
import { Button } from '@heroui/react'
import { Link2 } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { Order } from '../../domain/types'
import { apiRequest } from '../../lib/api'
import { SelectButton } from '../ui/shared'

export function OrderMapping({ order }: { order: Order }) {
  const { state, mode, refresh, notify, can } = useApp()
  const [selected, setSelected] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false)
  const apply = async (lineId: string) => {
    setBusy(true)
    try {
      await apiRequest(`/api/orders/${order.id}/map-line`, {
        method: 'POST',
        body: { lineId, variantId: selected[lineId] },
      })
      await refresh()
      notify('Sipariş satırı eşlendi.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Eşleme yapılamadı.', 'error')
    } finally {
      setBusy(false)
    }
  }
  const reconcile = async () => {
    setBusy(true)
    try {
      await apiRequest(`/api/orders/${order.id}/reconcile-stock`, { method: 'POST', body: {} })
      await refresh()
      notify('Sipariş stok hareketi tamamlandı.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Stok işlenemedi.', 'error')
    } finally {
      setBusy(false)
    }
  }
  if (mode !== 'live') return null
  return (
    <div className="order-mapping-actions">
      {order.lines
        .filter((line) => !line.variantId && line.externalId)
        .map((line) => (
          <div className="form-section" key={line.externalId}>
            <p className="description field-description">
              {line.title} · {line.externalSku || line.externalBarcode} · yerel ürün eşlemesi
              gerekli
            </p>
            <SelectButton
              label={`${line.title} varyant eşlemesi`}
              value={selected[line.externalId!] ?? ''}
              onChange={(value) =>
                setSelected((items) => ({ ...items, [line.externalId!]: value }))
              }
              options={state.products.flatMap((p) =>
                p.variants.map((v) => ({ id: v.id, label: `${p.name} · ${v.sku}` })),
              )}
            />
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy || !selected[line.externalId!] || !can('orders.write')}
              onPress={() => void apply(line.externalId!)}
            >
              <Link2 size={14} />
              Satırı bağla
            </Button>
          </div>
        ))}
      {!order.historical &&
        !order.inventoryApplied &&
        ['shipped', 'delivered'].includes(order.status) && (
          <Button
            variant="secondary"
            isDisabled={busy || !can('stock.write')}
            onPress={() => void reconcile()}
          >
            Eksik stok işlemini tamamla
          </Button>
        )}
      {order.syncError && <p className="form-error">{order.syncError}</p>}
    </div>
  )
}
