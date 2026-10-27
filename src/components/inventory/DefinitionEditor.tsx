import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import type { CatalogDefinition, DefinitionKind } from '../../domain/types'
import {
  categoryPath,
  COLOR_DEFINITION_ID,
  definitionKey,
  definitionSingular,
  definitionUsage,
} from '../../domain/definitions'
import { useApp } from '../../app/AppProvider'
import { Dialog, Field, SelectButton } from '../ui/shared'

export function DefinitionEditor({
  kind,
  definition,
  parentId,
  onClose,
  onSaved,
}: {
  kind: DefinitionKind
  definition?: CatalogDefinition
  parentId?: string
  onClose: () => void
  onSaved?: (definition: CatalogDefinition) => void
}) {
  const { state, run, can, getState } = useApp()
  const [draft, setDraft] = useState<CatalogDefinition>(() =>
    definition
      ? structuredClone(definition)
      : {
          id: crypto.randomUUID(),
          kind,
          name: '',
          active: true,
          sortOrder: 0,
          version: 0,
          ...(parentId ? { parentId } : {}),
          ...(['variant', 'attribute'].includes(kind) ? { values: [] } : {}),
        },
  )
  const [newValues, setNewValues] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const system = draft.id === COLOR_DEFINITION_ID
  const set = <K extends keyof CatalogDefinition>(key: K, value: CatalogDefinition[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (busy || !can('catalog.write')) return
    setError('')
    const values = [...(draft.values ?? [])]
    if (['variant', 'attribute'].includes(kind) && !system) {
      for (const name of newValues
        .split(kind === 'variant' ? /[,\n]/ : /\n/)
        .map((value) => value.trim())
        .filter(Boolean))
        if (!values.some((value) => definitionKey(value.name) === definitionKey(name)))
          values.push({ id: crypto.randomUUID(), name, active: true, sortOrder: values.length })
    }
    const next = { ...draft, ...(['variant', 'attribute'].includes(kind) ? { values } : {}) }
    setDraft(next)
    setNewValues('')
    setBusy(true)
    const result = await run({ type: 'definition.save', definition: next })
    setBusy(false)
    if (result.ok) {
      const saved = getState().definitions?.find((item) => item.id === next.id)
      if (saved) onSaved?.(saved)
      onClose()
    } else setError(result.message)
  }
  const excludedParent = (id: string) => {
    let current = state.definitions?.find((item) => item.id === id)
    const seen = new Set<string>()
    while (current) {
      if (current.id === draft.id || seen.has(current.id)) return true
      seen.add(current.id)
      current = state.definitions?.find((item) => item.id === current!.parentId)
    }
    return false
  }
  return (
    <Dialog
      open
      wide={kind === 'supplier' || kind === 'attribute' || kind === 'variant'}
      title={definition ? `${definition.name} · düzenle` : `Yeni ${definitionSingular[kind]}`}
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
            form="definition-form"
            type="submit"
            isDisabled={
              busy ||
              !can('catalog.write') ||
              !draft.name.trim() ||
              !Number.isFinite(draft.sortOrder)
            }
          >
            {busy ? 'Kaydediliyor…' : definition ? 'Kaydet' : 'Ekle'}
          </Button>
        </>
      }
    >
      <form
        id="definition-form"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void save()
        }}
        className="form-section"
      >
        <div className="form-grid">
          <Field
            label={
              kind === 'attribute'
                ? 'Özellik adı'
                : `${definitionSingular[kind][0].toLocaleUpperCase('tr-TR')}${definitionSingular[kind].slice(1)} adı`
            }
            value={draft.name}
            onChange={(name) => set('name', name)}
            required
            maxLength={kind === 'category' ? 300 : ['brand', 'supplier'].includes(kind) ? 200 : 100}
            isDisabled={busy || system}
          />
          <Field
            label="Sıra"
            type="number"
            min={-100000}
            max={100000}
            step={1}
            value={String(draft.sortOrder)}
            onChange={(value) => set('sortOrder', value === '' ? NaN : Number(value))}
            isDisabled={busy}
          />
        </div>
        {kind === 'category' && (
          <div className="select-field">
            <label className="label">Üst kategori</label>
            <SelectButton
              label="Üst kategori"
              value={draft.parentId ?? 'none'}
              onChange={(value) => set('parentId', value === 'none' ? undefined : value)}
              isDisabled={busy}
              options={[
                { id: 'none', label: 'Ana kategori' },
                ...(state.definitions ?? [])
                  .filter((item) => item.kind === 'category' && !excludedParent(item.id))
                  .map((item) => ({
                    id: item.id,
                    label: categoryPath(state.definitions ?? [], item),
                  })),
              ]}
            />
          </div>
        )}
        {['category', 'brand'].includes(kind) && (
          <Field
            label="Açıklama"
            value={draft.description ?? ''}
            onChange={(value) => set('description', value)}
            maxLength={5000}
            isDisabled={busy}
          />
        )}
        {kind === 'color' && (
          <div className="definition-color-fields">
            <div className="definition-color-value">
              <input
                aria-label="Rengi seç"
                type="color"
                value={draft.colorHex ?? '#808080'}
                onChange={(event) => set('colorHex', event.target.value)}
                disabled={busy}
              />
              <Field
                label="Renk kodu"
                value={draft.colorHex ?? ''}
                placeholder="#ffffff"
                onChange={(value) => set('colorHex', value || undefined)}
                required
                maxLength={7}
                isDisabled={busy}
              />
            </div>
            <Checkbox
              className="app-checkbox"
              isSelected={!!draft.gradientEnd}
              onChange={(value) => set('gradientEnd', value ? '#ffffff' : undefined)}
              isDisabled={busy}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>Degrade renk</Label>
              </Checkbox.Content>
            </Checkbox>
            {draft.gradientEnd && (
              <div className="form-grid">
                <Field
                  label="İkinci renk kodu"
                  value={draft.gradientEnd}
                  onChange={(value) => set('gradientEnd', value)}
                  maxLength={7}
                  isDisabled={busy}
                />
                <Field
                  label="Degrade açısı"
                  type="number"
                  min={0}
                  max={360}
                  value={String(draft.gradientAngle ?? 90)}
                  onChange={(value) => set('gradientAngle', Number(value))}
                  isDisabled={busy}
                />
              </div>
            )}
          </div>
        )}
        {kind === 'supplier' && (
          <div className="form-grid">
            {(
              [
                ['contactName', 'Yetkili kişi'],
                ['phone', 'Telefon'],
                ['email', 'E-posta'],
                ['taxOffice', 'Vergi dairesi'],
                ['taxId', 'Vergi numarası'],
                ['address', 'Adres'],
                ['note', 'Not'],
              ] as const
            ).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                type={key === 'email' ? 'email' : 'text'}
                value={draft[key] ?? ''}
                onChange={(value) => set(key, value)}
                className={key === 'address' || key === 'note' ? 'span-2' : ''}
                maxLength={
                  key === 'note'
                    ? 5000
                    : key === 'address'
                      ? 1000
                      : key === 'email'
                        ? 254
                        : key === 'phone'
                          ? 50
                          : key === 'taxId'
                            ? 20
                            : 200
                }
                isDisabled={busy}
              />
            ))}
          </div>
        )}
        {['variant', 'attribute'].includes(kind) && !system && (
          <>
            {!!draft.values?.length && (
              <details className="definition-values-edit" open={draft.values.length < 9}>
                <summary>
                  {draft.values.length} {kind === 'variant' ? 'seçenek' : 'değer'} düzenle
                </summary>
                <div>
                  {draft.values.map((value, index) => (
                    <div className="definition-value-edit-row" key={value.id}>
                      <Field
                        label={`${index + 1}. değer`}
                        value={value.name}
                        onChange={(name) =>
                          set(
                            'values',
                            draft.values?.map((item) =>
                              item.id === value.id ? { ...item, name } : item,
                            ),
                          )
                        }
                        maxLength={kind === 'variant' ? 100 : 1000}
                        isDisabled={busy}
                      />
                      <Checkbox
                        className="app-checkbox"
                        isSelected={value.active}
                        onChange={(active) =>
                          set(
                            'values',
                            draft.values?.map((item) =>
                              item.id === value.id ? { ...item, active } : item,
                            ),
                          )
                        }
                        isDisabled={busy}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label>Aktif</Label>
                        </Checkbox.Content>
                      </Checkbox>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="native-textarea-field">
              <label className="label" htmlFor="definition-new-values">
                {kind === 'variant' ? 'Seçenekler' : 'Yeni değerler'}
              </label>
              <textarea
                className="textarea textarea--secondary"
                id="definition-new-values"
                rows={4}
                value={newValues}
                onChange={(event) => setNewValues(event.target.value)}
                placeholder={kind === 'variant' ? 'S, M, L, XL' : 'Her satıra bir değer yazın'}
                disabled={busy}
              />
              <span className="description field-description">
                Mevcut değer yeniden kullanılacak; aynı değer iki kez eklenmez.
              </span>
            </div>
          </>
        )}
        {system ? (
          <p className="description field-description">
            Renk seçenekleri Renkler ekranından yönetilir.
          </p>
        ) : (
          <Checkbox
            className="app-checkbox"
            isSelected={draft.active}
            onChange={(active) => set('active', active)}
            isDisabled={busy}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Aktif</Label>
            </Checkbox.Content>
          </Checkbox>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}

export function DefinitionDeleteDialog({
  definition,
  valueId,
  onClose,
}: {
  definition: CatalogDefinition
  valueId?: string
  onClose: () => void
}) {
  const { state, run } = useApp()
  const [usage] = useState(() => definitionUsage(state, definition, valueId)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const remove = async () => {
    if (busy) return
    setBusy(true)
    const result = await run(
      valueId
        ? {
            type: 'definition.value.delete',
            id: definition.id,
            valueId,
            version: definition.version,
            expectedUsage: usage,
          }
        : {
            type: 'definition.delete',
            id: definition.id,
            version: definition.version,
            expectedUsage: usage,
          },
    )
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      title={valueId ? 'Değeri sil' : 'Tanımı sil'}
      description={
        valueId ? definition.values?.find((value) => value.id === valueId)?.name : definition.name
      }
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant="danger"
            onPress={() => void remove()}
            isDisabled={busy || (!!usage && definition.kind !== 'attribute')}
          >
            Evet, sil
          </Button>
        </>
      }
    >
      <p className="definition-delete-copy">
        {usage
          ? definition.kind === 'attribute'
            ? `${usage} üründe kullanılıyor. Silindiğinde bu ürünlerin teknik özelliklerinden de kaldırılır.`
            : `${usage} üründe kullanılıyor. Mevcut ürünlerde kalması için pasife alabilirsiniz.`
          : 'Bu tanım ürünlerde kullanılmıyor.'}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
