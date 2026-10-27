import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { MAIN_WAREHOUSE, stockAt, warehouseReserved, warehouses } from '../../domain/inventory'
import type { Product, Variant } from '../../domain/types'
import { Dialog, Field, SelectButton } from '../ui/shared'

export function StockAdjustment({
  product,
  variant,
  initialWarehouseId = MAIN_WAREHOUSE,
  onClose,
}: {
  product: Product
  variant: Variant
  initialWarehouseId?: string
  onClose: () => void
}) {
  const { state, run, can } = useApp()
  const [warehouseId, setWarehouse] = useState(initialWarehouseId)
  const [expected, setExpected] = useState(stockAt(variant, initialWarehouseId))
  const [quantity, setQuantity] = useState(String(expected)),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const current =
    state.products.find((p) => p.id === product.id)?.variants.find((v) => v.id === variant.id) ??
    variant
  const changed = stockAt(current, warehouseId) !== expected
  const load = (warehouse: string) => {
    const value = stockAt(current, warehouse)
    setWarehouse(warehouse)
    setExpected(value)
    setQuantity(String(value))
    setError('')
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !can('stock.write')) return
    setBusy(true)
    setError('')
    const result = await run({
      type: 'stock.adjust',
      variantId: variant.id,
      quantity: Number(quantity),
      note,
      warehouseId,
      expectedQuantity: expected,
    })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      title="Stok düzeltmesi"
      description={`${product.name} · ${variant.name}`}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="stock-adjustment-form"
            isDisabled={
              busy ||
              !can('stock.write') ||
              changed ||
              !quantity.trim() ||
              !Number.isInteger(Number(quantity)) ||
              (!state.ecommerce?.allowNegativeStock && Number(quantity) < 0) ||
              !note.trim()
            }
          >
            {busy ? 'Kaydediliyor…' : 'Düzeltmeyi kaydet'}
          </Button>
        </>
      }
    >
      <form id="stock-adjustment-form" onSubmit={save}>
        <div className="form-section">
          <SelectButton
            label="Düzeltilecek depo"
            value={warehouseId}
            onChange={load}
            options={warehouses(state)
              .filter((w) => w.active)
              .map((w) => ({ id: w.id, label: w.name }))}
            isDisabled={busy}
          />
        </div>
        {changed && (
          <div className="product-conflict" role="status">
            <span>
              Bu depodaki stok {stockAt(current, warehouseId)} oldu. Güncel miktarı yükleyin.
            </span>
            <Button size="sm" variant="secondary" onPress={() => load(warehouseId)}>
              <RefreshCw size={14} />
              Güncel miktarı yükle
            </Button>
          </div>
        )}
        <div className="stock-adjustment-summary">
          <span>
            Mevcut stok<strong>{expected}</strong>
          </span>
          <span>
            Rezerve<strong>{warehouseReserved(state, variant.id, warehouseId)}</strong>
          </span>
          <span>
            Fark
            <strong>
              {Number(quantity) - expected > 0 ? '+' : ''}
              {Number(quantity) - expected}
            </strong>
          </span>
        </div>
        <div className="form-grid">
          <Field
            label="Yeni stok miktarı"
            type="number"
            min={state.ecommerce?.allowNegativeStock ? -100000000 : 0}
            max={100000000}
            step={1}
            value={quantity}
            onChange={setQuantity}
            required
            isDisabled={busy || !can('stock.write')}
          />
          <Field
            label="Düzeltme nedeni"
            value={note}
            onChange={setNote}
            required
            maxLength={1000}
            placeholder="Örn. Depo sayımı"
            isDisabled={busy || !can('stock.write')}
          />
        </div>
        <p className="description field-description">
          Fark, seçilen depoya ve hareket defterine aynı işlemde kaydedilir.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
