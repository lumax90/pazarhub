import { useState } from 'react'
import { Button } from '@heroui/react'
import { useApp } from '../../app/AppProvider'
import type { Product, Variant } from '../../domain/types'
import { MAIN_WAREHOUSE, stockAt, warehouseReserved, warehouses } from '../../domain/inventory'
import { stockReasons } from '../../domain/inventory-base'
import { Dialog, Field, SelectButton } from '../ui/shared'

export function StockMovementDialog({
  product,
  variant,
  direction,
  warehouseId = MAIN_WAREHOUSE,
  onClose,
}: {
  product: Product
  variant: Variant
  direction: 'in' | 'out'
  warehouseId?: string
  onClose: () => void
}) {
  const { state, run, can } = useApp()
  const [warehouse, setWarehouse] = useState(warehouseId),
    [expected, setExpected] = useState(stockAt(variant, warehouseId)),
    [quantity, setQuantity] = useState('1'),
    [reason, setReason] = useState('other'),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const current =
    state.products
      .find((item) => item.id === product.id)
      ?.variants.find((item) => item.id === variant.id) ?? variant
  const after = expected + Number(quantity) * (direction === 'in' ? 1 : -1)
  const save = async () => {
    if (busy || !can('stock.write')) return
    setBusy(true)
    setError('')
    const result = await run({
      type: 'stock.record',
      variantId: variant.id,
      warehouseId: warehouse,
      direction,
      quantity: Number(quantity),
      reason,
      note,
      expectedQuantity: expected,
    })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      title={direction === 'in' ? 'Stok girişi' : 'Stok çıkışı'}
      description={`${product.name} · ${variant.sku}`}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            form="stock-movement-form"
            type="submit"
            isDisabled={
              busy ||
              !Number.isInteger(Number(quantity)) ||
              Number(quantity) < 1 ||
              (!state.ecommerce?.allowNegativeStock &&
                after < warehouseReserved(state, variant.id, warehouse))
            }
          >
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id="stock-movement-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        className="form-section"
      >
        <SelectButton
          label="Hareket deposu"
          value={warehouse}
          onChange={(value) => {
            setWarehouse(value)
            setExpected(stockAt(current, value))
          }}
          isDisabled={busy}
          options={warehouses(state)
            .filter((item) => item.active)
            .map((item) => ({ id: item.id, label: item.name }))}
        />
        <div className="stock-adjustment-summary">
          <span>
            Mevcut bakiye<strong>{expected}</strong>
          </span>
          <span>
            Rezerve<strong>{warehouseReserved(state, variant.id, warehouse)}</strong>
          </span>
          <span>
            Hareket sonrası<strong>{after}</strong>
          </span>
        </div>
        <Field
          label="Miktar"
          type="number"
          min={1}
          max={10000}
          step={1}
          value={quantity}
          onChange={setQuantity}
          required
          isDisabled={busy}
        />
        <SelectButton
          label="Hareket sebebi"
          value={reason}
          onChange={setReason}
          options={stockReasons[direction]}
          isDisabled={busy}
        />
        <Field label="Not" value={note} onChange={setNote} maxLength={1000} isDisabled={busy} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
