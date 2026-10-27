import { useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import {
  ArrowLeft,
  Barcode,
  Check,
  FileText,
  MapPin,
  Printer,
  RefreshCw,
  Truck,
  Wallet,
} from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Order, OrderAddress, Shipment } from '../domain/types'
import type { PublicIntegration } from '../domain/integrations'
import { providers } from '../domain/integrations'
import { orderContentKey, orderLineKey, orderPreparation } from '../domain/orders'
import { findVariant, orderTotal, taxTotal } from '../domain/selectors'
import { channelNames } from '../domain/channels'
import { cargoLabels } from '../domain/cargo-labels'
import { invoiceStatusLabels } from '../domain/labels'
import { invoiceDocumentLabel } from '../domain/invoice-document'
import { dateLabel, money } from '../lib/format'
import { apiMutation } from '../lib/api'
import { useResource } from '../lib/useResource'
import { DataTable } from '../components/ui/DataTable'
import {
  ChannelBadge,
  EmptyState,
  PageHeader,
  Panel,
  SelectButton,
  StatusBadge,
} from '../components/ui/shared'
import { ProductArt } from '../components/ui/ProductArt'
import { OrderStatusActions } from '../components/orders/OrderStatusActions'
import { OrderNotes } from '../components/orders/OrderNotes'
import { InvoicePreferenceFields } from '../components/orders/InvoicePreferenceFields'
import { OrderMapping } from '../components/integrations/OrderMapping'
import { InvoiceManager } from '../components/integrations/InvoiceManager'
import { ShipmentEditor } from './ShipmentsPage'
import { BundleContents } from '../components/products/BundleContents'
import { OrderAttachments } from '../components/orders/OrderAttachments'
import { MarketplaceFulfillment } from '../components/orders/MarketplaceFulfillment'
import { OrderReconciliation } from '../components/orders/OrderReconciliation'
import {
  foreignOrder,
  orderCurrencyTotal,
  orderCurrencyShipping,
  orderLineCurrencyTotal,
  orderLineCurrencyPrice,
} from '../domain/order-currency'
import { currencyMoney } from '../domain/money'

export function OrderDetailPage() {
  const { id } = useParams(),
    { state } = useApp(),
    location = useLocation()
  const order = state.orders.find((order) => order.id === id)
  const back =
    typeof location.state?.ordersReturnTo === 'string' &&
    /^\/orders(?:\?|$)/.test(location.state.ordersReturnTo)
      ? location.state.ordersReturnTo
      : '/orders'
  if (!order)
    return (
      <Panel>
        <EmptyState
          title="Sipariş bulunamadı"
          description="Sipariş listesine dönerek kayıtları kontrol edin."
          action={
            <Link to="/orders" className="button button--secondary">
              Listeye dön
            </Link>
          }
        />
      </Panel>
    )
  return <OrderWorkspace key={order.id} order={order} back={back} />
}

function OrderWorkspace({ order, back }: { order: Order; back: string }) {
  const { state, run, can } = useApp()
  const [busy, setBusy] = useState(false)
  const customer = state.customers.find((customer) => customer.id === order.customerId)
  const preparation = orderPreparation(order)
  const allReady = preparation.total > 0 && preparation.ready === preparation.total
  const mark = async (lineKeys: string[], ready: boolean) => {
    if (busy || !can('orders.write')) return
    setBusy(true)
    await run(
      {
        type: 'order.prepare',
        id: order.id,
        lineKeys,
        ready,
        expectedContent: orderContentKey(order),
      },
      { silent: false },
    )
    setBusy(false)
  }
  const canPrepare =
    can('orders.write') &&
    ['pending', 'approved'].includes(order.status) &&
    !order.syncError &&
    !busy
  const total = orderCurrencyTotal(order),
    displayShipping = orderCurrencyShipping(order)
  const tax = foreignOrder(order)
    ? order.lines.reduce(
        (sum, line) =>
          sum +
          Math.round((orderLineCurrencyTotal(order, line) * line.taxRate) / (100 + line.taxRate)),
        0,
      )
    : taxTotal(order.lines)
  const displayMoney = (amount: number) => currencyMoney(amount, order.currency)
  return (
    <div className="order-workspace">
      <div className="order-breadcrumb">
        <Link to={back}>
          <ArrowLeft size={14} />
          Siparişler
        </Link>
        <span>/</span>
        <span>{order.number}</span>
      </div>
      <PageHeader
        title={`Sipariş ${order.number}`}
        description={`${channelNames[order.channel]} · ${dateLabel(order.createdAt, true)}${order.externalNumber ? ` · Kaynak no: ${order.externalNumber}` : ''}`}
        actions={
          <>
            <Link to={back} className="button button--secondary">
              <ArrowLeft size={15} />
              Listeye dön
            </Link>
            <a
              href={`/orders/print?ids=${encodeURIComponent(order.id)}`}
              className="button button--secondary"
              target="_blank"
              rel="noreferrer"
            >
              <Printer size={15} />
              Sipariş detayı yazdır
            </a>
            {cargoLabels(state, [order]).labels.length > 0 && (
              <a
                href={`/orders/labels?ids=${encodeURIComponent(order.id)}`}
                className="button button--secondary"
                target="_blank"
                rel="noreferrer"
              >
                <Barcode size={15} />
                Kargo etiketi
              </a>
            )}
          </>
        }
      />
      <div className="order-detail-summary">
        <StatusBadge status={order.status} />
        <ChannelBadge channel={order.channel} />
        <span>
          Son kargoya verilme: <strong>{dateLabel(order.dueAt, true)}</strong>
        </span>
        <span>
          {order.lines.length} kalem · <strong>{displayMoney(total)}</strong>
        </span>
      </div>
      <OrderStatusActions order={order} />
      <OrderReconciliation order={order} />
      <div className="order-detail-grid">
        <div className="order-detail-main">
          <Panel
            title="Ürünler"
            description={`${order.lines.length} kalem · ${preparation.ready} hazır`}
            className="order-card"
            actions={
              <Checkbox
                className="app-checkbox"
                isSelected={allReady}
                isIndeterminate={preparation.ready > 0 && !allReady}
                isDisabled={!canPrepare}
                onChange={(ready) => void mark(order.lines.map(orderLineKey), ready)}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>Hepsi hazır</Label>
                </Checkbox.Content>
              </Checkbox>
            }
          >
            <DataTable
              label="Sipariş kalemleri"
              items={order.lines.map((line, index) => ({
                id: orderLineKey(line, index),
                line,
                index,
              }))}
              paginate={false}
              columns={[
                {
                  id: 'ready',
                  label: 'Hazır',
                  cell: ({ id, line }) => (
                    <Checkbox
                      className="app-checkbox"
                      aria-label={`${line.title || 'Ürün'} hazır`}
                      isSelected={!!line.prepared && !order.syncError}
                      isDisabled={!canPrepare}
                      onChange={(ready) => void mark([id], ready)}
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                  ),
                },
                {
                  id: 'product',
                  label: 'Ürün',
                  rowHeader: true,
                  cell: ({ line }) => {
                    const found = findVariant(state, line.variantId)
                    return (
                      <div className="order-detail-product">
                        {found && <ProductArt product={found.product} variant={found.variant} />}
                        <div>
                          <strong>{line.title || found?.product.name || 'Ürün'}</strong>
                          <small>
                            {line.variantName || found?.variant.name}
                            {line.sku || line.externalSku || found?.variant.sku
                              ? ` · ${line.sku || line.externalSku || found?.variant.sku}`
                              : ''}
                          </small>
                          {line.kind === 'free' ? (
                            <Chip size="sm" variant="soft">
                              Serbest satır
                            </Chip>
                          ) : !found ? (
                            <Chip size="sm" variant="soft" color="warning">
                              Eşlenmemiş
                            </Chip>
                          ) : null}
                          <BundleContents line={line} />
                          {!!line.discount?.value && (
                            <small>
                              İndirim:{' '}
                              {line.discount.kind === 'percent'
                                ? `%${line.discount.value / 100}`
                                : money(line.discount.value)}
                            </small>
                          )}
                        </div>
                      </div>
                    )
                  },
                },
                {
                  id: 'quantity',
                  label: 'Miktar',
                  className: 'align-right',
                  cell: ({ line }) => (
                    <span>
                      {line.quantity} <small>{line.unit || 'Adet'}</small>
                    </span>
                  ),
                },
                {
                  id: 'price',
                  label: 'Birim fiyat',
                  className: 'align-right',
                  cell: ({ line }) => displayMoney(orderLineCurrencyPrice(order, line)),
                },
                {
                  id: 'tax',
                  label: 'KDV',
                  className: 'align-right',
                  cell: ({ line }) => `%${line.taxRate}`,
                },
                {
                  id: 'total',
                  label: 'Toplam',
                  className: 'align-right',
                  cell: ({ line }) => (
                    <strong className="money-cell">
                      {displayMoney(orderLineCurrencyTotal(order, line))}
                    </strong>
                  ),
                },
              ]}
            />
            <div className="order-card-body">
              <OrderMapping order={order} />
              <div className="order-summary-totals">
                <div>
                  <span>Ara toplam (KDV hariç)</span>
                  <strong>{displayMoney(total - tax - displayShipping)}</strong>
                </div>
                <div>
                  <span>Ürün KDV’si</span>
                  <strong>{displayMoney(tax)}</strong>
                </div>
                <div>
                  <span>Kargo (KDV dahil)</span>
                  <strong>{displayMoney(displayShipping)}</strong>
                </div>
                <div className="is-total">
                  <span>Genel toplam</span>
                  <strong>{displayMoney(total)}</strong>
                </div>
                {foreignOrder(order) && (
                  <div>
                    <span>Kayıtlı TRY karşılığı</span>
                    <strong>{money(orderTotal(order))}</strong>
                  </div>
                )}
              </div>
              <p className="description field-description">Birim fiyatlar KDV dahildir.</p>
              {foreignOrder(order) && (
                <p className="description field-description">
                  Kayıt kuru: 1 {order.currency} ={' '}
                  {(Number(order.currencyRate?.value) / 100000000).toLocaleString('tr-TR', {
                    maximumFractionDigits: 8,
                  })}{' '}
                  TRY · TCMB {order.currencyRate?.date}
                </p>
              )}
            </div>
          </Panel>
          <Panel
            title="Müşteri"
            className="order-card"
            actions={
              customer && (
                <Link
                  className="provider-doc-link"
                  to={`/customers?customer=${encodeURIComponent(customer.id)}`}
                >
                  Kartı aç
                </Link>
              )
            }
          >
            <div className="order-card-body order-card-stack">
              <strong className="order-customer-title">
                {customer?.company || customer?.name || order.shippingAddress?.name}
              </strong>
              {customer?.email && <p className="description field-description">{customer.email}</p>}
              <div className="order-customer-addresses">
                <OrderAddressView
                  title="Gönderim adresi"
                  address={order.shippingAddress ?? customer}
                />
                <OrderAddressView title="Fatura adresi" address={order.billingAddress} />
              </div>
              {order.billingAddress?.taxId && (
                <p className="description field-description">
                  VKN / TCKN: {order.billingAddress.taxId}
                  {order.billingAddress.taxOffice ? ` · ${order.billingAddress.taxOffice}` : ''}
                </p>
              )}
            </div>
          </Panel>
          <Panel title="Sipariş notları" className="order-card">
            <div className="order-card-body order-card-stack">
              <OrderNotes orderId={order.id} />
            </div>
          </Panel>
          <Panel title="Sipariş geçmişi" className="order-card">
            <div className="order-card-body activity-timeline">
              {[...order.events].reverse().map((event, index) => (
                <div className="timeline-item" key={event.id}>
                  <span className={index === 0 ? 'timeline-dot is-latest' : 'timeline-dot'} />
                  <div>
                    <strong>{event.label}</strong>
                    <span>{dateLabel(event.at, true)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <aside className="order-detail-aside">
          <OrderInvoiceCard order={order} />
          <OrderPaymentCard order={order} />
          <OrderShipmentCard order={order} />
          <MarketplaceFulfillment order={order} />
          <Panel title="Ödeme ve kargo" className="order-card">
            <dl className="order-card-body order-metadata">
              <div>
                <dt>Ödeme yöntemi</dt>
                <dd>
                  {
                    {
                      cash: 'Nakit',
                      card: 'Kart',
                      transfer: 'Havale / EFT',
                      marketplace: 'Pazaryeri',
                    }[
                      order.paymentMethod ??
                        (order.channel === 'manual' ? 'transfer' : 'marketplace')
                    ]
                  }
                </dd>
              </div>
              <div>
                <dt>Stok</dt>
                <dd>
                  {order.inventoryApplied
                    ? 'Stok çıkışı işlendi'
                    : order.status === 'pending'
                      ? 'Siparişe rezerve'
                      : 'Stok çıkışı yok / geri alındı'}
                </dd>
              </div>
              <div>
                <dt>Depo</dt>
                <dd>
                  {(order.warehouseIds ?? [order.warehouseId || 'main'])
                    .map(
                      (id) =>
                        state.warehouses?.find((w) => w.id === id)?.name ??
                        (id === 'main' ? 'Merkez' : id),
                    )
                    .join(', ')}
                </dd>
              </div>
              {order.packageNumbers?.length ? (
                <div>
                  <dt>Paket no</dt>
                  <dd>{order.packageNumbers.join(', ')}</dd>
                </div>
              ) : null}
            </dl>
            {!!order.stockAllocations?.length && (
              <DataTable
                label="Sipariş depo dağılımı"
                items={order.stockAllocations.map((item, index) => ({
                  ...item,
                  id: String(index),
                }))}
                columns={[
                  {
                    id: 'warehouse',
                    label: 'Depo',
                    rowHeader: true,
                    cell: (item) =>
                      state.warehouses?.find((warehouse) => warehouse.id === item.warehouseId)
                        ?.name ?? item.warehouseId,
                  },
                  {
                    id: 'sku',
                    label: 'Fiziksel stok kodu',
                    cell: (item) =>
                      state.products
                        .flatMap((product) => product.variants)
                        .find((variant) => variant.id === item.variantId)?.sku,
                  },
                  { id: 'quantity', label: 'Adet', cell: (item) => item.quantity },
                ]}
                paginate={false}
              />
            )}
          </Panel>
          <OrderAttachments order={order} />
        </aside>
      </div>
    </div>
  )
}

function OrderAddressView({ title, address }: { title: string; address?: Partial<OrderAddress> }) {
  return (
    <div className="order-address-view">
      <span>
        <MapPin size={13} />
        {title}
      </span>
      {address?.address ? (
        <>
          <strong>{address.name}</strong>
          <p>{address.address}</p>
          <p>
            {[address.district, address.city, address.postalCode, address.country]
              .filter(Boolean)
              .join(' / ')}
          </p>
          <small>{address.phone}</small>
        </>
      ) : (
        <p>Adres belirtilmemiş.</p>
      )}
    </div>
  )
}

function OrderInvoiceCard({ order }: { order: Order }) {
  const { state, run, mode, can } = useApp()
  const invoice = state.invoices.find((invoice) => invoice.orderId === order.id)
  const accounts = useResource<{ connections: PublicIntegration[] }>(
    mode === 'live' ? '/api/integration-options?kind=invoice' : null,
  )
  const [preference, setPreference] = useState(order.invoicePreference ?? 'default'),
    [connectionId, setConnection] = useState(invoice?.connectionId ?? ''),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const writable = can('finance.write') && !['cancelled', 'returned'].includes(order.status)
  const perform = async (action: 'create' | 'preference') => {
    if (busy || !writable) return
    setBusy(true)
    setError('')
    const result = await run(
      action === 'create'
        ? { type: 'order.invoice', id: order.id }
        : {
            type: 'order.invoice.preference',
            id: order.id,
            preference,
            ...(preference === 'immediate'
              ? { connectionId: invoice?.connectionId || connectionId }
              : {}),
          },
    )
    setBusy(false)
    if (!result.ok) setError(result.message)
  }
  const locked =
    busy || !writable || (!!invoice && ['issued', 'queued', 'processing'].includes(invoice.status))
  return (
    <Panel title="Fatura" className="order-card">
      <div className="order-card-body">
        {invoice ? (
          <div className="order-invoice-state">
            <button
              className="button button--sm button--ghost document-link"
              onClick={() => setOpen(true)}
            >
              <FileText size={17} />
              {invoice.documentNumber || invoice.number}
            </button>
            <Chip
              size="sm"
              variant="soft"
              color={
                invoice.status === 'issued'
                  ? 'success'
                  : invoice.status === 'failed'
                    ? 'danger'
                    : 'default'
              }
            >
              {invoiceDocumentLabel(invoice) ?? invoiceStatusLabels[invoice.status]}
            </Chip>
            {invoice.error && <p className="form-error">{invoice.error}</p>}
          </div>
        ) : (
          <>
            <p className="empty-inline">Henüz fatura kesilmedi.</p>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => void perform('create')}
              isDisabled={!writable || busy || !!order.syncError}
            >
              <FileText size={14} />
              Fatura kes
            </Button>
          </>
        )}
        <InvoicePreferenceFields
          value={preference}
          onChange={setPreference}
          connectionId={invoice?.connectionId || connectionId}
          onConnectionChange={setConnection}
          accounts={accounts.data?.connections ?? []}
          disabled={locked}
          allowImmediate={mode === 'live' && writable}
        />
        <Button
          variant="secondary"
          size="sm"
          isDisabled={
            locked ||
            preference === (order.invoicePreference ?? 'default') ||
            (preference === 'immediate' && !invoice?.connectionId && !connectionId)
          }
          onPress={() => void perform('preference')}
        >
          <Check size={14} />
          Fatura tercihini kaydet
        </Button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {open && invoice && <InvoiceManager invoice={invoice} onClose={() => setOpen(false)} />}
      </div>
    </Panel>
  )
}

function OrderPaymentCard({ order }: { order: Order }) {
  const { run, can } = useApp()
  const [method, setMethod] = useState(
      order.paymentMethod ?? (order.channel === 'manual' ? 'transfer' : 'marketplace'),
    ),
    [busy, setBusy] = useState(false)
  return (
    <Panel title="Tahsilat" className="order-card">
      <div className="order-card-body">
        <div className="order-payment-state">
          <Wallet size={17} />
          <strong>{money(orderTotal(order))}</strong>
          <Chip size="sm" variant="soft" color={order.paid ? 'success' : 'warning'}>
            {order.paid ? 'Tahsilat kaydedildi' : 'Tahsilat bekliyor'}
          </Chip>
        </div>
        {!order.paid && !['cancelled', 'returned'].includes(order.status) && (
          <>
            <SelectButton
              label="Tahsilat yöntemi"
              value={method}
              onChange={(value) => setMethod(value as typeof method)}
              isDisabled={busy || !can('finance.write')}
              options={[
                { id: 'cash', label: 'Nakit' },
                { id: 'card', label: 'Kart' },
                { id: 'transfer', label: 'Havale / EFT' },
                { id: 'marketplace', label: 'Pazaryeri tahsilatı' },
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              isDisabled={busy || !can('finance.write')}
              onPress={async () => {
                if (busy) return
                setBusy(true)
                await run({ type: 'order.pay', id: order.id, method })
                setBusy(false)
              }}
            >
              Tahsilat kaydet
            </Button>
          </>
        )}
      </div>
    </Panel>
  )
}

const shipmentLabels: Record<Shipment['status'], string> = {
  queued: 'Oluşturuluyor',
  created: 'Gönderi hazır',
  in_transit: 'Taşımada',
  delivered: 'Teslim edildi',
  cancelled: 'İptal',
  failed: 'Kontrol gerekiyor',
  uncertain: 'Sonuç doğrulanmalı',
}
function OrderShipmentCard({ order }: { order: Order }) {
  const { state, mode, can, notify } = useApp()
  const accounts = useResource<{ connections: PublicIntegration[] }>(
    mode === 'live' ? '/api/integration-options?kind=cargo' : null,
  )
  const shipment = state.shipments?.find(
    (shipment) => shipment.orderId === order.id && shipment.status !== 'cancelled',
  )
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false)
  return (
    <Panel title="Kargo gönderisi" className="order-card">
      <div className="order-card-body">
        <div className="order-shipment-heading">
          <Truck size={18} />
          <strong>
            {shipment
              ? (providers.find((provider) => provider.id === shipment.provider)?.name ??
                shipment.provider)
              : order.cargoProvider || 'Kargo bilgisi'}
          </strong>
        </div>
        {shipment ? (
          <>
            <Chip size="sm" variant="soft">
              {shipmentLabels[shipment.status]}
            </Chip>
            <span className="code-text">{shipment.trackingNumber || shipment.reference}</span>
            {shipment.error && <p className="form-error">{shipment.error}</p>}
            <div className="row-actions">
              {shipment.labelUrl && (
                <a
                  href={shipment.labelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button button--secondary button--sm"
                >
                  Etiketi aç
                </a>
              )}
              <Button
                variant="secondary"
                size="sm"
                isDisabled={
                  busy ||
                  !can('orders.write') ||
                  !['created', 'in_transit'].includes(shipment.status)
                }
                onPress={async () => {
                  setBusy(true)
                  try {
                    await apiMutation(`/api/shipments/${shipment.id}/track`, {})
                    notify('Kargo durumu sorgulaması sıraya alındı.')
                  } catch (error) {
                    notify(error instanceof Error ? error.message : 'Kargo sorgulanamadı.', 'error')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <RefreshCw size={13} />
                Durumu sorgula
              </Button>
            </div>
          </>
        ) : (
          <>
            {order.trackingNumber ? (
              <span className="code-text">{order.trackingNumber}</span>
            ) : (
              <p className="empty-inline">Henüz gönderi bilgisi yok.</p>
            )}
            {order.status === 'approved' && (
              <Button
                variant="secondary"
                size="sm"
                isDisabled={
                  mode !== 'live' ||
                  !can('orders.write') ||
                  !!order.syncError ||
                  !order.inventoryApplied
                }
                onPress={() => setOpen(true)}
              >
                <Truck size={14} />
                Kargoda gönderi oluştur
              </Button>
            )}
          </>
        )}
        <Link to="/shipments" className="provider-doc-link">
          Kargo gönderileri
        </Link>
        {open && (
          <ShipmentEditor
            initialOrderId={order.id}
            accounts={accounts.data?.connections ?? []}
            error={accounts.error}
            loading={accounts.loading}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </Panel>
  )
}
