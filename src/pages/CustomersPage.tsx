import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@heroui/react'
import { Link, useSearchParams } from 'react-router'
import { ChevronRight, Download, Plus, Users } from 'lucide-react'
import { useApp } from '../app/AppProvider'
import type { Customer } from '../domain/types'
import { orderTotal } from '../domain/selectors'
import { downloadCsv, initials, matches, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import { Dialog, Field, PageHeader, Panel, SearchBox, SectionTitle } from '../components/ui/shared'

export function CustomersPage() {
  const { state } = useApp()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Customer | null>(null)
  const [params, setParams] = useSearchParams()
  const currentCustomer =
    editing ?? state.customers.find((customer) => customer.id === params.get('customer'))
  const closeCustomer = () => {
    setEditing(null)
    if (params.has('customer')) {
      const next = new URLSearchParams(params)
      next.delete('customer')
      setParams(next, { replace: true })
    }
  }
  const filtered = state.customers.filter((customer) =>
    matches(`${customer.name} ${customer.email} ${customer.city}`, query),
  )
  const ordersFor = (id: string) =>
    state.orders.filter(
      (order) => order.customerId === id && !['cancelled', 'returned'].includes(order.status),
    )
  const columns: Column<Customer>[] = [
    {
      id: 'name',
      label: 'Müşteri',
      rowHeader: true,
      sortValue: (customer) => customer.name,
      cell: (customer) => (
        <button
          className="button button--md button--ghost customer-cell customer-cell-button"
          onClick={() => setEditing(customer)}
        >
          <span className="customer-avatar">{initials(customer.name)}</span>
          <span>
            <strong>{customer.name}</strong>
            <span className="cell-secondary">{customer.company ?? 'Bireysel müşteri'}</span>
          </span>
        </button>
      ),
    },
    {
      id: 'email',
      label: 'E-posta',
      cell: (customer) => <span className="muted-cell">{customer.email || '—'}</span>,
    },
    {
      id: 'phone',
      label: 'Telefon',
      cell: (customer) => <span className="muted-cell">{customer.phone || '—'}</span>,
    },
    {
      id: 'city',
      label: 'Şehir',
      sortValue: (customer) => customer.city,
      cell: (customer) => customer.city || '—',
    },
    {
      id: 'orders',
      label: 'Sipariş',
      className: 'align-right',
      sortValue: (customer) => ordersFor(customer.id).length,
      cell: (customer) => ordersFor(customer.id).length,
    },
    {
      id: 'total',
      label: 'Toplam alışveriş',
      className: 'align-right',
      sortValue: (customer) =>
        ordersFor(customer.id).reduce((sum, order) => sum + orderTotal(order), 0),
      cell: (customer) => (
        <strong className="money-cell">
          {money(ordersFor(customer.id).reduce((sum, order) => sum + orderTotal(order), 0))}
        </strong>
      ),
    },
    {
      id: 'action',
      label: '',
      cell: (customer) => (
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={`${customer.name} düzenle`}
          onPress={() => setEditing(customer)}
        >
          <ChevronRight size={16} />
        </Button>
      ),
    },
  ]
  return (
    <>
      <PageHeader
        title="Müşteriler"
        description="Sipariş, perakende ve tahsilatın ortak müşteri kayıtları."
        actions={
          <>
            <Button
              variant="secondary"
              onPress={() =>
                downloadCsv(
                  'musteriler.csv',
                  ['Ad', 'E-posta', 'Telefon', 'Şehir'],
                  filtered.map((customer) => [
                    customer.name,
                    customer.email,
                    customer.phone,
                    customer.city,
                  ]),
                )
              }
            >
              <Download size={16} />
              Dışa aktar
            </Button>
            <Button
              variant="primary"
              onPress={() =>
                setEditing({
                  id: crypto.randomUUID(),
                  name: '',
                  email: '',
                  phone: '',
                  city: '',
                  address: '',
                })
              }
            >
              <Plus size={17} />
              Yeni müşteri
            </Button>
          </>
        }
      />
      <div className="summary-pills">
        <span>
          <Users size={16} />
          <strong>{state.customers.length}</strong> müşteri
        </span>
        <span>
          <strong>{new Set(state.customers.map((customer) => customer.city)).size}</strong> şehir
        </span>
      </div>
      <Panel flush className="list-panel">
        <div className="list-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Müşteri, e-posta veya şehir ara..."
            label="Müşterilerde ara"
          />
          <span className="record-count">{filtered.length} müşteri</span>
        </div>
        <DataTable items={filtered} columns={columns} label="Müşteri listesi" />
      </Panel>
      {currentCustomer && (
        <CustomerEditor
          key={currentCustomer.id}
          customer={currentCustomer}
          onClose={closeCustomer}
        />
      )}
    </>
  )
}

export function CustomerEditor({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer
  onClose: () => void
  onSaved?: (customer: Customer) => void
}) {
  const { run, state, can } = useApp()
  const [draft, setDraft] = useState({ ...customer })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isNew = !state.customers.some((item) => item.id === customer.id)
  const field = (key: keyof Customer, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !can('orders.write')) return
    setBusy(true)
    const result = await run({ type: 'customer.save', customer: draft })
    setBusy(false)
    if (result.ok) {
      onSaved?.(draft)
      onClose()
    } else setError(result.message)
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title={isNew ? 'Yeni müşteri' : customer.name}
      description="Tek müşteri kartı, tüm çalışma alanlarında aynı bilgiler."
      footer={
        <>
          {!isNew && can('orders.write') && (
            <Link
              to={`/orders/new?customer=${encodeURIComponent(customer.id)}`}
              className="button button--secondary"
              onClick={onClose}
            >
              Hızlı sipariş oluştur
            </Link>
          )}
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="customer-form"
            isDisabled={busy || !can('orders.write')}
          >
            Müşteriyi kaydet
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={save}>
        <SectionTitle title="İletişim bilgileri">
          <div className="form-grid">
            <Field
              label="Ad soyad"
              required
              value={draft.name}
              onChange={(value) => field('name', value)}
              className="span-2"
            />
            <Field
              label="E-posta"
              type="email"
              value={draft.email}
              onChange={(value) => field('email', value)}
            />
            <Field
              label="Telefon"
              type="tel"
              value={draft.phone}
              onChange={(value) => field('phone', value)}
            />
            <Field
              label="Firma (isteğe bağlı)"
              value={draft.company ?? ''}
              onChange={(value) => field('company', value)}
            />
            <Field label="Şehir" value={draft.city} onChange={(value) => field('city', value)} />
            <Field
              label="İlçe"
              value={draft.district ?? ''}
              onChange={(value) => field('district', value)}
            />
            <Field
              label="VKN / TCKN"
              value={draft.taxId ?? ''}
              onChange={(value) => field('taxId', value)}
            />
            <Field
              label="Vergi dairesi"
              value={draft.taxOffice ?? ''}
              onChange={(value) => field('taxOffice', value)}
            />
            <Field
              label="Adres"
              value={draft.address}
              onChange={(value) => field('address', value)}
              className="span-2"
            />
          </div>
        </SectionTitle>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
