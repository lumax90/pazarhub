import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { useApp } from '../../app/AppProvider'
import type { Order } from '../../domain/types'
import type { RemoteOrder } from '../../domain/integrations'
import { useResource } from '../../lib/useResource'
import { apiMutation, apiRequest } from '../../lib/api'
import { money, dateLabel } from '../../lib/format'
import { Dialog, Field, Panel } from '../ui/shared'
import { DataTable } from '../ui/DataTable'
import { AsyncState } from '../ui/AsyncState'
import { SearchSelect } from '../ui/SearchSelect'

interface ReconciliationPreview {
  previewId: string
  beforeTotal: number
  afterTotal: number
  economicChanged: boolean
  status: string
  movements: { variantId: string; quantity: number; warehouseId: string; name: string }[]
}
export function OrderReconciliation({ order }: { order: Order }) {
  const { can } = useApp(),
    [open, setOpen] = useState(false)
  if (!order.externalId || !order.syncError) return null
  return (
    <Panel
      title="Sipariş uzlaştırması"
      description={order.syncError}
      className="product-form-card"
      actions={
        <Button variant="secondary" isDisabled={!can('orders.write')} onPress={() => setOpen(true)}>
          Kalemleri uzlaştır
        </Button>
      }
    >
      {open && <ReconciliationEditor order={order} onClose={() => setOpen(false)} />}
    </Panel>
  )
}
function ReconciliationEditor({ order, onClose }: { order: Order; onClose: () => void }) {
  const { state, refresh, notify } = useApp(),
    resource = useResource<{ remote: RemoteOrder; mappings: Record<string, string> }>(
      `/api/orders/${order.id}/reconciliation`,
    )
  const [draft, setDraft] = useState<Record<string, string> | null>(null),
    [restock, setRestock] = useState(order.status === 'approved'),
    [note, setNote] = useState(''),
    [preview, setPreview] = useState<ReconciliationPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const mappings = draft ?? resource.data?.mappings ?? {}
  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      setPreview(
        await apiRequest(`/api/orders/${order.id}/reconciliation/preview`, {
          method: 'POST',
          body: { mappings, restockRemoved: restock, note },
        }),
      )
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const apply = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      await apiMutation(`/api/orders/${order.id}/reconciliation/apply`, {
        previewId: preview.previewId,
      })
      await refresh()
      notify('Sipariş, stok ve tutarlar doğrulanan plana göre uzlaştırıldı.')
      onClose()
    } catch (error) {
      setError((error as Error).message)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      wide
      title="Pazaryeri kalemlerini uzlaştır"
      description={order.externalNumber || order.number}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Kapat
          </Button>
          {preview ? (
            <Button variant="primary" isDisabled={busy} onPress={() => void apply()}>
              Doğrulanan planı uygula
            </Button>
          ) : (
            <Button
              variant="primary"
              isDisabled={busy || !resource.data || note.trim().length < 3}
              onPress={() => void prepare()}
            >
              Etkiyi önizle
            </Button>
          )}
        </>
      }
    >
      <div className="margin-rule-form">
        <AsyncState loading={resource.loading} error={resource.error} />
        {resource.data && (
          <>
            <p className="description field-description">
              Pazaryeri kaydı: {dateLabel(resource.data.remote.modifiedAt, true)}. Eşleme, miktar ve
              tutar farkları uygulanmadan önce sunucuda doğrulanır.
            </p>
            <DataTable
              label="Güncel pazaryeri kalemleri"
              items={resource.data.remote.lines.map((line) => ({ ...line, id: line.externalId }))}
              columns={[
                {
                  id: 'name',
                  label: 'Pazaryeri ürünü',
                  rowHeader: true,
                  cell: (line) => (
                    <div>
                      {line.title}
                      <small className="cell-secondary">
                        {line.sku || line.barcode} · {line.status || resource.data?.remote.status}
                      </small>
                    </div>
                  ),
                },
                { id: 'quantity', label: 'Adet', cell: (line) => line.quantity },
                {
                  id: 'total',
                  label: 'Tutar',
                  cell: (line) => money(line.total ?? line.unitPrice * line.quantity),
                },
                {
                  id: 'mapping',
                  label: 'Yerel varyant',
                  cell: (line) =>
                    ['cancelled', 'returned'].includes(line.status ?? '') ? (
                      'İptal / iade edilen kalem'
                    ) : (
                      <SearchSelect
                        label={`${line.title} eşlemesi`}
                        value={mappings[line.id] ?? ''}
                        onChange={(value) => {
                          setDraft({ ...mappings, [line.id]: value })
                          setPreview(null)
                        }}
                        options={state.products.flatMap((product) =>
                          product.variants.map((variant) => ({
                            id: variant.id,
                            label: `${product.name} · ${variant.name}`,
                            description: variant.sku,
                          })),
                        )}
                        disabled={busy || !!preview}
                      />
                    ),
                },
              ]}
              paginate={false}
            />
          </>
        )}
        <Checkbox
          className="app-checkbox"
          isSelected={restock}
          isDisabled={busy || !!preview}
          onChange={(value) => {
            setRestock(value)
            setPreview(null)
          }}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Azalan / iptal edilen miktarı depoya geri ekle</Label>
          </Checkbox.Content>
        </Checkbox>
        <Field
          label="Uzlaştırma notu"
          value={note}
          onChange={(value) => {
            setNote(value)
            setPreview(null)
          }}
          isDisabled={busy || !!preview}
          maxLength={1000}
        />
        {preview && (
          <>
            <div className="inline-summary">
              <span>
                Önce: <strong>{money(preview.beforeTotal)}</strong>
              </span>
              <span>
                Sonra: <strong>{money(preview.afterTotal)}</strong>
              </span>
            </div>
            <DataTable
              label="Uygulanacak stok farkları"
              items={preview.movements.map((item) => ({
                ...item,
                id: JSON.stringify([item.warehouseId, item.variantId]),
              }))}
              columns={[
                {
                  id: 'product',
                  label: 'Fiziksel ürün',
                  rowHeader: true,
                  cell: (item) => item.name,
                },
                {
                  id: 'quantity',
                  label: 'Stok değişimi',
                  cell: (item) => `${item.quantity > 0 ? '+' : ''}${item.quantity}`,
                },
                {
                  id: 'warehouse',
                  label: 'Depo',
                  cell: (item) =>
                    state.warehouses?.find((warehouse) => warehouse.id === item.warehouseId)
                      ?.name ?? item.warehouseId,
                },
              ]}
              paginate={false}
              emptyTitle="Fiziksel stok değişimi yok"
            />
            <Button variant="secondary" isDisabled={busy} onPress={() => setPreview(null)}>
              Eşlemeye dön
            </Button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
