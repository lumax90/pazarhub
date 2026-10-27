import { useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { Download, FileCheck2, RefreshCw, Send } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { Invoice } from '../../domain/types'
import type { PublicIntegration } from '../../domain/integrations'
import { invoiceStatusLabels } from '../../domain/labels'
import { orderCurrencyTotal } from '../../domain/order-currency'
import { apiRequest } from '../../lib/api'
import { useResource } from '../../lib/useResource'
import { currencyMoney } from '../../domain/money'
import { Dialog, Field, SectionTitle, SelectButton } from '../ui/shared'
import { AsyncState } from '../ui/AsyncState'
import { FulfillmentReconciliation } from './FulfillmentReconciliation'
import { invoiceSource } from '../../domain/invoice-source'
import { InvoiceManualDocument } from '../invoices/InvoiceManualDocument'
import { invoiceDocumentLabel } from '../../domain/invoice-document'

export function InvoiceManager({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { state, mode, notify, refresh, can } = useApp()
  const order = invoiceSource(state, invoice)!
  const customer = state.customers.find((c) => c.id === order.customerId)
  const initial = order.billingAddress
  const [billing, setBilling] = useState({
    name: initial?.name ?? customer?.name ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    district: initial?.district ?? '',
    phone: initial?.phone ?? '',
    taxId: initial?.taxId ?? '',
    taxOffice: initial?.taxOffice ?? '',
  })
  const [draftOnly, setDraftOnly] = useState(order.invoicePreference === 'draft')
  const [reconciling, setReconciling] = useState(false)
  const [shipment, setShipment] = useState(
    order.shipmentMetadata ?? {
      carrierName: order.cargoProvider ?? '',
      carrierTaxId: '',
      date: new Date().toISOString().slice(0, 10),
    },
  )
  const accounts = useResource<{ connections: PublicIntegration[] }>(
    mode === 'live' ? '/api/integration-options?kind=invoice' : null,
  )
  const [connectionId, setConnectionId] = useState(invoice.connectionId ?? ''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const currentConnection =
    invoice.connectionId ||
    connectionId ||
    accounts.data?.connections.find((c) => c.isDefault && c.enabled && c.status === 'verified')
      ?.id ||
    ''
  const action = async (operation: 'create' | 'finalize' | 'status') => {
    if (busy) return
    setBusy(operation)
    setError('')
    try {
      await apiRequest(`/api/invoices/${invoice.id}/action`, {
        method: 'POST',
        key: crypto.randomUUID(),
        body: { operation, connectionId: currentConnection },
      })
      notify('Fatura işlemi kuyruğa alındı.')
      await refresh()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Fatura işlemi başlatılamadı.')
    } finally {
      setBusy('')
    }
  }
  const save = async () => {
    if (busy) return
    setBusy('billing')
    setError('')
    if (invoice.document) {
      setBusy('')
      setError(
        'Bağımsız faturanın alıcı ve resmileştirme tercihini fatura düzenleme sayfasından kaydedin.',
      )
      return
    }
    try {
      await apiRequest(`/api/orders/${order.id}/billing`, {
        method: 'PATCH',
        body: {
          billingAddress: billing,
          invoicePreference: draftOnly
            ? 'draft'
            : order.invoicePreference === 'immediate'
              ? 'immediate'
              : 'default',
          shipmentMetadata: shipment,
        },
      })
      notify('Fatura bilgileri kaydedildi.')
      await refresh()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Bilgiler kaydedilemedi.')
    } finally {
      setBusy('')
    }
  }
  const writable = mode === 'live' && can('finance.write')
  const pending = ['queued', 'processing'].includes(invoice.status) || !!invoice.uncertainJobId
  return (
    <Dialog
      open
      wide
      title={invoice.documentNumber || invoice.number}
      description={`${order.externalNumber || order.number} · ${currencyMoney(orderCurrencyTotal(order), order.currency)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Kapat
          </Button>
          {invoice.url && (
            <a
              className="button button--secondary"
              href={invoice.url}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={15} />
              PDF’i aç
            </a>
          )}
          {!invoice.externalId && !invoice.manualDocument && (
            <Button
              variant="primary"
              isDisabled={
                !writable ||
                !!busy ||
                pending ||
                !currentConnection ||
                invoice.status === 'cancelled' ||
                invoice.localOnly
              }
              onPress={() => void action('create')}
            >
              <Send size={15} />
              Paraşüt’e aktar
            </Button>
          )}
          {invoice.externalId && invoice.status !== 'issued' && (
            <Button
              variant="primary"
              isDisabled={!writable || !!busy || pending || order.invoicePreference === 'draft'}
              onPress={() => void action('finalize')}
            >
              <FileCheck2 size={16} />
              Resmileştir
            </Button>
          )}
        </>
      }
    >
      <div className="invoice-summary">
        <Chip
          variant="soft"
          color={
            invoice.status === 'issued'
              ? 'success'
              : invoice.status === 'failed'
                ? 'danger'
                : 'accent'
          }
        >
          {invoiceDocumentLabel(invoice) ?? invoiceStatusLabels[invoice.status]}
        </Chip>
        {invoice.externalId && <span className="code-text">Paraşüt: {invoice.externalId}</span>}
        {writable && invoice.externalId && (
          <Button
            variant="ghost"
            size="sm"
            isDisabled={!!busy}
            onPress={() => void action('status')}
          >
            <RefreshCw size={14} />
            Durumu sorgula
          </Button>
        )}
      </div>
      <AsyncState loading={accounts.loading} error={accounts.error} />
      {invoice.error && <div className="resource-error">{invoice.error}</div>}
      {writable && (invoice.error || invoice.uncertainJobId) && (
        <Button variant="secondary" onPress={() => setReconciling(true)}>
          Sonucu uzlaştır
        </Button>
      )}
      {reconciling && (
        <FulfillmentReconciliation
          kind="invoice"
          id={invoice.id}
          onClose={() => setReconciling(false)}
        />
      )}
      {!invoice.connectionId && !invoice.manualDocument && (
        <SectionTitle title="Fatura sağlayıcısı">
          <SelectButton
            label="Paraşüt hesabı"
            value={currentConnection}
            onChange={setConnectionId}
            options={(accounts.data?.connections ?? [])
              .filter((c) => c.enabled && c.status === 'verified')
              .map((c) => ({ id: c.id, label: c.name }))}
          />
        </SectionTitle>
      )}
      <SectionTitle
        title="Fatura bilgileri"
        description="Alıcı bilgileri siparişin fatura anlık görüntüsüdür."
      >
        <div className="form-grid">
          {Object.entries({
            name: 'Alıcı / unvan',
            taxId: 'VKN / TCKN',
            taxOffice: 'Vergi dairesi',
            phone: 'Telefon',
            city: 'İl',
            district: 'İlçe',
            address: 'Fatura adresi',
          }).map(([field, label]) => (
            <Field
              key={field}
              label={label}
              value={billing[field as keyof typeof billing]}
              onChange={(value) => setBilling((current) => ({ ...current, [field]: value }))}
              readOnly={
                !!invoice.externalId || !!invoice.manualDocument || !writable || !!invoice.document
              }
              className={field === 'address' ? 'span-2' : ''}
            />
          ))}
        </div>
      </SectionTitle>
      <InvoiceManualDocument invoice={invoice} embedded />
      {invoice.status !== 'issued' && (
        <SectionTitle title="Resmileştirme tercihi">
          <Checkbox
            className="app-checkbox"
            isSelected={draftOnly}
            isDisabled={!writable || !!invoice.document}
            onChange={setDraftOnly}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Resmîleşmesin · Paraşüt’te taslak olarak kalsın</Label>
            </Checkbox.Content>
          </Checkbox>
          {order.channel !== 'manual' && (
            <div className="form-grid">
              <Field
                label="Kargo şirketi"
                value={shipment.carrierName}
                onChange={(value) => setShipment((s) => ({ ...s, carrierName: value }))}
              />
              <Field
                label="Kargo şirketi VKN"
                value={shipment.carrierTaxId}
                onChange={(value) => setShipment((s) => ({ ...s, carrierTaxId: value }))}
              />
              <Field
                label="Gönderim tarihi (YYYY-AA-GG)"
                value={shipment.date}
                onChange={(value) => setShipment((s) => ({ ...s, date: value }))}
              />
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            isDisabled={!writable || !!busy || pending || !!invoice.document}
            onPress={() => void save()}
          >
            Fatura bilgilerini kaydet
          </Button>
        </SectionTitle>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
