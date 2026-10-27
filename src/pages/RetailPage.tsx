import { useRef, useState } from 'react'
import { Button } from '@heroui/react'
import {
  ArrowRight,
  Banknote,
  Check,
  CheckCheck,
  CreditCard,
  Download,
  Minus,
  Plus,
  ScanLine,
  ShoppingBag,
  Trash2,
  Warehouse,
} from 'lucide-react'
import { useApp } from '../app/AppProvider'
import { availableStock, findVariant, orderTotal, taxTotal } from '../domain/selectors'
import { snapshotBundle, validateStockDemand, variantCost, variantPrice } from '../domain/bundles'
import type { RetailInput, RetailSale } from '../domain/types'
import { dateLabel, downloadCsv, matches, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import {
  Dialog,
  EmptyState,
  FilterTabs,
  PageHeader,
  Panel,
  SearchBox,
  SelectButton,
} from '../components/ui/shared'
import { ProductArt } from '../components/ui/ProductArt'
import { MoneyField } from '../components/ui/shared'
import { MAIN_WAREHOUSE, warehouses } from '../domain/inventory'
import { discountLines, lineTotal } from '../domain/selectors'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { BundleContents } from '../components/products/BundleContents'

const paymentNames = {
  cash: 'Nakit',
  card: 'Kart',
  transfer: 'Havale / EFT',
  marketplace: 'Pazaryeri',
}

export function RetailPage({ view = 'sale' }: { view?: 'sale' | 'history' }) {
  const { state, run, notify, mode, can } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = view
  const setTab = (tab: string) => navigate(`/retail/${tab}`)
  const [query, setQuery] = useState('')
  const [barcode, setBarcode] = useState('')
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState('all')
  const [cart, setCart] = useState<RetailInput['items']>([])
  const [customerId, setCustomerId] = useState('walkin')
  const [method, setMethod] = useState<RetailInput['method']>('card')
  const [warehouseId, setWarehouseId] = useState(MAIN_WAREHOUSE)
  const [payMode, setPayMode] = useState('full'),
    [partial, setPartial] = useState(0),
    [discount, setDiscount] = useState(0),
    [saleBusy, setSaleBusy] = useState(false)
  const available = (id: string) => availableStock(state, id, undefined, warehouseId)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const receipt = state.retailSales.find((sale) => sale.id === (receiptId ?? params.get('sale')))
  const closeReceipt = () => {
    setReceiptId(null)
    const next = new URLSearchParams(params)
    next.delete('sale')
    setParams(next, { replace: true })
  }
  const [historyQuery, setHistoryQuery] = useState('')
  const history = [...state.retailSales]
    .filter((sale) =>
      matches(
        `${sale.number} ${state.customers.find((c) => c.id === sale.customerId)?.name ?? 'Müşterisiz satış'}`,
        historyQuery,
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const categories = [...new Set(state.products.map((product) => product.category))]
  const products = state.products.filter(
    (product) =>
      product.active &&
      (category === 'all' || product.category === category) &&
      matches(
        `${product.name} ${product.variants.map((variant) => `${variant.sku} ${variant.barcode}`).join(' ')}`,
        query,
      ),
  )
  const cartLines = cart.flatMap((item) => {
    const found = findVariant(state, item.variantId)
    return found
      ? [
          {
            ...item,
            unitPrice: variantPrice(state, item.variantId),
            unitCost: variantCost(state, item.variantId),
            ...(found.product.bundle
              ? { bundleComponents: snapshotBundle(state, item.variantId) }
              : {}),
            taxRate: found.product.taxRate,
          },
        ]
      : []
  })
  const pricedLines = discountLines(cartLines, Number.isFinite(discount) ? discount : 0)
  const total = orderTotal({ lines: pricedLines, shipping: 0 })
  const tax = taxTotal(pricedLines)
  const add = (variantId: string) => {
    if (saleBusy) return
    const current = cart.find((item) => item.variantId === variantId)?.quantity ?? 0
    const next = current
      ? cart.map((item) =>
          item.variantId === variantId ? { ...item, quantity: item.quantity + 1 } : item,
        )
      : [
          ...cart,
          {
            variantId,
            quantity: 1,
            ...(findVariant(state, variantId)?.product.bundle
              ? { bundleVersion: findVariant(state, variantId)!.product.version ?? 0 }
              : {}),
          },
        ]
    const problem = validateStockDemand(
      state,
      next.map((item) => ({ ...item, bundleComponents: snapshotBundle(state, item.variantId) })),
      warehouseId,
    )
    if (problem) {
      notify(problem, 'error')
      return
    }
    setCart(next)
  }
  const scan = () => {
    const found = state.products
      .flatMap((product) => product.variants)
      .find(
        (variant) =>
          variant.barcode === barcode.trim() ||
          variant.sku.toLocaleLowerCase('tr-TR') === barcode.trim().toLocaleLowerCase('tr-TR'),
      )
    if (found) {
      add(found.id)
      setBarcode('')
      barcodeRef.current?.focus()
    } else notify('Barkod bulunamadı. Ürün kartından ekleyebilirsiniz.', 'error')
  }
  const complete = async () => {
    if (saleBusy) return
    setSaleBusy(true)
    const payments =
      payMode === 'credit'
        ? []
        : payMode === 'partial'
          ? [{ method, amount: partial }]
          : payMode === 'split'
            ? [
                { method, amount: partial },
                {
                  method: method === 'cash' ? ('card' as const) : ('cash' as const),
                  amount: total - partial,
                },
              ]
            : undefined
    const result = await run({
      type: 'retail.sale',
      input: {
        customerId: customerId === 'walkin' ? undefined : customerId,
        items: cart,
        expectedTotal: total,
        method,
        warehouseId,
        payments,
        discount,
      },
    })
    setSaleBusy(false)
    if (result.ok && result.id) {
      setReceiptId(result.id)
      setCart([])
      setCustomerId('walkin')
      setBarcode('')
      setDiscount(0)
      setPartial(0)
      setPayMode('full')
    }
  }
  const historyColumns: Column<RetailSale>[] = [
    {
      id: 'number',
      label: 'Satış kaydı',
      rowHeader: true,
      cell: (sale) => (
        <button
          className="button button--sm button--ghost order-link"
          onClick={() => setReceiptId(sale.id)}
        >
          {sale.number}
        </button>
      ),
    },
    {
      id: 'date',
      label: 'Tarih',
      cell: (sale) => dateLabel(sale.createdAt, true),
      sortValue: (sale) => sale.createdAt,
    },
    {
      id: 'customer',
      label: 'Müşteri',
      cell: (sale) =>
        state.customers.find((customer) => customer.id === sale.customerId)?.name ??
        'Müşterisiz satış',
    },
    {
      id: 'items',
      label: 'Ürün adedi',
      cell: (sale) => sale.lines.reduce((sum, line) => sum + line.quantity, 0),
    },
    {
      id: 'method',
      label: 'Tahsilat yöntemi',
      cell: (sale) =>
        (sale.paidAmount ?? sale.total) < sale.total
          ? `${money(sale.paidAmount ?? 0)} tahsil edildi`
          : sale.payments && sale.payments.length > 1
            ? 'Bölünmüş tahsilat'
            : paymentNames[sale.method],
    },
    {
      id: 'total',
      label: 'Toplam',
      className: 'align-right',
      cell: (sale) => <strong className="money-cell">{money(sale.total)}</strong>,
      sortValue: (sale) => sale.total,
    },
  ]
  return (
    <>
      <PageHeader
        title={tab === 'sale' ? 'Yeni satış' : 'Satış geçmişi'}
        description={
          tab === 'sale'
            ? 'Ürünü seçin veya barkodu okutun. Satışı kolayca tamamlayın.'
            : 'Geçmiş satış kayıtları, tahsilatlar ve satış fişleri.'
        }
        actions={
          <>
            <SelectButton
              label="Perakende deposu"
              value={warehouseId}
              onChange={(value) => {
                if (!saleBusy) {
                  setWarehouseId(value)
                  setCart([])
                }
              }}
              options={warehouses(state)
                .filter((w) => w.active)
                .map((w) => ({ id: w.id, label: w.name, icon: <Warehouse size={15} /> }))}
            />
            <Link to="/retail/returns" className="button button--secondary">
              İade işlemleri
            </Link>
            {tab === 'sale' && (
              <Button
                variant="secondary"
                className="mobile-cart-link"
                onPress={() =>
                  document.querySelector('.retail-cart')?.scrollIntoView({
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'auto'
                      : 'smooth',
                    block: 'start',
                  })
                }
              >
                <ShoppingBag size={16} />
                Sepete git ({cart.reduce((sum, item) => sum + item.quantity, 0)})
              </Button>
            )}
          </>
        }
      />
      <FilterTabs
        label="Perakende çalışma alanı"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'sale', label: 'Yeni satış' },
          { id: 'history', label: 'Satış geçmişi', count: state.retailSales.length },
        ]}
      />
      {tab === 'sale' ? (
        <div className="retail-layout">
          <section className="retail-catalog">
            <div className="retail-catalog-toolbar">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Ürün adı veya stok kodu..."
                label="Perakende ürün arama"
              />
              <SelectButton
                label="Perakende ürün kategorisi"
                value={category}
                onChange={setCategory}
                options={[
                  { id: 'all', label: 'Tüm kategoriler' },
                  ...categories.map((category) => ({ id: category, label: category })),
                ]}
              />
            </div>
            <form
              className="barcode-scanner"
              onSubmit={(event) => {
                event.preventDefault()
                scan()
              }}
            >
              <ScanLine size={19} />
              <input
                className="input input--secondary"
                ref={barcodeRef}
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="Barkodu okutun veya yazıp Enter’a basın"
                aria-label="Barkod okut"
                autoComplete="off"
              />
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                type="submit"
                aria-label="Barkodla ekle"
                isDisabled={!barcode.trim()}
              >
                <ArrowRight size={16} />
              </Button>
            </form>
            {products.length ? (
              <div className="retail-product-grid">
                {products.flatMap((product) =>
                  product.variants.map((variant) => (
                    <button
                      key={variant.id}
                      className="button button--md button--ghost retail-product-card"
                      disabled={
                        saleBusy ||
                        (!state.ecommerce?.allowNegativeStock && available(variant.id) <= 0)
                      }
                      aria-label={`${product.name} ${variant.name} sepete ekle`}
                      onClick={() => add(variant.id)}
                    >
                      <div className="retail-product-image">
                        <ProductArt product={product} />
                        <span className="retail-add-icon">
                          <Plus size={17} />
                        </span>
                        {available(variant.id) <= 0 && (
                          <span className="retail-out-of-stock">Tükendi</span>
                        )}
                      </div>
                      <div className="retail-product-copy">
                        <strong>{product.name}</strong>
                        <span>{variant.name}</span>
                        <div>
                          <strong>{money(variantPrice(state, variant.id))}</strong>
                          <small>
                            {available(variant.id)}{' '}
                            {(product.unit ?? 'Adet').toLocaleLowerCase('tr-TR')}
                          </small>
                        </div>
                      </div>
                    </button>
                  )),
                )}
              </div>
            ) : (
              <EmptyState
                title="Ürün bulunamadı"
                description="Başka bir ürün adı veya barkod deneyin."
              />
            )}
          </section>
          <Panel flush className="retail-cart">
            <div className="cart-heading">
              <div>
                <ShoppingBag size={19} />
                <h2>Yeni satış</h2>
                <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
              </div>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label="Sepeti temizle"
                isDisabled={!cart.length}
                onPress={() => setCart([])}
              >
                <Trash2 size={16} />
              </Button>
            </div>
            <div className="cart-customer">
              <SelectButton
                label="Perakende müşterisi"
                value={customerId}
                onChange={setCustomerId}
                options={[
                  { id: 'walkin', label: 'Müşterisiz satış' },
                  ...state.customers.map((customer) => ({ id: customer.id, label: customer.name })),
                ]}
              />
            </div>
            <div className="cart-lines">
              {cart.length ? (
                cart.map((item) => {
                  const found = findVariant(state, item.variantId)!
                  return (
                    <div className="cart-line" key={item.variantId}>
                      <ProductArt product={found.product} variant={found.variant} />
                      <div className="cart-line-copy">
                        <strong>{found.product.name}</strong>
                        <small>{found.variant.name}</small>
                        <div className="cart-line-bottom">
                          <div className="quantity-stepper">
                            <Button
                              isIconOnly
                              variant="ghost"
                              size="sm"
                              aria-label={`${found.product.name} azalt`}
                              onPress={() =>
                                setCart((items) =>
                                  items.flatMap((line) =>
                                    line.variantId === item.variantId
                                      ? line.quantity <= 1
                                        ? []
                                        : [{ ...line, quantity: line.quantity - 1 }]
                                      : [line],
                                  ),
                                )
                              }
                            >
                              <Minus size={13} />
                            </Button>
                            <span>{item.quantity}</span>
                            <Button
                              isIconOnly
                              variant="ghost"
                              size="sm"
                              aria-label={`${found.product.name} artır`}
                              onPress={() => add(item.variantId)}
                            >
                              <Plus size={13} />
                            </Button>
                          </div>
                          <strong>
                            {money(variantPrice(state, found.variant.id) * item.quantity)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="empty-cart">
                  <span>
                    <ShoppingBag size={28} strokeWidth={1.3} />
                  </span>
                  <strong>Sepetiniz hazır, ürünleri bekliyor.</strong>
                  <p>
                    Soldan bir ürün seçin
                    <br />
                    veya barkodunu okutun.
                  </p>
                </div>
              )}
            </div>
            <div className="cart-checkout">
              <div className="checkout-extras">
                <MoneyField
                  key={receiptId ?? 'sale-discount'}
                  label="Sepet indirimi (₺)"
                  initialValue={discount}
                  onChange={setDiscount}
                />
                <SelectButton
                  label="Tahsilat planı"
                  value={payMode}
                  onChange={setPayMode}
                  options={[
                    { id: 'full', label: 'Tam tahsilat' },
                    { id: 'split', label: 'Bölünmüş tahsilat' },
                    { id: 'partial', label: 'Kısmi tahsilat' },
                    { id: 'credit', label: 'Veresiye' },
                  ]}
                />
                {['split', 'partial'].includes(payMode) && (
                  <MoneyField
                    label={`${paymentNames[method]} tahsilatı (₺)`}
                    initialValue={partial}
                    onChange={setPartial}
                  />
                )}
              </div>
              <div className="cart-totals">
                <div>
                  <span>Ara toplam</span>
                  <span>{money(total - tax)}</span>
                </div>
                <div>
                  <span>KDV</span>
                  <span>{money(tax)}</span>
                </div>
                <div className="cart-grand-total">
                  <strong>Toplam</strong>
                  <strong>{money(total)}</strong>
                </div>
              </div>
              <span className="payment-label">TAHSİLAT YÖNTEMİ</span>
              <div className="payment-options">
                {(
                  [
                    { id: 'cash', label: 'Nakit', icon: Banknote },
                    { id: 'card', label: 'Kart', icon: CreditCard },
                    { id: 'transfer', label: 'Havale', icon: ArrowRight },
                  ] as const
                ).map((option) => (
                  <Button
                    key={option.id}
                    variant={method === option.id ? 'secondary' : 'ghost'}
                    aria-pressed={method === option.id}
                    className={method === option.id ? 'is-selected' : ''}
                    onPress={() => setMethod(option.id)}
                  >
                    <option.icon size={17} />
                    {option.label}
                  </Button>
                ))}
              </div>
              <Button
                variant="primary"
                className="complete-sale-button"
                isDisabled={
                  saleBusy ||
                  !can('retail.write') ||
                  !cart.length ||
                  !Number.isFinite(discount) ||
                  total <= 0
                }
                onPress={complete}
              >
                <CheckCheck size={19} />
                <span>{saleBusy ? 'Kaydediliyor…' : 'Satışı tamamla'}</span>
                <ArrowRight size={17} />
              </Button>
              <p className="checkout-footnote">Stok ve kasa aynı işlemde güncellenir.</p>
            </div>
          </Panel>
        </div>
      ) : (
        <Panel flush className="list-panel">
          <div className="list-toolbar">
            <SearchBox
              value={historyQuery}
              onChange={setHistoryQuery}
              label="Satış geçmişinde ara"
              placeholder="Satış numarası veya müşteri…"
            />
            <Button
              variant="secondary"
              size="sm"
              isDisabled={!state.retailSales.length}
              onPress={() =>
                downloadCsv(
                  'perakende-satislar.csv',
                  ['Satış', 'Tarih', 'Tutar (TL)', 'Tahsilat'],
                  history.map((sale) => [
                    sale.number,
                    dateLabel(sale.createdAt, true),
                    (sale.total / 100).toFixed(2),
                    paymentNames[sale.method],
                  ]),
                )
              }
            >
              <Download size={15} />
              Dışa aktar
            </Button>
          </div>
          <DataTable
            items={history}
            columns={historyColumns}
            label="Perakende satış geçmişi"
            emptyTitle="İlk satışınız burada görünecek"
            emptyDescription="Yeni satış sekmesinden tamamladığınız işlemler burada saklanır."
          />
        </Panel>
      )}
      {receipt && (
        <Dialog
          open
          onClose={closeReceipt}
          title="Satış tamamlandı"
          description="Satış, stok ve seçilen tahsilat planı kaydedildi."
          footer={
            <Button
              variant="primary"
              onPress={() => {
                closeReceipt()
                setTab('sale')
                barcodeRef.current?.focus()
              }}
            >
              Yeni satışa geç
              <ArrowRight size={16} />
            </Button>
          }
        >
          <div className="sale-receipt">
            <span className="receipt-success">
              <Check size={30} />
            </span>
            <h3>{receipt.number}</h3>
            <p>
              {dateLabel(receipt.createdAt, true)} · {paymentNames[receipt.method]}
            </p>
            <div className="receipt-lines">
              {receipt.lines.map((line) => (
                <div key={line.variantId}>
                  <div className="receipt-line-title">
                    {line.title ?? findVariant(state, line.variantId)?.product.name}
                    <BundleContents line={line} />
                    <small>
                      {line.quantity} {(line.unit ?? 'Adet').toLocaleLowerCase('tr-TR')}
                    </small>
                  </div>
                  <strong>{money(lineTotal(line))}</strong>
                </div>
              ))}
            </div>
            <div className="receipt-total">
              <span>Toplam</span>
              <strong>{money(receipt.total)}</strong>
            </div>
            <p className="subtle">
              {mode === 'demo'
                ? 'Örnek satış kaydı'
                : `Tahsilat: ${money(receipt.paidAmount ?? receipt.total)} · Kalan: ${money(receipt.total - (receipt.paidAmount ?? receipt.total))}`}
            </p>
          </div>
        </Dialog>
      )}
    </>
  )
}
