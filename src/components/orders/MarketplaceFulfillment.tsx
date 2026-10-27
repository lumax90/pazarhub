import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { Barcode, Download, Package, RefreshCw } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { Order } from '../../domain/types'
import type { MarketplaceOrderAction, OrderFulfillmentView } from '../../domain/order-fulfillment'
import { fulfillmentProviders, marketplaceActionLabels } from '../../domain/order-fulfillment'
import { useResource } from '../../lib/useResource'
import { apiMutation } from '../../lib/api'
import { Dialog, Field, Panel, SelectButton } from '../ui/shared'
import { AsyncState } from '../ui/AsyncState'
import { DataTable } from '../ui/DataTable'

export function MarketplaceFulfillment({ order }: { order: Order }) {
  const { mode, can, notify, refresh } = useApp(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false)
  if (
    !order.externalId ||
    order.channel === 'manual' ||
    !fulfillmentProviders.includes(order.channel) ||
    mode !== 'live'
  )
    return null
  const workflow = order.fulfillmentWorkflow,
    pending = !!workflow && ['queued', 'pending', 'uncertain'].includes(workflow.state)
  return (
    <Panel
      title="Pazaryeri paketleri"
      className="order-card"
      actions={
        <Button
          variant="secondary"
          size="sm"
          isDisabled={!can('orders.write') || pending}
          onPress={() => setOpen(true)}
        >
          <Package size={14} />
          Paket işlemleri
        </Button>
      }
    >
      <div className="order-card-body margin-rule-form">
        {(order.marketplacePackages ?? []).map((item) => (
          <div className="order-attachment" key={item.id}>
            <div>
              <strong>{item.number}</strong>
              <small>
                {item.carrier} · {item.status} · {item.trackingNumber}
              </small>
            </div>
            <div className="row-actions">
              {item.labels?.map((label) => (
                <a
                  key={label.id}
                  className="button button--secondary button--sm"
                  href={label.url}
                  download
                >
                  <Download size={14} />
                  Pazaryeri etiketi
                </a>
              ))}
              {item.trackingNumber && (
                <a
                  className="button button--secondary button--sm"
                  href={`/orders/labels?ids=${encodeURIComponent(order.id)}&package=${encodeURIComponent(item.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Barcode size={14} />
                  Kargo etiketi
                </a>
              )}
            </div>
          </div>
        ))}
        {!order.marketplacePackages?.length && (
          <p className="description field-description">
            Paketleri hazırlayın, pazaryeri etiketlerini alın ve kendi kargo gönderiminizi bildirin.
          </p>
        )}
        {workflow?.message && (
          <p
            className={
              ['uncertain', 'failed'].includes(workflow.state)
                ? 'form-error'
                : 'description field-description'
            }
            role="status"
          >
            {workflow.message}
          </p>
        )}
        {workflow && ['uncertain', 'failed'].includes(workflow.state) && (
          <Button
            variant="secondary"
            size="sm"
            isDisabled={busy || !can('orders.write')}
            onPress={async () => {
              setBusy(true)
              try {
                await apiMutation(`/api/orders/${order.id}/marketplace/reconcile`, {})
                notify('Pazaryeri kaydı tekrar yazılmadan sorgulanacak.')
                await refresh()
              } catch (error) {
                notify((error as Error).message, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            <RefreshCw size={14} />
            Sonucu doğrula
          </Button>
        )}
        {open && (
          <MarketplaceFulfillmentEditor
            key={order.id}
            order={order}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </Panel>
  )
}

function MarketplaceFulfillmentEditor({ order, onClose }: { order: Order; onClose: () => void }) {
  const { refresh, notify } = useApp(),
    [requestedAction, setAction] = useState<MarketplaceOrderAction>('pack'),
    [selection, setSelection] = useState<string[] | null>(null),
    [packageId, setPackage] = useState(''),
    [reasonId, setReason] = useState(''),
    [parcels, setParcels] = useState('1'),
    [desi, setDesi] = useState('1'),
    [trackingNumber, setTracking] = useState(order.trackingNumber ?? ''),
    [trackingUrl, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [carrierId, setCarrier] = useState(''),
    [warehouseId, setWarehouse] = useState(''),
    [carrierName, setCarrierName] = useState(order.cargoProvider ?? ''),
    [dimensions, setDimensions] = useState({ weight: '', width: '', height: '', length: '' })
  const resource = useResource<{ previewId: string; view: OrderFulfillmentView }>(
      `/api/orders/${order.id}/marketplace`,
    ),
    view = resource.data?.view
  const action = view?.actions.includes(requestedAction)
    ? requestedAction
    : (view?.actions[0] ?? requestedAction)
  const lineMode =
    ['prepare', 'pack', 'cancel'].includes(action) ||
    (action === 'ship' && !!view?.shipCreatesPackage)
  const selectedCarrier = view?.carriers?.find(
    (item) => item.id === (carrierId || view.carriers?.[0]?.id),
  )
  const selectable =
    view?.lines.filter((line) =>
      action === 'cancel'
        ? line.cancellable
        : action === 'prepare'
          ? line.preparable
          : line.packable,
    ) ?? []
  const selected =
    selection ??
    (action === 'cancel' && ['hepsiburada', 'n11'].includes(order.channel)
      ? selectable.slice(0, 1)
      : selectable
    ).map((line) => line.id)
  const currentPackage = packageId || view?.packages[0]?.id
  const submit = async () => {
    if (busy || !resource.data) return
    setBusy(true)
    setError('')
    try {
      await apiMutation(`/api/orders/${order.id}/marketplace/action`, {
        previewId: resource.data.previewId,
        action,
        lines: lineMode
          ? selectable
              .filter((line) => selected.includes(line.id))
              .map((line) => ({ id: line.id, quantity: line.quantity }))
          : [],
        packageId: !lineMode ? currentPackage : undefined,
        reasonId: action === 'cancel' ? reasonId || view?.cancellationReasons[0]?.id : undefined,
        parcels: Number(parcels),
        desi: Number(desi),
        carrierId: selectedCarrier?.id,
        warehouseId: warehouseId || view?.warehouses?.[0]?.id,
        carrierName: carrierName || undefined,
        ...(action === 'pack' && order.channel === 'toptantr'
          ? Object.fromEntries(
              Object.entries(dimensions).map(([key, value]) => [key, Number(value)]),
            )
          : {}),
        ...(action === 'ship' || (action === 'pack' && selectedCarrier?.contracted === false)
          ? {
              trackingNumber: trackingNumber || undefined,
              trackingUrl: trackingUrl || undefined,
              shippedAt: new Date().toISOString(),
            }
          : {}),
      })
      await refresh()
      notify('Pazaryeri işlemi sıraya alındı.')
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
      title="Pazaryeri paket işlemleri"
      description={order.externalNumber || order.number}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Kapat
          </Button>
          <Button
            variant="primary"
            isDisabled={busy || !view?.actions.length}
            onPress={() => void submit()}
          >
            Pazaryerine gönder
          </Button>
        </>
      }
    >
      <div className="margin-rule-form">
        <AsyncState
          loading={resource.loading}
          error={resource.error}
          retry={() => void resource.reload()}
        />
        {view && (
          <>
            <SelectButton
              label="Pazaryeri işlemi"
              value={action}
              onChange={(value) => {
                setAction(value as MarketplaceOrderAction)
                setSelection(null)
              }}
              options={view.actions.map((id) => ({ id, label: marketplaceActionLabels[id] }))}
              isDisabled={busy}
            />
            {lineMode ? (
              <DataTable
                label="Pazaryeri sipariş kalemleri"
                items={selectable}
                paginate={false}
                columns={[
                  {
                    id: 'selected',
                    label: 'Seç',
                    cell: (line) => (
                      <Checkbox
                        className="app-checkbox"
                        isSelected={selected.includes(line.id)}
                        onChange={(value) =>
                          setSelection(
                            value
                              ? action === 'cancel' &&
                                ['hepsiburada', 'n11'].includes(order.channel)
                                ? [line.id]
                                : [...selected, line.id]
                              : selected.filter((id) => id !== line.id),
                          )
                        }
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label>{line.sku || line.id}</Label>
                        </Checkbox.Content>
                      </Checkbox>
                    ),
                  },
                  { id: 'name', label: 'Ürün', rowHeader: true, cell: (line) => line.name },
                  { id: 'quantity', label: 'Adet', cell: (line) => line.quantity },
                  { id: 'status', label: 'Durum', cell: (line) => line.status },
                ]}
                emptyTitle="Bu işlem için uygun kalem yok"
              />
            ) : (
              <SelectButton
                label="Paket"
                value={currentPackage ?? ''}
                onChange={setPackage}
                options={view.packages.map((item) => ({
                  id: item.id,
                  label: `${item.number} · ${item.status}`,
                }))}
                isDisabled={busy}
              />
            )}
            {action === 'cancel' ? (
              <SelectButton
                label="Pazaryeri iptal nedeni"
                value={reasonId || view.cancellationReasons[0]?.id || ''}
                onChange={setReason}
                options={view.cancellationReasons}
                isDisabled={busy}
              />
            ) : (
              <div className="form-grid">
                <Field
                  label="Paket koli adedi"
                  type="number"
                  min={1}
                  max={20}
                  value={parcels}
                  onChange={setParcels}
                />
                <Field
                  label="Paket toplam desi"
                  type="number"
                  min={0.1}
                  max={1000}
                  step={0.1}
                  value={desi}
                  onChange={setDesi}
                />
              </div>
            )}
            {['pack', 'ship'].includes(action) && view.carriers && (
              <SelectButton
                label="Pazaryeri kargo firması"
                value={carrierId || view.carriers[0]?.id || ''}
                onChange={setCarrier}
                options={view.carriers}
                isDisabled={busy}
              />
            )}
            {action === 'pack' && view.warehouses && (
              <SelectButton
                label="Pazaryeri gönderici deposu"
                value={warehouseId || view.warehouses[0]?.id || ''}
                onChange={setWarehouse}
                options={view.warehouses}
                isDisabled={busy}
              />
            )}
            {action === 'pack' && order.channel === 'toptantr' && (
              <div className="form-grid">
                {Object.entries({
                  weight: 'Koli başına ağırlık (kg)',
                  width: 'Koli genişliği (cm)',
                  height: 'Koli yüksekliği (cm)',
                  length: 'Koli uzunluğu (cm)',
                }).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={dimensions[key as keyof typeof dimensions]}
                    onChange={(value) => setDimensions((current) => ({ ...current, [key]: value }))}
                  />
                ))}
              </div>
            )}
            {((action === 'ship' && order.channel !== 'toptantr') ||
              (action === 'pack' && selectedCarrier?.contracted === false)) && (
              <div className="form-grid">
                {view.shipCreatesPackage && (
                  <Field label="Kargo firması adı" value={carrierName} onChange={setCarrierName} />
                )}
                <Field label="Kargo takip numarası" value={trackingNumber} onChange={setTracking} />
                <Field
                  label="Kargo takip bağlantısı"
                  type="url"
                  value={trackingUrl}
                  onChange={setUrl}
                />
              </div>
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
