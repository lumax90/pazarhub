import { useState } from 'react'
import { Button, Chip, Dropdown, Label } from '@heroui/react'
import type { Selection } from '@heroui/react'
import {
  Check,
  Columns3,
  Download,
  Eye,
  FileText,
  Filter,
  MessageSquareText,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { statusLabels } from '../domain/operations'
import { findVariant, orderTotal } from '../domain/selectors'
import {
  defaultOrderColumns,
  defaultOrderDates,
  filterOrders,
  orderPreparation,
  orderPrinted,
} from '../domain/orders'
import type { Order, OrderFilters, OrderStatus } from '../domain/types'
import { channelNames } from '../domain/channels'
import { invoiceStatusLabels } from '../domain/labels'
import { invoiceDocumentLabel } from '../domain/invoice-document'
import { dateLabel, downloadCsv, initials, money } from '../lib/format'
import { orderFilterParams, readOrderFilters } from '../lib/order-filters'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import { ChannelBadge, Dialog, PageHeader, Panel, SearchBox } from '../components/ui/shared'
import { ProductArt } from '../components/ui/ProductArt'
import { OrderFiltersPanel } from '../components/orders/OrderFiltersPanel'
import { OrderStatusActions } from '../components/orders/OrderStatusActions'
import { OrderBulkActions } from '../components/orders/OrderBulkActions'
import { OrderNotes } from '../components/orders/OrderNotes'
import { InvoiceManager } from '../components/integrations/InvoiceManager'
import { foreignOrder, orderCurrencyTotal } from '../domain/order-currency'
import { currencyMoney } from '../domain/money'

export function OrdersPage() {
  const { state, run, can, notify } = useApp(),
    navigate = useNavigate(),
    location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = readOrderFilters(params, state.ecommerce?.orderDays),
    view = params.get('view')
  const [filterOpen, setFilterOpen] = useState(false),
    [selection, setSelection] = useState<Selection>(new Set())
  const [notesOrder, setNotesOrder] = useState<string | null>(null),
    [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [columnDraft, setColumnDraft] = useState<string[] | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const visibleColumns = columnDraft ?? state.preferences.orderColumns ?? defaultOrderColumns
  const filtered = filterOrders(state, filters).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  const forCounts = filterOrders(state, filters, true)
  const customerName = (order: Order) =>
    state.customers.find((customer) => customer.id === order.customerId)?.name ??
    order.shippingAddress?.name ??
    'Müşteri'
  const selectedIds =
    selection === 'all' ? filtered.map((order) => order.id) : [...selection].map(String)
  const selectedOrders = filtered.filter((order) => selectedIds.includes(order.id))
  const backState = { ordersReturnTo: location.pathname + location.search }
  const apply = (next: OrderFilters, selectedView?: string) => {
    if (bulkBusy) return
    setSelection(new Set())
    setFilterOpen(false)
    setParams(orderFilterParams(next, selectedView), { replace: true })
  }
  const columns: Column<Order>[] = [
    {
      id: 'number',
      label: 'Sipariş No',
      rowHeader: true,
      sortValue: (order) => order.number,
      cell: (order) => (
        <div>
          <Link state={backState} to={`/orders/${order.id}`} className="order-link">
            {order.number}
          </Link>
          {order.externalNumber && (
            <span className="cell-secondary code-text">{order.externalNumber}</span>
          )}
        </div>
      ),
    },
    {
      id: 'customer',
      label: 'Sipariş Veren',
      sortValue: customerName,
      cell: (order) => (
        <div className="customer-cell">
          <span className="customer-avatar">{initials(customerName(order))}</span>
          <span>
            <strong>{customerName(order)}</strong>
            {order.shippingAddress?.name && order.shippingAddress.name !== customerName(order) && (
              <small>Alıcı: {order.shippingAddress?.name}</small>
            )}
            <span className="cell-secondary">{order.shippingAddress?.city}</span>
            {order.trackingNumber && (
              <small className="order-tracking-preview">
                {order.cargoProvider} · {order.trackingNumber}
              </small>
            )}
          </span>
        </div>
      ),
    },
    {
      id: 'products',
      label: 'Ürünler',
      cell: (order) => (
        <div className="order-products">
          {order.lines.slice(0, 2).map((line, index) => {
            const found = findVariant(state, line.variantId)
            return found ? (
              <ProductArt key={index} product={found.product} variant={found.variant} />
            ) : null
          })}
          <span>{order.lines.reduce((sum, line) => sum + line.quantity, 0)} adet</span>
        </div>
      ),
    },
    {
      id: 'date',
      label: 'Tarih',
      sortValue: (order) => order.createdAt,
      cell: (order) => <span className="muted-cell">{dateLabel(order.createdAt, true)}</span>,
    },
    {
      id: 'due',
      label: 'Son Kargoya Verilme',
      sortValue: (order) => order.dueAt,
      cell: (order) => <span className="muted-cell">{dateLabel(order.dueAt, true)}</span>,
    },
    { id: 'channel', label: 'Kaynak', cell: (order) => <ChannelBadge channel={order.channel} /> },
    { id: 'status', label: 'Durum', cell: (order) => <OrderStatusActions order={order} compact /> },
    {
      id: 'preparation',
      label: 'Hazırlık',
      cell: (order) => {
        const preparation = orderPreparation(order)
        return (
          <Chip
            size="sm"
            variant="soft"
            color={
              preparation.ready && preparation.ready === preparation.total ? 'success' : 'default'
            }
          >
            {preparation.ready} / {preparation.total}
          </Chip>
        )
      },
    },
    {
      id: 'invoice',
      label: 'Fatura',
      cell: (order) => {
        const invoice = state.invoices.find((invoice) => invoice.orderId === order.id)
        return invoice ? (
          <button
            className="button button--md button--ghost order-invoice-link"
            onClick={() => setInvoiceId(invoice.id)}
          >
            <FileText size={14} />
            <span>
              {invoice.documentNumber || invoice.number}
              <small>{invoiceDocumentLabel(invoice) ?? invoiceStatusLabels[invoice.status]}</small>
            </span>
          </button>
        ) : (
          <span className="muted-cell">Kesilmedi</span>
        )
      },
    },
    {
      id: 'total',
      label: 'Toplam Tutar',
      className: 'align-right',
      sortValue: orderTotal,
      cell: (order) => (
        <div>
          <strong className="money-cell">
            {currencyMoney(orderCurrencyTotal(order), order.currency)}
          </strong>
          {foreignOrder(order) && (
            <small className="cell-secondary">{money(orderTotal(order))}</small>
          )}
        </div>
      ),
    },
    {
      id: 'print',
      label: 'Yazdırma',
      cell: (order) => (
        <span className="muted-cell">
          {orderPrinted(order)
            ? `Yazdırıldı · ${dateLabel(order.printStatus!.at, true)}`
            : order.printStatus?.printed
              ? 'Çıktı değişti'
              : 'Yazdırılmadı'}
        </span>
      ),
    },
    {
      id: 'action',
      label: 'İşlemler',
      cell: (order) => (
        <div className="row-actions">
          <Link
            state={backState}
            to={`/orders/${order.id}`}
            className="order-icon-link"
            aria-label={`${order.number} detayını aç`}
          >
            <Eye size={16} />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label={`${order.number} notları`}
            onPress={() => setNotesOrder(order.id)}
          >
            <MessageSquareText size={16} />
            {!!order.notes?.length && (
              <span className="order-note-count">{order.notes.length}</span>
            )}
          </Button>
          <a
            className="order-icon-link"
            href={`/orders/print?ids=${encodeURIComponent(order.id)}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`${order.number} detayını yazdır`}
          >
            <Printer size={16} />
          </a>
        </div>
      ),
    },
  ]
  if (params.has('new')) return <Navigate to="/orders/new" replace />
  return (
    <div className="order-workspace">
      <PageHeader
        title="Siparişler"
        description="Sipariş, hazırlık, kargo ve fatura takibi."
        actions={
          <>
            <Button
              variant="secondary"
              onPress={() =>
                downloadCsv(
                  'siparisler.csv',
                  [
                    'Sipariş',
                    'Kaynak sipariş no',
                    'Müşteri',
                    'Kaynak',
                    'Durum',
                    'Tutar (TL)',
                    'Sipariş para birimi',
                    'Döviz tutarı',
                    'Tarih',
                  ],
                  filtered.map((order) => [
                    order.number,
                    order.externalNumber ?? '',
                    customerName(order),
                    channelNames[order.channel],
                    statusLabels[order.status],
                    (orderTotal(order) / 100).toFixed(2),
                    order.currency ?? 'TRY',
                    (orderCurrencyTotal(order) / 100).toFixed(2),
                    dateLabel(order.createdAt, true),
                  ]),
                )
              }
            >
              <Download size={16} />
              Dışa aktar
            </Button>
            <Button
              variant="primary"
              isDisabled={!can('orders.write')}
              onPress={() => navigate('/orders/new', { state: backState })}
            >
              <Plus size={16} />
              Sipariş oluştur
            </Button>
          </>
        }
      />
      <Panel flush className="list-panel order-list-panel">
        <div className="order-list-toolbar">
          <div className="order-saved-filters">
            <Button
              variant={filterOpen ? 'primary' : 'secondary'}
              aria-expanded={filterOpen}
              onPress={() => setFilterOpen((value) => !value)}
            >
              <Filter size={15} />
              Filtre
            </Button>
            <Button
              variant={!view ? 'secondary' : 'ghost'}
              aria-pressed={!view}
              onPress={() => apply(defaultOrderDates())}
            >
              Tüm Siparişler
            </Button>
            {state.orderFilters?.map((saved) => (
              <span
                key={saved.id}
                className={`order-saved-filter ${view === saved.id ? 'is-selected' : ''}`}
              >
                <Button
                  variant={view === saved.id ? 'secondary' : 'ghost'}
                  aria-pressed={view === saved.id}
                  onPress={() => apply(saved.filters, saved.id)}
                >
                  {saved.name}
                </Button>
                {view === saved.id && can('orders.write') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    aria-label={`${saved.name} filtresini kaldır`}
                    onPress={async () => {
                      const result = await run({
                        type: 'order.filter.delete',
                        id: saved.id,
                        version: saved.version,
                      })
                      if (result.ok) apply(filters)
                    }}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </span>
            ))}
          </div>
          <div className="order-date-range">
            <label className="order-date-field">
              <span className="label">Başlangıç tarihi</span>
              <input
                className="input input--secondary"
                type="date"
                aria-label="Başlangıç tarihi"
                value={filters.from ?? ''}
                max={filters.to}
                onChange={(event) => apply({ ...filters, from: event.target.value || undefined })}
              />
            </label>
            <span>—</span>
            <label className="order-date-field">
              <span className="label">Bitiş tarihi</span>
              <input
                className="input input--secondary"
                type="date"
                aria-label="Bitiş tarihi"
                value={filters.to ?? ''}
                min={filters.from}
                onChange={(event) => apply({ ...filters, to: event.target.value || undefined })}
              />
            </label>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Tarihleri son 7 güne döndür"
              onPress={() => apply({ ...filters, ...defaultOrderDates() })}
            >
              <X size={14} />
            </Button>
          </div>
          <SearchBox
            label="Siparişlerde ara"
            value={filters.query ?? ''}
            onChange={(query) => apply({ ...filters, query })}
            placeholder="No, müşteri, alıcı, takip no"
          />
          <Dropdown>
            <Button variant="secondary" aria-label="Sütunları seç" isDisabled={!!columnDraft}>
              <Columns3 size={15} />
              Sütunlar
            </Button>
            <Dropdown.Popover className="app-dropdown">
              <Dropdown.Menu
                aria-label="Sipariş sütunları"
                selectionMode="multiple"
                selectedKeys={new Set(visibleColumns)}
                onSelectionChange={async (keys) => {
                  const next = keys === 'all' ? defaultOrderColumns : [...keys].map(String)
                  setColumnDraft(next)
                  const result = await run(
                    {
                      type: 'preferences.update',
                      preferences: { ...state.preferences, orderColumns: next },
                    },
                    { silent: true },
                  )
                  if (!result.ok) notify(result.message, 'error')
                  setColumnDraft(null)
                }}
              >
                {columns
                  .filter((column) => !['number', 'action'].includes(column.id))
                  .map((column) => (
                    <Dropdown.Item
                      id={column.id}
                      key={column.id}
                      textValue={column.label}
                      shouldCloseOnSelect={false}
                      isDisabled={!!columnDraft}
                    >
                      <Label>{column.label}</Label>
                      {visibleColumns.includes(column.id) && (
                        <Check size={14} className="menu-check" />
                      )}
                    </Dropdown.Item>
                  ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
        <div className="order-status-filters">
          <span>{filtered.length} sipariş</span>
          {(Object.keys(statusLabels) as OrderStatus[]).map((status) => (
            <Button
              key={status}
              variant={filters.statuses?.includes(status) ? 'secondary' : 'ghost'}
              className={filters.statuses?.includes(status) ? 'is-active' : ''}
              aria-pressed={filters.statuses?.includes(status) ?? false}
              onPress={() =>
                apply({
                  ...filters,
                  statuses:
                    filters.statuses?.length === 1 && filters.statuses[0] === status
                      ? []
                      : [status],
                })
              }
            >
              <span className={`order-status-dot order-status-dot--${status}`} />
              {statusLabels[status]}
              <span>{forCounts.filter((order) => order.status === status).length}</span>
            </Button>
          ))}
        </div>
        {filterOpen && (
          <OrderFiltersPanel
            filters={filters}
            onApply={apply}
            onClose={() => setFilterOpen(false)}
          />
        )}
        <DataTable
          items={filtered}
          columns={columns.filter(
            (column) =>
              ['number', 'action'].includes(column.id) || visibleColumns.includes(column.id),
          )}
          label="Sipariş listesi"
          selection={selection}
          onSelectionChange={(value) => {
            if (!bulkBusy) setSelection(value)
          }}
          emptyTitle="Bu aralıkta sipariş yok"
          emptyDescription="Tarih aralığını genişletebilir veya filtrelerinizi değiştirebilirsiniz."
        />
      </Panel>
      <OrderBulkActions
        orders={selectedOrders}
        onSelectionChange={(ids) => setSelection(new Set(ids))}
        onBusyChange={setBulkBusy}
      />
      {notesOrder && (
        <Dialog
          open
          title="Sipariş notları"
          description={state.orders.find((order) => order.id === notesOrder)?.number}
          onClose={() => setNotesOrder(null)}
        >
          <OrderNotes orderId={notesOrder} />
        </Dialog>
      )}
      {invoiceId && state.invoices.some((invoice) => invoice.id === invoiceId) && (
        <InvoiceManager
          key={invoiceId}
          invoice={state.invoices.find((invoice) => invoice.id === invoiceId)!}
          onClose={() => setInvoiceId(null)}
        />
      )}
    </div>
  )
}
