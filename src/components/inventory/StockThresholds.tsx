import { useState } from 'react'
import { Button } from '@heroui/react'
import { useApp } from '../../app/AppProvider'
import { warehouses } from '../../domain/inventory'
import type { Variant } from '../../domain/types'
import { Dialog, Field } from '../ui/shared'

export function StockThresholds({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  const { state, run } = useApp(),
    [expected] = useState({ ...variant.lowStockByWarehouse }),
    [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        Object.entries(variant.lowStockByWarehouse ?? {}).map(([id, value]) => [id, String(value)]),
      ),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <Dialog
      open
      title="Depo kritik seviyeleri"
      description={variant.sku}
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
            isDisabled={busy}
            onPress={async () => {
              setBusy(true)
              const result = await run({
                type: 'stock.thresholds',
                variantId: variant.id,
                expected,
                thresholds: Object.fromEntries(
                  Object.entries(values)
                    .filter(([, value]) => value !== '')
                    .map(([id, value]) => [id, Number(value)]),
                ),
              })
              setBusy(false)
              if (result.ok) onClose()
              else setError(result.message)
            }}
          >
            Kaydet
          </Button>
        </>
      }
    >
      <div className="margin-rule-form">
        {warehouses(state).map((warehouse) => (
          <Field
            key={warehouse.id}
            label={`${warehouse.name} kritik seviye`}
            type="number"
            min={0}
            max={100000000}
            step={1}
            value={values[warehouse.id] ?? ''}
            onChange={(value) => setValues((current) => ({ ...current, [warehouse.id]: value }))}
            isDisabled={busy}
          />
        ))}
        <p className="description field-description">
          Depo bakiyesi bu değere indiğinde ürün düşük stokta gösterilir. Boş bırakılan depoda
          ürünün genel eşiği kullanılır.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
