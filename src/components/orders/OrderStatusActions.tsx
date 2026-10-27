import { useState } from 'react'
import { Button, Checkbox, Dropdown, Label } from '@heroui/react'
import { Check, ChevronDown, Truck } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { Order, OrderStatus } from '../../domain/types'
import { statusLabels, transitions } from '../../domain/operations'
import { Dialog, Field, StatusBadge } from '../ui/shared'

export function OrderStatusActions({
  order,
  compact = false,
}: {
  order: Order
  compact?: boolean
}) {
  const { run, can } = useApp()
  const [target, setTarget] = useState<OrderStatus | null>(null),
    [busy, setBusy] = useState(false)
  const choices = transitions[order.status].filter(
    (status) => !order.externalId || status === 'approved',
  )
  const act = async (status: OrderStatus) => {
    if (busy || !can('orders.write')) return
    if (['cancelled', 'returned', 'shipped'].includes(status)) {
      setTarget(status)
      return
    }
    setBusy(true)
    await run({ type: 'order.transition', id: order.id, status })
    setBusy(false)
  }
  return (
    <>
      {compact ? (
        choices.length && can('orders.write') ? (
          <div className="order-status-cell">
            <Dropdown>
              <Button
                variant="ghost"
                size="sm"
                className="order-status-trigger"
                aria-label={`${order.number} durumunu değiştir`}
                isDisabled={busy}
              >
                <StatusBadge status={order.status} />
                <ChevronDown size={12} />
              </Button>
              <Dropdown.Popover className="app-dropdown">
                <Dropdown.Menu aria-label="Durumu değiştir">
                  {choices.map((status) => (
                    <Dropdown.Item
                      key={status}
                      id={status}
                      textValue={statusLabels[status]}
                      onAction={() => void act(status)}
                    >
                      <Label>{statusLabels[status]}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            {order.status === 'pending' && (
              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                aria-label={`${order.number} onayla`}
                isDisabled={busy || !!order.syncError}
                onPress={() => void act('approved')}
              >
                <Check size={14} />
              </Button>
            )}
          </div>
        ) : (
          <StatusBadge status={order.status} />
        )
      ) : (
        <div className="order-status-actions">
          <span>Durumu değiştir:</span>
          {choices.map((status) => (
            <Button
              key={status}
              variant={
                status === 'cancelled' || status === 'returned'
                  ? 'danger-soft'
                  : status === 'approved'
                    ? 'primary'
                    : 'secondary'
              }
              size="sm"
              isDisabled={
                busy || !can('orders.write') || (status === 'approved' && !!order.syncError)
              }
              aria-label={status === 'approved' ? 'Siparişi onayla' : statusLabels[status]}
              onPress={() => void act(status)}
            >
              {status === 'approved' ? (
                <Check size={15} />
              ) : status === 'shipped' ? (
                <Truck size={15} />
              ) : null}
              {statusLabels[status]}
            </Button>
          ))}
        </div>
      )}
      {target && (
        <OrderTransitionDialog order={order} target={target} onClose={() => setTarget(null)} />
      )}
    </>
  )
}

export function OrderTransitionDialog({
  order,
  target,
  onClose,
}: {
  order: Order
  target: OrderStatus
  onClose: () => void
}) {
  const { run, can } = useApp()
  const [reason, setReason] = useState(''),
    [restock, setRestock] = useState(true),
    [carrier, setCarrier] = useState(order.cargoProvider ?? ''),
    [tracking, setTracking] = useState(order.trackingNumber ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const submit = async () => {
    if (busy || !can('orders.write')) return
    setBusy(true)
    setError('')
    const result = await run({
      type: 'order.transition',
      id: order.id,
      status: target,
      ...(reason.trim() ? { reason } : {}),
      ...(target === 'returned' ? { restock } : {}),
      ...(target === 'shipped' ? { shipment: { carrier, trackingNumber: tracking } } : {}),
    })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  const title =
    target === 'cancelled'
      ? 'Siparişi iptal et'
      : target === 'returned'
        ? 'Sipariş iadesi'
        : 'Kargoya verildi'
  return (
    <Dialog
      open
      title={title}
      description={order.number}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant={target === 'cancelled' ? 'danger' : 'primary'}
            isDisabled={busy || (target === 'shipped' && (!carrier.trim() || !tracking.trim()))}
            onPress={() => void submit()}
          >
            {busy
              ? 'Kaydediliyor…'
              : target === 'cancelled'
                ? 'Evet, iptal et'
                : target === 'returned'
                  ? 'İadeyi kaydet'
                  : 'Kargo bilgisini kaydet'}
          </Button>
        </>
      }
    >
      {target === 'shipped' ? (
        <div className="form-grid">
          <Field
            label="Kargo firması"
            value={carrier}
            onChange={setCarrier}
            required
            maxLength={200}
            isDisabled={busy}
          />
          <Field
            label="Kargo takip numarası"
            value={tracking}
            onChange={setTracking}
            required
            maxLength={100}
            isDisabled={busy}
          />
        </div>
      ) : (
        <div className="form-section">
          {target === 'returned' && (
            <Checkbox
              className="app-checkbox"
              isSelected={restock}
              onChange={setRestock}
              isDisabled={busy}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>Stoklar depoya geri yüklensin</Label>
              </Checkbox.Content>
            </Checkbox>
          )}
          <Field
            label={target === 'cancelled' ? 'İptal sebebi' : 'İade notu'}
            value={reason}
            onChange={setReason}
            maxLength={2000}
            isDisabled={busy}
          />
          <p className="description field-description">
            {target === 'cancelled'
              ? 'Siparişin rezervasyonu kaldırılır; işlenmiş stok ve kaydedilmiş tahsilat geri alınır.'
              : 'Bu işlem siparişin tamamı içindir. Kısmi iade, İade Yönetimi ekranından kaydedilir.'}
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
