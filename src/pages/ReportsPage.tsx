import { useState } from 'react'
import { Button } from '@heroui/react'
import { ChartNoAxesCombined, Download, ShoppingBag, TrendingUp, Wallet } from 'lucide-react'
import { useApp } from '../app/AppProvider'
import { activeOrders, netContribution, netOrderTotal } from '../domain/selectors'
import type { Channel } from '../domain/types'
import { dayKey, downloadCsv, money } from '../lib/format'
import { RevenueChart } from '../components/dashboard/RevenueChart'
import { ChannelBadge, Metric, PageHeader, Panel, SelectButton } from '../components/ui/shared'
import { channelNames } from '../domain/channels'
import { invoiceSource, invoiceTryTotal } from '../domain/invoice-source'

export function ReportsPage() {
  const { state } = useApp()
  const [days, setDays] = useState('30')
  const first = new Date()
  first.setDate(first.getDate() - Number(days) + 1)
  first.setHours(0, 0, 0, 0)
  const orders = activeOrders(state).filter((order) => new Date(order.createdAt) >= first)
  const revenue = orders.reduce((sum, order) => sum + netOrderTotal(state, order), 0)
  const unknownCosts = orders
    .flatMap((order) => order.lines)
    .filter((line) => line.costKnown === false).length
  const contribution = orders.reduce((sum, order) => sum + netContribution(state, order), 0)
  const series = Array.from({ length: Number(days) }, (_, index) => {
    const date = new Date(first)
    date.setDate(date.getDate() + index)
    const matching = orders.filter((order) => dayKey(order.createdAt) === dayKey(date))
    return {
      date: date.toISOString(),
      amount: matching.reduce((sum, order) => sum + netOrderTotal(state, order), 0),
      orders: matching.length,
    }
  })
  const channels = (Object.keys(channelNames) as Channel[])
    .map((channel) => {
      const matching = orders.filter((order) => order.channel === channel)
      return {
        channel,
        count: matching.length,
        revenue: matching.reduce((sum, order) => sum + netOrderTotal(state, order), 0),
        contribution: matching.some((order) => order.lines.some((line) => line.costKnown === false))
          ? null
          : matching.reduce((sum, order) => sum + netContribution(state, order), 0),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
  const retail = state.retailSales.filter((sale) => new Date(sale.createdAt) >= first)
  const invoices = state.invoices.filter(
    (invoice) =>
      !invoice.orderId &&
      invoice.document &&
      invoice.status !== 'cancelled' &&
      new Date(invoiceSource(state, invoice)!.createdAt) >= first,
  )
  return (
    <>
      <PageHeader
        title="Satış Özeti"
        description="Rakamların kaynağı belli, işletmenizin görünümü net."
        actions={
          <>
            <SelectButton
              label="Rapor tarih aralığı"
              value={days}
              onChange={setDays}
              options={[
                { id: '7', label: 'Son 7 gün' },
                { id: '14', label: 'Son 14 gün' },
                { id: '30', label: 'Son 30 gün' },
              ]}
            />
            <Button
              variant="secondary"
              onPress={() =>
                downloadCsv(
                  'kanal-satis-raporu.csv',
                  ['Kanal', 'Sipariş', 'Satış (TL)', 'Brüt ürün katkısı (TL)'],
                  channels.map((item) => [
                    channelNames[item.channel],
                    item.count,
                    (item.revenue / 100).toFixed(2),
                    item.contribution === null
                      ? 'Maliyet eksik'
                      : (item.contribution / 100).toFixed(2),
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
      <div className="metrics-grid">
        <Metric
          label="Satış tutarı"
          value={money(revenue)}
          detail="iptal ve iade hariç · KDV dahil"
          icon={<Wallet size={18} />}
        />
        <Metric
          label="Sipariş adedi"
          value={String(orders.length)}
          detail={`son ${days} gündeki siparişler`}
          icon={<ShoppingBag size={18} />}
          index={1}
        />
        <Metric
          label="Ortalama sepet"
          value={money(orders.length ? Math.round(revenue / orders.length) : 0)}
          detail="sipariş başına satış"
          icon={<ChartNoAxesCombined size={18} />}
          index={2}
        />
        <Metric
          label="Brüt ürün katkısı"
          value={unknownCosts ? '—' : money(contribution)}
          detail={
            unknownCosts
              ? `${unknownCosts} satırın satış anı maliyeti bilinmiyor`
              : 'komisyon ve işletme gideri hariç'
          }
          icon={<TrendingUp size={18} />}
          index={3}
        />
      </div>
      <Panel
        title="Satışların seyri"
        description={`Son ${days} gün · tüm satış kanalları`}
        className="report-chart"
      >
        <RevenueChart data={series} />
      </Panel>
      <Panel
        flush
        title="Kanal karşılaştırması"
        description="Satış ve brüt ürün katkısı, farklı amaçlarla gösterilir."
        className="report-channel-table"
      >
        <div className="simple-table-scroll">
          <table className="simple-table">
            <thead>
              <tr>
                <th>Satış kanalı</th>
                <th>Sipariş</th>
                <th>Pay</th>
                <th className="align-right">Satış tutarı</th>
                <th className="align-right">Brüt ürün katkısı</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((item) => (
                <tr key={item.channel}>
                  <td>
                    <ChannelBadge channel={item.channel} />
                  </td>
                  <td>{item.count}</td>
                  <td>
                    <div className="channel-share">
                      <span
                        style={{
                          width: `${Math.round((item.revenue / Math.max(1, revenue)) * 100)}%`,
                        }}
                      />
                      <small>%{Math.round((item.revenue / Math.max(1, revenue)) * 100)}</small>
                    </div>
                  </td>
                  <td className="align-right money-cell">{money(item.revenue)}</td>
                  <td className="align-right money-cell">
                    {item.contribution === null ? 'Maliyet eksik' : money(item.contribution)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="report-notes">
        <div>
          <strong>Veri kalitesi</strong>
          <p>
            {state.orders.flatMap((order) => order.lines).filter((line) => !line.variantId).length}{' '}
            eşleşmemiş sipariş satırı · {unknownCosts} eksik tarihsel maliyet. Katalog maliyetini
            sonradan değiştirmek geçmiş satışın maliyetini değiştirmez.
          </p>
        </div>
        <div>
          <strong>Brüt katkı nasıl hesaplanıyor?</strong>
          <p>
            Sipariş anındaki satış fiyatından alış maliyeti düşülür, KDV hariç hesaplanır. Pazaryeri
            komisyonu, kargo ve işletme giderleri bu tutara dahil değildir.
          </p>
        </div>
        <div>
          <strong>Perakende ayrı izlenir</strong>
          <p>
            Bu dönemde {retail.length} perakende satışı, toplam{' '}
            {money(retail.reduce((sum, sale) => sum + sale.total, 0))}. Stok ve kasa ortak; sipariş
            raporu ile perakende toplamları ayrıdır.
          </p>
        </div>
        <div>
          <strong>Bağımsız fatura satışları</strong>
          <p>
            Bu dönemde {invoices.length} bağımsız fatura, toplam{' '}
            {money(invoices.reduce((sum, invoice) => sum + invoiceTryTotal(state, invoice), 0))}.
            Sipariş kaynaklı faturalar ikinci kez sayılmaz; bağımsız faturalar yukarıdaki sipariş
            toplamına dahil değildir.
          </p>
        </div>
      </div>
    </>
  )
}
