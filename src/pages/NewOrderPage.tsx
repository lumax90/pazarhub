import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { ArrowLeft, Check, Package, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type {
  Channel,
  Customer,
  Order,
  OrderAddress,
  OrderDiscount,
  OrderItemInput,
} from '../domain/types'
import type { PublicIntegration } from '../domain/integrations'
import { channelNames } from '../domain/channels'
import { availableStock, findVariant, variantPrice } from '../domain/selectors'
import { orderInputAmounts } from '../domain/orders'
import { orderCurrencies } from '../domain/order-currency'
import {
  currencyMoney,
  exchangeRate,
  fromTry,
  toTry,
  inclusivePrice,
  exclusivePrice,
} from '../domain/money'
import type { CurrencyCode } from '../domain/money'
import { MAIN_WAREHOUSE, warehouses } from '../domain/inventory'
import { salesWarehouseIds } from '../domain/stock-allocation'
import { productUnits } from '../domain/products'
import { money } from '../lib/format'
import { useResource } from '../lib/useResource'
import { Field, MoneyField, PageHeader, Panel, SelectButton } from '../components/ui/shared'
import { SearchSelect } from '../components/ui/SearchSelect'
import { InvoicePreferenceFields } from '../components/orders/InvoicePreferenceFields'
import { CustomerEditor } from './CustomersPage'

interface DraftLine {
  id: string
  kind: 'catalog' | 'free'
  variantId: string
  title: string
  sku: string
  unit: string
  quantity: string
  price: number
  taxRate: number
  discount: OrderDiscount
  bundleVersion?: number
}
const paymentOptions = [
  { id: 'cash', label: 'Nakit' },
  { id: 'card', label: 'Kart' },
  { id: 'transfer', label: 'Havale / EFT' },
  { id: 'marketplace', label: 'Pazaryeri tahsilatı' },
]
const addressFor = (customer?: Customer): OrderAddress => ({
  name: customer?.name ?? '',
  address: customer?.address ?? '',
  city: customer?.city ?? '',
  phone: customer?.phone ?? '',
  district: customer?.district ?? '',
  postalCode: '',
  country: customer?.country ?? 'TR',
})

export function NewOrderPage() {
  const { state, run, can, mode } = useApp(),
    navigate = useNavigate()
  const [params] = useSearchParams()
  const initialCustomer = state.customers.find((customer) => customer.id === params.get('customer'))
  const [customerId, setCustomer] = useState(initialCustomer?.id ?? '')
  const [newCustomer, setNewCustomer] = useState<Customer | null>(null)
  const [channel, setChannel] = useState<Channel>('manual'),
    [sourceNumber, setSourceNumber] = useState('')
  const [paymentMethod, setMethod] = useState('transfer'),
    [paid, setPaid] = useState(false)
  const [warehouseId, setWarehouse] = useState(
    state.ecommerce?.stockScope ? 'workspace' : MAIN_WAREHOUSE,
  )
  const stockWarehouses = warehouseId === 'workspace' ? salesWarehouseIds(state) : [warehouseId]
  const available = (variantId: string) =>
    stockWarehouses.reduce((sum, id) => sum + availableStock(state, variantId, undefined, id), 0)
  const [shippingAddress, setShippingAddress] = useState<OrderAddress>(() =>
    addressFor(initialCustomer),
  )
  const [billingSame, setBillingSame] = useState(true)
  const [billing, setBilling] = useState(() => ({
    ...addressFor(initialCustomer),
    name: initialCustomer?.company || initialCustomer?.name || '',
    taxId: initialCustomer?.taxId ?? '',
    taxOffice: initialCustomer?.taxOffice ?? '',
  }))
  const [preference, setPreference] = useState<NonNullable<Order['invoicePreference']>>('default'),
    [invoiceConnection, setInvoiceConnection] = useState('')
  const [rows, setRows] = useState<DraftLine[]>([])
  const [currency, setCurrency] = useState<CurrencyCode>('TRY')
  const [includesVat, setIncludesVat] = useState(state.ecommerce?.pricesIncludeVat !== false)
  const rate = exchangeRate(state.exchangeRates, currency, state.ecommerce?.exchangeRateType)
  const formatMoney = (amount: number) => currencyMoney(amount, currency)
  const convertTo = (amount: number, from: CurrencyCode, to: CurrencyCode) =>
    fromTry(
      toTry(amount, from, state.exchangeRates, state.ecommerce?.exchangeRateType),
      to,
      state.exchangeRates,
      state.ecommerce?.exchangeRateType,
    )
  const [shipping, setShipping] = useState(0),
    [note, setNote] = useState(''),
    [internalNote, setInternalNote] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const accounts = useResource<{ connections: PublicIntegration[] }>(
    mode === 'live' ? '/api/integration-options?kind=invoice' : null,
  )
  const disabled = busy || !can('orders.write')
  const chooseCustomer = (id: string, known?: Customer) => {
    setCustomer(id)
    const customer = known ?? state.customers.find((customer) => customer.id === id)
    if (customer) {
      setShippingAddress(addressFor(customer))
      setBilling({
        ...addressFor(customer),
        name: customer.company || customer.name,
        taxId: customer.taxId ?? '',
        taxOffice: customer.taxOffice ?? '',
      })
    }
  }
  const update = (id: string, change: Partial<DraftLine>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)))
  const changeCurrency = (value: CurrencyCode) => {
    if (!exchangeRate(state.exchangeRates, value, state.ecommerce?.exchangeRateType) || !rate) {
      setError('Önce E-ticaret Ayarları’ndan TCMB kurlarını alın.')
      return
    }
    setRows((current) =>
      current.map((row) => ({
        ...row,
        price: convertTo(row.price, currency, value),
        discount:
          row.discount.kind === 'amount'
            ? { ...row.discount, value: convertTo(row.discount.value, currency, value) }
            : row.discount,
      })),
    )
    setShipping((current) => convertTo(current, currency, value))
    setCurrency(value)
    setError('')
  }
  const changeVatEntry = (value: boolean) => {
    const convert = (amount: number, taxRate: number) =>
      value ? inclusivePrice(amount, taxRate) : exclusivePrice(amount, taxRate)
    setRows((current) =>
      current.map((row) => ({
        ...row,
        price: convert(row.price, row.taxRate),
        discount:
          row.discount.kind === 'amount'
            ? { ...row.discount, value: convert(row.discount.value, row.taxRate) }
            : row.discount,
      })),
    )
    setIncludesVat(value)
  }
  const addCatalog = (variantId: string) => {
    if (!variantId || disabled || rows.length >= 200) return
    const found = findVariant(state, variantId)
    if (!found) return
    const existing = rows.find((row) => row.kind === 'catalog' && row.variantId === variantId)
    if (existing) update(existing.id, { quantity: String((Number(existing.quantity) || 0) + 1) })
    else
      setRows((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'catalog',
          variantId,
          title: `${found.product.name} · ${found.variant.name}`,
          sku: found.variant.sku,
          unit: found.product.unit ?? 'Adet',
          quantity: '1',
          price: includesVat
            ? convertTo(variantPrice(state, variantId), 'TRY', currency)
            : exclusivePrice(
                convertTo(variantPrice(state, variantId), 'TRY', currency),
                found.product.taxRate,
              ),
          ...(found.product.bundle ? { bundleVersion: found.product.version ?? 0 } : {}),
          taxRate: found.product.taxRate,
          discount: { kind: 'percent', value: 0 },
        },
      ])
  }
  const rowAmount = (row: DraftLine) => {
    try {
      return orderInputAmounts(
        Number(row.quantity),
        row.price,
        row.taxRate,
        row.discount,
        includesVat,
      ).total
    } catch {
      return NaN
    }
  }
  const productTotal = rows.reduce((sum, row) => sum + rowAmount(row), 0)
  const tax = rows.reduce(
    (sum, row) => sum + Math.round((rowAmount(row) * row.taxRate) / (100 + row.taxRate)),
    0,
  )
  const total = productTotal + shipping
  const tryTotal =
    rows.reduce(
      (sum, row) =>
        sum +
        toTry(rowAmount(row), currency, state.exchangeRates, state.ecommerce?.exchangeRateType),
      0,
    ) + toTry(shipping, currency, state.exchangeRates, state.ecommerce?.exchangeRateType)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled) return
    setError('')
    if (
      !customerId ||
      !rows.length ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      !Number.isSafeInteger(tryTotal) ||
      !rate
    ) {
      setError('Müşteri, sipariş satırları ve tutarları kontrol edin.')
      return
    }
    if (rows.some((row) => !row.quantity.trim() || (row.kind === 'free' && !row.title.trim()))) {
      setError('Satır açıklaması ve miktarlarını tamamlayın.')
      return
    }
    const items: OrderItemInput[] = rows.map((row) =>
      row.kind === 'free'
        ? {
            kind: 'free',
            title: row.title,
            unit: row.unit,
            quantity: Number(row.quantity),
            unitPrice: row.price,
            taxRate: row.taxRate,
            discount: row.discount,
          }
        : {
            kind: 'catalog',
            variantId: row.variantId,
            ...(row.bundleVersion !== undefined ? { bundleVersion: row.bundleVersion } : {}),
            quantity: Number(row.quantity),
            unitPrice: row.price,
            taxRate: row.taxRate,
            discount: row.discount,
          },
    )
    setBusy(true)
    const result = await run({
      type: 'order.create',
      input: {
        customerId,
        channel,
        externalNumber: sourceNumber,
        paymentMethod: paymentMethod as NonNullable<Order['paymentMethod']>,
        paid,
        warehouseId: warehouseId === 'workspace' ? undefined : warehouseId,
        items,
        shipping,
        currency,
        expectedExchangeRate: rate,
        expectedTotal: total,
        expectedTryTotal: tryTotal,
        priceInputIncludesVat: includesVat,
        note,
        internalNote,
        shippingAddress,
        billingAddress: billingSame
          ? { ...shippingAddress, taxId: billing.taxId, taxOffice: billing.taxOffice }
          : billing,
        invoicePreference: preference,
        ...(preference === 'immediate' ? { invoiceConnectionId: invoiceConnection } : {}),
      },
    })
    setBusy(false)
    if (result.ok && result.id) navigate(`/orders/${result.id}`, { replace: true })
    else setError(result.message)
  }
  return (
    <div className="order-workspace">
      <PageHeader
        title="Yeni sipariş"
        description="Panelden elle sipariş oluşturun; müşteri, ürün ve gönderim bilgilerini tamamlayın."
        actions={
          <Link to="/orders" className="button button--secondary">
            <ArrowLeft size={15} />
            Listeye dön
          </Link>
        }
      />
      <form id="new-order-form" onSubmit={submit}>
        <div className="order-create-grid">
          <Panel
            className="order-form-card"
            title="Müşteri ve kaynak"
            description="Müşteri seçilince gönderim adresi kartından doldurulur."
          >
            <div className="order-customer-picker">
              <SearchSelect
                label="Müşteri"
                value={customerId}
                onChange={chooseCustomer}
                disabled={disabled}
                placeholder="Ad veya e-posta ile ara…"
                options={state.customers.map((customer) => ({
                  id: customer.id,
                  label: customer.name,
                  description: customer.email || customer.company,
                  search: `${customer.email} ${customer.company ?? ''}`,
                }))}
              />
              <Button
                variant="secondary"
                isDisabled={disabled}
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
            <div className="form-grid">
              <div className="select-field">
                <label className="label">Kaynak</label>
                <SelectButton
                  label="Sipariş kaynağı"
                  value={channel}
                  onChange={(value) => setChannel(value as Channel)}
                  options={Object.entries(channelNames).map(([id, label]) => ({ id, label }))}
                  isDisabled={disabled}
                />
              </div>
              <Field
                label="Kaynak sipariş no"
                value={sourceNumber}
                onChange={setSourceNumber}
                maxLength={200}
                description="Kaynağın verdiği numara, varsa."
                isDisabled={disabled}
              />
              <div className="select-field">
                <label className="label">Ödeme yöntemi</label>
                <SelectButton
                  label="Sipariş ödeme yöntemi"
                  value={paymentMethod}
                  onChange={setMethod}
                  options={paymentOptions}
                  isDisabled={disabled}
                />
              </div>
              <div className="order-paid-choice">
                <Checkbox
                  className="app-checkbox"
                  isSelected={paid}
                  onChange={setPaid}
                  isDisabled={disabled || !can('finance.write')}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Label>Tahsil edildi</Label>
                  </Checkbox.Content>
                </Checkbox>
                <p className="description field-description">
                  Seçilen yöntemle kasa girişi oluşturulur.
                </p>
              </div>
              <div className="select-field">
                <label className="label">Stok deposu</label>
                <SelectButton
                  label="Sipariş deposu"
                  value={warehouseId}
                  onChange={setWarehouse}
                  options={[
                    { id: 'workspace', label: 'Firma e-ticaret depoları' },
                    ...warehouses(state)
                      .filter((w) => w.active)
                      .map((w) => ({ id: w.id, label: w.name })),
                  ]}
                  isDisabled={disabled}
                />
              </div>
              <div className="select-field">
                <label className="label">Para birimi</label>
                <SelectButton
                  label="Sipariş para birimi"
                  value={currency}
                  onChange={(value) => changeCurrency(value as CurrencyCode)}
                  options={orderCurrencies.map((id) => ({
                    id,
                    label: id === 'TRY' ? 'TRY · Türk Lirası' : id,
                  }))}
                  isDisabled={disabled}
                />
                {currency !== 'TRY' && (
                  <p className="description field-description">
                    1 {currency} ={' '}
                    {rate
                      ? (Number(rate) / 100000000).toLocaleString('tr-TR', {
                          maximumFractionDigits: 8,
                        })
                      : '—'}{' '}
                    TRY · TCMB {state.exchangeRates?.date}
                  </p>
                )}
              </div>
            </div>
          </Panel>
          <Panel
            className="order-form-card"
            title="Gönderim adresi"
            description="Alıcı ve teslimat bilgileri."
          >
            <OrderAddressFields
              value={shippingAddress}
              onChange={setShippingAddress}
              disabled={disabled}
            />
            <div className="order-billing-choice">
              <Checkbox
                className="app-checkbox"
                isSelected={billingSame}
                onChange={setBillingSame}
                isDisabled={disabled}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>Fatura adresi gönderim adresiyle aynı</Label>
                </Checkbox.Content>
              </Checkbox>
            </div>
            {!billingSame && (
              <div className="order-separate-billing">
                <h3>Fatura adresi</h3>
                <OrderAddressFields
                  value={billing}
                  onChange={(address) => setBilling((current) => ({ ...current, ...address }))}
                  disabled={disabled}
                  prefix="Fatura "
                />
              </div>
            )}
            <div className="form-grid">
              <Field
                label="VKN / TCKN"
                value={billing.taxId}
                onChange={(taxId) => setBilling((current) => ({ ...current, taxId }))}
                maxLength={11}
                isDisabled={disabled}
              />
              <Field
                label="Vergi dairesi"
                value={billing.taxOffice}
                onChange={(taxOffice) => setBilling((current) => ({ ...current, taxOffice }))}
                maxLength={200}
                isDisabled={disabled}
              />
            </div>
          </Panel>
        </div>
        <Panel
          className="order-form-card"
          title="Fatura"
          description="Sipariş kaydı ile resmî belge işlemini bu tercihle yönetin."
        >
          <InvoicePreferenceFields
            value={preference}
            onChange={setPreference}
            connectionId={invoiceConnection}
            onConnectionChange={setInvoiceConnection}
            accounts={accounts.data?.connections ?? []}
            disabled={disabled}
            allowImmediate={mode === 'live' && can('finance.write')}
          />
          {accounts.error && preference === 'immediate' && (
            <p className="form-error" role="alert">
              {accounts.error}
            </p>
          )}
        </Panel>
        <Panel
          className="order-form-card"
          title="Ürünler"
          description="Katalog satırları sipariş için rezerve edilir; onayda stoktan düşer. Serbest ürün/hizmet satırları stok oluşturmaz."
        >
          <SearchSelect
            label="Üründen satır ekle"
            value=""
            onChange={addCatalog}
            disabled={disabled || rows.length >= 200}
            placeholder="Ürün adı, stok kodu veya barkod…"
            options={state.products
              .filter((product) => product.active)
              .flatMap((product) =>
                product.variants.map((variant) => ({
                  id: variant.id,
                  label: `${product.name} · ${variant.name}`,
                  description: `${variant.sku} · ${formatMoney(convertTo(variantPrice(state, variant.id), 'TRY', currency))} · ${available(variant.id)} ${product.unit ?? 'Adet'} stok`,
                  search: `${variant.sku} ${variant.barcode}`,
                })),
              )}
          />
          <div className="order-billing-choice">
            <Checkbox
              className="app-checkbox"
              isSelected={includesVat}
              isDisabled={disabled}
              onChange={changeVatEntry}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>Birim fiyatı KDV dahil gir</Label>
              </Checkbox.Content>
            </Checkbox>
          </div>
          <div className="order-lines-editor">
            {!!rows.length && (
              <div className="order-line-header" aria-hidden="true">
                <span>Ürün / hizmet</span>
                <span>Miktar</span>
                <span>Birim</span>
                <span>Birim fiyat (KDV {includesVat ? 'dahil' : 'hariç'})</span>
                <span>İndirim</span>
                <span>KDV</span>
                <span>Toplam</span>
                <span />
              </div>
            )}
            {rows.map((row, index) => (
              <div className="order-draft-row" key={row.id}>
                <div className="order-draft-title">
                  {row.kind === 'free' ? (
                    <Field
                      label={`${index + 1}. satır açıklaması`}
                      value={row.title}
                      onChange={(title) => update(row.id, { title })}
                      placeholder="Ürün / hizmet adı"
                      maxLength={300}
                      required
                      isDisabled={disabled}
                    />
                  ) : (
                    <div>
                      <strong>{row.title}</strong>
                      <span>{row.sku}</span>
                      <small>
                        {available(row.variantId)} {row.unit.toLocaleLowerCase('tr-TR')} satılabilir
                      </small>
                    </div>
                  )}
                  <Chip size="sm" variant="soft" color={row.kind === 'free' ? 'default' : 'accent'}>
                    {row.kind === 'free' ? 'Serbest satır' : 'Katalog ürünü'}
                  </Chip>
                </div>
                <Field
                  label={`Miktar · satır ${index + 1}`}
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={row.quantity}
                  onChange={(quantity) => update(row.id, { quantity })}
                  isDisabled={disabled}
                />
                <div className="select-field">
                  <label className="label">Birim</label>
                  {row.kind === 'free' ? (
                    <SelectButton
                      label={`Birim · satır ${index + 1}`}
                      value={row.unit}
                      onChange={(unit) => update(row.id, { unit })}
                      options={productUnits.map((unit) => ({ id: unit, label: unit }))}
                      isDisabled={disabled}
                    />
                  ) : (
                    <span className="order-fixed-unit">{row.unit}</span>
                  )}
                </div>
                <MoneyField
                  key={`${row.id}-${currency}-${includesVat}`}
                  label={`Birim fiyat (KDV ${includesVat ? 'dahil' : 'hariç'}) · satır ${index + 1}`}
                  initialValue={row.price}
                  onChange={(price) => update(row.id, { price })}
                  isDisabled={disabled}
                />
                <div className="order-line-discount">
                  <div className="select-field">
                    <label className="label">İndirim</label>
                    <SelectButton
                      label={`İndirim türü · satır ${index + 1}`}
                      value={row.discount.kind}
                      onChange={(kind) =>
                        update(row.id, {
                          discount: { kind: kind as OrderDiscount['kind'], value: 0 },
                        })
                      }
                      options={[
                        { id: 'percent', label: '%' },
                        { id: 'amount', label: currency === 'TRY' ? '₺' : currency },
                      ]}
                      isDisabled={disabled}
                    />
                  </div>
                  {row.discount.kind === 'percent' ? (
                    <Field
                      label={`İndirim (%) · satır ${index + 1}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={String(row.discount.value / 100)}
                      onChange={(value) =>
                        update(row.id, {
                          discount: {
                            kind: 'percent',
                            value: value === '' ? NaN : Math.round(Number(value) * 100),
                          },
                        })
                      }
                      isDisabled={disabled}
                    />
                  ) : (
                    <MoneyField
                      key={`${row.id}-amount-${currency}-${includesVat}`}
                      label={`İndirim (${currency === 'TRY' ? '₺' : currency}) · satır ${index + 1}`}
                      initialValue={row.discount.value}
                      onChange={(value) => update(row.id, { discount: { kind: 'amount', value } })}
                      isDisabled={disabled}
                    />
                  )}
                </div>
                <div className="select-field">
                  <label className="label">KDV</label>
                  <SelectButton
                    label={`KDV oranı · satır ${index + 1}`}
                    value={String(row.taxRate)}
                    onChange={(value) => update(row.id, { taxRate: Number(value) })}
                    options={[...new Set([0, 1, 10, 20, row.taxRate])].map((value) => ({
                      id: String(value),
                      label: `%${value}`,
                    }))}
                    isDisabled={disabled}
                  />
                </div>
                <div className="order-draft-amount">
                  <span>Toplam</span>
                  <strong>
                    {Number.isFinite(rowAmount(row)) ? formatMoney(rowAmount(row)) : '—'}
                  </strong>
                </div>
                <Button
                  variant="ghost"
                  isIconOnly
                  size="sm"
                  aria-label={`${index + 1}. satırı kaldır`}
                  onPress={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                  isDisabled={disabled}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
            {!rows.length && (
              <div className="order-lines-empty">
                <Package size={24} />
                <p>Katalogdan bir ürün seçin veya serbest satır ekleyin.</p>
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={disabled || rows.length >= 200}
            onPress={() =>
              setRows((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  kind: 'free',
                  variantId: '',
                  title: '',
                  sku: '',
                  unit: 'Adet',
                  quantity: '1',
                  price: 0,
                  taxRate: 20,
                  discount: { kind: 'percent', value: 0 },
                },
              ])
            }
          >
            <Plus size={15} />
            Satır ekle
          </Button>
          <div className="order-create-bottom">
            <div className="form-grid">
              <MoneyField
                key={`shipping-${currency}`}
                label={`Kargo ücreti (KDV dahil, ${currency})`}
                initialValue={shipping}
                onChange={setShipping}
                isDisabled={disabled}
              />
              <Field
                label="Müşteri notu"
                value={note}
                onChange={setNote}
                maxLength={5000}
                isDisabled={disabled}
              />
              <Field
                label="İç not"
                value={internalNote}
                onChange={setInternalNote}
                maxLength={5000}
                className="span-2"
                isDisabled={disabled}
              />
            </div>
            <div className="order-summary-totals">
              <div>
                <span>Ara toplam (KDV hariç)</span>
                <strong>
                  {Number.isFinite(productTotal - tax) ? formatMoney(productTotal - tax) : '—'}
                </strong>
              </div>
              <div>
                <span>Ürün KDV’si</span>
                <strong>{Number.isFinite(tax) ? formatMoney(tax) : '—'}</strong>
              </div>
              <div>
                <span>Kargo (KDV dahil)</span>
                <strong>{Number.isFinite(shipping) ? formatMoney(shipping) : '—'}</strong>
              </div>
              <div className="is-total">
                <span>Genel toplam</span>
                <strong>{Number.isFinite(total) ? formatMoney(total) : '—'}</strong>
              </div>
              {currency !== 'TRY' && (
                <div>
                  <span>Kasa / cari karşılığı</span>
                  <strong>{Number.isSafeInteger(tryTotal) ? money(tryTotal) : '—'}</strong>
                </div>
              )}
            </div>
          </div>
        </Panel>
        {error && (
          <p className="form-error order-page-error" role="alert">
            {error}
          </p>
        )}
        <div className="order-create-footer">
          <Link to="/orders" className="button button--secondary">
            Vazgeç
          </Link>
          <Button
            variant="primary"
            type="submit"
            isDisabled={
              disabled ||
              !customerId ||
              !rows.length ||
              !Number.isFinite(total) ||
              (preference === 'immediate' && !invoiceConnection)
            }
          >
            <Check size={16} />
            {busy ? 'Oluşturuluyor…' : 'Siparişi oluştur'}
          </Button>
        </div>
      </form>
      {newCustomer && (
        <CustomerEditor
          customer={newCustomer}
          onSaved={(customer) => chooseCustomer(customer.id, customer)}
          onClose={() => setNewCustomer(null)}
        />
      )}
    </div>
  )
}

function OrderAddressFields({
  value,
  onChange,
  disabled,
  prefix = '',
}: {
  value: OrderAddress
  onChange: (value: OrderAddress) => void
  disabled: boolean
  prefix?: string
}) {
  return (
    <div className="form-grid">
      {(
        [
          ['name', 'Ad soyad', true],
          ['phone', 'Telefon', false],
          ['address', 'Açık adres', true],
          ['district', 'İlçe', false],
          ['city', 'İl', true],
          ['postalCode', 'Posta kodu', false],
          ['country', 'Ülke', false],
        ] as const
      ).map(([key, label, required]) => (
        <Field
          key={key}
          label={`${prefix}${label}`}
          value={value[key] ?? ''}
          onChange={(text) =>
            onChange({ ...value, [key]: key === 'country' ? text.toUpperCase() : text })
          }
          required={required}
          className={key === 'address' ? 'span-2' : ''}
          maxLength={
            key === 'country'
              ? 2
              : key === 'address'
                ? 1000
                : key === 'phone'
                  ? 50
                  : key === 'postalCode'
                    ? 20
                    : 200
          }
          isDisabled={disabled}
        />
      ))}
    </div>
  )
}
