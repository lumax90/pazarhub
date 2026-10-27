import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import type { Selection } from '@heroui/react'
import { ArrowLeft, Download, FileText, Plus, Trash2, Wallet } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Invoice, InvoiceInput, OrderDiscount, OrderItemInput } from '../domain/types'
import {
  invoiceSource,
  invoiceTryTotal,
  invoicePayment,
  invoiceAmountDue,
} from '../domain/invoice-source'
import { invoiceCategoryName } from '../domain/invoice-categories'
import { invoiceDocumentLabel } from '../domain/invoice-document'
import { InvoiceManualDocument } from '../components/invoices/InvoiceManualDocument'
import { invoiceNativeTotal } from '../domain/invoices'
import {
  orderCurrencyShipping,
  orderCurrencyTotal,
  orderLineCurrencyTotal,
  orderLineCurrencyPrice,
} from '../domain/order-currency'
import { currencyMoney, exchangeRate, exclusivePrice, multiplyMoney } from '../domain/money'
import { orderInputAmounts } from '../domain/orders'
import { availableStock, customerBalance, findVariant, variantPrice } from '../domain/selectors'
import { invoiceStatusLabels } from '../domain/labels'
import { dayKey, dateLabel, downloadCsv, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import {
  Dialog,
  Field,
  FilterTabs,
  Metric,
  MoneyField,
  PageHeader,
  Panel,
  SearchBox,
  SelectButton,
} from '../components/ui/shared'
import { SearchSelect } from '../components/ui/SearchSelect'
import { InvoiceManager } from '../components/integrations/InvoiceManager'
import { CustomerEditor } from './CustomersPage'
import { warehouses } from '../domain/inventory'
import { InvoiceCategoryManager } from '../components/invoices/InvoiceCategoryManager'
import { InvoiceBulkPay } from '../components/invoices/InvoiceBulkPay'
import { InvoiceCategoryAssignment } from '../components/invoices/InvoiceCategoryAssignment'
import { paymentDateInput, paymentTimestamp } from '../lib/accounting-date'

const methods = [
  { id: 'cash', label: 'Nakit' },
  { id: 'card', label: 'Kart' },
  { id: 'transfer', label: 'Havale / EFT' },
  { id: 'marketplace', label: 'Pazaryeri' },
]
export function InvoicesPage() {
  const { state, can } = useApp(),
    [params, setParams] = useSearchParams(),
    [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [tag, setTag] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all'),
    [categoryOpen, setCategoryOpen] = useState(false),
    [bulkOpen, setBulkOpen] = useState(false),
    [selection, setSelection] = useState<Selection>(new Set())
  const resetSelection = () => setSelection(new Set())
  const view = params.get('status') ?? 'all',
    today = dayKey(new Date())
  const status = (invoice: Invoice) =>
    invoice.status === 'cancelled'
      ? 'cancelled'
      : invoicePayment(state, invoice).paid
        ? 'paid'
        : invoice.dueDate && invoice.dueDate < today
          ? 'overdue'
          : 'unpaid'
  const all = state.invoices
    .filter((invoice) => {
      const source = invoiceSource(state, invoice),
        customer = state.customers.find((customer) => customer.id === source?.customerId),
        date = invoice.issueDate ?? dayKey(invoice.createdAt)
      return (
        (!query ||
          `${invoice.number} ${invoice.title ?? ''} ${customer?.name ?? ''} ${source?.number ?? ''} ${source?.externalNumber ?? ''}`
            .toLocaleLowerCase('tr-TR')
            .includes(query.toLocaleLowerCase('tr-TR'))) &&
        (!from || date >= from) &&
        (!to || date <= to) &&
        (tag === 'all' || invoice.tags?.includes(tag)) &&
        (categoryFilter === 'all' || invoice.categoryId === categoryFilter)
      )
    })
    .sort((a, b) => (b.issueDate ?? b.createdAt).localeCompare(a.issueDate ?? a.createdAt))
  const selected = all.filter((invoice) =>
    view === 'all' || view === 'unpaid'
      ? view === 'all' || ['unpaid', 'overdue'].includes(status(invoice))
      : status(invoice) === view,
  )
  const totals = (kind: string) =>
    all
      .filter((invoice) =>
        kind === 'unpaid'
          ? ['unpaid', 'overdue'].includes(status(invoice))
          : status(invoice) === kind,
      )
      .reduce(
        (sum, invoice) =>
          sum +
          (kind === 'paid' ? invoiceTryTotal(state, invoice) : invoiceAmountDue(state, invoice)),
        0,
      )
  const eligible = (invoice: Invoice) => {
    const source = invoiceSource(state, invoice)
    return (
      invoice.status !== 'cancelled' &&
      !invoicePayment(state, invoice).paid &&
      source &&
      !source.syncError &&
      !['cancelled', 'returned'].includes(source.status) &&
      Number.isSafeInteger(invoiceAmountDue(state, invoice))
    )
  }
  const selectedInvoices = selected.filter(
    (invoice) => eligible(invoice) && (selection === 'all' || selection.has(invoice.id)),
  )
  return (
    <>
      <PageHeader
        title="Faturalar"
        description="Bağımsız ve sipariş kaynaklı faturalar; ödeme ve resmileşme ayrı izlenir."
        actions={
          <>
            <Button
              variant="secondary"
              onPress={() => setCategoryOpen(true)}
              isDisabled={!can('finance.write')}
            >
              Fatura kategorileri
            </Button>
            <Button
              variant="secondary"
              onPress={() =>
                downloadCsv(
                  'faturalar.csv',
                  [
                    'Fatura',
                    'Müşteri',
                    'Düzenleme',
                    'Vade',
                    'Ödeme',
                    'Resmileşme',
                    'Para birimi',
                    'Tutar',
                    'TRY karşılığı',
                  ],
                  selected.map((invoice) => {
                    const source = invoiceSource(state, invoice)
                    return [
                      invoice.number,
                      state.customers.find((customer) => customer.id === source?.customerId)
                        ?.name ?? '',
                      invoice.issueDate ?? dayKey(invoice.createdAt),
                      invoice.dueDate ?? '',
                      status(invoice),
                      invoiceDocumentLabel(invoice) ?? invoiceStatusLabels[invoice.status],
                      source?.currency ?? 'TRY',
                      (invoiceNativeTotal(state, invoice) / 100).toFixed(2),
                      (invoiceTryTotal(state, invoice) / 100).toFixed(2),
                    ]
                  }),
                )
              }
            >
              <Download size={15} />
              Dışa aktar
            </Button>
            <Link
              className={`button button--primary ${!can('finance.write') ? 'is-disabled' : ''}`}
              to="/finance/invoices/new"
            >
              Fatura oluştur
            </Link>
          </>
        }
      />
      <div className="metrics-grid metrics-grid--three">
        <Metric
          label="Ödeme bekleyen"
          value={money(totals('unpaid'))}
          detail="TRY karşılığı"
          icon={<Wallet size={18} />}
        />
        <Metric
          label="Vadesi geçen"
          value={money(totals('overdue'))}
          detail="vadeli ve ödenmemiş"
          icon={<FileText size={18} />}
        />
        <Metric
          label="Tahsil edilen"
          value={money(totals('paid'))}
          detail="kayıtlı tahsilat"
          icon={<Wallet size={18} />}
        />
      </div>
      <Panel flush className="list-panel">
        <FilterTabs
          label="Fatura ödeme durumu"
          value={view}
          onChange={(value) => {
            resetSelection()
            setParams(value === 'all' ? {} : { status: value })
          }}
          items={[
            { id: 'all', label: 'Tümü' },
            { id: 'unpaid', label: 'Ödeme bekleyenler' },
            { id: 'overdue', label: 'Vadesi geçenler' },
            { id: 'paid', label: 'Ödenenler' },
            { id: 'cancelled', label: 'İptal' },
          ]}
        />
        <div className="list-toolbar invoice-list-toolbar">
          <SearchBox
            value={query}
            onChange={(value) => {
              resetSelection()
              setQuery(value)
            }}
            label="Faturalarda ara"
            placeholder="Fatura, müşteri veya açıklama…"
          />
          <label className="order-date-field">
            <span className="label">Başlangıç tarihi</span>
            <input
              className="input input--secondary"
              type="date"
              value={from}
              onChange={(event) => {
                resetSelection()
                setFrom(event.target.value)
              }}
            />
          </label>
          <label className="order-date-field">
            <span className="label">Bitiş tarihi</span>
            <input
              className="input input--secondary"
              type="date"
              value={to}
              onChange={(event) => {
                resetSelection()
                setTo(event.target.value)
              }}
            />
          </label>
          <SelectButton
            label="Fatura etiketi filtresi"
            value={tag}
            onChange={(value) => {
              resetSelection()
              setTag(value)
            }}
            options={[
              { id: 'all', label: 'Tüm etiketler' },
              ...[...new Set(state.invoices.flatMap((invoice) => invoice.tags ?? []))].map(
                (id) => ({ id, label: id }),
              ),
            ]}
          />
          <SelectButton
            label="Fatura kategorisi filtresi"
            value={categoryFilter}
            onChange={(value) => {
              resetSelection()
              setCategoryFilter(value)
            }}
            options={[
              { id: 'all', label: 'Tüm kategoriler' },
              ...(state.invoiceCategories ?? []).map((category) => ({
                id: category.id,
                label: `${category.name}${category.active ? '' : ' (pasif)'}`,
              })),
            ]}
          />
        </div>
        {!!selectedInvoices.length && (
          <div className="selection-toolbar invoice-bulk-toolbar">
            <strong>
              {selectedInvoices.length} fatura ·{' '}
              {money(
                selectedInvoices.reduce(
                  (sum, invoice) => sum + invoiceAmountDue(state, invoice),
                  0,
                ),
              )}{' '}
              kalan tahsilat
            </strong>
            <Button
              size="sm"
              variant="primary"
              onPress={() => setBulkOpen(true)}
              isDisabled={!can('finance.write')}
            >
              Ödendi işaretle
            </Button>
            <Button size="sm" variant="ghost" onPress={resetSelection}>
              Seçimi temizle
            </Button>
          </div>
        )}
        <DataTable
          label="Faturalar"
          items={selected}
          selection={selection}
          onSelectionChange={can('finance.write') ? setSelection : undefined}
          disabledSelectionIds={selected
            .filter((invoice) => !eligible(invoice))
            .map((invoice) => invoice.id)}
          selectionLabel="Bu sayfadaki ödeme bekleyen faturaları seç"
          selectionRowLabel={(invoice) => `${invoice.number} seç`}
          columns={[
            {
              id: 'number',
              label: 'Fatura',
              rowHeader: true,
              cell: (invoice) => (
                <Link className="document-link" to={`/finance/invoices/${invoice.id}`}>
                  {invoice.number}
                </Link>
              ),
            },
            {
              id: 'customer',
              label: 'Müşteri',
              cell: (invoice) => {
                const source = invoiceSource(state, invoice)
                return (
                  <div>
                    <strong>
                      {state.customers.find((customer) => customer.id === source?.customerId)?.name}
                    </strong>
                    <small className="cell-secondary">
                      {invoice.title ||
                        (invoice.orderId
                          ? `Sipariş ${source?.externalNumber || source?.number}`
                          : 'Bağımsız fatura')}
                    </small>
                  </div>
                )
              },
            },
            {
              id: 'date',
              label: 'Tarih / vade',
              cell: (invoice) => (
                <div>
                  {invoice.issueDate ?? dayKey(invoice.createdAt)}
                  <small className="cell-secondary">Vade: {invoice.dueDate ?? '—'}</small>
                </div>
              ),
            },
            {
              id: 'category',
              label: 'Kategori',
              cell: (invoice) => <span>{invoiceCategoryName(state, invoice) ?? '—'}</span>,
            },
            {
              id: 'payment',
              label: 'Ödeme',
              cell: (invoice) => (
                <Chip
                  size="sm"
                  variant="soft"
                  color={
                    status(invoice) === 'paid'
                      ? 'success'
                      : status(invoice) === 'overdue'
                        ? 'danger'
                        : 'default'
                  }
                >
                  {
                    {
                      paid: 'Ödendi',
                      unpaid: 'Ödeme bekliyor',
                      overdue: 'Vadesi geçti',
                      cancelled: 'İptal',
                    }[status(invoice)]
                  }
                </Chip>
              ),
            },
            {
              id: 'provider',
              label: 'Resmileşme',
              cell: (invoice) => (
                <span>{invoiceDocumentLabel(invoice) ?? invoiceStatusLabels[invoice.status]}</span>
              ),
            },
            {
              id: 'amount',
              label: 'Tutar',
              className: 'align-right',
              cell: (invoice) => (
                <strong>
                  {currencyMoney(
                    invoiceNativeTotal(state, invoice),
                    invoiceSource(state, invoice)?.currency,
                  )}
                </strong>
              ),
            },
          ]}
          emptyTitle="Fatura bulunamadı"
        />
      </Panel>
      {categoryOpen && <InvoiceCategoryManager onClose={() => setCategoryOpen(false)} />}
      {bulkOpen && (
        <InvoiceBulkPay
          invoices={selectedInvoices}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false)
            resetSelection()
          }}
        />
      )}
    </>
  )
}

interface DraftLine {
  id: string
  variantId: string
  title: string
  unit: string
  quantity: string
  price: number
  taxRate: number
  discount: OrderDiscount
  bundleVersion?: number
}
function rateValue(value: string) {
  const match = /^(\d{1,7})(?:[.,](\d{0,8}))?$/.exec(value.trim())
  return match
    ? (BigInt(match[1]) * 100000000n + BigInt((match[2] ?? '').padEnd(8, '0'))).toString()
    : ''
}
const rateText = (value: string) =>
  value ? (Number(value) / 100000000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : ''
export function InvoiceEditorPage() {
  const { id } = useParams(),
    { state } = useApp(),
    navigate = useNavigate(),
    invoice = id ? state.invoices.find((invoice) => invoice.id === id) : undefined
  if (id && !invoice)
    return (
      <Panel title="Fatura bulunamadı">
        <Link to="/finance/invoices">Faturalara dön</Link>
      </Panel>
    )
  return (
    <InvoiceEditor
      key={id ?? 'new'}
      invoice={invoice}
      onDone={(id) => navigate(`/finance/invoices/${id}`, { replace: true })}
    />
  )
}
function InvoiceEditor({ invoice, onDone }: { invoice?: Invoice; onDone: (id: string) => void }) {
  const { state, run, can } = useApp(),
    [id] = useState(invoice?.id ?? crypto.randomUUID()),
    [baseVersion] = useState(invoice?.version ?? 0),
    source = invoice ? invoiceSource(state, invoice) : undefined
  const [customerId, setCustomer] = useState(source?.customerId ?? ''),
    [newCustomer, setNewCustomer] = useState<
      Parameters<typeof CustomerEditor>[0]['customer'] | null
    >(null),
    [number, setNumber] = useState(invoice?.number ?? ''),
    [title, setTitle] = useState(invoice?.title ?? ''),
    [note, setNote] = useState(invoice?.note ?? ''),
    [sourceNumber, setSourceNumber] = useState(source?.externalNumber ?? ''),
    [issueDate, setIssueDate] = useState(invoice?.issueDate ?? dayKey(new Date())),
    [dueDate, setDueDate] = useState(invoice?.dueDate ?? ''),
    [tags, setTags] = useState(invoice?.tags?.join(', ') ?? ''),
    [categoryId, setCategoryId] = useState(invoice?.categoryId ?? ''),
    [currency, setCurrency] = useState<InvoiceInput['currency']>(
      (source?.currency as InvoiceInput['currency']) ?? 'TRY',
    ),
    [manual, setManual] = useState(source?.currencyRate?.source === 'manual'),
    [rate, setRate] = useState(rateText(source?.currencyRate?.value ?? '')),
    [localOnly, setLocalOnly] = useState(invoice?.localOnly ?? false),
    [warehouse, setWarehouse] = useState(invoice?.document?.warehouseIds[0] ?? 'main'),
    [paid, setPaid] = useState(false),
    [method, setMethod] = useState('transfer'),
    [paymentAt, setPaymentAt] = useState(paymentDateInput),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(
    () =>
      source?.lines.map((line) => ({
        id: line.id ?? crypto.randomUUID(),
        variantId: line.kind === 'free' ? '' : line.variantId,
        title: line.title ?? '',
        unit: line.unit ?? 'Adet',
        quantity: String(line.quantity),
        price:
          line.invoiceNetPrice ??
          exclusivePrice(orderLineCurrencyPrice(source, line), line.taxRate),
        taxRate: line.taxRate,
        discount: line.invoiceNetDiscount ?? { kind: 'percent', value: 0 },
      })) ?? [],
  )
  const [billingOverride, setBillingOverride] = useState<InvoiceInput['billingAddress']>()
  const chooseCustomer = (id: string, known?: Parameters<typeof CustomerEditor>[0]['customer']) => {
    setCustomer(id)
    const customer = known ?? state.customers.find((customer) => customer.id === id)
    if (customer)
      setBillingOverride({
        name: customer.company || customer.name,
        address: customer.address,
        city: customer.city,
        district: customer.district,
        phone: customer.phone,
        taxId: customer.taxId,
        taxOffice: customer.taxOffice,
        country: customer.country,
      })
  }
  const currentRate =
    currency === 'TRY'
      ? '100000000'
      : manual
        ? rateValue(rate)
        : (exchangeRate(state.exchangeRates, currency, state.ecommerce?.exchangeRateType) ?? '')
  const blocked =
    busy ||
    !can('finance.write') ||
    (!!invoice &&
      (!!invoice.orderId ||
        !!invoice.externalId ||
        ['issued', 'cancelled', 'queued', 'processing'].includes(invoice.status) ||
        !!invoice.uncertainJobId ||
        (!!invoice.document?.lines.some((line) => line.kind !== 'free') && !can('stock.write')) ||
        invoicePayment(state, invoice).paid))
  const update = (id: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  const nativeAmount = (line: DraftLine) => {
    try {
      return orderInputAmounts(
        Number(line.quantity),
        line.price,
        line.taxRate,
        line.discount,
        false,
      ).total
    } catch {
      return NaN
    }
  }
  const total = lines.reduce((sum, line) => sum + nativeAmount(line), 0),
    tryTotal = lines.reduce(
      (sum, line) =>
        sum +
        (currentRate ? multiplyMoney(nativeAmount(line), BigInt(currentRate), 100000000n) : NaN),
      0,
    ),
    tax = lines.reduce(
      (sum, line) => sum + Math.round((nativeAmount(line) * line.taxRate) / (100 + line.taxRate)),
      0,
    )
  const addProduct = (variantId: string) => {
    const found = findVariant(state, variantId)
    if (!found) return
    setLines((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        variantId,
        title: found.product.invoiceName || found.product.name,
        unit: found.product.unit ?? 'Adet',
        quantity: '1',
        price: currentRate
          ? exclusivePrice(
              multiplyMoney(variantPrice(state, variantId), 100000000n, BigInt(currentRate)),
              found.product.taxRate,
            )
          : 0,
        taxRate: found.product.taxRate,
        discount: { kind: 'percent', value: 0 },
        bundleVersion: found.product.bundle ? (found.product.version ?? 0) : undefined,
      },
    ])
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (blocked) return
    if (paid && !Number.isFinite(Date.parse(`${paymentAt}:00+03:00`))) {
      setError('Ödeme tarihini ve saatini tamamlayın.')
      return
    }
    setBusy(true)
    setError('')
    const items: OrderItemInput[] = lines.map((line) => ({
      ...(line.variantId
        ? { kind: 'catalog' as const, variantId: line.variantId, bundleVersion: line.bundleVersion }
        : { kind: 'free' as const, title: line.title, unit: line.unit }),
      quantity: Number(line.quantity),
      unitPrice: line.price,
      taxRate: line.taxRate,
      discount: line.discount,
    }))
    const input: InvoiceInput = {
      customerId,
      number: number || undefined,
      sourceNumber: sourceNumber || undefined,
      title,
      note,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      issueDate,
      dueDate: dueDate || undefined,
      currency,
      rateSource: manual ? 'manual' : 'TCMB',
      exchangeRate: manual ? currentRate : undefined,
      expectedExchangeRate: currentRate,
      items,
      warehouseId: warehouse,
      billingAddress: billingOverride,
      localOnly,
      categoryId: categoryId || undefined,
      expectedTotal: total,
      expectedTryTotal: tryTotal,
      ...(paid
        ? {
            payment: {
              method: method as NonNullable<InvoiceInput['payment']>['method'],
              at: paymentTimestamp(paymentAt),
              warehouseId: warehouse,
            },
          }
        : {}),
    }
    const result = await run(
      invoice
        ? { type: 'invoice.edit', id, expectedVersion: baseVersion, input }
        : { type: 'invoice.create', id, input },
    )
    setBusy(false)
    if (result.ok) onDone(id)
    else setError(result.message)
  }
  return (
    <div className="order-workspace">
      <PageHeader
        title={invoice ? `Fatura ${invoice.number} düzenle` : 'Fatura oluştur'}
        description="Birim fiyatlar KDV hariç; katalog kalemleri kaydedildiğinde stoktan düşer."
        actions={
          <Link className="button button--secondary" to="/finance/invoices">
            <ArrowLeft size={15} />
            Listeye dön
          </Link>
        }
      />
      <form onSubmit={(event) => void submit(event)}>
        <Panel className="order-form-card" title="Fatura bilgileri">
          <div className="form-grid">
            <div className="order-customer-picker">
              <SearchSelect
                label="Fatura müşterisi"
                value={customerId}
                onChange={chooseCustomer}
                options={state.customers.map((customer) => ({
                  id: customer.id,
                  label: customer.name,
                  description: customer.company,
                }))}
                disabled={blocked}
              />
              <Button
                variant="secondary"
                isDisabled={blocked || !can('orders.write')}
                onPress={() =>
                  setNewCustomer({
                    id: crypto.randomUUID(),
                    name: '',
                    email: '',
                    phone: '',
                    address: '',
                    city: '',
                  })
                }
              >
                <Plus size={15} />
                Yeni müşteri
              </Button>
            </div>
            <p className="description field-description">
              Müşteri bakiyesi: {customerId ? money(customerBalance(state, customerId)) : '—'}
            </p>
            <Field
              label="Fatura no"
              value={number}
              onChange={setNumber}
              isDisabled={blocked}
              description="Boşsa otomatik verilir."
            />
            <Field
              label="Sipariş no (bilgi)"
              value={sourceNumber}
              onChange={setSourceNumber}
              isDisabled={blocked}
            />
            <Field
              label="Fatura adı / açıklama"
              value={title}
              onChange={setTitle}
              isDisabled={blocked}
            />
            <label className="order-date-field">
              <span className="label">Düzenleme tarihi</span>
              <input
                className="input input--secondary"
                type="date"
                value={issueDate}
                aria-label="Düzenleme tarihi"
                onChange={(event) => setIssueDate(event.target.value)}
                required
                disabled={blocked}
              />
            </label>
            <label className="order-date-field">
              <span className="label">Vade tarihi</span>
              <input
                className="input input--secondary"
                type="date"
                min={issueDate}
                aria-label="Vade tarihi"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={blocked}
              />
              <small>Boşsa vade takibi yapılmaz.</small>
            </label>
            <SelectButton
              label="Fatura para birimi"
              value={currency}
              onChange={(value) => {
                setCurrency(value as InvoiceInput['currency'])
                setRate(
                  rateText(
                    exchangeRate(
                      state.exchangeRates,
                      value as InvoiceInput['currency'],
                      state.ecommerce?.exchangeRateType,
                    ) ?? '',
                  ),
                )
              }}
              options={['TRY', 'USD', 'EUR', 'GBP'].map((id) => ({ id, label: id }))}
              isDisabled={blocked}
            />
            {currency !== 'TRY' && (
              <div>
                <Field
                  label="Fatura döviz kuru (1 döviz = TRY)"
                  value={manual ? rate : rateText(currentRate)}
                  onChange={(value) => {
                    setRate(value)
                    setManual(true)
                  }}
                  isDisabled={blocked}
                />
                <Checkbox
                  className="app-checkbox"
                  isSelected={!manual}
                  onChange={(value) => setManual(!value)}
                  isDisabled={blocked}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Label>Güncel TCMB kurunu kullan</Label>
                  </Checkbox.Content>
                </Checkbox>
              </div>
            )}
            <SelectButton
              label="Fatura kategorisi"
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { id: '', label: 'Kategori seçilmedi' },
                ...(state.invoiceCategories ?? [])
                  .filter((category) => category.active || category.id === categoryId)
                  .map((category) => ({
                    id: category.id,
                    label: `${category.name}${category.active ? '' : ' (pasif)'}`,
                  })),
              ]}
              isDisabled={blocked}
            />
            <Field
              label="Fatura etiketleri"
              value={tags}
              onChange={setTags}
              isDisabled={blocked}
              description="Virgülle ayırın."
            />
            <Field label="Fatura notları" value={note} onChange={setNote} isDisabled={blocked} />
            <SelectButton
              label="Fatura stok deposu"
              value={warehouse}
              onChange={setWarehouse}
              options={warehouses(state)
                .filter((warehouse) => warehouse.active)
                .map((warehouse) => ({ id: warehouse.id, label: warehouse.name }))}
              isDisabled={blocked}
            />
          </div>
          <Checkbox
            className="app-checkbox"
            isSelected={localOnly}
            isDisabled={blocked}
            onChange={setLocalOnly}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Resmileştirilmesin · yalnız iç kayıt</Label>
            </Checkbox.Content>
          </Checkbox>
          <p className="description field-description">
            Kapalı olduğunda Paraşüt’e aktarım fatura detayından başlatılır. Kayıt ile resmî belge
            birbirinden ayrıdır.
          </p>
        </Panel>
        <Panel className="order-form-card" title="Ürün / hizmet satırları">
          <SearchSelect
            label="Fatura ürününden satır ekle"
            value=""
            onChange={addProduct}
            options={state.products
              .filter((product) => product.active)
              .flatMap((product) =>
                product.variants.map((variant) => ({
                  id: variant.id,
                  label: `${product.name} · ${variant.name}`,
                  description: `${variant.sku} · ${availableStock(state, variant.id, undefined, warehouse)} satılabilir`,
                })),
              )}
            disabled={blocked || !can('stock.write')}
          />
          <div className="order-lines-editor">
            {lines.map((line, index) => (
              <div className="order-draft-row" key={line.id}>
                <div>
                  <Field
                    label={`${index + 1}. fatura satırı açıklaması`}
                    value={line.title}
                    onChange={(title) => update(line.id, { title })}
                    isDisabled={blocked || !!line.variantId}
                  />
                  <Chip size="sm" variant="soft">
                    {line.variantId ? 'Stoktan düşülür' : 'Serbest hizmet'}
                  </Chip>
                </div>
                <Field
                  label={`Fatura miktarı · satır ${index + 1}`}
                  type="number"
                  min={1}
                  max={10000}
                  value={line.quantity}
                  onChange={(quantity) => update(line.id, { quantity })}
                  isDisabled={blocked}
                />
                <Field
                  label={`Fatura birimi · satır ${index + 1}`}
                  value={line.unit}
                  onChange={(unit) => update(line.id, { unit })}
                  isDisabled={blocked || !!line.variantId}
                />
                <MoneyField
                  key={`${line.id}-${currency}`}
                  label={`Fatura birim fiyatı (KDV hariç) · satır ${index + 1}`}
                  initialValue={line.price}
                  onChange={(price) => update(line.id, { price })}
                  isDisabled={blocked}
                />
                <div>
                  <SelectButton
                    label={`Fatura indirim türü · satır ${index + 1}`}
                    value={line.discount.kind}
                    onChange={(kind) =>
                      update(line.id, {
                        discount: { kind: kind as OrderDiscount['kind'], value: 0 },
                      })
                    }
                    options={[
                      { id: 'percent', label: '%' },
                      { id: 'amount', label: currency },
                    ]}
                    isDisabled={blocked}
                  />
                  {line.discount.kind === 'percent' ? (
                    <Field
                      label={`Fatura indirimi (%) · satır ${index + 1}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={String(line.discount.value / 100)}
                      onChange={(value) =>
                        update(line.id, {
                          discount: { kind: 'percent', value: Math.round(Number(value) * 100) },
                        })
                      }
                      isDisabled={blocked}
                    />
                  ) : (
                    <MoneyField
                      label={`Fatura indirim tutarı · satır ${index + 1}`}
                      initialValue={line.discount.value}
                      onChange={(value) => update(line.id, { discount: { kind: 'amount', value } })}
                      isDisabled={blocked}
                    />
                  )}
                </div>
                <SelectButton
                  label={`Fatura KDV oranı · satır ${index + 1}`}
                  value={String(line.taxRate)}
                  onChange={(value) => update(line.id, { taxRate: Number(value) })}
                  options={[...new Set([0, 1, 10, 20, line.taxRate])].map((value) => ({
                    id: String(value),
                    label: `%${value}`,
                  }))}
                  isDisabled={blocked}
                />
                <strong className="money-cell">
                  {Number.isSafeInteger(nativeAmount(line))
                    ? currencyMoney(nativeAmount(line), currency)
                    : '—'}
                </strong>
                <Button
                  variant="ghost"
                  isIconOnly
                  size="sm"
                  aria-label={`${index + 1}. fatura satırını kaldır`}
                  onPress={() =>
                    setLines((current) => current.filter((item) => item.id !== line.id))
                  }
                  isDisabled={blocked}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            isDisabled={blocked || lines.length >= 200}
            onPress={() =>
              setLines((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  variantId: '',
                  title: '',
                  unit: 'Adet',
                  quantity: '1',
                  price: 0,
                  taxRate: 20,
                  discount: { kind: 'percent', value: 0 },
                },
              ])
            }
          >
            Satır ekle
          </Button>
          <div className="order-summary-totals">
            <div>
              <span>Ara toplam</span>
              <strong>
                {Number.isSafeInteger(total - tax) ? currencyMoney(total - tax, currency) : '—'}
              </strong>
            </div>
            <div>
              <span>KDV</span>
              <strong>{Number.isSafeInteger(tax) ? currencyMoney(tax, currency) : '—'}</strong>
            </div>
            <div className="is-total">
              <span>Genel toplam</span>
              <strong>{Number.isSafeInteger(total) ? currencyMoney(total, currency) : '—'}</strong>
            </div>
            {currency !== 'TRY' && (
              <div>
                <span>TRY karşılığı</span>
                <strong>{Number.isSafeInteger(tryTotal) ? money(tryTotal) : '—'}</strong>
              </div>
            )}
          </div>
        </Panel>
        <Panel className="order-form-card" title="Ödeme durumu">
          <Checkbox
            className="app-checkbox"
            isSelected={paid}
            onChange={setPaid}
            isDisabled={blocked}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Faturayı ödendi olarak kaydet</Label>
            </Checkbox.Content>
          </Checkbox>
          {paid && (
            <div className="form-grid">
              <SelectButton
                label="Fatura ödeme yöntemi"
                value={method}
                onChange={setMethod}
                options={methods}
                isDisabled={blocked}
              />
              <label className="order-date-field">
                <span className="label">Ödeme tarihi / saati</span>
                <input
                  className="input input--secondary"
                  type="datetime-local"
                  value={paymentAt}
                  onChange={(event) => setPaymentAt(event.target.value)}
                  disabled={blocked}
                />
              </label>
            </div>
          )}
        </Panel>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="order-create-footer">
          <Link className="button button--secondary" to="/finance/invoices">
            Vazgeç
          </Link>
          <Button
            type="submit"
            variant="primary"
            isDisabled={
              blocked ||
              !customerId ||
              !lines.length ||
              !Number.isSafeInteger(total) ||
              total <= 0 ||
              !currentRate
            }
          >
            {busy
              ? 'Kaydediliyor…'
              : invoice
                ? 'Faturayı kaydet'
                : paid
                  ? 'Faturayı oluştur ve ödendi işaretle'
                  : 'Faturayı oluştur'}
          </Button>
        </div>
      </form>
      {newCustomer && (
        <CustomerEditor
          customer={newCustomer}
          onClose={() => setNewCustomer(null)}
          onSaved={(customer) => {
            chooseCustomer(customer.id, customer)
            setNewCustomer(null)
          }}
        />
      )}
    </div>
  )
}

export function InvoiceDetailPage() {
  const { id } = useParams(),
    { state, run, can } = useApp(),
    navigate = useNavigate(),
    invoice = state.invoices.find((invoice) => invoice.id === id),
    [provider, setProvider] = useState(false),
    [dialog, setDialog] = useState<'pay' | 'unpay' | 'cancel' | 'restore' | 'delete' | null>(null),
    [method, setMethod] = useState('transfer'),
    [warehouse, setWarehouse] = useState('main'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [paymentAt, setPaymentAt] = useState(paymentDateInput)
  if (!invoice)
    return (
      <Panel title="Fatura bulunamadı">
        <Link to="/finance/invoices">Faturalara dön</Link>
      </Panel>
    )
  const source = invoiceSource(state, invoice),
    payment = invoicePayment(state, invoice)
  if (!source)
    return (
      <Panel title="Faturanın kalem kaynağı bulunamadı">
        <Link to="/finance/invoices">Faturalara dön</Link>
      </Panel>
    )
  const locked =
    !!invoice.externalId ||
    ['issued', 'queued', 'processing'].includes(invoice.status) ||
    !!invoice.uncertainJobId
  const action = async () => {
    if (!dialog) return
    if (dialog === 'pay' && !Number.isFinite(Date.parse(`${paymentAt}:00+03:00`))) {
      setError('Ödeme tarihini ve saatini tamamlayın.')
      return
    }
    setBusy(true)
    setError('')
    const result = await run(
      dialog === 'pay'
        ? {
            type: 'invoice.pay',
            id: invoice.id,
            expectedTotal: invoiceAmountDue(state, invoice),
            expectedPaymentId: invoice.paymentCashId,
            payment: {
              method: method as 'cash' | 'card' | 'transfer' | 'marketplace',
              warehouseId: warehouse,
              at: paymentTimestamp(paymentAt),
            },
          }
        : dialog === 'unpay'
          ? { type: 'invoice.unpay', id: invoice.id, expectedPaymentId: payment.cash?.id ?? '' }
          : { type: `invoice.${dialog}`, id: invoice.id, expectedVersion: invoice.version ?? 0 },
    )
    setBusy(false)
    if (result.ok) {
      if (dialog === 'delete') navigate('/finance/invoices')
      setDialog(null)
    } else setError(result.message)
  }
  return (
    <div className="order-workspace">
      <PageHeader
        title={`Fatura ${invoice.number}`}
        description={`${state.customers.find((customer) => customer.id === source.customerId)?.name ?? ''} · ${invoice.orderId ? 'Sipariş kaynaklı' : 'Bağımsız fatura'}`}
        actions={
          <Link className="button button--secondary" to="/finance/invoices">
            <ArrowLeft size={15} />
            Listeye dön
          </Link>
        }
      />
      <div className="order-detail-summary">
        <Chip variant="soft" color={payment.paid ? 'success' : 'warning'}>
          {invoice.status === 'cancelled' ? 'İptal' : payment.paid ? 'Ödendi' : 'Ödeme bekliyor'}
        </Chip>
        <span>{invoiceDocumentLabel(invoice) ?? invoiceStatusLabels[invoice.status]}</span>
        <strong>{currencyMoney(orderCurrencyTotal(source), source.currency)}</strong>
      </div>
      <div className="order-status-actions">
        {!invoice.orderId &&
          !locked &&
          !payment.paid &&
          invoice.status !== 'cancelled' &&
          can('finance.write') && (
            <Link className="button button--secondary" to={`/finance/invoices/${invoice.id}/edit`}>
              Faturayı düzenle
            </Link>
          )}
        {can('finance.write') && (
          <>
            <Button
              variant="secondary"
              isDisabled={invoice.status === 'cancelled' || busy}
              onPress={() => setDialog(payment.paid ? 'unpay' : 'pay')}
            >
              {payment.paid ? 'Ödemeyi geri al' : 'Ödendi işaretle'}
            </Button>
            {!invoice.orderId &&
              (!locked ||
                (invoice.manualDocument && !invoice.externalId && !invoice.uncertainJobId)) &&
              !payment.paid && (
                <>
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => setDialog(invoice.status === 'cancelled' ? 'restore' : 'cancel')}
                  >
                    {invoice.status === 'cancelled' ? 'Geri al' : 'Yerel faturayı iptal et'}
                  </Button>
                  {!invoice.manualDocument && (
                    <Button variant="danger" isDisabled={busy} onPress={() => setDialog('delete')}>
                      Sil
                    </Button>
                  )}
                </>
              )}
          </>
        )}
        <Button variant="secondary" onPress={() => setProvider(true)}>
          Resmileştirme / Paraşüt
        </Button>
        {invoice.orderId && (
          <Link className="button button--secondary" to={`/orders/${invoice.orderId}`}>
            Siparişe git
          </Link>
        )}
      </div>
      <InvoiceManualDocument invoice={invoice} />
      <InvoiceCategoryAssignment key={invoice.id} invoice={invoice} />
      <Panel className="order-form-card" title="Fatura bilgileri">
        <dl className="detail-list">
          <div>
            <dt>Açıklama</dt>
            <dd>{invoice.title || '—'}</dd>
          </div>
          <div>
            <dt>Düzenleme / vade</dt>
            <dd>
              {invoice.issueDate ?? dayKey(invoice.createdAt)} · {invoice.dueDate ?? 'Vade yok'}
            </dd>
          </div>
          <div>
            <dt>Notlar</dt>
            <dd>{invoice.note || '—'}</dd>
          </div>
          <div>
            <dt>Etiketler</dt>
            <dd>{invoice.tags?.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>Tahsilat</dt>
            <dd>
              {payment.cash
                ? `${money(payment.cash.amount)} · ${dateLabel(payment.cash.createdAt, true)}`
                : 'Henüz yok'}
            </dd>
          </div>
        </dl>
        <DataTable
          label="Fatura kalemleri"
          items={source.lines.map((line, index) => ({ ...line, id: line.id ?? String(index) }))}
          columns={[
            {
              id: 'title',
              label: 'Ürün / hizmet',
              rowHeader: true,
              cell: (line) => (
                <div>
                  <strong>{line.invoiceTitle || line.title}</strong>
                  <small className="cell-secondary">
                    {line.sku || line.externalSku} ·{' '}
                    {line.kind === 'free' ? 'Serbest satır' : 'Katalog ürünü'}
                  </small>
                </div>
              ),
            },
            {
              id: 'quantity',
              label: 'Miktar',
              cell: (line) => `${line.quantity} ${line.unit ?? 'Adet'}`,
            },
            {
              id: 'price',
              label: 'Birim fiyat (KDV dahil)',
              cell: (line) => currencyMoney(orderLineCurrencyPrice(source, line), source.currency),
            },
            { id: 'tax', label: 'KDV', cell: (line) => `%${line.taxRate}` },
            {
              id: 'total',
              label: 'Toplam',
              cell: (line) => currencyMoney(orderLineCurrencyTotal(source, line), source.currency),
            },
          ]}
          paginate={false}
        />
        <div className="order-summary-totals">
          <div>
            <span>Kargo</span>
            <strong>{currencyMoney(orderCurrencyShipping(source), source.currency)}</strong>
          </div>
          <div className="is-total">
            <span>Genel toplam</span>
            <strong>{currencyMoney(orderCurrencyTotal(source), source.currency)}</strong>
          </div>
          {source.currency !== 'TRY' && source.currency && (
            <div>
              <span>TRY karşılığı · kayıtlı kur</span>
              <strong>
                {money(invoiceTryTotal(state, invoice))} ·{' '}
                {(Number(source.currencyRate?.value) / 100000000).toLocaleString('tr-TR')}
              </strong>
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Fatura geçmişi" className="order-form-card">
        <div className="activity-timeline">
          {[...(invoice.events ?? [])].reverse().map((event) => (
            <div className="timeline-item" key={event.id}>
              <span className="timeline-dot" />
              <div>
                <strong>{event.label}</strong>
                <span>{dateLabel(event.at, true)}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      {provider && (
        <InvoiceManager key={invoice.id} invoice={invoice} onClose={() => setProvider(false)} />
      )}
      {dialog && (
        <Dialog
          open
          title={
            {
              pay: 'Ödendi işaretle',
              unpay: 'Ödemeyi geri al',
              cancel: 'Yerel fatura iptali',
              restore: 'Faturayı geri al',
              delete: 'Faturayı sil',
            }[dialog]
          }
          onClose={() => {
            if (!busy) setDialog(null)
          }}
          footer={
            <>
              <Button variant="secondary" isDisabled={busy} onPress={() => setDialog(null)}>
                Vazgeç
              </Button>
              <Button
                variant={dialog === 'delete' ? 'danger' : 'primary'}
                isDisabled={busy}
                onPress={() => void action()}
              >
                Onayla
              </Button>
            </>
          }
        >
          {dialog === 'pay' ? (
            <div className="form-grid">
              <SelectButton
                label="Tahsilat yöntemi"
                value={method}
                onChange={setMethod}
                options={methods}
              />
              <SelectButton
                label="Tahsilat deposu"
                value={warehouse}
                onChange={setWarehouse}
                options={warehouses(state)
                  .filter((warehouse) => warehouse.active)
                  .map((warehouse) => ({ id: warehouse.id, label: warehouse.name }))}
              />
              <label className="order-date-field">
                <span className="label">Tahsilat tarihi / saati</span>
                <input
                  className="input input--secondary"
                  type="datetime-local"
                  value={paymentAt}
                  onChange={(event) => setPaymentAt(event.target.value)}
                />
              </label>
              <p>
                {money(invoiceAmountDue(state, invoice))} kalan tahsilat kasaya giriş yazılacak.
              </p>
            </div>
          ) : (
            <p>
              {dialog === 'unpay'
                ? 'Bu faturanın bağlı kasa tahsilatı geri alınır; belge yeniden ödeme bekler.'
                : dialog === 'restore'
                  ? 'Fatura yeniden açılır; kayıtlı ürünlerin stok çıkışı uygulanır.'
                  : dialog === 'delete'
                    ? 'Belge kalıcı silinir; uygulanmış stok çıkışı geri yazılır. Bu işlem geri alınamaz.'
                    : 'Yalnız yerel belge iptal edilir; stok çıkışı geri yazılır. Resmî belge veya Paraşüt iptali bu işlem değildir.'}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  )
}
