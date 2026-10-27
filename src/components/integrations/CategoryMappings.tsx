import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { Plus } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { CategoryMapping } from '../../domain/publishing'
import { apiRequest } from '../../lib/api'
import { DataTable } from '../ui/DataTable'
import { Dialog, EmptyState, Field, SelectButton } from '../ui/shared'
import { CatalogPicker, CategoryAttributes } from './CatalogFields'
import { dateLabel } from '../../lib/format'
import { categoryPath, categoryTree, definitionActive } from '../../domain/definitions'

export function CategoryMappings({
  storeId,
  shared = false,
}: {
  storeId: string
  shared?: boolean
}) {
  const { state, can } = useApp()
  const [editing, setEditing] = useState<CategoryMapping | null>(null)
  const provider = state.connections.find((c) => c.id === storeId)?.channel
  if (!storeId || storeId === 'all')
    return (
      <EmptyState
        title="Önce bir mağaza seçin"
        description="Kategori eşlemeleri mağazaya özeldir."
      />
    )
  if (
    !['trendyol', 'n11', 'ciceksepeti', 'pazarama', 'hepsiburada', 'toptantr', 'pttavm'].includes(
      provider ?? '',
    )
  )
    return (
      <EmptyState
        title={
          provider === 'amazon'
            ? 'Amazon ASIN tekliflerini kullanır'
            : 'Bu sağlayıcının kategori eşlemesi henüz açık değil'
        }
        description={
          provider === 'amazon'
            ? 'Teklif hazırlığında mevcut katalog ürünü seçilir.'
            : 'Bağlantının yayınlama kabiliyetleri tamamlandığında burada görünecek.'
        }
      />
    )
  return (
    <>
      <div className="mapping-toolbar">
        <span className="record-count">
          Ürün kategorisi → mağaza kategorisi ve ortak özellikler
        </span>
        <Button
          variant="primary"
          size="sm"
          isDisabled={!can('catalog.write')}
          onPress={() =>
            setEditing({
              id: crypto.randomUUID(),
              version: 0,
              ...(shared && provider ? { provider } : {}),
              storeId,
              localCategory: '',
              categoryId: '',
              categoryName: '',
              attributes: {},
              updatedAt: new Date().toISOString(),
            })
          }
        >
          <Plus size={14} />
          Eşleme ekle
        </Button>
      </div>
      <DataTable
        label="Kategori eşlemeleri"
        items={(state.categoryMappings ?? []).filter((m) =>
          m.provider ? m.provider === provider : m.storeId === storeId,
        )}
        columns={[
          {
            id: 'local',
            label: 'Yerel kategori',
            rowHeader: true,
            cell: (m) => (
              <button
                className="button button--sm button--ghost text-button"
                onClick={() => setEditing(m)}
              >
                {m.localCategory}
              </button>
            ),
          },
          { id: 'remote', label: 'Pazaryeri kategorisi', cell: (m) => m.categoryName },
          {
            id: 'scope',
            label: 'Kullanım',
            cell: (m) => (m.provider ? 'Pazaryerindeki tüm mağazalar' : 'Bu mağaza'),
          },
          { id: 'values', label: 'Ortak özellik', cell: (m) => Object.keys(m.attributes).length },
          { id: 'date', label: 'Son güncelleme', cell: (m) => dateLabel(m.updatedAt, true) },
        ]}
      />
      {editing && (
        <MappingEditor key={editing.id} mapping={editing} onClose={() => setEditing(null)} />
      )}
    </>
  )
}
function MappingEditor({ mapping, onClose }: { mapping: CategoryMapping; onClose: () => void }) {
  const { state, refresh, notify, can } = useApp()
  const [draft, setDraft] = useState(() => structuredClone(mapping)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const definitions = state.definitions ?? []
  const categories = [
    ...new Set([
      ...categoryTree(definitions)
        .filter(
          (category) =>
            definitionActive(definitions, category) &&
            !definitions.some((child) => child.parentId === category.id),
        )
        .map((category) => categoryPath(definitions, category)),
      ...state.products.map((product) => product.category),
    ]),
  ]
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/catalog-mappings', {
        method: 'POST',
        body: {
          id: draft.id,
          version: draft.version,
          storeId: draft.storeId,
          localCategory: draft.localCategory,
          categoryId: draft.categoryId,
          attributes: draft.attributes,
          shared: !!draft.provider,
          localCategoryId: state.definitions?.find(
            (item) => item.kind === 'category' && item.id === draft.localCategoryId,
          )?.id,
          commissionBps: draft.commissionBps,
        },
      })
      await refresh()
      notify('Kategori ve varsayılan özellik eşlemesi kaydedildi.')
      onClose()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Eşleme kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      wide
      title="Kategori eşlemesi"
      description="Yeni taslakların boş alanları bu değerleri kullanır. Gönderilmiş ilanların değerleri korunur."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            isDisabled={busy || !can('catalog.write') || !draft.localCategory || !draft.categoryId}
            onPress={() => void save()}
          >
            Eşlemeyi kaydet
          </Button>
        </>
      }
    >
      <div className="form-section">
        <Checkbox
          className="app-checkbox"
          isSelected={!!draft.provider}
          onChange={(selected) =>
            setDraft((current) => ({
              ...current,
              provider: selected
                ? state.connections.find((store) => store.id === draft.storeId)?.channel
                : undefined,
            }))
          }
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Aynı pazaryerindeki tüm mağazalarda kullan</Label>
          </Checkbox.Content>
        </Checkbox>
        <SelectButton
          label="Yerel ürün kategorisi"
          value={draft.localCategory}
          onChange={(localCategory) =>
            setDraft((d) => ({
              ...d,
              localCategory,
              localCategoryId: definitions.find(
                (item) =>
                  item.kind === 'category' && categoryPath(definitions, item) === localCategory,
              )?.id,
            }))
          }
          options={categories.map((name) => ({ id: name, label: name }))}
        />
        <CatalogPicker
          storeId={draft.storeId}
          resource="categories"
          label="Pazaryeri kategorisi seçin"
          value={draft.categoryId ? [{ id: draft.categoryId, name: draft.categoryName }] : []}
          onChange={(options) =>
            setDraft((d) => ({
              ...d,
              categoryId: options[0]?.id ?? '',
              categoryName: options[0]?.path || options[0]?.name || '',
              attributes: {},
            }))
          }
        />
        <CategoryAttributes
          storeId={draft.storeId}
          categoryId={draft.categoryId || undefined}
          values={draft.attributes}
          onChange={(attributes) => setDraft((d) => ({ ...d, attributes }))}
          commonOnly
        />
        <Field
          label="Kategori komisyonu (%)"
          type="number"
          min={0}
          max={99.99}
          step={0.01}
          value={draft.commissionBps === undefined ? '' : String(draft.commissionBps / 100)}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              commissionBps: value === '' ? undefined : Math.round(Number(value) * 100),
            }))
          }
        />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
