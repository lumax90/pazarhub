import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Chip } from '@heroui/react'
import { Barcode, Download, Plus, RefreshCw, Truck } from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../app/AppProvider'
import { providers } from '../domain/integrations'
import type { PublicIntegration } from '../domain/integrations'
import type { Order, Shipment } from '../domain/types'
import type { MarketplacePackage } from '../domain/order-fulfillment'
import { apiMutation } from '../lib/api'
import { useResource } from '../lib/useResource'
import { dateLabel, matches } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import {
  Dialog,
  Field,
  FilterTabs,
  PageHeader,
  Panel,
  SearchBox,
  SelectButton,
  StatusBadge,
} from '../components/ui/shared'
import { AsyncState } from '../components/ui/AsyncState'
import { FulfillmentReconciliation } from '../components/integrations/FulfillmentReconciliation'

const shipmentLabels: Record<Shipment['status'], string> = {
  queued: 'Oluşturuluyor',
  created: 'Gönderi hazır',
  in_transit: 'Taşımada',
  delivered: 'Teslim edildi',
  cancelled: 'İptal',
  failed: 'Kontrol gerekiyor',
  uncertain: 'Sonuç doğrulanmalı',
}
export function ShipmentsPage() {
  const { state, mode, notify, can } = useApp()
  const [view, setView] = useState('marketplace'),
    [query, setQuery] = useState(''),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState('')
  const [reconciling, setReconciling] = useState<string | null>(null)
  const accounts = useResource<{ connections: PublicIntegration[] }>(
    mode === 'live' ? '/api/integration-options?kind=cargo' : null,
  )
  const action = async (shipment: Shipment, type: 'track' | 'cancel') => {
    setBusy(shipment.id)
    try {
      await apiMutation(`/api/shipments/${shipment.id}/${type}`, {})
      notify('Kargo işlemi kuyruğa alındı.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'İşlem başlatılamadı.', 'error')
    } finally {
      setBusy('')
    }
  }
  const ownColumns: Column<Shipment>[] = [
    {
      id: 'reference',
      label: 'Gönderi',
      rowHeader: true,
      cell: (s) => (
        <div>
          <Link className="document-link" to={`/orders/${s.orderId}`}>
            {state.orders.find((o) => o.id === s.orderId)?.number}
          </Link>
          <small className="cell-secondary">{s.reference}</small>
        </div>
      ),
    },
    {
      id: 'provider',
      label: 'Kargo firması',
      cell: (s) => providers.find((p) => p.id === s.provider)?.name ?? s.provider,
    },
    {
      id: 'tracking',
      label: 'Takip numarası',
      cell: (s) => <span className="code-text">{s.trackingNumber ?? 'Kabul bekleniyor'}</span>,
    },
    {
      id: 'status',
      label: 'Durum',
      cell: (s) => (
        <div>
          <Chip
            size="sm"
            variant="soft"
            color={
              s.status === 'delivered'
                ? 'success'
                : ['failed', 'uncertain'].includes(s.status)
                  ? 'danger'
                  : 'accent'
            }
          >
            {shipmentLabels[s.status]}
          </Chip>
          {s.error && <small className="connection-error">{s.error}</small>}
        </div>
      ),
    },
    { id: 'date', label: 'Oluşturulma', cell: (s) => dateLabel(s.createdAt, true) },
    {
      id: 'actions',
      label: '',
      cell: (s) => (
        <div className="row-actions">
          {(s.uncertainJobId || s.status === 'uncertain' || s.status === 'failed') &&
            can('orders.write') && (
              <Button size="sm" variant="secondary" onPress={() => setReconciling(s.id)}>
                Sonucu uzlaştır
              </Button>
            )}
          {s.labelUrl && (
            <a
              href={s.labelUrl}
              target="_blank"
              rel="noreferrer"
              className="button button--secondary button--sm"
            >
              <Download size={13} />
              Etiket
            </a>
          )}
          <Button
            size="sm"
            variant="ghost"
            isDisabled={
              busy === s.id || !can('orders.write') || !['created', 'in_transit'].includes(s.status)
            }
            onPress={() => void action(s, 'track')}
          >
            <RefreshCw size={14} />
            Sorgula
          </Button>
          {s.status === 'created' &&
            accounts.data?.connections
              .find((c) => c.id === s.connectionId)
              ?.capabilities.includes('shipment.cancel') && (
              <Button
                size="sm"
                variant="ghost"
                isDisabled={busy === s.id}
                onPress={() => void action(s, 'cancel')}
              >
                İptal et
              </Button>
            )}
        </div>
      ),
    },
  ]
  type MarketRow = { id: string; order: Order; package?: MarketplacePackage }
  const market: MarketRow[] = state.orders
    .filter(
      (order) =>
        order.externalId &&
        !state.shipments?.some((s) => s.orderId === order.id && s.status !== 'cancelled'),
    )
    .flatMap<MarketRow>((order) =>
      order.marketplacePackages?.length
        ? order.marketplacePackages.map((item) => ({
            id: `${order.id}:${item.id}`,
            order,
            package: item,
          }))
        : order.trackingNumber
          ? [{ id: order.id, order }]
          : [],
    )
    .filter((item) =>
      matches(
        `${item.order.number} ${item.order.externalNumber} ${item.package?.number ?? ''} ${item.package?.trackingNumber ?? item.order.trackingNumber}`,
        query,
      ),
    )
  const marketColumns: Column<MarketRow>[] = [
    {
      id: 'order',
      label: 'Sipariş',
      rowHeader: true,
      cell: (row) => (
        <Link className="order-link" to={`/orders/${row.order.id}`}>
          {row.order.externalNumber || row.order.number}
        </Link>
      ),
    },
    {
      id: 'cargo',
      label: 'Kargo firması',
      cell: (row) => row.package?.carrier || row.order.cargoProvider || 'Pazaryeri anlaşması',
    },
    {
      id: 'tracking',
      label: 'Pazaryeri kargo kodu',
      cell: (row) => (
        <span className="code-text">
          {row.package?.trackingNumber || row.package?.number || row.order.trackingNumber}
        </span>
      ),
    },
    {
      id: 'status',
      label: 'Durum',
      cell: (row) =>
        row.package ? (
          <Chip size="sm" variant="soft">
            {row.package.status}
          </Chip>
        ) : (
          <StatusBadge status={row.order.status} />
        ),
    },
    {
      id: 'updated',
      label: 'Son bilgi',
      cell: (row) => dateLabel(row.order.remoteUpdatedAt ?? row.order.createdAt, true),
    },
    {
      id: 'labels',
      label: 'Etiket',
      cell: (row) => (
        <div className="row-actions">
          {row.package?.labels?.map((label) => (
            <a
              key={label.id}
              className="button button--secondary button--sm"
              href={label.url}
              download
            >
              <Download size={13} />
              Pazaryeri
            </a>
          ))}
          {(row.package?.trackingNumber || (!row.package && row.order.trackingNumber)) && (
            <a
              className="button button--secondary button--sm"
              href={`/orders/labels?ids=${encodeURIComponent(row.order.id)}${row.package ? `&package=${encodeURIComponent(row.package.id)}` : ''}`}
              target="_blank"
              rel="noreferrer"
            >
              <Barcode size={13} />
              Yazdır
            </a>
          )}
        </div>
      ),
    },
  ]
  return (
    <>
      <PageHeader
        title="Kargo Gönderileri"
        description="Pazaryeri kargolarını ve kendi anlaşmanızla hazırladığınız gönderileri izleyin."
        actions={
          <>
            <Link to="/connections/cargo" className="button button--secondary">
              <Truck size={16} />
              Kargo hesapları
            </Link>
            <Button
              variant="primary"
              onPress={() => setOpen(true)}
              isDisabled={mode === 'demo' || !can('orders.write')}
            >
              <Plus size={16} />
              Gönderi oluştur
            </Button>
          </>
        }
      />
      <Panel flush className="list-panel">
        <FilterTabs
          label="Kargo modeli"
          value={view}
          onChange={setView}
          items={[
            { id: 'marketplace', label: 'Pazaryeri kargosu', count: market.length },
            { id: 'own', label: 'Kendi anlaşmalarım', count: state.shipments?.length ?? 0 },
          ]}
        />
        <div className="list-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            label="Gönderilerde ara"
            placeholder="Sipariş veya kargo kodu…"
          />
        </div>
        {view === 'marketplace' ? (
          <DataTable
            label="Pazaryeri kargoları"
            items={market}
            columns={marketColumns}
            emptyTitle="Pazaryeri kargosu henüz yok"
            emptyDescription="Siparişler alındığında platformun verdiği kargo kodu ve durum burada görünür."
          />
        ) : (
          <DataTable
            label="Kendi anlaşmalı gönderiler"
            items={(state.shipments ?? []).filter((s) =>
              matches(`${s.reference} ${s.trackingNumber} ${s.provider}`, query),
            )}
            columns={ownColumns}
            emptyTitle="İlk gönderinizi hazırlayın"
            emptyDescription="Test edilmiş kargo hesabınızı ve onaylı siparişi seçerek başlayın."
          />
        )}
      </Panel>
      {open && (
        <ShipmentEditor
          accounts={accounts.data?.connections ?? []}
          error={accounts.error}
          loading={accounts.loading}
          onClose={() => setOpen(false)}
        />
      )}
      {reconciling && (
        <FulfillmentReconciliation
          kind="shipment"
          id={reconciling}
          onClose={() => setReconciling(null)}
        />
      )}
    </>
  )
}

export function ShipmentEditor({
  accounts,
  error,
  loading,
  onClose,
  initialOrderId,
}: {
  accounts: PublicIntegration[]
  error: string
  loading: boolean
  onClose: () => void
  initialOrderId?: string
}) {
  const { state, notify, refresh } = useApp()
  const [orderId, setOrderId] = useState(initialOrderId ?? ''),
    [connectionId, setConnectionId] = useState('')
  const recipientFor = (id: string) => {
    const order = state.orders.find((order) => order.id === id),
      customer = state.customers.find((customer) => customer.id === order?.customerId)
    return {
      name: order?.shippingAddress?.name ?? customer?.name ?? '',
      address: order?.shippingAddress?.address ?? customer?.address ?? '',
      city: order?.shippingAddress?.city ?? customer?.city ?? '',
      district: order?.shippingAddress?.district ?? customer?.district ?? '',
      phone: order?.shippingAddress?.phone ?? customer?.phone ?? '',
    }
  }
  const [recipient, setRecipient] = useState(() => recipientFor(initialOrderId ?? ''))
  const [packages, setPackages] = useState('1'),
    [desi, setDesi] = useState('1'),
    [weight, setWeight] = useState('1'),
    [barcode, setBarcode] = useState(''),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('')
  const selectOrder = (id: string) => {
    setOrderId(id)
    setRecipient(recipientFor(id))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFormError('')
    try {
      await apiMutation('/api/shipments', {
        orderId,
        connectionId,
        recipient,
        packages: Number(packages),
        desi: Number(desi),
        weight: Number(weight),
        carrierBarcode: barcode || undefined,
      })
      notify('Gönderi oluşturma isteği sıraya alındı.')
      await refresh()
      onClose()
    } catch (problem) {
      setFormError(problem instanceof Error ? problem.message : 'Gönderi oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      wide
      title="Yeni kargo gönderisi"
      description="Gönderici adresi ve sözleşme bilgileri seçtiğiniz kargo hesabından alınır."
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            Vazgeç
          </Button>
          <Button
            form="shipment-form"
            type="submit"
            variant="primary"
            isDisabled={busy || !orderId || !connectionId}
          >
            {busy ? 'Kaydediliyor…' : 'Gönderiyi oluştur'}
          </Button>
        </>
      }
    >
      <AsyncState loading={loading} error={error} />
      <form id="shipment-form" onSubmit={submit} className="form-section">
        <div className="form-grid">
          <div className="select-field">
            <label className="label">Onaylı sipariş</label>
            <SelectButton
              value={orderId}
              onChange={selectOrder}
              label="Gönderilecek sipariş"
              isDisabled={!!initialOrderId || busy}
              options={state.orders
                .filter(
                  (o) =>
                    o.status === 'approved' &&
                    !state.shipments?.some((s) => s.orderId === o.id && s.status !== 'cancelled'),
                )
                .map((o) => ({
                  id: o.id,
                  label: `${o.number} · ${o.shippingAddress?.name ?? ''}`,
                }))}
            />
          </div>
          <div className="select-field">
            <label className="label">Kargo hesabı</label>
            <SelectButton
              value={connectionId}
              onChange={setConnectionId}
              label="Kargo hesabı seçin"
              options={accounts
                .filter((a) => a.enabled && a.status === 'verified')
                .map((a) => ({ id: a.id, label: a.name }))}
            />
          </div>
          {Object.entries({
            name: 'Alıcı adı',
            phone: 'Telefon',
            city: 'İl',
            district: 'İlçe',
            address: 'Açık adres',
          }).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={recipient[key as keyof typeof recipient]}
              onChange={(value) => setRecipient((current) => ({ ...current, [key]: value }))}
              required
              className={key === 'address' ? 'span-2' : ''}
            />
          ))}
          <Field
            label="Koli adedi"
            type="number"
            value={packages}
            onChange={setPackages}
            required
          />
          <Field label="Toplam desi" type="number" value={desi} onChange={setDesi} required />
          <Field
            label="Toplam ağırlık (kg)"
            type="number"
            value={weight}
            onChange={setWeight}
            required
          />
          {accounts.find((a) => a.id === connectionId)?.provider === 'ptt' && (
            <Field
              label="PTT tarafından tahsisli barkod"
              value={barcode}
              onChange={setBarcode}
              required
            />
          )}
        </div>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
      </form>
    </Dialog>
  )
}
