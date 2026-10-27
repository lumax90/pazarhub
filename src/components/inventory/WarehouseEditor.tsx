import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { useApp } from '../../app/AppProvider'
import type { Warehouse } from '../../domain/types'
import { MAIN_WAREHOUSE } from '../../domain/inventory'
import { Dialog, Field } from '../ui/shared'

export function WarehouseEditor({
  warehouse,
  onClose,
}: {
  warehouse?: Warehouse
  onClose: () => void
}) {
  const { run, can } = useApp()
  const [draft, setDraft] = useState<Warehouse>(() =>
    warehouse
      ? { ...warehouse, code: warehouse.code || warehouse.id, version: warehouse.version ?? 0 }
      : { id: crypto.randomUUID(), name: '', code: '', active: true, version: 0, sortOrder: 0 },
  )
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const set = <K extends keyof Warehouse>(key: K, value: Warehouse[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (busy || !can('stock.write')) return
    setBusy(true)
    setError('')
    const result = await run({ type: 'warehouse.save', warehouse: draft })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      title={warehouse ? 'Depoyu düzenle' : 'Yeni depo'}
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
            form="warehouse-form"
            isDisabled={busy || !can('stock.write') || !draft.name.trim() || !draft.code?.trim()}
          >
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id="warehouse-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        className="form-section"
      >
        <div className="form-grid">
          <Field
            label="Depo adı"
            value={draft.name}
            onChange={(name) => set('name', name)}
            required
            maxLength={160}
            isDisabled={busy}
          />
          <Field
            label="Depo kodu"
            value={draft.code ?? ''}
            onChange={(code) => set('code', code)}
            required
            maxLength={40}
            readOnly={draft.id === MAIN_WAREHOUSE}
            isDisabled={busy}
          />
          {(
            [
              ['city', 'İl'],
              ['district', 'İlçe'],
              ['address', 'Adres'],
              ['phone', 'Telefon'],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={draft[key] ?? ''}
              onChange={(value) => set(key, value)}
              maxLength={key === 'address' ? 1000 : key === 'phone' ? 50 : 100}
              className={key === 'address' ? 'span-2' : ''}
              isDisabled={busy}
            />
          ))}
          <Field
            label="Sıra"
            type="number"
            value={String(draft.sortOrder ?? 0)}
            onChange={(value) => set('sortOrder', Number(value))}
            min={-100000}
            max={100000}
            isDisabled={busy}
          />
        </div>
        <Checkbox
          className="app-checkbox"
          isSelected={draft.active}
          onChange={(active) => set('active', active)}
          isDisabled={busy || draft.id === MAIN_WAREHOUSE}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Aktif</Label>
          </Checkbox.Content>
        </Checkbox>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
