import { useState } from 'react'
import { Button, Chip, Dropdown, Label } from '@heroui/react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Download,
  Ellipsis,
  CircleAlert,
  PackageX,
  ShieldCheck,
  Warehouse,
} from 'lucide-react'
import { useApp } from '../app/AppProvider'
import {
  availableStock,
  findVariant,
  isLowStock,
  reservedStock,
  variantStock,
} from '../domain/selectors'
import type { Product, StockMovement, Variant } from '../domain/types'
import { count, dateLabel, dayKey, downloadCsv, matches } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import {
  FilterTabs,
  Metric,
  PageHeader,
  Panel,
  SearchBox,
  SelectButton,
} from '../components/ui/shared'
import { ProductArt } from '../components/ui/ProductArt'
import { InventoryTools, StockCounts } from '../components/inventory/InventoryTools'
import { MAIN_WAREHOUSE, warehouses, warehouseReserved } from '../domain/inventory'
import { stockMovementLabels } from '../domain/inventory-base'
import { StockAdjustment } from '../components/inventory/StockAdjustment'
import { StockMovementDialog } from '../components/inventory/StockMovementDialog'
import { StockTransfersTable } from '../components/inventory/StockTransfersTable'
import { StockThresholds } from '../components/inventory/StockThresholds'

type StockRow = { id: string; product: Product; variant: Variant }
export function InventoryPage() {
  const { state, can } = useApp()
  const { view = 'levels' } = useParams(),
    navigate = useNavigate(),
    location = useLocation()
  const tab = ['levels', 'movements', 'transfers', 'counts'].includes(view) ? view : 'levels'
  const base = location.pathname.startsWith('/retail') ? '/retail/inventory' : '/inventory'
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [warehouse, setWarehouse] = useState('all'),
    [type, setType] = useState('all'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('')
  const warehouseId = warehouse === 'all' ? undefined : warehouse
  const stock = (id: string) => variantStock(state, id, warehouseId)
  const available = (id: string) => availableStock(state, id, undefined, warehouseId)
  const reservedQuantity = (id: string) =>
    warehouseId ? warehouseReserved(state, id, warehouseId) : reservedStock(state, id)
  const [adjusting, setAdjusting] = useState<StockRow | null>(null)
  const [threshold, setThreshold] = useState<Variant | null>(null)
  const [movement, setMovement] = useState<{ row: StockRow; direction: 'in' | 'out' } | null>(null)
  const rows = state.products.flatMap((product) =>
    product.variants.map((variant) => ({ id: variant.id, product, variant })),
  )
  const filtered = rows.filter(
    (row) =>
      matches(`${row.product.name} ${row.variant.sku} ${row.variant.barcode}`, query) &&
      (filter === 'all' ||
        (filter === 'empty' ? available(row.id) <= 0 : isLowStock(state, row.id, warehouseId))),
  )
  const reserved = rows
    .filter((row) => !row.product.bundle)
    .reduce((sum, row) => sum + reservedQuantity(row.id), 0)
  const total = rows
    .filter((row) => !row.product.bundle)
    .reduce((sum, row) => sum + stock(row.id), 0)
  const columns: Column<StockRow>[] = [
    {
      id: 'product',
      label: 'Ürün / varyant',
      rowHeader: true,
      sortValue: (row) => row.product.name,
      cell: (row) => (
        <div className="product-cell">
          <ProductArt product={row.product} variant={row.variant} />
          <span>
            <Link to={`/products/${row.product.id}?tab=stocks`}>
              <strong>{row.product.name}</strong>
            </Link>
            <small>
              {row.variant.name}
              {row.product.bundle ? ' · İçerikten hesaplanır' : ''}
            </small>
          </span>
        </div>
      ),
    },
    {
      id: 'sku',
      label: 'Stok kodu',
      cell: (row) => <span className="code-text">{row.variant.sku}</span>,
    },
    {
      id: 'stock',
      label: warehouseId ? 'Depo stoğu' : 'Toplam stok',
      className: 'align-right',
      sortValue: (row) => stock(row.id),
      cell: (row) => <strong>{stock(row.id)}</strong>,
    },
    ...warehouses(state)
      .filter(() => !warehouseId && warehouses(state).length > 1)
      .map((warehouse) => ({
        id: warehouse.id,
        label: warehouse.name,
        className: 'align-right',
        cell: (row: StockRow) => variantStock(state, row.id, warehouse.id),
      })),
    {
      id: 'reserved',
      label: 'Rezerve',
      className: 'align-right',
      cell: (row) => <span className="muted-cell">{reservedQuantity(row.id)}</span>,
    },
    {
      id: 'available',
      label: 'Satılabilir',
      className: 'align-right',
      sortValue: (row) => available(row.id),
      cell: (row) => (
        <strong className={isLowStock(state, row.id, warehouseId) ? 'text-warning' : ''}>
          {available(row.id)}
        </strong>
      ),
    },
    {
      id: 'status',
      label: 'Durum',
      cell: (row) => (
        <Chip
          size="sm"
          variant="soft"
          color={
            available(row.id) <= 0
              ? 'danger'
              : isLowStock(state, row.id, warehouseId)
                ? 'warning'
                : 'success'
          }
        >
          <span className="status-dot" />
          {available(row.id) < 0
            ? 'Eksi stok'
            : available(row.id) === 0
              ? 'Tükendi'
              : available(row.id) <= (state.ecommerce?.criticalStock ?? 0)
                ? 'Kritik'
                : isLowStock(state, row.id, warehouseId)
                  ? 'Düşük stok'
                  : 'Yeterli'}
        </Chip>
      ),
    },
    {
      id: 'action',
      label: '',
      cell: (row) =>
        row.product.bundle ? (
          <Link className="provider-doc-link" to={`/products/${row.product.id}?tab=variants`}>
            Paket içeriği
          </Link>
        ) : (
          <Dropdown>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              aria-label={`${row.variant.sku} stok işlemleri`}
              isDisabled={!can('stock.write')}
            >
              <Ellipsis size={17} />
            </Button>
            <Dropdown.Popover className="app-dropdown">
              <Dropdown.Menu aria-label="Stok işlemleri">
                <Dropdown.Item
                  id="threshold"
                  textValue="Kritik seviye"
                  onAction={() => setThreshold(row.variant)}
                >
                  <Label>Kritik seviye</Label>
                </Dropdown.Item>
                <Dropdown.Item
                  id="in"
                  textValue="Stok girişi"
                  onAction={() => setMovement({ row, direction: 'in' })}
                >
                  <Label>Stok girişi</Label>
                </Dropdown.Item>
                <Dropdown.Item
                  id="out"
                  textValue="Stok çıkışı"
                  onAction={() => setMovement({ row, direction: 'out' })}
                >
                  <Label>Stok çıkışı</Label>
                </Dropdown.Item>
                <Dropdown.Item
                  id="adjust"
                  textValue="Bakiyeyi düzelt"
                  onAction={() => setAdjusting(row)}
                >
                  <Label>Bakiyeyi düzelt</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ),
    },
  ]
  const movementColumns: Column<StockMovement>[] = [
    {
      id: 'date',
      label: 'Tarih',
      rowHeader: true,
      sortValue: (item) => item.createdAt,
      cell: (item) => dateLabel(item.createdAt, true),
    },
    {
      id: 'product',
      label: 'Ürün',
      cell: (item) => {
        const found = findVariant(state, item.variantId)
        return (
          <div>
            <strong>{found?.product.name}</strong>
            <span className="cell-secondary">{found?.variant.sku}</span>
          </div>
        )
      },
    },
    {
      id: 'type',
      label: 'İşlem',
      cell: (item) => (
        <Chip variant="soft" size="sm">
          {item.type === 'transfer'
            ? item.quantity > 0
              ? 'Transfer giriş'
              : 'Transfer çıkış'
            : stockMovementLabels[item.type]}
        </Chip>
      ),
    },
    {
      id: 'warehouse',
      label: 'Depo',
      cell: (item) =>
        warehouses(state).find((w) => w.id === (item.warehouseId ?? MAIN_WAREHOUSE))?.name ?? '—',
    },
    {
      id: 'reference',
      label: 'Belge / açıklama',
      cell: (item) => <span className="muted-cell">{item.reference}</span>,
    },
    {
      id: 'amount',
      label: 'Değişim',
      className: 'align-right',
      sortValue: (item) => item.quantity,
      cell: (item) => (
        <strong className={`movement-amount ${item.quantity > 0 ? 'positive' : ''}`}>
          {item.quantity > 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
          {item.quantity > 0 ? '+' : ''}
          {item.quantity}
        </strong>
      ),
    },
    {
      id: 'balance',
      label: 'Bakiye',
      className: 'align-right',
      cell: (item) => item.balance ?? '—',
    },
    { id: 'reason', label: 'Sebep', cell: (item) => item.reason ?? stockMovementLabels[item.type] },
    { id: 'author', label: 'Kullanıcı', cell: (item) => item.author ?? '—' },
  ]
  const movements = state.movements.filter(
    (item) =>
      (!warehouseId || (item.warehouseId ?? MAIN_WAREHOUSE) === warehouseId) &&
      (type === 'all' ||
        (type === 'transfer-in'
          ? item.type === 'transfer' && item.quantity > 0
          : type === 'transfer-out'
            ? item.type === 'transfer' && item.quantity < 0
            : item.type === type)) &&
      (!from || dayKey(item.createdAt) >= from) &&
      (!to || dayKey(item.createdAt) <= to) &&
      matches(
        `${findVariant(state, item.variantId)?.product.name} ${item.reference} ${findVariant(state, item.variantId)?.variant.sku}`,
        query,
      ),
  )
  return (
    <>
      <PageHeader
        title={
          {
            levels: 'Stok durumu',
            movements: 'Hareketler',
            transfers: 'Transferler',
            counts: 'Sayımlar',
          }[tab] ?? 'Stok durumu'
        }
        description="Pazaryeri ve perakende için tek, izlenebilir stok kaynağı."
        actions={
          <>
            <Chip variant="soft">
              <Warehouse size={14} />
              {warehouses(state).length} depo
            </Chip>
            <Button
              variant="secondary"
              onPress={() =>
                downloadCsv(
                  'stok-durumu.csv',
                  ['Ürün', 'Varyant', 'SKU', 'Stok', 'Rezerve', 'Satılabilir'],
                  filtered.map((row) => [
                    row.product.name,
                    row.variant.name,
                    row.variant.sku,
                    stock(row.id),
                    reservedQuantity(row.id),
                    available(row.id),
                  ]),
                )
              }
            >
              <Download size={16} />
              Dışa aktar
            </Button>
          </>
        }
      />
      <div className="inventory-metrics">
        <Metric
          label="Toplam stok"
          value={count(total)}
          detail={`${rows.filter((row) => !row.product.bundle).length} fiziksel stok kodu`}
          icon={<Boxes size={18} />}
        />
        <Metric
          label="Rezerve"
          value={count(reserved)}
          detail="onay bekleyen siparişlere ayrılan"
          icon={<ShieldCheck size={18} />}
          index={1}
        />
        <Metric
          label="Düşük stok"
          value={count(
            new Set(
              rows
                .filter((row) => row.product.active && isLowStock(state, row.id, warehouseId))
                .map((row) => row.product.id),
            ).size,
          )}
          detail="kritik seviyedeki ürünler"
          icon={<CircleAlert size={18} />}
          index={2}
        />
        <Metric
          label="Tükenen"
          value={count(rows.filter((row) => available(row.id) <= 0).length)}
          detail="satılabilir stoğu olmayan kodlar"
          icon={<PackageX size={18} />}
          index={3}
        />
        <Metric
          label="Bugünkü hareket"
          value={count(
            state.movements.filter(
              (item) =>
                dayKey(item.createdAt) === dayKey(new Date()) &&
                (!warehouseId || (item.warehouseId ?? MAIN_WAREHOUSE) === warehouseId),
            ).length,
          )}
          detail="stok defterine işlenen"
          icon={<Warehouse size={18} />}
          index={4}
        />
      </div>
      <InventoryTools
        variantIds={filtered.filter((row) => !row.product.bundle).map((row) => row.id)}
      />
      <Panel flush className="list-panel">
        <FilterTabs
          label="Stok görünümü"
          value={tab}
          onChange={(value) => navigate(`${base}/${value}`)}
          items={[
            { id: 'levels', label: 'Stok durumu', count: rows.length },
            { id: 'movements', label: 'Hareketler', count: state.movements.length },
            { id: 'transfers', label: 'Transferler', count: state.stockTransfers?.length ?? 0 },
            { id: 'counts', label: 'Sayımlar', count: state.stockCounts?.length ?? 0 },
          ]}
        />
        <div className="list-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Ürün, stok kodu veya açıklama..."
            label="Stok kayıtlarında ara"
          />
          <SelectButton
            label="Stok deposu filtresi"
            value={warehouse}
            onChange={setWarehouse}
            options={[
              { id: 'all', label: 'Tüm depolar' },
              ...warehouses(state).map((w) => ({ id: w.id, label: w.name })),
            ]}
          />
          {tab === 'levels' && (
            <SelectButton
              label="Stok durumu filtresi"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'Tüm stoklar' },
                { id: 'low', label: 'Düşük stok' },
                { id: 'empty', label: 'Tükenenler' },
              ]}
            />
          )}
        </div>
        {tab === 'movements' && (
          <div className="stock-movement-filters">
            <SelectButton
              label="Hareket türü"
              value={type}
              onChange={setType}
              options={[
                { id: 'all', label: 'Tüm hareketler' },
                ...Object.entries(stockMovementLabels)
                  .filter(([id]) => id !== 'transfer')
                  .map(([id, label]) => ({ id, label })),
                { id: 'transfer-in', label: 'Transfer giriş' },
                { id: 'transfer-out', label: 'Transfer çıkış' },
              ]}
            />
            <label className="order-date-field">
              <span className="label">Başlangıç tarihi</span>
              <input
                className="input input--secondary"
                type="date"
                value={from}
                max={to}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="order-date-field">
              <span className="label">Bitiş tarihi</span>
              <input
                className="input input--secondary"
                type="date"
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
        )}
        {tab === 'counts' ? (
          <StockCounts warehouseId={warehouseId} query={query} />
        ) : tab === 'transfers' ? (
          <StockTransfersTable warehouseId={warehouseId} query={query} />
        ) : tab === 'levels' ? (
          <DataTable items={filtered} columns={columns} label="Depo stokları" />
        ) : (
          <DataTable items={movements} columns={movementColumns} label="Stok hareketleri" />
        )}
      </Panel>
      {threshold && <StockThresholds variant={threshold} onClose={() => setThreshold(null)} />}
      {adjusting && (
        <StockAdjustment
          key={adjusting.id}
          product={adjusting.product}
          variant={adjusting.variant}
          initialWarehouseId={warehouseId}
          onClose={() => setAdjusting(null)}
        />
      )}
      {movement && (
        <StockMovementDialog
          product={movement.row.product}
          variant={movement.row.variant}
          direction={movement.direction}
          warehouseId={warehouseId}
          onClose={() => setMovement(null)}
        />
      )}
    </>
  )
}
