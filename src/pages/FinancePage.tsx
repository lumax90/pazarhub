import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { ArrowDownLeft, ArrowUpRight, Download, FileText, Wallet } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { orderTotal } from '../domain/selectors'
import type { CashEntry, Invoice } from '../domain/types'
import { dateLabel, downloadCsv, matches, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import { FilterTabs, Metric, PageHeader, Panel, SearchBox } from '../components/ui/shared'
import { CashEntryButton, CustomerAccountsPage, ExpensesPage } from './AccountingPages'
import { invoiceStatusLabels } from '../domain/labels'
import { invoiceDocumentLabel } from '../domain/invoice-document'
import { InvoiceManager } from '../components/integrations/InvoiceManager'
import { SettlementsPage } from './SettlementsPage'
import { InvoicesPage } from './InvoicePages'

export function FinancePage() {
  const { state, mode } = useApp()
  const { view = 'invoices' } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [query, setQuery] = useState('')
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const incoming = state.cash
    .filter((entry) => entry.kind === 'in')
    .reduce((sum, entry) => sum + entry.amount, 0)
  const outgoing = state.cash
    .filter((entry) => entry.kind === 'out')
    .reduce((sum, entry) => sum + entry.amount, 0)
  const methodLabels = {
    cash: 'Nakit',
    card: 'Kart',
    transfer: 'Havale / EFT',
    marketplace: 'Pazaryeri',
  }
  const invoices = state.invoices.filter((invoice) =>
    matches(
      `${invoice.number} ${state.orders.find((order) => order.id === invoice.orderId)?.number}`,
      query,
    ),
  )
  const entries = state.cash
    .filter((entry) => matches(`${entry.description} ${methodLabels[entry.method]}`, query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const invoiceColumns: Column<Invoice>[] = [
    {
      id: 'number',
      label: 'Fatura',
      rowHeader: true,
      cell: (invoice) => (
        <button
          onClick={() => setInvoiceId(invoice.id)}
          className="button button--sm button--ghost document-link"
        >
          <FileText size={16} />
          {invoice.number}
        </button>
      ),
    },
    {
      id: 'customer',
      label: 'Müşteri',
      cell: (invoice) => {
        const order = state.orders.find((item) => item.id === invoice.orderId)
        return state.customers.find((customer) => customer.id === order?.customerId)?.name ?? '—'
      },
    },
    {
      id: 'order',
      label: 'Sipariş',
      cell: (invoice) => (
        <Link className="order-link" to={`/orders/${invoice.orderId}`}>
          {state.orders.find((order) => order.id === invoice.orderId)?.number}
        </Link>
      ),
    },
    {
      id: 'date',
      label: 'Tarih',
      cell: (invoice) => dateLabel(invoice.createdAt),
      sortValue: (invoice) => invoice.createdAt,
    },
    {
      id: 'document',
      label: 'Resmileşme',
      cell: (invoice) => (
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
      ),
    },
    {
      id: 'paid',
      label: 'Tahsilat',
      cell: (invoice) => {
        const paid = state.orders.find((order) => order.id === invoice.orderId)?.paid
        return (
          <Chip size="sm" variant="soft" color={paid ? 'success' : 'warning'}>
            {paid ? 'Kaydedildi' : 'Bekliyor'}
          </Chip>
        )
      },
    },
    {
      id: 'total',
      label: 'Tutar',
      className: 'align-right',
      cell: (invoice) => {
        const order = state.orders.find((item) => item.id === invoice.orderId)
        return <strong className="money-cell">{order ? money(orderTotal(order)) : '—'}</strong>
      },
    },
  ]
  const cashColumns: Column<CashEntry>[] = [
    {
      id: 'description',
      label: 'İşlem',
      rowHeader: true,
      cell: (entry) => (
        <div className="cash-description">
          <span className={`cash-direction ${entry.kind}`}>
            {entry.kind === 'in' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
          </span>
          <strong>{entry.description}</strong>
        </div>
      ),
    },
    {
      id: 'date',
      label: 'Tarih',
      cell: (entry) => dateLabel(entry.createdAt, true),
      sortValue: (entry) => entry.createdAt,
    },
    { id: 'method', label: 'Ödeme yöntemi', cell: (entry) => methodLabels[entry.method] },
    {
      id: 'type',
      label: 'Tür',
      cell: (entry) => (
        <Chip size="sm" variant="soft" color={entry.kind === 'in' ? 'success' : 'default'}>
          {entry.kind === 'in' ? 'Tahsilat' : 'Çıkış'}
        </Chip>
      ),
    },
    {
      id: 'amount',
      label: 'Tutar',
      className: 'align-right',
      sortValue: (entry) => entry.amount,
      cell: (entry) => (
        <strong className={entry.kind === 'in' ? 'text-success money-cell' : 'money-cell'}>
          {entry.kind === 'in' ? '+' : '−'}
          {money(entry.amount)}
        </strong>
      ),
    },
  ]
  if (view === 'expenses') return <ExpensesPage />
  if (view === 'customers') return <CustomerAccountsPage />
  if (view === 'settlements') return <SettlementsPage />
  if (view === 'invoices') return <InvoicesPage />
  return (
    <>
      <PageHeader
        title={view === 'cash' ? 'Kasa Hareketleri' : 'Faturalar'}
        description="Sipariş, belge ve tahsilat kayıtları aynı akışta."
        actions={
          <>
            {view === 'cash' && <CashEntryButton />}
            <Button
              variant="secondary"
              onPress={() =>
                view === 'cash'
                  ? downloadCsv(
                      'kasa-hareketleri.csv',
                      ['Açıklama', 'Tür', 'Tutar (TL)', 'Tarih'],
                      entries.map((entry) => [
                        entry.description,
                        entry.kind === 'in' ? 'Giriş' : 'Çıkış',
                        (entry.amount / 100).toFixed(2),
                        dateLabel(entry.createdAt, true),
                      ]),
                    )
                  : downloadCsv(
                      'fatura-taslaklari.csv',
                      ['Belge', 'Tarih', 'Durum'],
                      invoices.map((invoice) => [
                        invoice.number,
                        dateLabel(invoice.createdAt),
                        'Taslak',
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
      <div className="metrics-grid metrics-grid--three">
        <Metric
          label="Tahsilat kayıtları"
          value={money(incoming)}
          detail="kayıtlı kasa girişleri"
          icon={<ArrowDownLeft size={18} />}
        />
        <Metric
          label="Kasa çıkışları"
          value={money(outgoing)}
          detail="gider ve iade kayıtları"
          icon={<ArrowUpRight size={18} />}
          index={1}
        />
        <Metric
          label="Kayıtlı bakiye"
          value={money(incoming - outgoing)}
          detail="giriş − çıkış"
          icon={<Wallet size={18} />}
          index={2}
        />
      </div>
      <Panel flush className="list-panel">
        <FilterTabs
          label="Muhasebe görünümü"
          value={view}
          onChange={(value) => {
            navigate(`${pathname.startsWith('/retail') ? '/retail' : ''}/finance/${value}`)
            setQuery('')
          }}
          items={[
            { id: 'invoices', label: 'Faturalar', count: state.invoices.length },
            { id: 'cash', label: 'Kasa hareketleri', count: state.cash.length },
            { id: 'expenses', label: 'Giderler', count: state.expenses?.length ?? 0 },
            { id: 'customers', label: 'Cari hesaplar' },
            { id: 'settlements', label: 'Hakedişler' },
          ]}
        />
        <div className="list-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={
              view === 'cash'
                ? 'İşlem açıklaması veya ödeme yöntemi...'
                : 'Fatura veya sipariş numarası...'
            }
            label="Muhasebe kayıtlarında ara"
          />
          <Chip size="sm" variant="soft">
            {mode === 'demo' ? 'Örnek kayıtlar' : 'Çalışma alanı defterleri'}
          </Chip>
        </div>
        {view === 'cash' ? (
          <DataTable items={entries} columns={cashColumns} label="Kasa hareketleri" />
        ) : (
          <DataTable items={invoices} columns={invoiceColumns} label="Fatura taslakları" />
        )}
      </Panel>
      <p className="page-explainer">
        <FileText size={15} />
        Belge oluşturma ve tahsilat ayrı tutulur. Resmî belgelerin sağlayıcı sonucu fatura durumunda
        görünür.
      </p>
      {invoiceId && state.invoices.some((invoice) => invoice.id === invoiceId) && (
        <InvoiceManager
          key={invoiceId}
          invoice={state.invoices.find((invoice) => invoice.id === invoiceId)!}
          onClose={() => setInvoiceId(null)}
        />
      )}
    </>
  )
}
