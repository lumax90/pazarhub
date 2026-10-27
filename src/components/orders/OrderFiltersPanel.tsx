import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { Save, X } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { OrderFilters, OrderStatus } from '../../domain/types'
import { statusLabels } from '../../domain/operations'
import { channelNames } from '../../domain/channels'
import { Field, SelectButton } from '../ui/shared'

export function OrderFiltersPanel({
  filters,
  onApply,
  onClose,
}: {
  filters: OrderFilters
  onApply: (filters: OrderFilters, view?: string) => void
  onClose: () => void
}) {
  const { state, run, can } = useApp()
  const [draft, setDraft] = useState<OrderFilters>(() => structuredClone(filters))
  const [saving, setSaving] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [id] = useState(() => crypto.randomUUID())
  const set = <K extends keyof OrderFilters>(key: K, value: OrderFilters[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const valid = !draft.from || !draft.to || draft.from <= draft.to
  const save = async () => {
    if (busy || !name.trim() || !valid) return
    setBusy(true)
    setError('')
    const result = await run({
      type: 'order.filter.save',
      filter: { id, name, filters: draft, version: 0 },
    })
    setBusy(false)
    if (result.ok) onApply(draft, id)
    else setError(result.message)
  }
  return (
    <section className="order-filter-panel" aria-label="Sipariş filtreleri">
      <div className="order-filter-heading">
        <strong>Sipariş filtreleri</strong>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label="Filtre panelini kapat"
          onPress={onClose}
        >
          <X size={16} />
        </Button>
      </div>
      <div className="order-filter-statuses">
        {(Object.keys(statusLabels) as OrderStatus[]).map((status) => (
          <Checkbox
            key={status}
            className="app-checkbox"
            isSelected={draft.statuses?.includes(status) ?? false}
            onChange={(selected) =>
              set(
                'statuses',
                selected
                  ? [...(draft.statuses ?? []), status]
                  : draft.statuses?.filter((value) => value !== status),
              )
            }
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>{statusLabels[status]}</Label>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
      <div className="order-filter-grid">
        <label className="order-date-field">
          <span className="label">Başlangıç tarihi</span>
          <input
            className="input input--secondary"
            type="date"
            value={draft.from ?? ''}
            onChange={(event) => set('from', event.target.value || undefined)}
            max={draft.to}
          />
        </label>
        <label className="order-date-field">
          <span className="label">Bitiş tarihi</span>
          <input
            className="input input--secondary"
            type="date"
            value={draft.to ?? ''}
            onChange={(event) => set('to', event.target.value || undefined)}
            min={draft.from}
          />
        </label>
        <div className="select-field">
          <label className="label">Kaynak</label>
          <SelectButton
            label="Kaynak filtresi"
            value={draft.channel ?? 'all'}
            onChange={(value) =>
              set('channel', value === 'all' ? undefined : (value as OrderFilters['channel']))
            }
            options={[
              { id: 'all', label: 'Tüm kaynaklar' },
              ...Object.entries(channelNames).map(([id, label]) => ({ id, label })),
            ]}
          />
        </div>
        <div className="select-field">
          <label className="label">Mağaza</label>
          <SelectButton
            label="Mağaza filtresi"
            value={draft.storeId ?? 'all'}
            onChange={(value) => set('storeId', value === 'all' ? undefined : value)}
            options={[
              { id: 'all', label: 'Tüm mağazalar' },
              ...state.connections.map((c) => ({ id: c.id, label: c.name })),
            ]}
          />
        </div>
        <div className="select-field">
          <label className="label">Kargo firması</label>
          <SelectButton
            label="Kargo firması filtresi"
            value={draft.cargoProvider ?? 'all'}
            onChange={(value) => set('cargoProvider', value === 'all' ? undefined : value)}
            options={[
              { id: 'all', label: 'Tüm firmalar' },
              ...[
                ...new Set(
                  state.orders.flatMap((order) =>
                    order.cargoProvider ? [order.cargoProvider] : [],
                  ),
                ),
              ]
                .sort()
                .map((name) => ({ id: name, label: name })),
            ]}
          />
        </div>
        {(
          [
            { key: 'paid', label: 'Tahsil edildi' },
            { key: 'invoiced', label: 'Fatura kesildi' },
            { key: 'unmapped', label: 'Eşlenmemiş ürün var' },
            { key: 'ownShipment', label: 'Anlaşmalı kargo gönderisi' },
            { key: 'printed', label: 'Yazdırıldı' },
          ] as const
        ).map((field) => (
          <div className="select-field" key={field.key}>
            <label className="label">{field.label}</label>
            <SelectButton
              label={`${field.label} filtresi`}
              value={draft[field.key] === undefined ? 'all' : draft[field.key] ? 'yes' : 'no'}
              onChange={(value) => set(field.key, value === 'all' ? undefined : value === 'yes')}
              options={[
                { id: 'all', label: 'Fark etmez' },
                { id: 'yes', label: 'Evet' },
                { id: 'no', label: 'Hayır' },
              ]}
            />
          </div>
        ))}
        <Field
          label="Arama"
          value={draft.query ?? ''}
          onChange={(value) => set('query', value || undefined)}
          maxLength={500}
        />
      </div>
      {!valid && (
        <p className="form-error" role="alert">
          Başlangıç tarihi bitişten sonra olamaz.
        </p>
      )}
      {saving && (
        <div className="order-filter-save">
          <Field
            label="Filtre adı"
            value={name}
            onChange={setName}
            maxLength={100}
            required
            description="Kayıtlı filtre çalışma alanınızdaki ekiple paylaşılır."
          />
          <Button
            variant="primary"
            size="sm"
            isDisabled={busy || !name.trim() || !valid}
            onPress={() => void save()}
          >
            Kaydet
          </Button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="order-filter-actions">
        <Button
          variant="ghost"
          size="sm"
          isDisabled={!can('orders.write') || busy}
          onPress={() => setSaving((value) => !value)}
        >
          <Save size={14} />
          Filtreyi kaydet
        </Button>
        <div>
          <Button variant="secondary" size="sm" onPress={() => onApply({})}>
            Filtreleri temizle
          </Button>
          <Button
            variant="primary"
            size="sm"
            isDisabled={!valid || busy}
            onPress={() => onApply(draft)}
          >
            Filtrele
          </Button>
        </div>
      </div>
    </section>
  )
}
