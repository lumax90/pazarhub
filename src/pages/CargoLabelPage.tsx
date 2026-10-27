import { useState } from 'react'
import { Button } from '@heroui/react'
import { Printer } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { channelNames } from '../domain/channels'
import { cargoLabelFormats, cargoLabels } from '../domain/cargo-labels'
import type { CargoLabel, CargoLabelFormat } from '../domain/cargo-labels'
import { Barcode } from '../components/ui/Barcode'
import { SelectButton } from '../components/ui/shared'
import { dateLabel } from '../lib/format'

const formatKey = 'pazarhub.cargoLabelFormat'
const paper: Record<CargoLabelFormat, string> = {
  '100x100': '100 × 100 mm',
  '100x150': '100 × 150 mm',
  a4: 'A4',
}

function storedFormat(): CargoLabelFormat {
  try {
    const value = localStorage.getItem(formatKey)
    return cargoLabelFormats.find((format) => format.id === value)?.id ?? '100x100'
  } catch {
    return '100x100'
  }
}

/** Our own cargo label with the marketplace tracking code, for any printer. */
export function CargoLabelPage() {
  const { state } = useApp(),
    [params] = useSearchParams(),
    [format, setFormat] = useState(storedFormat)
  const ids = (params.get('ids') ?? '').split(',')
  const { labels, skipped } = cargoLabels(
    state,
    state.orders.filter((order) => ids.includes(order.id)).slice(0, 200),
    params.get('package') ?? undefined,
  )
  const business = state.business ?? {}
  const sender = [
    business.legalName || state.preferences.businessName,
    [business.address, [business.district, business.city].filter(Boolean).join(' / ')]
      .filter(Boolean)
      .join(', '),
    business.phone && `Tel: ${business.phone}`,
  ].filter((line): line is string => !!line)
  const choose = (value: string) => {
    setFormat(value as CargoLabelFormat)
    try {
      localStorage.setItem(formatKey, value)
    } catch {
      // The choice simply is not remembered.
    }
  }
  const sheets =
    format === 'a4'
      ? Array.from({ length: Math.ceil(labels.length / 4) }, (_, index) =>
          labels.slice(index * 4, index * 4 + 4),
        )
      : labels.map((label) => [label])
  return (
    <div className={`order-print-page order-print-labels order-print-labels--${format}`}>
      <header className="order-print-toolbar">
        <Link to="/orders">Siparişlere dön</Link>
        <strong>{labels.length} kargo etiketi</strong>
        <SelectButton
          label="Etiket boyutu"
          value={format}
          onChange={choose}
          options={cargoLabelFormats.map((item) => ({ id: item.id, label: item.label }))}
        />
        <Button variant="primary" onPress={() => window.print()} isDisabled={!labels.length}>
          <Printer size={16} />
          Yazdır
        </Button>
      </header>
      <p className="order-print-label-hint">
        Yazdırma penceresinde kâğıt boyutunu {paper[format]}, kenar boşluğunu “Yok” ve ölçeği %100
        seçin.
        {format !== 'a4' && ' Termal yazıcının sürücüsünde etiket boyutu aynı olmalı.'}
      </p>
      {skipped.length > 0 && (
        <ul className="order-print-label-skipped">
          {skipped.map(({ order, reason }, index) => (
            <li key={`${order.id}-${index}`}>
              <Link to={`/orders/${order.id}`}>{order.externalNumber || order.number}</Link>:{' '}
              {reason}
            </li>
          ))}
        </ul>
      )}
      {!labels.length && !skipped.length && <p>Sipariş bulunamadı.</p>}
      {sheets.map((sheet) => (
        <section className="order-print-label-sheet" key={sheet[0].key}>
          {sheet.map((label) => (
            <LabelCard
              key={label.key}
              label={label}
              sender={sender}
              compact={format === '100x100'}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function LabelCard({
  label,
  sender,
  compact,
}: {
  label: CargoLabel
  sender: string[]
  compact: boolean
}) {
  const { order } = label,
    address = order.shippingAddress
  return (
    <article className="order-print-label">
      <header>
        <strong className="order-print-label-carrier">{label.carrier}</strong>
        <span>
          {channelNames[order.channel]}
          {label.part && ` · Paket ${label.part}`}
        </span>
      </header>
      <div className="order-print-label-code">
        <Barcode value={label.trackingNumber} widthMm={86} heightMm={compact ? 17 : 26} />
        <span>{label.trackingNumber}</span>
      </div>
      <section className="order-print-label-recipient">
        <h2>Alıcı</h2>
        <strong>{address?.name || 'Alıcı adı yok'}</strong>
        <p>{address?.address}</p>
        <p className="order-print-label-city">
          {[address?.district, address?.city].filter(Boolean).join(' / ')}
        </p>
        {address?.phone && <p>Tel: {address.phone}</p>}
      </section>
      <section className="order-print-label-sender">
        <h2>Gönderici</h2>
        <p>{sender.join(' · ')}</p>
      </section>
      <footer>
        <span>
          Sipariş {order.externalNumber || order.number}
          {label.packageNumber && ` · Paket ${label.packageNumber}`}
        </span>
        <span>
          {label.items} ürün · {dateLabel(order.createdAt)}
        </span>
      </footer>
    </article>
  )
}
