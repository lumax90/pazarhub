import { useState } from 'react'
import { Button, Chip, Dropdown, Label } from '@heroui/react'
import {
  Check,
  ChevronRight,
  Columns3,
  Download,
  Grid2X2,
  List,
  Package,
  Plus,
  SearchX,
} from 'lucide-react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { productPrice as catalogPrice, productStock as catalogStock } from '../domain/selectors'
import type { Product } from '../domain/types'
import { dateLabel, downloadCsv, matches, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import {
  ChannelIcon,
  Dialog,
  EmptyState,
  FilterTabs,
  PageHeader,
  Panel,
  SearchBox,
  SelectButton,
} from '../components/ui/shared'
import { ProductArt } from '../components/ui/ProductArt'
import { BulkProducts } from '../components/inventory/BulkProducts'
import { CatalogImportButton } from '../components/inventory/CatalogImport'
import { StockAdjustment } from '../components/inventory/StockAdjustment'
import { channelNames } from '../domain/channels'

export function ProductsPage() {
  const { state, can } = useApp(),
    navigate = useNavigate()
  const productPrice = (product: Product) => catalogPrice(product, state)
  const productStock = (product: Product) => catalogStock(product, state)
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? '',
    category = params.get('category') ?? 'all',
    filter = params.get('filter') ?? 'all',
    view = params.get('view') ?? 'table'
  const setFilterValue = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'all' || value === 'table') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }
  const [bulkOpen, setBulkOpen] = useState(false),
    [preview, setPreview] = useState<Product | null>(null),
    [adjusting, setAdjusting] = useState<Product | null>(null)
  const [visible, setVisible] = useState(
    new Set(['category', 'variants', 'price', 'stock', 'channels', 'status']),
  )
  const categories = [...new Set(state.products.map((product) => product.category))]
  const filtered = state.products.filter(
    (product) =>
      (category === 'all' || product.category === category) &&
      (filter === 'all' || (filter === 'active' ? product.active : productStock(product) === 0)) &&
      matches(
        `${product.name} ${product.brand} ${product.modelCode ?? ''} ${product.variants.map((v) => `${v.sku} ${v.barcode}`).join(' ')}`,
        query,
      ),
  )
  const columns: Column<Product>[] = [
    {
      id: 'name',
      label: 'Ürün',
      rowHeader: true,
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="product-cell">
          <button
            className="button button--sm button--ghost product-thumbnail-button"
            type="button"
            aria-label={`${p.name} görselini büyüt`}
            onClick={() => setPreview(p)}
          >
            <ProductArt product={p} />
          </button>
          <Link to={`/products/${p.id}`}>
            <strong>{p.name}</strong>
            <small>{p.variants[0]?.sku}</small>
          </Link>
        </div>
      ),
    },
    {
      id: 'category',
      label: 'Kategori',
      cell: (p) => <span className="muted-cell">{p.category}</span>,
    },
    { id: 'brand', label: 'Marka', cell: (p) => p.brand || '—' },
    {
      id: 'variants',
      label: 'Varyant',
      cell: (p) =>
        p.bundle ? (
          <Chip size="sm" variant="soft" color="accent">
            Paket
          </Chip>
        ) : p.variants.length > 1 ? (
          `${p.variants.length} varyant`
        ) : (
          'Standart'
        ),
    },
    {
      id: 'price',
      label: 'Satış fiyatı',
      sortValue: productPrice,
      className: 'align-right',
      cell: (p) => <strong className="money-cell">{money(productPrice(p))}</strong>,
    },
    {
      id: 'stock',
      label: 'Stok',
      sortValue: productStock,
      cell: (p) => (
        <button
          type="button"
          className={`button button--sm button--ghost ${`stock-value stock-quick-edit ${productStock(p) <= p.lowStock ? 'is-low' : ''}`}`}
          aria-label={`${p.name} stoğunu düzenle`}
          onClick={() =>
            !p.bundle && p.variants.length === 1 && can('stock.write')
              ? setAdjusting(p)
              : navigate(`/products/${p.id}?tab=stocks`)
          }
        >
          {productStock(p)} <small>{(p.unit ?? 'Adet').toLocaleLowerCase('tr-TR')}</small>
        </button>
      ),
    },
    {
      id: 'channels',
      label: 'Pazaryerleri',
      cell: (p) => {
        const channels = [
          ...new Set(
            state.listings
              .filter((l) => l.productId === p.id && l.status === 'active')
              .map((l) => l.channel),
          ),
        ]
        return (
          <div
            className="channel-icon-stack"
            role="img"
            aria-label={
              channels.length
                ? channels.map((channel) => channelNames[channel]).join(', ')
                : 'Yayında ilan yok'
            }
          >
            {channels.map((channel) => (
              <ChannelIcon key={channel} channel={channel} />
            ))}
          </div>
        )
      },
    },
    {
      id: 'status',
      label: 'Durum',
      cell: (p) => (
        <Chip size="sm" color={p.active ? 'success' : 'default'} variant="soft">
          <span className="status-dot" />
          {p.active ? 'Aktif' : 'Pasif'}
        </Chip>
      ),
    },
    {
      id: 'updated',
      label: 'Güncellenme',
      sortValue: (p) => p.updatedAt ?? '',
      cell: (p) => (p.updatedAt ? dateLabel(p.updatedAt, true) : '—'),
    },
    {
      id: 'action',
      label: '',
      cell: (p) => (
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={`${p.name} düzenle`}
          onPress={() => navigate(`/products/${p.id}`)}
        >
          <ChevronRight size={16} />
        </Button>
      ),
    },
  ]
  if (params.has('new')) return <Navigate to="/products/new" replace />
  return (
    <>
      <PageHeader
        title="Ürünler"
        description="Tek katalog. Her mağazada tutarlı ürün bilgisi."
        actions={
          <>
            <CatalogImportButton />
            <Button
              variant="secondary"
              isDisabled={!can('catalog.write')}
              onPress={() => navigate('/products/new/bundle')}
            >
              <Package size={16} />
              Paket oluştur
            </Button>
            <Button
              variant="secondary"
              onPress={() =>
                downloadCsv(
                  'urunler.csv',
                  ['Ürün', 'Kategori', 'Stok', 'Satış fiyatı (TL)'],
                  filtered.map((p) => [
                    p.name,
                    p.category,
                    productStock(p),
                    (productPrice(p) / 100).toFixed(2),
                  ]),
                )
              }
            >
              <Download size={16} />
              Dışa aktar
            </Button>
            <Button
              variant="primary"
              isDisabled={!can('catalog.write')}
              onPress={() => navigate('/products/new')}
            >
              <Plus size={17} />
              Yeni ürün
            </Button>
            <Button
              variant="secondary"
              isDisabled={!filtered.length || !can('catalog.write')}
              onPress={() => setBulkOpen(true)}
            >
              Toplu düzenle
            </Button>
          </>
        }
      />
      <div className="summary-pills">
        <span>
          <Package size={16} />
          <strong>{state.products.length}</strong> ürün
        </span>
        <span>
          <strong>{state.products.flatMap((p) => p.variants).length}</strong> stok kodu
        </span>
        <span>
          <strong>{state.products.filter((p) => productStock(p) === 0).length}</strong> tükenen ürün
        </span>
      </div>
      <Panel flush className="list-panel">
        <FilterTabs
          value={filter}
          onChange={(value) => setFilterValue('filter', value)}
          label="Ürün durumu"
          items={[
            { id: 'all', label: 'Tüm ürünler', count: state.products.length },
            {
              id: 'active',
              label: 'Aktif ürünler',
              count: state.products.filter((p) => p.active).length,
            },
            {
              id: 'empty',
              label: 'Stoğu tükenenler',
              count: state.products.filter((p) => productStock(p) === 0).length,
            },
          ]}
        />
        <div className="list-toolbar">
          <SearchBox
            value={query}
            onChange={(value) => setFilterValue('q', value)}
            placeholder="Ürün adı, stok kodu veya barkod..."
            label="Ürünlerde ara"
          />
          <div className="toolbar-right">
            <SelectButton
              label="Ürün kategorisi filtresi"
              value={category}
              onChange={(value) => setFilterValue('category', value)}
              options={[
                { id: 'all', label: 'Tüm kategoriler' },
                ...categories.map((category) => ({ id: category, label: category })),
              ]}
            />
            <Dropdown>
              <Button variant="secondary" aria-label="Sütunları seç">
                <Columns3 size={15} />
                Sütunlar
              </Button>
              <Dropdown.Popover className="app-dropdown">
                <Dropdown.Menu
                  aria-label="Ürün sütunları"
                  selectionMode="multiple"
                  selectedKeys={visible}
                  onSelectionChange={(keys) =>
                    setVisible(
                      new Set(keys === 'all' ? columns.map((c) => c.id) : [...keys].map(String)),
                    )
                  }
                >
                  {columns
                    .filter((c) => !['name', 'action'].includes(c.id))
                    .map((column) => (
                      <Dropdown.Item
                        key={column.id}
                        id={column.id}
                        textValue={column.label}
                        shouldCloseOnSelect={false}
                      >
                        <Label>{column.label}</Label>
                        {visible.has(column.id) && <Check size={14} className="menu-check" />}
                      </Dropdown.Item>
                    ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <div className="view-switch">
              <Button
                isIconOnly
                size="sm"
                variant={view === 'table' ? 'secondary' : 'ghost'}
                aria-label="Liste görünümü"
                aria-pressed={view === 'table'}
                onPress={() => setFilterValue('view', 'table')}
              >
                <List size={16} />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant={view === 'grid' ? 'secondary' : 'ghost'}
                aria-label="Kart görünümü"
                aria-pressed={view === 'grid'}
                onPress={() => setFilterValue('view', 'grid')}
              >
                <Grid2X2 size={16} />
              </Button>
            </div>
          </div>
        </div>
        {view === 'table' ? (
          <DataTable
            items={filtered}
            columns={columns.filter((c) => ['name', 'action'].includes(c.id) || visible.has(c.id))}
            label="Ürün listesi"
          />
        ) : filtered.length ? (
          <div className="product-grid">
            {filtered.map((p) => (
              <Link to={`/products/${p.id}`} key={p.id} className="product-grid-card">
                <div className="product-grid-image">
                  <ProductArt product={p} />
                  <span className="product-grid-category">{p.category}</span>
                </div>
                <div className="product-grid-copy">
                  <strong>{p.name}</strong>
                  <span>
                    {p.variants.length} varyant · {productStock(p)}{' '}
                    {(p.unit ?? 'Adet').toLocaleLowerCase('tr-TR')} stok
                  </span>
                  <div>
                    <strong>{money(productPrice(p))}</strong>
                    <ChevronRight size={16} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Ürün bulunamadı"
            description="Filtreleri veya arama kelimesini değiştirin."
            icon={<SearchX size={25} />}
          />
        )}
      </Panel>
      {preview && (
        <Dialog open title={preview.name} onClose={() => setPreview(null)}>
          <div className="product-image-lightbox">
            <ProductArt product={preview} />
          </div>
        </Dialog>
      )}
      {adjusting && (
        <StockAdjustment
          product={adjusting}
          variant={adjusting.variants[0]}
          onClose={() => setAdjusting(null)}
        />
      )}
      {bulkOpen && (
        <BulkProducts
          ids={filtered.slice(0, 200).map((p) => p.id)}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  )
}
