import {
  ArrowRight,
  Boxes,
  Clock3,
  ReceiptText,
  RotateCcw,
  ScanLine,
  ShoppingBag,
  Users,
  Wallet,
} from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../app/AppProvider'
import { lowStockProducts, productStock } from '../domain/selectors'
import { dayKey, dateLabel, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import { EmptyState, Metric, PageHeader, Panel } from '../components/ui/shared'
import { ProductArt } from '../components/ui/ProductArt'

export function RetailHomePage() {
  const { state } = useApp()
  const today = dayKey(new Date().toISOString())
  const sales = state.retailSales.filter((sale) => dayKey(sale.createdAt) === today)
  const total = sales.reduce((sum, sale) => sum + sale.total, 0)
  const refunds = (state.returns ?? []).filter(
    (r) => r.source === 'retail' && dayKey(r.createdAt) === today,
  )
  const low = lowStockProducts(state)
  const shortcuts = [
    {
      title: 'Yeni satış',
      description: 'Barkod okutun, sepeti oluşturun ve tahsil edin.',
      to: '/retail/sale',
      icon: ScanLine,
      featured: true,
      detail: 'Kasayı aç',
    },
    {
      title: 'Yeni iade',
      description: 'Satıştan kalem seçin; stoka dönüş ve geri ödemeyi işleyin.',
      to: '/retail/returns?new=1',
      icon: RotateCcw,
      detail: 'İade kaydet',
    },
    {
      title: 'Yeni alış',
      description: 'Tedarikçi belgesini, maliyeti ve depo girişini kaydedin.',
      to: '/retail/finance/expenses?new=purchase',
      icon: ShoppingBag,
      detail: 'Alış belgesi',
    },
    {
      title: 'Kasa',
      description: 'Tahsilat, ödeme ve hesaplar arası virman.',
      to: '/retail/finance/cash',
      icon: Wallet,
      detail: 'Kasa hareketleri',
    },
    {
      title: 'Eski satışlar',
      description: 'Geçmiş satışları, müşterileri ve tahsilatları bulun.',
      to: '/retail/history',
      icon: Clock3,
      detail: `${state.retailSales.length} satış kaydı`,
    },
    {
      title: 'Stok',
      description: 'Depo bakiyelerini, sayım ve transferleri yönetin.',
      to: '/retail/inventory',
      icon: Boxes,
      detail: `${state.products.flatMap((p) => p.variants).length} stok kodu`,
    },
  ]
  return (
    <div className="retail-home">
      <PageHeader
        eyebrow={state.preferences.businessName}
        title="Perakende"
        description="Günlük işleriniz için kısa bir yol. Satış, alış, kasa ve stok aynı çalışma alanında."
        actions={
          <span className="retail-today">
            <Clock3 size={15} />
            {dateLabel(new Date().toISOString())}
          </span>
        }
      />
      <div className="retail-shortcuts">
        {shortcuts.map((item) => (
          <Link
            to={item.to}
            className={`retail-shortcut ${item.featured ? 'retail-shortcut--featured' : ''}`}
            key={item.to}
          >
            <span className="retail-shortcut-icon">
              <item.icon size={23} strokeWidth={1.6} />
            </span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <span className="retail-shortcut-bottom">
              <span>{item.detail}</span>
              <ArrowRight size={17} />
            </span>
          </Link>
        ))}
      </div>
      <div className="retail-home-links">
        <Link to="/retail/finance/customers">
          <Users size={16} />
          Cari hesaplar
          <ArrowRight size={14} />
        </Link>
        <Link to="/retail/finance/expenses">
          <ReceiptText size={16} />
          Gider ve alış belgeleri
          <ArrowRight size={14} />
        </Link>
        <Link to="/retail/returns">
          <RotateCcw size={16} />
          İade geçmişi
          <ArrowRight size={14} />
        </Link>
      </div>
      <div className="metrics-grid metrics-grid--three">
        <Metric
          label="Bugünkü satış"
          value={money(total)}
          detail={`${sales.length} perakende satışı · iade öncesi`}
          icon={<ShoppingBag size={18} />}
        />
        <Metric
          label="Satış anında tahsilat"
          value={money(sales.reduce((sum, sale) => sum + (sale.paidAmount ?? sale.total), 0))}
          detail="bugün tamamlanan satışların tahsilatı"
          icon={<Wallet size={18} />}
          index={1}
        />
        <Metric
          label="Bugünkü iadeler"
          value={money(
            refunds.reduce(
              (sum, r) => sum + r.items.reduce((amount, i) => amount + i.amount, 0),
              0,
            ),
          )}
          detail={`${refunds.length} perakende iade kaydı`}
          icon={<RotateCcw size={18} />}
          index={2}
        />
      </div>
      <div className="retail-home-bottom">
        <Panel
          flush
          title="Son satışlar"
          description="Son tamamlanan perakende işlemleri"
          actions={
            <Link className="provider-doc-link" to="/retail/history">
              Tümünü gör
              <ArrowRight size={14} />
            </Link>
          }
        >
          <DataTable
            label="Son perakende satışları"
            items={[...state.retailSales]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 5)}
            paginate={false}
            columns={[
              {
                id: 'number',
                label: 'Satış',
                rowHeader: true,
                cell: (sale) => (
                  <Link
                    className="order-link"
                    to={`/retail/history?sale=${encodeURIComponent(sale.id)}`}
                  >
                    {sale.number}
                  </Link>
                ),
              },
              {
                id: 'customer',
                label: 'Müşteri',
                cell: (sale) =>
                  state.customers.find((c) => c.id === sale.customerId)?.name ?? 'Müşterisiz satış',
              },
              { id: 'date', label: 'Tarih', cell: (sale) => dateLabel(sale.createdAt, true) },
              {
                id: 'total',
                label: 'Tutar',
                className: 'align-right',
                cell: (sale) => <strong className="money-cell">{money(sale.total)}</strong>,
              },
            ]}
            emptyTitle="İlk satışınız burada görünecek"
            emptyDescription="Yeni satış kartından başlayın; kayıt, stok ve kasa birlikte güncellenir."
          />
        </Panel>
        <Panel
          title="Stok takibi"
          description={`${low.length} ürün kritik seviyede`}
          className="retail-low-stock"
          actions={
            <Link className="provider-doc-link" to="/retail/inventory">
              Stoka git
              <ArrowRight size={14} />
            </Link>
          }
        >
          {low.length ? (
            <div>
              {low.slice(0, 4).map((product) => (
                <Link key={product.id} to={`/products/${product.id}?tab=stocks`}>
                  <ProductArt product={product} />
                  <span>
                    <strong>{product.name}</strong>
                    <small>
                      {productStock(product, state)}{' '}
                      {(product.unit ?? 'Adet').toLocaleLowerCase('tr-TR')} fiziksel stok
                    </small>
                  </span>
                  <ArrowRight size={14} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Stoklarınız yolunda"
              description="Kritik stok eşiğinin altındaki ürünler burada görünür."
              icon={<Boxes size={23} />}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
