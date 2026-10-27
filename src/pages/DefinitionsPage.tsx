import { useState } from 'react'
import { Button, Checkbox, Chip, Dropdown, Label } from '@heroui/react'
import { ArrowDown, ArrowUp, Ellipsis, Plus, Tag, Trash2 } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { CatalogDefinition, DefinitionKind, Warehouse } from '../domain/types'
import {
  categoryPath,
  categoryTree,
  COLOR_DEFINITION_ID,
  definitionActive,
  definitionKindPaths,
  definitionLabels,
  definitionOrderKey,
  definitionSingular,
  definitionUsage,
  definitionValues,
} from '../domain/definitions'
import { MAIN_WAREHOUSE, warehouses } from '../domain/inventory'
import { matches } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import {
  Dialog,
  EmptyState,
  PageHeader,
  Panel,
  SearchBox,
  SelectButton,
} from '../components/ui/shared'
import { DefinitionDeleteDialog, DefinitionEditor } from '../components/inventory/DefinitionEditor'
import { WarehouseEditor } from '../components/inventory/WarehouseEditor'
import { CategoryMappings } from '../components/integrations/CategoryMappings'
import { CategoryNameCell } from '../components/inventory/CategoryNameCell'
import { ValueMappings } from '../components/integrations/ValueMappings'
import { supportsPublishing } from '../domain/publishing'

export function DefinitionsPage() {
  const { kind = 'categories' } = useParams()
  if (kind === 'warehouses') return <WarehouseDefinitionsPage />
  if (kind === 'mappings') return <DefinitionMappingsPage />
  const type = (Object.keys(definitionKindPaths) as DefinitionKind[]).find(
    (type) => definitionKindPaths[type] === kind,
  )
  if (!type)
    return (
      <EmptyState
        title="Tanım sayfası bulunamadı"
        action={<Link to="/definitions/categories">Ürün Kategorileri</Link>}
      />
    )
  return <DefinitionList key={type} kind={type} />
}

function DefinitionList({ kind }: { kind: DefinitionKind }) {
  const { state, run, can } = useApp()
  const [query, setQuery] = useState(''),
    [passive, setPassive] = useState(false),
    [editing, setEditing] = useState<{ definition?: CatalogDefinition; parentId?: string } | null>(
      null,
    ),
    [deleting, setDeleting] = useState<{ definition: CatalogDefinition; valueId?: string } | null>(
      null,
    ),
    [busy, setBusy] = useState('')
  const all = state.definitions ?? []
  const typed = all.filter((item) => item.kind === kind)
  const ordered =
    kind === 'category'
      ? categoryTree(all)
      : [...typed].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'))
  const rows = ordered.filter(
    (item) =>
      (passive || definitionActive(all, item)) &&
      matches(
        `${item.name} ${kind === 'category' ? categoryPath(all, item) : (item.description ?? '')}`,
        query,
      ),
  )
  const save = async (definition: CatalogDefinition) => {
    setBusy(definition.id)
    await run({ type: 'definition.save', definition })
    setBusy('')
  }
  const move = async (
    id: string,
    parentId: string | undefined,
    beforeId: string | undefined,
    expectedOrder: string,
  ) => {
    setBusy(id)
    await run({ type: 'definition.move', id, parentId, beforeId, expectedOrder })
    setBusy('')
  }
  const adjacent = (definition: CatalogDefinition, direction: -1 | 1) => {
    const siblings = ordered.filter((item) => item.parentId === definition.parentId),
      index = siblings.findIndex((item) => item.id === definition.id)
    if (!siblings[index + direction]) return
    void move(
      definition.id,
      definition.parentId,
      siblings[index + (direction === 1 ? 2 : -1)]?.id,
      definitionOrderKey(all, kind),
    )
  }
  const actions = (definition: CatalogDefinition) => (
    <Dropdown>
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        aria-label={`${definition.name} işlemleri`}
        isDisabled={!!busy || !can('catalog.write')}
      >
        <Ellipsis size={17} />
      </Button>
      <Dropdown.Popover className="app-dropdown">
        <Dropdown.Menu aria-label="Tanım işlemleri">
          <Dropdown.Item id="edit" textValue="Düzenle" onAction={() => setEditing({ definition })}>
            <Label>Düzenle</Label>
          </Dropdown.Item>
          {kind === 'category' && (
            <Dropdown.Item
              id="child"
              textValue="Alt kategori ekle"
              onAction={() => setEditing({ parentId: definition.id })}
            >
              <Label>Alt kategori ekle</Label>
            </Dropdown.Item>
          )}
          {definition.id !== COLOR_DEFINITION_ID && (
            <Dropdown.Item
              id="active"
              textValue={definition.active ? 'Pasife al' : 'Aktifleştir'}
              onAction={() => void save({ ...definition, active: !definition.active })}
            >
              <Label>{definition.active ? 'Pasife al' : 'Aktifleştir'}</Label>
            </Dropdown.Item>
          )}
          {kind === 'category' && (
            <Dropdown.Item
              id="up"
              textValue="Yukarı taşı"
              onAction={() => adjacent(definition, -1)}
            >
              <Label>Yukarı taşı</Label>
            </Dropdown.Item>
          )}
          {kind === 'category' && (
            <Dropdown.Item
              id="down"
              textValue="Aşağı taşı"
              onAction={() => adjacent(definition, 1)}
            >
              <Label>Aşağı taşı</Label>
            </Dropdown.Item>
          )}
          {definition.id !== COLOR_DEFINITION_ID && (
            <Dropdown.Item id="delete" textValue="Sil" onAction={() => setDeleting({ definition })}>
              <Label>Sil</Label>
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
  return (
    <div className="definitions-page">
      <PageHeader
        title={definitionLabels[kind]}
        description={
          kind === 'category'
            ? 'Kategori ağacı ve ürün sınıflandırmaları.'
            : kind === 'variant'
              ? 'Ürünlerde seçilecek varyant tipleri ve seçenekleri.'
              : kind === 'attribute'
                ? 'Ortak teknik özellikler ve birden fazla seçilebilen değerler.'
                : 'Ürün kartlarında kullanılan ortak tanımlar.'
        }
        actions={
          <Button
            variant="primary"
            isDisabled={!can('catalog.write')}
            onPress={() => setEditing({})}
          >
            <Plus size={16} />
            Yeni {definitionSingular[kind]}
          </Button>
        }
      />
      <Panel flush className="list-panel">
        <div className="list-toolbar">
          <SearchBox
            label="Tanımlarda ara"
            value={query}
            onChange={setQuery}
            placeholder="Ad veya açıklama…"
          />
          <Checkbox className="app-checkbox" isSelected={passive} onChange={setPassive}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Pasifleri göster</Label>
            </Checkbox.Content>
          </Checkbox>
          <span className="record-count">{rows.length} kayıt</span>
        </div>
        {kind === 'category' && (
          <p className="category-drag-hint">
            Sürüklemek için aramayı temizleyip pasifleri gösterin. Sağa bırakarak üst kategoriyi
            değiştirebilirsiniz.
          </p>
        )}
        {kind === 'variant' || kind === 'attribute' ? (
          <div className="definition-option-cards">
            {rows.map((definition) => (
              <div className="definition-option-card" key={definition.id}>
                <div className="definition-card-heading">
                  <div>
                    <strong>{definition.name}</strong>
                    <span>{definitionUsage(state, definition)} üründe kullanılıyor</span>
                  </div>
                  <Chip size="sm" variant="soft">
                    {definition.id === COLOR_DEFINITION_ID
                      ? 'Sistem varyantı'
                      : definition.active
                        ? 'Aktif'
                        : 'Pasif'}
                  </Chip>
                  {actions(definition)}
                </div>
                <div className="definition-value-chips">
                  {definitionValues(state, definition)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .filter((value) => passive || value.active)
                    .map((value) => (
                      <span key={value.id} className={!value.active ? 'is-passive' : ''}>
                        {value.name}
                        {definition.id !== COLOR_DEFINITION_ID && can('catalog.write') && (
                          <button
                            className="button button--md button--ghost"
                            aria-label={`${value.name} değerini sil`}
                            onClick={() => setDeleting({ definition, valueId: value.id })}
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                </div>
                <div className="definition-card-footer">
                  {definition.id === COLOR_DEFINITION_ID ? (
                    <Link className="provider-doc-link" to="/definitions/colors">
                      Renkleri yönet
                    </Link>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={!can('catalog.write')}
                        onPress={() => setEditing({ definition })}
                      >
                        <Plus size={13} />
                        {kind === 'variant' ? 'Seçenek' : 'Değer'}
                      </Button>
                      {kind === 'attribute' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            isDisabled={!!busy || !can('catalog.write')}
                            onPress={() =>
                              void save({
                                ...definition,
                                values: [...(definition.values ?? [])]
                                  .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                                  .map((value, index) => ({ ...value, sortOrder: index })),
                              })
                            }
                          >
                            Değerleri A–Z sırala
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            isIconOnly
                            aria-label={`${definition.name} yukarı taşı`}
                            isDisabled={!!busy || !can('catalog.write')}
                            onPress={() => adjacent(definition, -1)}
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            isIconOnly
                            aria-label={`${definition.name} aşağı taşı`}
                            isDisabled={!!busy || !can('catalog.write')}
                            onPress={() => adjacent(definition, 1)}
                          >
                            <ArrowDown size={14} />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {!rows.length && (
              <EmptyState
                title="Henüz tanım yok"
                description="Yeni bir tanım ekleyerek ürün formlarında kullanabilirsiniz."
              />
            )}
          </div>
        ) : (
          <DataTable
            label={`${definitionLabels[kind]} listesi`}
            items={rows}
            columns={[
              {
                id: 'name',
                label: kind === 'category' ? 'Kategori' : 'Ad',
                rowHeader: true,
                cell: (definition) =>
                  kind === 'category' ? (
                    <CategoryNameCell
                      definition={definition}
                      all={all}
                      disabled={!!busy || !can('catalog.write') || !passive || !!query.trim()}
                      onMove={(...args) => void move(...args)}
                    />
                  ) : (
                    <div className="definition-name">
                      {kind === 'color' ? (
                        <span
                          className="definition-color-swatch"
                          style={{
                            background: definition.gradientEnd
                              ? `linear-gradient(${definition.gradientAngle ?? 90}deg, ${definition.colorHex ?? '#808080'}, ${definition.gradientEnd})`
                              : (definition.colorHex ?? 'transparent'),
                          }}
                        />
                      ) : (
                        <Tag size={16} />
                      )}
                      <span>
                        <strong>{definition.name}</strong>
                        <small>
                          {kind === 'supplier'
                            ? definition.contactName || definition.email
                            : kind === 'color'
                              ? definition.colorHex || 'Renk kodu tanımlanmamış'
                              : definition.description}
                        </small>
                      </span>
                    </div>
                  ),
              },
              ...(kind === 'category'
                ? [
                    {
                      id: 'children',
                      label: 'Alt kategori',
                      cell: (definition: CatalogDefinition) =>
                        typed.filter((item) => item.parentId === definition.id).length,
                    },
                  ]
                : []),
              {
                id: 'used',
                label: 'Ürün',
                className: 'align-right',
                cell: (definition) => definitionUsage(state, definition),
              },
              {
                id: 'order',
                label: 'Sıra',
                className: 'align-right',
                cell: (definition) => definition.sortOrder,
              },
              {
                id: 'status',
                label: 'Durum',
                cell: (definition) => (
                  <Chip
                    size="sm"
                    variant="soft"
                    color={definitionActive(all, definition) ? 'success' : 'default'}
                  >
                    {definitionActive(all, definition) ? 'Aktif' : 'Pasif'}
                  </Chip>
                ),
              },
              { id: 'action', label: '', cell: actions },
            ]}
          />
        )}
      </Panel>
      {editing && (
        <DefinitionEditor
          key={editing.definition?.id ?? editing.parentId ?? 'new'}
          kind={kind}
          definition={editing.definition}
          parentId={editing.parentId}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DefinitionDeleteDialog
          definition={deleting.definition}
          valueId={deleting.valueId}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function WarehouseDefinitionsPage() {
  const { state, run, can } = useApp(),
    [editing, setEditing] = useState<{ warehouse?: Warehouse } | null>(null),
    [deleting, setDeleting] = useState<Warehouse | null>(null),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <div className="definitions-page">
      <PageHeader
        title="Depolar"
        description="Stokların tutulduğu depolar, kodları ve iletişim bilgileri."
        actions={
          <Button variant="primary" isDisabled={!can('stock.write')} onPress={() => setEditing({})}>
            <Plus size={16} />
            Yeni depo
          </Button>
        }
      />
      <Panel flush className="list-panel">
        <div className="list-toolbar">
          <SearchBox label="Depolarda ara" value={query} onChange={setQuery} />
        </div>
        <DataTable
          label="Depolar listesi"
          items={warehouses(state)
            .filter((warehouse) =>
              matches(
                `${warehouse.name} ${warehouse.code ?? warehouse.id} ${warehouse.city ?? ''}`,
                query,
              ),
            )
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))}
          columns={[
            {
              id: 'name',
              label: 'Depo',
              rowHeader: true,
              cell: (w) => (
                <div>
                  <strong>{w.name}</strong>
                  {w.id === MAIN_WAREHOUSE && (
                    <Chip size="sm" variant="soft">
                      Merkez
                    </Chip>
                  )}
                </div>
              ),
            },
            {
              id: 'code',
              label: 'Kod',
              cell: (w) => <span className="code-text">{w.code || w.id}</span>,
            },
            {
              id: 'address',
              label: 'Konum',
              cell: (w) => [w.district, w.city].filter(Boolean).join(' / ') || '—',
            },
            { id: 'phone', label: 'Telefon', cell: (w) => w.phone || '—' },
            {
              id: 'status',
              label: 'Durum',
              cell: (w) => (
                <Chip size="sm" variant="soft" color={w.active ? 'success' : 'default'}>
                  {w.active ? 'Aktif' : 'Pasif'}
                </Chip>
              ),
            },
            {
              id: 'action',
              label: '',
              cell: (w) => (
                <div className="row-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={!can('stock.write')}
                    onPress={() => setEditing({ warehouse: w })}
                  >
                    Düzenle
                  </Button>
                  {w.id !== MAIN_WAREHOUSE && (
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      aria-label={`${w.name} sil`}
                      isDisabled={!can('stock.write')}
                      onPress={() => {
                        setDeleting(w)
                        setError('')
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Panel>
      {editing && (
        <WarehouseEditor warehouse={editing.warehouse} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <Dialog
          open
          title="Depoyu sil"
          description={deleting.name}
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
                  const result = await run({
                    type: 'warehouse.delete',
                    id: deleting.id,
                    version: deleting.version ?? 0,
                  })
                  setBusy(false)
                  if (result.ok) setDeleting(null)
                  else setError(result.message)
                }}
              >
                Evet, sil
              </Button>
            </>
          }
        >
          <p className="definition-delete-copy">
            Stok, hareket, sipariş veya bağlantıda kullanılmayan depolar kaldırılabilir.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  )
}

function DefinitionMappingsPage() {
  const { state, mode } = useApp(),
    [storeId, setStore] = useState(state.connections[0]?.id ?? '')
  const [tab, setTab] = useState('category')
  const provider = state.connections.find((store) => store.id === storeId)?.channel
  const supported = !!provider && supportsPublishing(provider) && provider !== 'amazon'
  return (
    <>
      <PageHeader
        title="Eşleştirmeler"
        description="Yerel kategorilerin pazaryeri kategori ve ortak özellik karşılıkları."
      />
      <Panel className="product-form-card">
        <SelectButton
          label="Eşleme mağazası"
          value={storeId}
          onChange={(value) => {
            setStore(value)
            setTab('category')
          }}
          options={state.connections.map((store) => ({ id: store.id, label: store.name }))}
        />
        <SelectButton
          label="Eşleme türü"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'category', label: 'Kategoriler' },
            ...(['trendyol', 'pazarama', 'toptantr'].includes(provider ?? '')
              ? [{ id: 'brand', label: 'Markalar' }]
              : []),
            { id: 'color', label: 'Renkler' },
            { id: 'variant', label: 'Varyant Değerleri' },
            { id: 'attribute', label: 'Teknik Özellikler' },
          ]}
        />
        {mode === 'live' && storeId && supported ? (
          tab === 'category' ? (
            <CategoryMappings key={storeId} storeId={storeId} shared />
          ) : (
            <ValueMappings
              key={`${storeId}:${tab}`}
              storeId={storeId}
              kind={tab as 'brand' | 'color' | 'variant' | 'attribute'}
            />
          )
        ) : (
          <EmptyState
            title="Mağaza bağlantısı seçin"
            description="Kategori eşlemesi gerçek pazaryeri bağlantısıyla hazırlanır."
          />
        )}
      </Panel>
    </>
  )
}
