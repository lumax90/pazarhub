import { useState } from 'react'
import { Button, Dropdown, Label } from '@heroui/react'
import { Check, Printer, X } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { Command, Order } from '../../domain/types'
import { orderContentKey, orderLineKey, orderPrintKey } from '../../domain/orders'
import { transitions } from '../../domain/operations'
import { Dialog, Field, SelectButton } from '../ui/shared'

export function OrderBulkActions({
  orders,
  onSelectionChange,
  onBusyChange,
}: {
  orders: Order[]
  onSelectionChange: (ids: string[]) => void
  onBusyChange: (busy: boolean) => void
}) {
  const { state, run, can } = useApp()
  const [dialog, setDialog] = useState<'cancel' | 'tax' | null>(null),
    [reason, setReason] = useState(''),
    [tax, setTax] = useState('20'),
    [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ number: string; message: string; ok: boolean }[]>([])
  type Action =
    'approve' | 'cancel' | 'tax' | 'invoice' | 'ready' | 'unready' | 'printed' | 'unprinted'
  const execute = async (action: Action) => {
    if (busy || !can(action === 'invoice' ? 'finance.write' : 'orders.write')) return
    setBusy(true)
    onBusyChange(true)
    setResults([])
    const outcomes: { number: string; message: string; ok: boolean }[] = [],
      remaining: string[] = []
    for (const order of orders) {
      let skipped = ''
      if (action === 'approve' && order.status !== 'pending')
        skipped = 'Atlandı: sipariş bekliyor durumunda değil.'
      if (
        action === 'cancel' &&
        (order.externalId || !transitions[order.status].includes('cancelled'))
      )
        skipped = 'Atlandı: bu siparişin iptali bu yerel işlemle yapılamaz.'
      if (
        action === 'tax' &&
        (!['pending', 'approved'].includes(order.status) ||
          state.invoices.some((invoice) => invoice.orderId === order.id))
      )
        skipped = 'Atlandı: fatura veya sevk kaydı var.'
      if (
        action === 'invoice' &&
        (order.syncError || ['cancelled', 'returned'].includes(order.status))
      )
        skipped = 'Atlandı: sipariş uzlaştırılmalı veya iptal/iade durumunda.'
      if (
        ['ready', 'unready'].includes(action) &&
        (!['pending', 'approved'].includes(order.status) || order.syncError)
      )
        skipped = 'Atlandı: bu siparişin hazırlık durumu değiştirilemez.'
      if (skipped) {
        outcomes.push({ number: order.number, message: skipped, ok: false })
        remaining.push(order.id)
        continue
      }
      const command: Command =
        action === 'invoice'
          ? { type: 'order.invoice', id: order.id }
          : action === 'ready' || action === 'unready'
            ? {
                type: 'order.prepare',
                id: order.id,
                ready: action === 'ready',
                lineKeys: order.lines.map(orderLineKey),
                expectedContent: orderContentKey(order),
              }
            : action === 'printed' || action === 'unprinted'
              ? {
                  type: 'order.print',
                  id: order.id,
                  printed: action === 'printed',
                  expectedContent: orderPrintKey(order),
                }
              : action === 'tax'
                ? {
                    type: 'order.tax',
                    id: order.id,
                    taxRate: Number(tax),
                    expectedContent: orderContentKey(order),
                  }
                : {
                    type: 'order.transition',
                    id: order.id,
                    status: action === 'approve' ? 'approved' : 'cancelled',
                    ...(action === 'cancel' ? { reason } : {}),
                  }
      const result = await run(command, { silent: true })
      outcomes.push({ number: order.number, message: result.message, ok: result.ok })
      if (!result.ok) remaining.push(order.id)
    }
    setBusy(false)
    onBusyChange(false)
    setDialog(null)
    setResults(outcomes)
    onSelectionChange(remaining)
  }
  return (
    <>
      {!!orders.length && (
        <div className="selection-toolbar order-bulk-toolbar">
          <strong>{orders.length} sipariş seçildi</strong>
          <div>
            <Button
              variant="secondary"
              size="sm"
              isDisabled={busy || !can('orders.write')}
              onPress={() => void execute('approve')}
            >
              <Check size={14} />
              Siparişleri Onayla
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isDisabled={busy || !can('orders.write')}
              onPress={() => setDialog('cancel')}
            >
              Siparişleri İptal Et
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isDisabled={busy || !can('orders.write')}
              onPress={() => setDialog('tax')}
            >
              KDV Oranını Değiştir
            </Button>
            <a
              className="button button--secondary button--sm"
              href={`/orders/print?ids=${encodeURIComponent(orders.map((order) => order.id).join(','))}`}
              target="_blank"
              rel="noreferrer"
            >
              <Printer size={14} />
              Detayları Yazdır
            </a>
            <Dropdown>
              <Button size="sm" variant="secondary" isDisabled={busy}>
                Diğer işlemler
              </Button>
              <Dropdown.Popover className="app-dropdown">
                <Dropdown.Menu
                  aria-label="Diğer toplu sipariş işlemleri"
                  onAction={(key) => void execute(String(key) as Action)}
                >
                  <Dropdown.Item
                    id="invoice"
                    textValue="Fatura taslaklarını oluştur"
                    isDisabled={!can('finance.write')}
                  >
                    <Label>Fatura taslaklarını oluştur</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="ready"
                    textValue="Tüm kalemleri hazır işaretle"
                    isDisabled={!can('orders.write')}
                  >
                    <Label>Tüm kalemleri hazır işaretle</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="unready"
                    textValue="Hazırlık işaretlerini kaldır"
                    isDisabled={!can('orders.write')}
                  >
                    <Label>Hazırlık işaretlerini kaldır</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="printed"
                    textValue="Yazdırıldı işaretle"
                    isDisabled={!can('orders.write')}
                  >
                    <Label>Yazdırıldı işaretle</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="unprinted"
                    textValue="Yazdırıldı işaretini kaldır"
                    isDisabled={!can('orders.write')}
                  >
                    <Label>Yazdırıldı işaretini kaldır</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              aria-label="Seçimi temizle"
              isDisabled={busy}
              onPress={() => onSelectionChange([])}
            >
              <X size={15} />
            </Button>
          </div>
        </div>
      )}
      {!!results.length && (
        <div className="order-bulk-results" role="status">
          <div>
            <strong>{results.filter((result) => result.ok).length} işlem tamamlandı</strong>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Toplu işlem sonuçlarını kapat"
              onPress={() => setResults([])}
            >
              <X size={14} />
            </Button>
          </div>
          <ul>
            {results.map((result) => (
              <li key={result.number}>
                <strong>{result.number}</strong>
                <span>{result.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog && (
        <Dialog
          open
          title={
            dialog === 'cancel' ? 'Seçili siparişleri iptal et' : 'Sipariş KDV oranını değiştir'
          }
          description={`${orders.length} sipariş seçildi; uygun olmayan kayıtlar gerekçeleriyle atlanır.`}
          onClose={() => {
            if (!busy) setDialog(null)
          }}
          footer={
            <>
              <Button variant="secondary" isDisabled={busy} onPress={() => setDialog(null)}>
                Vazgeç
              </Button>
              <Button
                variant={dialog === 'cancel' ? 'danger' : 'primary'}
                isDisabled={busy}
                onPress={() => void execute(dialog)}
              >
                {busy
                  ? 'İşleniyor…'
                  : dialog === 'cancel'
                    ? 'Evet, iptal et'
                    : 'KDV oranını uygula'}
              </Button>
            </>
          }
        >
          <div className="form-section">
            <div className="order-bulk-numbers">
              {orders.map((order) => (
                <span key={order.id}>{order.number}</span>
              ))}
            </div>
            {dialog === 'cancel' ? (
              <Field
                label="İptal sebebi"
                value={reason}
                onChange={setReason}
                maxLength={2000}
                isDisabled={busy}
              />
            ) : (
              <SelectButton
                label="Yeni KDV oranı"
                value={tax}
                onChange={setTax}
                options={[0, 1, 10, 20].map((value) => ({ id: String(value), label: `%${value}` }))}
                isDisabled={busy}
              />
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
