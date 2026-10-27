import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { ArrowUpRight, CircleAlert, Link2, Pencil, RotateCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { availableStock, findVariant, listingPrice, variantPrice } from '../domain/selectors'
import type { Listing, ListingStatus } from '../domain/types'
import { dateLabel, matches, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import {
  ChannelIcon,
  Dialog,
  Field,
  FilterTabs,
  MoneyField,
  PageHeader,
  Panel,
  SearchBox,
  SectionTitle,
  SelectButton,
} from '../components/ui/shared'
import { channelNames } from '../domain/channels'
import { ProductArt } from '../components/ui/ProductArt'
import { ProductMapping } from '../components/integrations/ProductMapping'
import { CategoryMappings } from '../components/integrations/CategoryMappings'
import { NewListingButton } from './PublishingPage'
import { publicationLabels } from '../domain/publishing'
import { contentDefinitions } from '../domain/listing-content'

const listingLabels: Record<ListingStatus, string> = {
  active: 'Yayında',
  pending: 'Onay bekliyor',
  rejected: 'Kontrol gerekiyor',
  archived: 'Arşivde',
}
const listingColors = {
  active: 'success',
  pending: 'warning',
  rejected: 'danger',
  archived: 'default',
} as const

export function ListingsPage() {
  const { state, run, mode, can } = useApp()
  const [params, setParams] = useSearchParams()
  const productId = params.get('product')
  // `?store=` and `?view=` let a connection card open its own mapping directly.
  const [store, setStore] = useState(
    params.get('store') ?? (productId ? 'all' : (state.connections[0]?.id ?? 'all')),
  )
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Listing | null>(null)
  const [view, setView] = useState(
    ['mapping', 'categories'].includes(params.get('view') ?? '') ? params.get('view')! : 'listings',
  )
  const forStore = state.listings.filter(
    (listing) =>
      (store === 'all' || listing.storeId === store) &&
      (!productId || listing.productId === productId),
  )
  const filtered = forStore.filter(
    (listing) =>
      (status === 'all' || listing.status === status) &&
      matches(
        `${findVariant(state, listing.variantId)?.product.name} ${findVariant(state, listing.variantId)?.variant.sku} ${listing.titleOverride ?? ''}`,
        query,
      ),
  )
  const columns: Column<Listing>[] = [
    {
      id: 'product',
      label: 'Ürün / ilan',
      rowHeader: true,
      cell: (listing) => {
        const found = findVariant(state, listing.variantId)
        return found ? (
          <div className="product-cell">
            <ProductArt product={found.product} variant={found.variant} />
            <span>
              <strong>{listing.titleOverride ?? found.product.name}</strong>
              <small>
                {found.variant.name} · {found.variant.sku}
              </small>
              {listing.error && (
                <span className="listing-error-preview">
                  <CircleAlert size={11} />
                  İşlem açıklaması mevcut
                </span>
              )}
            </span>
          </div>
        ) : (
          'Ürün bulunamadı'
        )
      },
    },
    {
      id: 'stock',
      label: 'Satılabilir stok',
      className: 'align-right',
      cell: (listing) => availableStock(state, listing.variantId),
    },
    {
      id: 'price',
      label: 'Mağaza fiyatı',
      className: 'align-right',
      cell: (listing) => (
        <div>
          <strong className="money-cell">{money(listingPrice(state, listing))}</strong>
          <span className="cell-secondary">
            {listing.priceOverride !== undefined ? 'Mağazaya özel' : 'Ürün fiyatından'}
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      label: 'İlan durumu',
      cell: (listing) => (
        <Chip size="sm" variant="soft" color={listingColors[listing.status]}>
          <span className="status-dot" />
          {listing.desiredStatus === 'archived'
            ? listing.syncStatus === 'synced'
              ? 'Stok gönderimi kapalı'
              : 'Kapatma bekliyor'
            : listing.publication
              ? publicationLabels[listing.publication.phase]
              : listingLabels[listing.status]}
        </Chip>
      ),
    },
    {
      id: 'updated',
      label: 'Son işlem',
      sortValue: (listing) => listing.updatedAt,
      cell: (listing) => <span className="muted-cell">{dateLabel(listing.updatedAt, true)}</span>,
    },
    {
      id: 'actions',
      label: '',
      cell: (listing) => (
        <div className="row-actions">
          {mode === 'live' &&
            listing.externalId &&
            contentDefinitions[listing.channel] &&
            can('catalog.write') && (
              <Link
                className="button button--secondary button--sm"
                to={`/listings/content/${listing.id}`}
              >
                İçeriği güncelle
              </Link>
            )}
          {listing.publication && (
            <Link
              className="button button--secondary button--sm"
              to={`/listings/prepare/${listing.id}`}
            >
              Yayın hazırlığı
            </Link>
          )}
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label={`${findVariant(state, listing.variantId)?.product.name} ilanını düzenle`}
            onPress={() => setEditing(listing)}
          >
            <Pencil size={15} />
          </Button>
          {listing.status === 'rejected' && (
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              aria-label={
                mode === 'demo' ? 'Demo ilanını yeniden dene' : 'Stok ve fiyatı yeniden gönder'
              }
              onPress={() => run({ type: 'listing.update', id: listing.id, status: 'active' })}
            >
              <RotateCw size={15} />
            </Button>
          )}
        </div>
      ),
    },
  ]
  return (
    <>
      <PageHeader
        title="Platform Listelemeleri"
        description="Ürün aynı, her mağazanın ilanı ve ayarları kendine özel."
        actions={
          <>
            <NewListingButton
              storeId={store === 'all' ? undefined : store}
              productId={productId ?? undefined}
            />
            <Chip variant="soft" size="sm">
              {mode === 'demo' ? 'Demo mağaza verileri' : 'Mağaza bazlı ilanlar'}
            </Chip>
          </>
        }
      />
      {productId && (
        <div className="product-filter-notice">
          <span>
            Ürün:{' '}
            <strong>{state.products.find((p) => p.id === productId)?.name ?? 'Seçili ürün'}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              const next = new URLSearchParams(params)
              next.delete('product')
              setParams(next)
            }}
          >
            Ürün filtresini kaldır
          </Button>
        </div>
      )}
      <div className="store-selector-list">
        <Button
          variant={store === 'all' ? 'secondary' : 'ghost'}
          className={`store-selector ${store === 'all' ? 'is-active' : ''}`}
          aria-pressed={store === 'all'}
          onPress={() => setStore('all')}
        >
          Tüm mağazalar
        </Button>
        {state.connections.map((connection) => (
          <Button
            key={connection.id}
            variant={store === connection.id ? 'secondary' : 'ghost'}
            className={`store-selector ${store === connection.id ? 'is-active' : ''}`}
            aria-pressed={store === connection.id}
            onPress={() => {
              setStore(connection.id)
              setStatus('all')
            }}
          >
            <ChannelIcon channel={connection.channel} />
            <span>{channelNames[connection.channel]}</span>
            <span className="store-listing-count">
              {state.listings.filter((listing) => listing.storeId === connection.id).length}
            </span>
          </Button>
        ))}
        <Link className="store-selector-add" to="/connections">
          <Link2 size={16} />
          Mağazaları yönet
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <Panel flush className="list-panel">
        {mode === 'live' && (
          <FilterTabs
            label="Listeleme görünümü"
            value={view}
            onChange={setView}
            items={[
              { id: 'listings', label: 'İlanlarım' },
              { id: 'mapping', label: 'Ürün Eşlemesi' },
              { id: 'categories', label: 'Kategori Eşlemesi' },
            ]}
          />
        )}
        {view === 'categories' && mode === 'live' ? (
          <CategoryMappings key={store} storeId={store} />
        ) : view === 'mapping' && mode === 'live' ? (
          <ProductMapping key={store} storeId={store} />
        ) : (
          <>
            <FilterTabs
              value={status}
              onChange={setStatus}
              label="İlan durumları"
              items={[
                { id: 'all', label: 'Tüm ilanlar', count: forStore.length },
                ...(['active', 'pending', 'rejected', 'archived'] as ListingStatus[]).map(
                  (status) => ({
                    id: status,
                    label: listingLabels[status],
                    count: forStore.filter((listing) => listing.status === status).length,
                  }),
                ),
              ]}
            />
            <div className="list-toolbar">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Ürün veya stok kodu ara..."
                label="İlanlarda ara"
              />
              <span className="record-count">{filtered.length} ilan</span>
            </div>
            <DataTable
              items={filtered}
              columns={columns}
              label="Mağaza ilanları"
              emptyTitle="Bu görünümde ilan yok"
              emptyDescription="Başka bir mağaza veya durum seçebilirsiniz."
            />
          </>
        )}
      </Panel>
      {editing && can('catalog.write') && (
        <ListingEditor
          key={editing.id}
          listing={state.listings.find((listing) => listing.id === editing.id) ?? editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function ListingEditor({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const { state, run, mode } = useApp()
  const found = findVariant(state, listing.variantId)!
  const [title, setTitle] = useState(listing.titleOverride ?? found.product.name)
  const [inherit, setInherit] = useState(listing.priceOverride === undefined)
  const [price, setPrice] = useState(listing.priceOverride ?? variantPrice(state, found.variant.id))
  const [excluded, setExcluded] = useState(listing.marginExcluded ?? false)
  const [listPrice, setListPrice] = useState(
    listing.listPriceOverride ?? listing.remoteListPrice ?? price,
  )
  const [listInherit, setListInherit] = useState(listing.listPriceOverride === undefined)
  const [status, setStatus] = useState<ListingStatus | 'keep'>(
    mode === 'demo' ? listing.status : 'keep',
  )
  const [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const result = await run({
      type: 'listing.update',
      id: listing.id,
      titleOverride: title === found.product.name ? null : title,
      priceOverride: inherit ? null : price,
      marginExcluded: excluded,
      listPriceOverride: listInherit ? null : listPrice,
      ...(status !== 'keep' && (mode === 'live' || status !== listing.status) ? { status } : {}),
    })
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Mağaza ilanını düzenle"
      description={`${state.connections.find((connection) => connection.id === listing.storeId)?.name} · ${found.variant.name}`}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" form="listing-form" type="submit">
            Değişiklikleri kaydet
          </Button>
        </>
      }
    >
      <form id="listing-form" onSubmit={save}>
        {listing.error && (
          <div className="inline-notice warning">
            <CircleAlert size={17} />
            <span>{listing.error}</span>
          </div>
        )}
        <SectionTitle
          title="İlan bilgileri"
          description="Değişiklik yalnızca bu mağazadaki bu varyanta uygulanır."
        >
          <Field
            label={mode === 'demo' ? 'İlan başlığı' : 'Yerel ilan başlığı'}
            value={title}
            onChange={setTitle}
            required
            description={
              mode === 'live'
                ? 'Bu başlık panelde gösterilir. Stok/fiyat gönderimi ürün içeriğini değiştirmez.'
                : undefined
            }
          />
          <div className="field-source">
            <Link2 size={13} />
            {title === found.product.name
              ? 'Başlık ürün kartından geliyor.'
              : 'Bu başlık mağazaya özel kaydedilecek.'}
          </div>
        </SectionTitle>
        <SectionTitle title="Fiyat ve durum">
          <Checkbox className="app-checkbox" isSelected={excluded} onChange={setExcluded}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Marjdan hariç</Label>
            </Checkbox.Content>
          </Checkbox>
          <Checkbox isSelected={inherit} onChange={setInherit} className="app-checkbox">
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>
                {mode === 'demo'
                  ? 'Ürün kartındaki fiyatı kullan'
                  : 'Ürün / marj kuralındaki fiyatı kullan'}
              </Label>
            </Checkbox.Content>
          </Checkbox>
          {inherit ? (
            <div className="inherited-value">
              <span>Ürün fiyatı</span>
              <strong>
                {money(
                  listingPrice(state, {
                    ...listing,
                    priceOverride: undefined,
                    marginExcluded: excluded,
                  }),
                )}
              </strong>
              <small>KDV dahil · ürünle birlikte güncellenir</small>
            </div>
          ) : (
            <MoneyField
              label="Mağazaya özel satış fiyatı (₺)"
              initialValue={price}
              onChange={setPrice}
            />
          )}
          {['trendyol', 'n11', 'pazarama'].includes(listing.channel) && (
            <>
              <Checkbox className="app-checkbox" isSelected={listInherit} onChange={setListInherit}>
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>Liste fiyatını mağaza şablonundan al</Label>
                </Checkbox.Content>
              </Checkbox>
              {!listInherit && (
                <MoneyField
                  label="Mağazaya özel liste fiyatı (₺)"
                  initialValue={listPrice}
                  onChange={setListPrice}
                />
              )}
            </>
          )}
          <div className="select-field">
            <label className="label">
              {mode === 'demo' ? 'Demo ilan durumu' : 'Stok gönderimi'}
            </label>
            <SelectButton
              label="İlan durumu"
              value={status}
              onChange={(value) => setStatus(value as ListingStatus | 'keep')}
              options={
                mode === 'demo'
                  ? Object.entries(listingLabels).map(([id, label]) => ({ id, label }))
                  : [
                      { id: 'keep', label: 'Durumu değiştirme' },
                      { id: 'active', label: 'Stok ve fiyatı gönder' },
                      { id: 'archived', label: 'Stoğu sıfır gönder' },
                    ]
              }
            />
          </div>
        </SectionTitle>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
