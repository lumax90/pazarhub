import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { ArrowRightLeft, Check, ClipboardCheck, Plus, Warehouse } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { findVariant } from '../../domain/selectors'
import { MAIN_WAREHOUSE, warehouses } from '../../domain/inventory'
import type { StockCount } from '../../domain/types'
import { Dialog, Field, SelectButton } from '../ui/shared'
import { DataTable } from '../ui/DataTable'
import { dateLabel } from '../../lib/format'
import { WarehouseEditor } from './WarehouseEditor'

export function InventoryTools({ variantIds }: { variantIds: string[] }) {
  const { state, run, can } = useApp()
  const [mode, setMode] = useState<'warehouse' | 'transfer' | 'count' | null>(null)
  const [name, setName] = useState(''),
    [variantId, setVariantId] = useState(''),
    [from, setFrom] = useState(MAIN_WAREHOUSE),
    [to, setTo] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const options = warehouses(state)
    .filter((w) => w.active)
    .map((w) => ({ id: w.id, label: w.name }))
  const open = (next: typeof mode) => {
    setMode(next)
    setName('')
    setError('')
    setRequestId(crypto.randomUUID())
  }
  const save = async () => {
    if (busy || !mode || mode === 'warehouse') return
    setBusy(true)
    const result = await run(
      mode === 'transfer'
        ? { type: 'stock.transfer', variantId, from, to, quantity: Number(quantity), note: name }
        : {
            type: 'stock.count.create',
            id: requestId,
            name,
            warehouseId: from,
            variantIds: variantIds.slice(0, 200),
          },
    )
    setBusy(false)
    if (result.ok) setMode(null)
    else setError(result.message)
  }
  return (
    <>
      <div className="inventory-tool-row">
        <span>
          <Warehouse size={15} />
          {warehouses(state).length} depo
        </span>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={!can('stock.write')}
          onPress={() => open('warehouse')}
        >
          <Plus size={14} />
          Depo ekle
        </Button>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={!can('stock.write') || options.length < 2}
          onPress={() => open('transfer')}
        >
          <ArrowRightLeft size={14} />
          Depo transferi
        </Button>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={!can('stock.write') || !variantIds.length}
          onPress={() => open('count')}
        >
          <ClipboardCheck size={14} />
          Sayım aç
        </Button>
      </div>
      {mode === 'warehouse' && <WarehouseEditor onClose={() => setMode(null)} />}
      {mode && mode !== 'warehouse' && (
        <Dialog
          open
          title={mode === 'transfer' ? 'Depolar arası transfer' : 'Yeni stok sayımı'}
          onClose={() => {
            if (!busy) setMode(null)
          }}
          footer={
            <>
              <Button variant="secondary" isDisabled={busy} onPress={() => setMode(null)}>
                Vazgeç
              </Button>
              <Button
                variant="primary"
                isDisabled={
                  busy ||
                  !name.trim() ||
                  (mode === 'transfer' &&
                    (!variantId ||
                      !to ||
                      !Number.isInteger(Number(quantity)) ||
                      Number(quantity) < 1))
                }
                onPress={() => void save()}
              >
                <Check size={15} />
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </>
          }
        >
          <div className="form-section inventory-operation-form">
            <Field
              label={mode === 'count' ? 'Sayım adı' : 'Transfer açıklaması'}
              value={name}
              onChange={setName}
              required
              maxLength={1000}
              isDisabled={busy}
            />
            <div className="select-field">
              <label className="label">{mode === 'count' ? 'Sayılacak depo' : 'Kaynak depo'}</label>
              <SelectButton
                label={mode === 'count' ? 'Sayılacak depo' : 'Kaynak depo'}
                value={from}
                onChange={(value) => {
                  setFrom(value)
                  if (value === to) setTo('')
                }}
                options={options}
                isDisabled={busy}
              />
            </div>
            {mode === 'transfer' && (
              <>
                <div className="select-field">
                  <label className="label">Hedef depo</label>
                  <SelectButton
                    label="Hedef depo"
                    value={to}
                    onChange={setTo}
                    options={options.filter((o) => o.id !== from)}
                    isDisabled={busy}
                  />
                </div>
                <div className="select-field span-2">
                  <label className="label">Ürün / stok kodu</label>
                  <SelectButton
                    label="Transfer edilecek varyant"
                    value={variantId}
                    onChange={setVariantId}
                    options={state.products
                      .filter((p) => !p.bundle)
                      .flatMap((p) =>
                        p.variants.map((v) => ({ id: v.id, label: `${p.name} · ${v.sku}` })),
                      )}
                    isDisabled={busy}
                  />
                </div>
                <Field
                  type="number"
                  label="Transfer adedi"
                  value={quantity}
                  onChange={setQuantity}
                  required
                  min={1}
                  max={10000}
                  step={1}
                  isDisabled={busy}
                />
              </>
            )}
            {mode === 'count' && (
              <p className="description field-description">
                Geçerli filtredeki {Math.min(200, variantIds.length)} stok kodu sayılacak. Stok
                yalnız sayımı tamamladığınızda değişir.
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}

export function StockCounts({
  warehouseId,
  query = '',
}: { warehouseId?: string; query?: string } = {}) {
  const { state, run, can } = useApp()
  const [selected, setSelected] = useState<StockCount | null>(null),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const open = (count: StockCount) => {
    setSelected(count)
    setCounts({ ...count.counts })
    setError('')
  }
  const complete = async () => {
    if (!selected || busy) return
    setBusy(true)
    const result = await run({ type: 'stock.count.complete', id: selected.id, counts })
    setBusy(false)
    if (result.ok) setSelected(null)
    else setError(result.message)
  }
  return (
    <>
      <DataTable
        label="Stok sayımları"
        items={(state.stockCounts ?? []).filter(
          (count) =>
            (!warehouseId || count.warehouseId === warehouseId) &&
            count.name.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')),
        )}
        columns={[
          {
            id: 'name',
            label: 'Sayım',
            rowHeader: true,
            cell: (c) => (
              <button
                className="button button--sm button--ghost text-button"
                onClick={() => open(c)}
              >
                {c.name}
              </button>
            ),
          },
          {
            id: 'warehouse',
            label: 'Depo',
            cell: (c) => warehouses(state).find((w) => w.id === c.warehouseId)?.name,
          },
          { id: 'count', label: 'Stok kodu', cell: (c) => Object.keys(c.baseline).length },
          {
            id: 'status',
            label: 'Durum',
            cell: (c) => (
              <Chip
                size="sm"
                variant="soft"
                color={c.status === 'completed' ? 'success' : 'warning'}
              >
                {c.status === 'completed' ? 'Tamamlandı' : 'Açık sayım'}
              </Chip>
            ),
          },
          { id: 'date', label: 'Tarih', cell: (c) => dateLabel(c.createdAt, true) },
        ]}
      />
      {selected && (
        <Dialog
          open
          wide
          title={selected.name}
          description="Sayım sırasında stok hareketi oluşursa güncel bakiyelerle yeni sayım açmanız gerekir."
          onClose={() => setSelected(null)}
          footer={
            <>
              <Button variant="secondary" onPress={() => setSelected(null)}>
                Kapat
              </Button>
              {selected.status === 'open' && can('stock.write') && (
                <Button variant="primary" isDisabled={busy} onPress={() => void complete()}>
                  Sayımı tamamla
                </Button>
              )}
            </>
          }
        >
          <div className="count-lines">
            {Object.entries(selected.baseline).map(([variantId, baseline]) => (
              <div key={variantId}>
                <span>
                  <strong>{findVariant(state, variantId)?.product.name}</strong>
                  <small>
                    {findVariant(state, variantId)?.variant.sku} · Kayıtlı: {baseline}
                  </small>
                </span>
                <Field
                  label="Sayılan miktar"
                  type="number"
                  value={String(counts[variantId] ?? '')}
                  onChange={(value) =>
                    setCounts((current) => ({ ...current, [variantId]: Number(value) }))
                  }
                  readOnly={selected.status === 'completed'}
                />
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </>
  )
}
