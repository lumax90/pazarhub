import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock3,
  Download,
  Package,
  Plus,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useApp } from '../app/AppProvider'
import { activeOrders, lowStockProducts, netOrderTotal } from '../domain/selectors'
import { dayKey, downloadCsv, money } from '../lib/format'
import {
  ChannelBadge,
  ChannelIcon,
  Metric,
  PageHeader,
  Panel,
  SelectButton,
  StatusBadge,
} from '../components/ui/shared'
import { channelNames } from '../domain/channels'
import { ProductArt } from '../components/ui/ProductArt'
import { RevenueChart } from '../components/dashboard/RevenueChart'
import type { ChartPoint } from '../components/dashboard/RevenueChart'
import type { Channel } from '../domain/types'

export function DashboardPage() {
  const { state, mode } = useApp()
  const orderTotal = (order: Parameters<typeof netOrderTotal>[1]) => netOrderTotal(state, order)
  const navigate = useNavigate()
  const [range, setRange] = useState('7')
  const orders = activeOrders(state)
  const today = orders.filter((order) => dayKey(order.createdAt) === dayKey(new Date()))
  const previous = new Date()
  previous.setDate(previous.getDate() - 1)
  const yesterday = orders.filter((order) => dayKey(order.createdAt) === dayKey(previous))
  const todayTotal = today.reduce((sum, order) => sum + orderTotal(order), 0)
  const previousTotal = yesterday.reduce((sum, order) => sum + orderTotal(order), 0)
  const pending = state.orders.filter(
    (order) => order.status === 'pending' || order.status === 'approved',
  )
  const lowStock = lowStockProducts(state)
  const errors = state.listings.filter((listing) => listing.status === 'rejected')
  const series: ChartPoint[] = Array.from({ length: Number(range) }, (_, index) => {
    const day = new Date()
    day.setDate(day.getDate() - Number(range) + 1 + index)
    const matching = orders.filter((order) => dayKey(order.createdAt) === dayKey(day))
    return {
      date: day.toISOString(),
      amount: matching.reduce((sum, order) => sum + orderTotal(order), 0),
      orders: matching.length,
    }
  })
  const periodTotal = series.reduce((sum, point) => sum + point.amount, 0)
  const channelTotals = (Object.keys(channelNames) as Channel[])
    .map((channel) => ({
      channel,
      amount: orders
        .filter(
          (order) =>
            order.channel === channel &&
            series.some((point) => dayKey(point.date) === dayKey(order.createdAt)),
        )
        .reduce((sum, order) => sum + orderTotal(order), 0),
    }))
    .sort((a, b) => b.amount - a.amount)
  const topProducts = state.products
    .map((product) => ({
      product,
      quantity: orders
        .flatMap((order) => order.lines)
        .filter((line) => product.variants.some((variant) => variant.id === line.variantId))
        .reduce((sum, line) => sum + line.quantity, 0),
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 4)
  const exportData = () =>
    downloadCsv(
      'satis-ozeti.csv',
      ['Tarih', 'Sipariş', 'Ciro (TL)'],
      series.map((point) => [dayKey(point.date), point.orders, (point.amount / 100).toFixed(2)]),
    )
  return (
    <>
      <PageHeader
        eyebrow="HER ŞEY KONTROLÜNÜZDE"
        title="Gününüz, bir bakışta."
        description="Mağazalarınız, siparişleriniz ve günün öncelikleri bir arada."
        actions={
          <>
            <Button variant="secondary" onPress={exportData}>
              <Download size={16} />
              Dışa aktar
            </Button>
            <Button variant="primary" onPress={() => navigate('/orders?new=1')}>
              <Plus size={17} />
              Yeni sipariş
            </Button>
          </>
        }
      />
      {mode === 'live' && !state.products.length && (
        <Panel className="onboarding-card">
          <div className="onboarding-title">
            <Package size={24} />
            <div>
              <h2>Çalışma alanınız hazır.</h2>
              <p>Mağazanızı bağlayarak veya ilk ürününüzü ekleyerek başlayın.</p>
            </div>
          </div>
          <div className="onboarding-steps">
            {[
              {
                to: '/connections',
                title: 'Mağazanızı bağlayın',
                detail: 'Hesabı kaydedin, API erişimini test edin.',
              },
              {
                to: '/listings',
                title: 'Ürünleri eşleştirin',
                detail: 'Kataloğu alın ve yerel varyantlara bağlayın.',
              },
              {
                to: '/products?new=1',
                title: 'İlk ürününüzü ekleyin',
                detail: 'Varyant, fiyat ve açılış stoğunu tamamlayın.',
              },
            ].map((item, index) => (
              <Link key={item.to} to={item.to} className="onboarding-step">
                <span>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      )}
      <div className="overview-topline">
        <span className="overview-date">
          <CalendarDays size={15} />
          {new Intl.DateTimeFormat('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).format(new Date())}
          <span className="date-divider" />
          Bugünkü özet
        </span>
        <span className="quiet-status">
          <span className="status-dot" />
          {state.connections.filter((connection) => connection.active).length}{' '}
          {mode === 'demo' ? 'demo mağaza' : 'etkin mağaza'}
        </span>
      </div>
      <div className="metrics-grid">
        <Metric
          index={0}
          label="Bugünkü satış"
          value={money(todayTotal)}
          change={previousTotal ? ((todayTotal - previousTotal) / previousTotal) * 100 : 0}
          detail="düne göre"
          icon={<Wallet size={18} />}
          highlighted
        />
        <Metric
          index={1}
          label="Bugünkü sipariş"
          value={String(today.length)}
          change={
            yesterday.length ? ((today.length - yesterday.length) / yesterday.length) * 100 : 0
          }
          detail="düne göre"
          icon={<ShoppingBag size={18} />}
        />
        <Metric
          index={2}
          label="Ortalama sepet"
          value={money(today.length ? Math.round(todayTotal / today.length) : 0)}
          detail="bugünkü sipariş başına"
          icon={<TrendingUp size={18} />}
        />
        <Metric
          index={3}
          label="Gönderim bekleyen"
          value={String(pending.length)}
          detail={`${state.orders.filter((order) => order.status === 'pending').length} onay · ${state.orders.filter((order) => order.status === 'approved').length} hazırlık aşamasında`}
          icon={<Package size={18} />}
        />
      </div>
      <div className="dashboard-primary-grid">
        <Panel
          entryIndex={1}
          title="Satış performansı"
          description="Satışlarınızın gün gün görünümü"
          className="performance-panel"
          actions={
            <SelectButton
              value={range}
              label="Grafik tarih aralığı"
              options={[
                { id: '7', label: 'Son 7 gün' },
                { id: '14', label: 'Son 14 gün' },
                { id: '30', label: 'Son 30 gün' },
              ]}
              onChange={setRange}
            />
          }
        >
          <div className="chart-summary">
            <div>
              <strong>{money(periodTotal)}</strong>
              <span>toplam satış</span>
            </div>
            <span className="chart-legend">
              <i />
              Satış tutarı
            </span>
          </div>
          <RevenueChart data={series} />
        </Panel>
        <Panel
          entryIndex={2}
          title="Satış kanalları"
          description={`Son ${range} gündeki satış dağılımı`}
          actions={<IconLink to="/reports" label="Kanal raporlarını aç" />}
          className="channel-panel"
        >
          <div className="channel-distribution-bar">
            {channelTotals
              .filter((item) => item.amount > 0)
              .map((item) => (
                <span
                  key={item.channel}
                  className={`distribution-${item.channel}`}
                  style={{ width: `${(item.amount / Math.max(1, periodTotal)) * 100}%` }}
                />
              ))}
          </div>
          <div className="channel-totals">
            {channelTotals.map((item) => (
              <div className="channel-total-row" key={item.channel}>
                <div className="channel-identity">
                  <ChannelIcon channel={item.channel} />
                  <span>{channelNames[item.channel]}</span>
                </div>
                <div className="channel-amount">
                  <strong>{money(item.amount)}</strong>
                  <small>%{Math.round((item.amount / Math.max(1, periodTotal)) * 100)}</small>
                </div>
              </div>
            ))}
          </div>
          <Link className="button button--sm button--ghost dashboard-panel-link" to="/connections">
            Mağazaları yönet <ArrowRight size={14} />
          </Link>
        </Panel>
      </div>
      <Panel className="attention-panel" entryIndex={3}>
        <div className="attention-strip">
          <div className="attention-symbol">
            <Sparkles size={19} />
          </div>
          <div className="attention-copy">
            <strong>Küçük bir kontrol, daha rahat bir gün.</strong>
            <span>Önceliklerinizi birlikte toparladık.</span>
          </div>
          <Link className="button button--sm button--ghost attention-action" to="/listings">
            <Chip size="sm" variant="soft" color={errors.length ? 'danger' : 'default'}>
              {errors.length}
            </Chip>
            İlan kontrolü
            <ChevronRight size={14} />
          </Link>
          <Link className="button button--sm button--ghost attention-action" to="/inventory">
            <Chip size="sm" variant="soft" color={lowStock.length ? 'warning' : 'default'}>
              {lowStock.length}
            </Chip>
            Düşük stok
            <ChevronRight size={14} />
          </Link>
          <Link className="button button--sm button--ghost attention-action" to="/orders">
            <Chip size="sm" variant="soft" color={pending.length ? 'accent' : 'default'}>
              {pending.length}
            </Chip>
            Bekleyen sipariş
            <ChevronRight size={14} />
          </Link>
        </div>
      </Panel>
      <div className="dashboard-secondary-grid">
        <Panel
          flush
          entryIndex={4}
          title="Son siparişler"
          description="Mağazalarınızdan gelen en yeni siparişler"
          actions={
            <Link to="/orders" className="small-link">
              Tüm siparişler
              <ArrowUpRight size={15} />
            </Link>
          }
          className="recent-orders-panel"
        >
          <div className="simple-table-scroll">
            <table className="simple-table recent-orders-table">
              <thead>
                <tr>
                  <th>Sipariş / müşteri</th>
                  <th>Kanal</th>
                  <th>Durum</th>
                  <th className="align-right">Tutar</th>
                  <th aria-label="Detay" />
                </tr>
              </thead>
              <tbody>
                {state.orders.slice(0, 5).map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link to={`/orders/${order.id}`} className="order-link">
                        {order.number}
                      </Link>
                      <span className="cell-secondary">
                        {state.customers.find((customer) => customer.id === order.customerId)?.name}
                      </span>
                    </td>
                    <td>
                      <ChannelBadge channel={order.channel} />
                    </td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="align-right money-cell">{money(orderTotal(order))}</td>
                    <td>
                      <Link
                        className="table-arrow-link"
                        to={`/orders/${order.id}`}
                        aria-label={`${order.number} detayları`}
                      >
                        <ChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel
          entryIndex={5}
          title="Öne çıkan ürünler"
          description="Son 30 günde en çok tercih edilenler"
          actions={<IconLink to="/products" label="Ürünleri aç" />}
          className="top-products-panel"
        >
          <div className="top-product-list">
            {topProducts.map(({ product, quantity }, index) => (
              <Link to={`/products/${product.id}`} key={product.id} className="top-product-row">
                <span className="top-product-rank">{String(index + 1).padStart(2, '0')}</span>
                <ProductArt product={product} />
                <span className="top-product-copy">
                  <strong>{product.name}</strong>
                  <small>{product.category}</small>
                </span>
                <span className="top-product-quantity">
                  {quantity}
                  <small>adet</small>
                </span>
              </Link>
            ))}
          </div>
          <div className="product-insight">
            <CircleCheck size={15} />
            <span>Ürün, stok ve siparişler aynı kaynaktan.</span>
          </div>
        </Panel>
      </div>
      <div className="dashboard-note">
        <Clock3 size={13} />
        <span>
          {mode === 'demo'
            ? 'Bu görünüm örnek çalışma alanınızdaki kayıtlarla hesaplanır.'
            : 'Bu görünüm çalışma alanınızdaki kayıtlarla hesaplanır.'}
        </span>
        {mode === 'demo' && (
          <Chip size="sm" variant="soft">
            Demo
          </Chip>
        )}
      </div>
    </>
  )
}

function IconLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="panel-icon-link" to={to} aria-label={label}>
      <ArrowUpRight size={17} />
    </Link>
  )
}
