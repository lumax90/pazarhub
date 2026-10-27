import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { Printer } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { channelNames } from '../domain/channels'
import { statusLabels } from '../domain/operations'
import { findVariant, orderTotal } from '../domain/selectors'
import { dateLabel, money } from '../lib/format'
import { BundleContents } from '../components/products/BundleContents'
import {
  foreignOrder,
  orderCurrencyTotal,
  orderCurrencyShipping,
  orderLineCurrencyPrice,
  orderLineCurrencyTotal,
} from '../domain/order-currency'
import { currencyMoney } from '../domain/money'
import { orderPrinted, orderPrintKey } from '../domain/orders'

export function OrderPrintPage() {
  const { state, run, can } = useApp(),
    [params] = useSearchParams()
  const [orders] = useState(() =>
    structuredClone(
      state.orders
        .filter((order) => (params.get('ids') ?? '').split(',').includes(order.id))
        .slice(0, 100),
    ),
  )
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const marked =
    orders.length > 0 &&
    orders.every((order) => {
      const current = state.orders.find((item) => item.id === order.id)
      return current && orderPrinted(current) && orderPrintKey(current) === orderPrintKey(order)
    })
  const mark = async (printed: boolean) => {
    setBusy(true)
    setError('')
    const problems: string[] = []
    for (const order of orders) {
      const result = await run(
        { type: 'order.print', id: order.id, printed, expectedContent: orderPrintKey(order) },
        { silent: true },
      )
      if (!result.ok) problems.push(`${order.number}: ${result.message}`)
    }
    setError(problems.join(' · '))
    setBusy(false)
  }
  return (
    <div className="order-print-page">
      <header className="order-print-toolbar">
        <Link to="/orders">Siparişlere dön</Link>
        <strong>{orders.length} sipariş</strong>
        <Button variant="primary" onPress={() => window.print()} isDisabled={!orders.length}>
          <Printer size={16} />
          Yazdır
        </Button>
        <Checkbox
          className="app-checkbox"
          isSelected={marked}
          isDisabled={!can('orders.write') || busy || !orders.length}
          onChange={(value) => void mark(value)}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Yazdırıldı olarak işaretle</Label>
          </Checkbox.Content>
        </Checkbox>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!orders.length && <p>Sipariş bulunamadı.</p>}
      {orders.map((order) => (
        <article className="order-print-document" key={order.id}>
          <header>
            <div>
              <strong>{state.preferences.businessName}</strong>
              <h1>Sipariş {order.number}</h1>
              <p>
                {dateLabel(order.createdAt, true)} · {channelNames[order.channel]} ·{' '}
                {statusLabels[order.status]}
              </p>
            </div>
            {order.externalNumber && <span>Kaynak no: {order.externalNumber}</span>}
          </header>
          <section className="order-print-addresses">
            <div>
              <h2>Gönderim adresi</h2>
              <strong>{order.shippingAddress?.name}</strong>
              <p>{order.shippingAddress?.address}</p>
              <p>
                {[
                  order.shippingAddress?.district,
                  order.shippingAddress?.city,
                  order.shippingAddress?.postalCode,
                  order.shippingAddress?.country,
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </p>
              <p>{order.shippingAddress?.phone}</p>
            </div>
            <div>
              <h2>Fatura adresi</h2>
              <strong>{order.billingAddress?.name}</strong>
              <p>{order.billingAddress?.address}</p>
              <p>
                {[order.billingAddress?.district, order.billingAddress?.city]
                  .filter(Boolean)
                  .join(' / ')}
              </p>
              {order.billingAddress?.taxId && <p>VKN / TCKN: {order.billingAddress.taxId}</p>}
            </div>
          </section>
          <table>
            <thead>
              <tr>
                <th>Ürün / hizmet</th>
                <th>Miktar</th>
                <th>Birim fiyat</th>
                <th>KDV</th>
                <th>Toplam</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line, index) => (
                <tr key={line.id ?? index}>
                  <td>
                    <strong>
                      {line.title || findVariant(state, line.variantId)?.product.name || 'Ürün'}
                    </strong>
                    <small>{line.sku || line.externalSku || line.variantName}</small>
                    <BundleContents line={line} expanded />
                  </td>
                  <td>
                    {line.quantity} {line.unit || 'Adet'}
                  </td>
                  <td>{currencyMoney(orderLineCurrencyPrice(order, line), order.currency)}</td>
                  <td>%{line.taxRate}</td>
                  <td>{currencyMoney(orderLineCurrencyTotal(order, line), order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="order-print-totals">
            <span>
              Kargo (KDV dahil): {currencyMoney(orderCurrencyShipping(order), order.currency)}
            </span>
            <strong>
              Genel toplam: {currencyMoney(orderCurrencyTotal(order), order.currency)}
            </strong>
            {foreignOrder(order) && (
              <span>
                TRY karşılığı: {money(orderTotal(order))} · TCMB {order.currencyRate?.date} · Kur:{' '}
                {(Number(order.currencyRate?.value) / 100000000).toLocaleString('tr-TR', {
                  maximumFractionDigits: 8,
                })}
              </span>
            )}
          </div>
          {order.note && (
            <section>
              <h2>Müşteri notu</h2>
              <p>{order.note}</p>
            </section>
          )}
          {order.trackingNumber && (
            <p>
              Kargo: {order.cargoProvider} · {order.trackingNumber}
            </p>
          )}
          <footer>Birim fiyatlar KDV dahil gösterilmiştir.</footer>
        </article>
      ))}
    </div>
  )
}
