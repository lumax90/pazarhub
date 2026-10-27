import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { Plus, Trash2 } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { CatalogValueMapping, CategorySchema } from '../../domain/publishing'
import { COLOR_DEFINITION_ID, definitionValues } from '../../domain/definitions'
import { apiRequest } from '../../lib/api'
import { useResource } from '../../lib/useResource'
import { DataTable } from '../ui/DataTable'
import { Dialog, Field, SelectButton } from '../ui/shared'
import { CatalogPicker } from './CatalogFields'
import { AsyncState } from '../ui/AsyncState'

export function ValueMappings({
  storeId,
  kind,
}: {
  storeId: string
  kind: 'brand' | 'color' | 'variant' | 'attribute'
}) {
  const { state, can, refresh, notify } = useApp(),
    [editing, setEditing] = useState<CatalogValueMapping | null>(null)
  const [deleting, setDeleting] = useState<CatalogValueMapping | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const provider = state.connections.find((store) => store.id === storeId)!.channel
  const matches = (mapping: CatalogValueMapping) =>
    mapping.provider === provider &&
    (kind === 'color'
      ? mapping.definitionId === COLOR_DEFINITION_ID
      : mapping.kind === kind &&
        (kind !== 'variant' || mapping.definitionId !== COLOR_DEFINITION_ID))
  const definitions = (state.definitions ?? []).filter((definition) =>
    kind === 'color'
      ? definition.id === COLOR_DEFINITION_ID
      : definition.kind === kind && definition.id !== COLOR_DEFINITION_ID,
  )
  return (
    <>
      <div className="mapping-toolbar">
        <p className="description field-description">
          Bu eşlemeler aynı pazaryerindeki bütün mağazalarda kullanılır. İlanda girilen değer
          önceliklidir.
        </p>
        <Button
          variant="primary"
          size="sm"
          isDisabled={!can('catalog.write') || !definitions.length}
          onPress={() =>
            setEditing({
              id: crypto.randomUUID(),
              provider,
              kind: kind === 'color' ? 'variant' : kind,
              definitionId: definitions[0].id,
              version: 0,
              values: {},
              updatedAt: '',
              useSameText: false,
            })
          }
        >
          <Plus size={14} />
          Eşleme ekle
        </Button>
      </div>
      <DataTable
        label="Tanım eşlemeleri"
        items={(state.catalogValueMappings ?? []).filter(matches)}
        columns={[
          {
            id: 'local',
            label: 'Yerel tanım',
            rowHeader: true,
            cell: (mapping) => (
              <button
                className="button button--sm button--ghost text-button"
                onClick={() => setEditing(mapping)}
              >
                {state.definitions?.find((definition) => definition.id === mapping.definitionId)
                  ?.name ?? 'Silinmiş tanım'}
              </button>
            ),
          },
          {
            id: 'remote',
            label: 'Pazaryeri karşılığı',
            cell: (mapping) => mapping.brandName || mapping.attributeName || '—',
          },
          {
            id: 'category',
            label: 'Kategori',
            cell: (mapping) =>
              state.categoryMappings?.find(
                (category) =>
                  category.categoryId === mapping.categoryId &&
                  (category.provider === provider || category.storeId === storeId),
              )?.categoryName ??
              mapping.categoryId ??
              'Tüm kategoriler',
          },
          {
            id: 'values',
            label: 'Değerler',
            cell: (mapping) =>
              mapping.useSameText
                ? 'Aynı metin gönderilir'
                : `${Object.keys(mapping.values).length} değer eşli`,
          },
          {
            id: 'action',
            label: '',
            cell: (mapping) => (
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label="Eşlemeyi kaldır"
                isDisabled={!can('catalog.write')}
                onPress={() => {
                  setDeleting(mapping)
                  setError('')
                }}
              >
                <Trash2 size={14} />
              </Button>
            ),
          },
        ]}
      />
      {editing && (
        <ValueMappingEditor
          key={editing.id}
          storeId={storeId}
          mapping={editing}
          definitions={definitions.map((definition) => ({
            id: definition.id,
            label: definition.name,
          }))}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Dialog
          open
          title="Eşlemeyi kaldır"
          onClose={() => {
            if (!busy) setDeleting(null)
          }}
          footer={
            <>
              <Button variant="secondary" isDisabled={busy} onPress={() => setDeleting(null)}>
                Vazgeç
              </Button>
              <Button
                variant="danger"
                isDisabled={busy}
                onPress={async () => {
                  setBusy(true)
                  try {
                    await apiRequest('/api/catalog-mappings/delete', {
                      method: 'POST',
                      body: { id: deleting.id, version: deleting.version, kind: 'value' },
                    })
                    await refresh()
                    notify('Eşleme kaldırıldı.')
                    setDeleting(null)
                  } catch (error) {
                    setError((error as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Kaldır
              </Button>
            </>
          }
        >
          <p className="description field-description">
            İlanlara kaydedilmiş özel değerler korunur; yeni hazırlıkta ortak eşleme kullanılmaz.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </>
  )
}

function ValueMappingEditor({
  storeId,
  mapping,
  definitions,
  onClose,
}: {
  storeId: string
  mapping: CatalogValueMapping
  definitions: { id: string; label: string }[]
  onClose: () => void
}) {
  const { state, refresh, notify } = useApp(),
    [draft, setDraft] = useState(() => structuredClone(mapping)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const definition = state.definitions?.find((item) => item.id === draft.definitionId)
  const local = definition ? definitionValues(state, definition) : []
  const schema = useResource<{ schema: CategorySchema }>(
    draft.categoryId
      ? `/api/publishing/${storeId}/metadata?resource=attributes&categoryId=${encodeURIComponent(draft.categoryId)}`
      : null,
  )
  const attribute = schema.data?.schema.attributes.find((item) => item.id === draft.attributeId)
  const save = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/catalog-value-mappings', {
        method: 'POST',
        body: {
          id: draft.id,
          storeId,
          version: draft.version,
          kind: draft.kind,
          definitionId: draft.definitionId,
          categoryId: draft.categoryId,
          attributeId: draft.attributeId,
          brandId: draft.brandId,
          brandName: draft.brandName,
          useSameText: draft.useSameText,
          values: draft.values,
        },
      })
      await refresh()
      notify('Tanım eşlemesi kaydedildi.')
      onClose()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      wide
      title="Pazaryeri tanım eşlemesi"
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
            isDisabled={
              busy ||
              !draft.definitionId ||
              (draft.kind !== 'brand' && !draft.attributeId) ||
              (draft.kind === 'brand' && !draft.brandId)
            }
            onPress={() => void save()}
          >
            Eşlemeyi kaydet
          </Button>
        </>
      }
    >
      <div className="margin-rule-form">
        <SelectButton
          label="Yerel tanım"
          value={draft.definitionId}
          onChange={(definitionId) =>
            setDraft((current) => ({ ...current, definitionId, values: {} }))
          }
          options={definitions}
          isDisabled={busy}
        />
        {draft.kind === 'brand' ? (
          <CatalogPicker
            storeId={storeId}
            resource="brands"
            label="Pazaryeri markası"
            value={
              draft.brandId ? [{ id: draft.brandId, name: draft.brandName ?? draft.brandId }] : []
            }
            onChange={(values) =>
              setDraft((current) => ({
                ...current,
                brandId: values[0]?.id,
                brandName: values[0]?.name,
              }))
            }
            disabled={busy}
          />
        ) : (
          <>
            <CatalogPicker
              storeId={storeId}
              resource="categories"
              label="Pazaryeri kategorisi"
              value={
                draft.categoryId
                  ? [
                      {
                        id: draft.categoryId,
                        name:
                          state.categoryMappings?.find(
                            (mapping) => mapping.categoryId === draft.categoryId,
                          )?.categoryName ?? draft.categoryId,
                      },
                    ]
                  : []
              }
              onChange={(values) =>
                setDraft((current) => ({
                  ...current,
                  categoryId: values[0]?.id,
                  attributeId: undefined,
                  values: {},
                  useSameText: false,
                }))
              }
              disabled={busy}
            />
            <AsyncState loading={schema.loading} error={schema.error} />
            {schema.data && (
              <SelectButton
                label="Pazaryeri özellik tipi"
                value={draft.attributeId ?? ''}
                onChange={(attributeId) =>
                  setDraft((current) => ({
                    ...current,
                    attributeId,
                    values: {},
                    useSameText: false,
                  }))
                }
                options={schema.data.schema.attributes
                  .filter((item) => !item.personalization)
                  .map((item) => ({ id: item.id, label: item.name }))}
                isDisabled={busy}
              />
            )}
            {attribute?.allowCustom && (
              <Checkbox
                className="app-checkbox"
                isSelected={draft.useSameText ?? false}
                onChange={(useSameText) => setDraft((current) => ({ ...current, useSameText }))}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>Aynısını kullan · yerel değer adını gönder</Label>
                </Checkbox.Content>
              </Checkbox>
            )}
            {attribute && !draft.useSameText && (
              <DataTable
                label="Yerel değer karşılıkları"
                items={local}
                columns={[
                  {
                    id: 'local',
                    label: 'Yerel değer',
                    rowHeader: true,
                    cell: (value) => value.name,
                  },
                  {
                    id: 'remote',
                    label: 'Pazaryeri değeri',
                    cell: (value) =>
                      attribute.allowCustom ? (
                        <Field
                          label={`${value.name} karşılığı`}
                          value={draft.values[value.id]?.customValue ?? ''}
                          onChange={(text) =>
                            setDraft((current) => ({
                              ...current,
                              values: { ...current.values, [value.id]: { customValue: text } },
                            }))
                          }
                        />
                      ) : (
                        <CatalogPicker
                          storeId={storeId}
                          resource="values"
                          categoryId={draft.categoryId}
                          attributeId={draft.attributeId}
                          label={`${value.name} karşılığı`}
                          multiple={attribute.multiple}
                          value={(draft.values[value.id]?.valueIds ?? []).map((id, index) => ({
                            id,
                            name: draft.values[value.id]?.labels?.[index] ?? id,
                          }))}
                          onChange={(values) =>
                            setDraft((current) => ({
                              ...current,
                              values: {
                                ...current.values,
                                [value.id]: {
                                  valueIds: values.map((value) => value.id),
                                  labels: values.map((value) => value.name),
                                },
                              },
                            }))
                          }
                          disabled={busy}
                        />
                      ),
                  },
                ]}
              />
            )}
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
