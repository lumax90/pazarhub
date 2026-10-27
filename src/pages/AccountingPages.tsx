import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { ArrowRightLeft, Check, Plus, Wallet } from 'lucide-react'
import { useApp } from '../app/AppProvider'
import { customerBalance, findVariant } from '../domain/selectors'
import { MAIN_WAREHOUSE, warehouses } from '../domain/inventory'
import { paymentLabels } from '../domain/labels'
import type { CommerceCommand } from '../domain/types'
import { dateLabel, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import {
  Dialog,
  Field,
  MoneyField,
  PageHeader,
  Panel,
  SearchBox,
  SelectButton,
} from '../components/ui/shared'

const methods = [
  { id: 'cash', label: 'Nakit' },
  { id: 'card', label: 'Kart' },
  { id: 'transfer', label: 'Havale / EFT' },
]
export function CashEntryButton() {
  const { can } = useApp()
  const [open, setOpen] = useState<'cash' | 'transfer' | null>(null)
  return (
    <>
      <Button
        variant="secondary"
        isDisabled={!can('finance.write')}
        onPress={() => setOpen('transfer')}
      >
        <ArrowRightLeft size={15} />
        Virman
      </Button>
      <Button variant="primary" isDisabled={!can('finance.write')} onPress={() => setOpen('cash')}>
        <Plus size={15} />
        Kasa kaydı
      </Button>
      {open && <EntryEditor mode={open} onClose={() => setOpen(null)} />}
    </>
  )
}
export function ExpensesPage() {
  const { state, run, can } = useApp()
  const [params, setParams] = useSearchParams()
  const open =
    params.get('new') === 'purchase'
      ? 'purchase'
      : params.get('new') === 'expense'
        ? 'expense'
        : null
  const setOpen = (value: 'expense' | 'purchase' | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set('new', value)
    else next.delete('new')
    setParams(next, { replace: true })
  }
  return (
    <>
      <PageHeader
        title="Giderler ve Alışlar"
        description="Gider belgesi, ödeme ve ürün alışını ortak defterlerde takip edin."
        actions={
          <>
            <Button
              variant="secondary"
              isDisabled={!can('finance.write') || !can('stock.write')}
              onPress={() => setOpen('purchase')}
            >
              Yeni ürün alışı
            </Button>
            <Button
              variant="primary"
              isDisabled={!can('finance.write')}
              onPress={() => setOpen('expense')}
            >
              <Plus size={16} />
              Gider ekle
            </Button>
          </>
        }
      />
      <Panel flush className="list-panel">
        <DataTable
          label="Gider belgeleri"
          items={state.expenses ?? []}
          columns={[
            {
              id: 'supplier',
              label: 'Tedarikçi / açıklama',
              rowHeader: true,
              cell: (e) => (
                <div>
                  <strong>{e.supplier}</strong>
                  <small className="cell-secondary">{e.description}</small>
                </div>
              ),
            },
            { id: 'number', label: 'Belge no', cell: (e) => e.number },
            { id: 'category', label: 'Kategori', cell: (e) => e.category },
            { id: 'due', label: 'Vade', cell: (e) => dateLabel(e.dueAt) },
            {
              id: 'paid',
              label: 'Ödeme',
              cell: (e) => (
                <Chip variant="soft" size="sm" color={e.paid ? 'success' : 'warning'}>
                  {e.paid ? 'Ödendi' : 'Bekliyor'}
                </Chip>
              ),
            },
            {
              id: 'amount',
              label: 'Tutar',
              className: 'align-right',
              cell: (e) => money(e.amount),
            },
            {
              id: 'actions',
              label: '',
              cell: (e) =>
                !e.paid &&
                can('finance.write') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => void run({ type: 'expense.pay', id: e.id })}
                  >
                    <Check size={13} />
                    Ödeme kaydet
                  </Button>
                ),
            },
          ]}
        />
      </Panel>
      {open && can('finance.write') && (open !== 'purchase' || can('stock.write')) && (
        <ExpenseEditor purchase={open === 'purchase'} onClose={() => setOpen(null)} />
      )}
    </>
  )
}
export function CustomerAccountsPage() {
  const { state, can } = useApp()
  const [query, setQuery] = useState(''),
    [open, setOpen] = useState<'entry' | 'cash' | null>(null)
  return (
    <>
      <PageHeader
        title="Cari Hesaplar"
        description="Satış, tahsilat, iade ve cari fişlerden oluşan müşteri bakiyeleri."
        actions={
          <>
            <Button
              variant="secondary"
              isDisabled={!can('finance.write')}
              onPress={() => setOpen('cash')}
            >
              <Wallet size={15} />
              Tahsilat / ödeme
            </Button>
            <Button
              variant="primary"
              isDisabled={!can('finance.write')}
              onPress={() => setOpen('entry')}
            >
              <Plus size={15} />
              Cari fiş
            </Button>
          </>
        }
      />
      <Panel flush className="list-panel">
        <div className="list-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            label="Cari hesaplarda ara"
            placeholder="Müşteri veya şirket…"
          />
        </div>
        <DataTable
          label="Müşteri cari bakiyeleri"
          items={state.customers.filter((c) =>
            `${c.name} ${c.company ?? ''}`
              .toLocaleLowerCase('tr-TR')
              .includes(query.toLocaleLowerCase('tr-TR')),
          )}
          columns={[
            {
              id: 'name',
              label: 'Müşteri',
              rowHeader: true,
              cell: (c) => <strong>{c.name}</strong>,
            },
            { id: 'company', label: 'Şirket', cell: (c) => c.company || '—' },
            {
              id: 'balance',
              label: 'Bakiye',
              className: 'align-right',
              cell: (c) => (
                <strong className="money-cell">
                  {money(Math.abs(customerBalance(state, c.id)))}
                </strong>
              ),
            },
            {
              id: 'type',
              label: 'Durum',
              cell: (c) => {
                const balance = customerBalance(state, c.id)
                return (
                  <Chip
                    size="sm"
                    variant="soft"
                    color={balance > 0 ? 'warning' : balance < 0 ? 'accent' : 'success'}
                  >
                    {balance > 0
                      ? 'Müşteriden alacak'
                      : balance < 0
                        ? 'Müşteriye borç'
                        : 'Hesap kapalı'}
                  </Chip>
                )
              },
            },
          ]}
        />
      </Panel>
      <Panel flush title="Cari fişler" className="accounting-secondary">
        <DataTable
          label="Manuel cari fişler"
          items={state.customerEntries ?? []}
          columns={[
            {
              id: 'customer',
              label: 'Müşteri',
              rowHeader: true,
              cell: (e) => state.customers.find((c) => c.id === e.customerId)?.name,
            },
            { id: 'description', label: 'Açıklama', cell: (e) => e.description },
            {
              id: 'type',
              label: 'Tür',
              cell: (e) => (e.kind === 'debit' ? 'Borçlandırma' : 'Alacaklandırma'),
            },
            {
              id: 'amount',
              label: 'Tutar',
              className: 'align-right',
              cell: (e) => money(e.amount),
            },
            { id: 'date', label: 'Tarih', cell: (e) => dateLabel(e.createdAt, true) },
          ]}
        />
      </Panel>
      {open && <EntryEditor mode={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function EntryEditor({
  mode,
  onClose,
}: {
  mode: 'entry' | 'cash' | 'transfer'
  onClose: () => void
}) {
  const { state, run } = useApp()
  const [id] = useState(() => crypto.randomUUID())
  const [customerId, setCustomerId] = useState(''),
    [amount, setAmount] = useState(0),
    [description, setDescription] = useState(''),
    [kind, setKind] = useState('in'),
    [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash'),
    [to, setTo] = useState<'cash' | 'card' | 'transfer'>('transfer'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const save = async () => {
    if (busy) return
    setBusy(true)
    const command: CommerceCommand =
      mode === 'entry'
        ? {
            type: 'customer.entry',
            id,
            customerId,
            amount,
            description,
            kind: kind === 'in' ? 'debit' : 'credit',
          }
        : mode === 'transfer'
          ? { type: 'cash.transfer', id, amount, description, from: method, to }
          : {
              type: 'cash.record',
              id,
              amount,
              description,
              kind: kind as 'in' | 'out',
              method,
              customerId: customerId || undefined,
            }
    const result = await run(command)
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      title={
        mode === 'entry'
          ? 'Yeni cari fiş'
          : mode === 'transfer'
            ? 'Hesaplar arası virman'
            : 'Yeni kasa hareketi'
      }
      description={
        mode === 'entry'
          ? 'Cari fiş müşteri bakiyesini değiştirir.'
          : 'Tutarlar kayıtlı hesap bakiyelerine işlenir.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" isDisabled={busy} onPress={() => void save()}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <div className="form-section">
        {mode !== 'transfer' && (
          <>
            <SelectButton
              label="Müşteri hesabı"
              value={customerId}
              onChange={setCustomerId}
              options={[
                ...(mode === 'cash' ? [{ id: '', label: 'Müşteriyle ilişkilendirme' }] : []),
                ...state.customers.map((c) => ({ id: c.id, label: c.name })),
              ]}
            />
            <SelectButton
              label="İşlem yönü"
              value={kind}
              onChange={setKind}
              options={
                mode === 'entry'
                  ? [
                      { id: 'in', label: 'Müşteriyi borçlandır' },
                      { id: 'out', label: 'Müşteriyi alacaklandır' },
                    ]
                  : [
                      { id: 'in', label: 'Kasa girişi / tahsilat' },
                      { id: 'out', label: 'Kasa çıkışı / ödeme' },
                    ]
              }
            />
          </>
        )}
        <MoneyField label="Tutar (₺)" initialValue={amount} onChange={setAmount} />
        {mode !== 'entry' && (
          <SelectButton
            label={mode === 'transfer' ? 'Kaynak hesap' : 'Ödeme yöntemi'}
            value={method}
            onChange={(value) => setMethod(value as typeof method)}
            options={methods}
          />
        )}{' '}
        {mode === 'transfer' && (
          <SelectButton
            label="Hedef hesap"
            value={to}
            onChange={(value) => setTo(value as typeof to)}
            options={methods.filter((m) => m.id !== method)}
          />
        )}
        <Field label="Açıklama" value={description} onChange={setDescription} required />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

function ExpenseEditor({ purchase, onClose }: { purchase: boolean; onClose: () => void }) {
  const { state, run } = useApp()
  const [id] = useState(() => crypto.randomUUID())
  const [supplier, setSupplier] = useState(''),
    [number, setNumber] = useState(''),
    [description, setDescription] = useState(''),
    [category, setCategory] = useState(purchase ? 'Ürün alışı' : 'İşletme gideri'),
    [amount, setAmount] = useState(0),
    [paid, setPaid] = useState(false),
    [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('transfer'),
    [warehouseId, setWarehouseId] = useState(MAIN_WAREHOUSE),
    [variantId, setVariantId] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [cost, setCost] = useState(0),
    [items, setItems] = useState<{ variantId: string; quantity: number; unitCost: number }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const total = purchase
    ? items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
    : amount
  const save = async () => {
    if (busy) return
    setBusy(true)
    const result = await run({
      type: 'expense.create',
      warehouseId,
      expense: {
        id,
        number: number || `GD-${String((state.expenses?.length ?? 0) + 1).padStart(6, '0')}`,
        supplier,
        description,
        category,
        amount: total,
        paid,
        method,
        dueAt: new Date().toISOString(),
        ...(purchase ? { purchaseLines: items } : {}),
      },
    })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      wide
      title={purchase ? 'Yeni ürün alışı' : 'Yeni gider belgesi'}
      onClose={onClose}
      footer={
        <>
          <strong className="money-cell">{money(total)}</strong>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" isDisabled={busy} onPress={() => void save()}>
            {busy ? 'Kaydediliyor…' : 'Belgeyi kaydet'}
          </Button>
        </>
      }
    >
      <div className="form-section">
        <div className="form-grid">
          <Field label="Tedarikçi / firma" value={supplier} onChange={setSupplier} required />
          <Field label="Belge numarası" value={number} onChange={setNumber} />
          <Field label="Kategori" value={category} onChange={setCategory} />
          <Field label="Açıklama" value={description} onChange={setDescription} required />
        </div>
        {purchase ? (
          <>
            <SelectButton
              label="Stok giriş deposu"
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouses(state)
                .filter((w) => w.active)
                .map((w) => ({ id: w.id, label: w.name }))}
            />
            <SelectButton
              label="Alınan ürün"
              value={variantId}
              onChange={setVariantId}
              options={state.products
                .filter((p) => !p.bundle)
                .flatMap((p) =>
                  p.variants.map((v) => ({ id: v.id, label: `${p.name} · ${v.sku}` })),
                )}
            />
            <div className="form-grid">
              <Field label="Alış miktarı" type="number" value={quantity} onChange={setQuantity} />
              <MoneyField
                label="Birim alış maliyeti (KDV dahil ₺)"
                initialValue={cost}
                onChange={setCost}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => {
                if (
                  variantId &&
                  Number(quantity) > 0 &&
                  Number.isInteger(Number(quantity)) &&
                  cost > 0
                ) {
                  setItems((current) => [
                    ...current,
                    { variantId, quantity: Number(quantity), unitCost: cost },
                  ])
                  setVariantId('')
                }
              }}
            >
              Kalemi ekle
            </Button>
            <div className="purchase-lines">
              {items.map((item, index) => (
                <div key={index}>
                  <span>
                    {findVariant(state, item.variantId)?.product.name} · {item.quantity} adet
                  </span>
                  <strong>{money(item.quantity * item.unitCost)}</strong>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => setItems((current) => current.filter((_, i) => i !== index))}
                  >
                    Kaldır
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <MoneyField label="Gider toplamı (₺)" initialValue={amount} onChange={setAmount} />
        )}
        <Checkbox className="app-checkbox" isSelected={paid} onChange={setPaid}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Ödendi · kasa çıkışı oluştur</Label>
          </Checkbox.Content>
        </Checkbox>
        <SelectButton
          label="Ödeme hesabı"
          value={method}
          onChange={(value) => setMethod(value as typeof method)}
          options={methods}
        />
        <p className="description field-description">
          {purchase
            ? 'Stok girişi yapılır; alış maliyeti ağırlıklı ortalamayla güncellenir.'
            : `Ödeme yöntemi: ${paymentLabels[method]}`}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
