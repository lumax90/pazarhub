import { useState } from 'react'
import { Button } from '@heroui/react'
import { useApp } from '../../app/AppProvider'
import type { Invoice, InvoiceInput } from '../../domain/types'
import { invoiceAmountDue, invoicePayment } from '../../domain/invoice-source'
import { warehouses } from '../../domain/inventory'
import { paymentDateInput, paymentTimestamp, validPaymentDate } from '../../lib/accounting-date'
import { money } from '../../lib/format'
import { DataTable } from '../ui/DataTable'
import { Dialog, SelectButton } from '../ui/shared'

export function InvoiceBulkPay({
  invoices,
  onClose,
  onDone,
}: {
  invoices: Invoice[]
  onClose: () => void
  onDone: () => void
}) {
  const { state, run, can } = useApp(),
    [snapshot] = useState(() =>
      invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        expectedTotal: invoiceAmountDue(state, invoice),
        expectedVersion: invoice.version ?? 0,
        expectedPaymentId: invoice.paymentCashId,
      })),
    ),
    [method, setMethod] = useState(''),
    [warehouse, setWarehouse] = useState(() => {
      const active = warehouses(state).filter((warehouse) => warehouse.active)
      return active.length === 1 ? active[0].id : ''
    }),
    [at, setAt] = useState(paymentDateInput),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const stale = snapshot.some((item) => {
    const current = state.invoices.find((invoice) => invoice.id === item.id)
    return (
      !current ||
      current.status === 'cancelled' ||
      invoicePayment(state, current).paid ||
      (current.version ?? 0) !== item.expectedVersion ||
      invoiceAmountDue(state, current) !== item.expectedTotal
    )
  })
  const total = snapshot.reduce((sum, item) => sum + item.expectedTotal, 0)
  const submit = async () => {
    if (busy || stale) return
    setBusy(true)
    setError('')
    const result = await run({
      type: 'invoice.pay.bulk',
      items: snapshot.map((item) => ({
        id: item.id,
        expectedTotal: item.expectedTotal,
        expectedVersion: item.expectedVersion,
        expectedPaymentId: item.expectedPaymentId,
      })),
      payment: {
        method: method as NonNullable<InvoiceInput['payment']>['method'],
        warehouseId: warehouse,
        at: paymentTimestamp(at),
      },
    })
    setBusy(false)
    if (result.ok) onDone()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      wide
      title={`${snapshot.length} faturayı ödendi işaretle`}
      description="Kasa/banka işlemi çalıştırılmaz; yalnız kayıtlı kalan tahsilatlar kasaya giriş yazılır."
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            isDisabled={
              busy ||
              stale ||
              !can('finance.write') ||
              !method ||
              !warehouse ||
              !validPaymentDate(at) ||
              !Number.isSafeInteger(total)
            }
            onPress={() => void submit()}
          >
            Ödendi işaretle
          </Button>
        </>
      }
    >
      <div className="margin-rule-form">
        <DataTable
          label="Toplu tahsilat faturaları"
          items={snapshot}
          columns={[
            { id: 'number', label: 'Fatura', rowHeader: true, cell: (item) => item.number },
            {
              id: 'due',
              label: 'Kalan tahsilat (TRY)',
              className: 'align-right',
              cell: (item) => money(item.expectedTotal),
            },
          ]}
          paginate={false}
        />
        <strong>Kasaya yazılacak toplam: {money(total)}</strong>
        <label className="order-date-field">
          <span className="label">Toplu ödeme tarihi / saati</span>
          <input
            className="input input--secondary"
            type="datetime-local"
            value={at}
            onChange={(event) => setAt(event.target.value)}
            disabled={busy}
          />
        </label>
        <SelectButton
          label="Toplu ödeme yöntemi"
          value={method}
          onChange={setMethod}
          isDisabled={busy}
          options={[
            { id: '', label: 'Yöntem seçin…' },
            { id: 'cash', label: 'Nakit' },
            { id: 'card', label: 'Kart' },
            { id: 'transfer', label: 'Havale / EFT' },
            { id: 'marketplace', label: 'Pazaryeri' },
          ]}
        />
        <SelectButton
          label="Toplu tahsilat deposu"
          value={warehouse}
          onChange={setWarehouse}
          isDisabled={busy}
          options={[
            { id: '', label: 'Depo seçin…' },
            ...warehouses(state)
              .filter((warehouse) => warehouse.active)
              .map((warehouse) => ({ id: warehouse.id, label: warehouse.name })),
          ]}
        />
        {stale && (
          <p className="form-error" role="alert">
            Seçilen faturalardan biri değişti. Güncel kayıtları yeniden seçin.
          </p>
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
