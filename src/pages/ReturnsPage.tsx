import { useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { Plus, RotateCcw } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { SalesReturn } from '../domain/types'
import { findVariant, lineTotal } from '../domain/selectors'
import { dateLabel, money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import { Dialog, Field, FilterTabs, PageHeader, Panel, SelectButton } from '../components/ui/shared'
import { MarketplaceClaims } from '../components/marketplace/MarketplaceClaims'

export function ReturnsPage() {
  const { state, can } = useApp()
  const [params, setParams] = useSearchParams()
  const open = params.get('new') === '1'
  const setOpen = (value: boolean) => {
    const next = new URLSearchParams(params)
    if (value) next.set('new', '1')
    else next.delete('new')
    setParams(next, { replace: true })
  }
  const marketplace = params.get('view') === 'marketplace'
  return (
    <>
      <PageHeader
        title="İade Yönetimi"
        description={
          marketplace
            ? 'Mağazaların iade taleplerini inceleyin ve kalem bazında karar verin.'
            : 'Tam veya kısmi iadeyi, depoya dönüş ve geri ödeme tercihleriyle kaydedin.'
        }
        actions={
          !marketplace && (
            <Button
              variant="primary"
              isDisabled={!can('retail.write')}
              onPress={() => setOpen(true)}
            >
              <Plus size={16} />
              İade kaydet
            </Button>
          )
        }
      />
      <Panel flush className="list-panel">
        <FilterTabs
          label="İade görünümü"
          value={marketplace ? 'marketplace' : 'local'}
          onChange={(v) => setParams(v === 'marketplace' ? { view: v } : {})}
          items={[
            { id: 'local', label: 'Satış iadeleri', count: state.returns?.length ?? 0 },
            { id: 'marketplace', label: 'Pazaryeri talepleri' },
          ]}
        />
        {marketplace ? (
          <MarketplaceClaims />
        ) : (
          <DataTable
            label="Satış iadeleri"
            items={state.returns ?? []}
            columns={[
              {
                id: 'sale',
                label: 'Satış',
                rowHeader: true,
                cell: (r) =>
                  r.source === 'retail'
                    ? state.retailSales.find((s) => s.id === r.saleId)?.number
                    : state.orders.find((o) => o.id === r.saleId)?.number,
              },
              {
                id: 'type',
                label: 'Kaynak',
                cell: (r) => (
                  <Chip size="sm" variant="soft">
                    {r.source === 'retail' ? 'Perakende' : 'Sipariş'}
                  </Chip>
                ),
              },
              {
                id: 'items',
                label: 'İade adedi',
                cell: (r) => r.items.reduce((sum, item) => sum + item.quantity, 0),
              },
              {
                id: 'total',
                label: 'İade tutarı',
                className: 'align-right',
                cell: (r) => money(r.items.reduce((sum, item) => sum + item.amount, 0)),
              },
              {
                id: 'refund',
                label: 'Kasa çıkışı',
                className: 'align-right',
                cell: (r) => money(r.refund),
              },
              { id: 'note', label: 'Açıklama', cell: (r) => r.note },
              { id: 'date', label: 'Tarih', cell: (r) => dateLabel(r.createdAt, true) },
            ]}
            emptyTitle="Henüz iade kaydı yok"
            emptyDescription="İade kalemleri satış fiyatı ve miktarı üzerinden izlenir."
          />
        )}
      </Panel>
      <p className="page-explainer">
        <RotateCcw size={15} />
        Pazaryeri iade kararı ve fiziksel depo girişi ayrı işlemlerdir. Geri ödeme tercihi kasa
        defterine yazılır.
      </p>
      {open && can('retail.write') && <ReturnEditor onClose={() => setOpen(false)} />}
    </>
  )
}

function ReturnEditor({ onClose }: { onClose: () => void }) {
  const { state, run } = useApp()
  const [source, setSource] = useState<SalesReturn['source']>('retail'),
    [saleId, setSaleId] = useState(''),
    [quantities, setQuantities] = useState<Record<number, number>>({}),
    [restock, setRestock] = useState<Record<number, boolean>>({}),
    [refund, setRefund] = useState(true),
    [note, setNote] = useState(''),
    [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [id] = useState(() => crypto.randomUUID())
  const sales =
    source === 'retail'
      ? state.retailSales
      : state.orders.filter((o) => ['shipped', 'delivered'].includes(o.status))
  const sale = sales.find((s) => s.id === saleId)
  const prior = (state.returns ?? []).filter((r) => r.saleId === saleId && r.source === source)
  const save = async () => {
    if (busy) return
    setBusy(true)
    const result = await run({
      type: 'sale.return',
      id,
      source,
      saleId,
      items: Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .map(([index, quantity]) => ({
          lineIndex: Number(index),
          quantity,
          restock:
            sale?.lines[Number(index)]?.kind === 'free' ? false : (restock[Number(index)] ?? true),
        })),
      refund,
      method,
      note,
    })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      wide
      title="Satış iadesi"
      description="İade miktarı önceki iadeler çıkarıldıktan sonra kalan miktarla sınırlıdır."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" isDisabled={busy || !saleId} onPress={() => void save()}>
            {busy ? 'Kaydediliyor…' : 'İadeyi kaydet'}
          </Button>
        </>
      }
    >
      <div className="form-section">
        <div className="form-grid">
          <SelectButton
            label="İade kaynağı"
            value={source}
            onChange={(value) => {
              setSource(value as SalesReturn['source'])
              setSaleId('')
              setQuantities({})
            }}
            options={[
              { id: 'retail', label: 'Perakende satışı' },
              { id: 'order', label: 'E-ticaret siparişi' },
            ]}
          />
          <SelectButton
            label="İade edilecek satış"
            value={saleId}
            onChange={(value) => {
              setSaleId(value)
              setQuantities({})
              setRestock({})
            }}
            options={sales.map((s) => ({ id: s.id, label: s.number }))}
          />
        </div>
        <div className="return-lines">
          {sale?.lines.map((line, index) => {
            const already = prior
              .flatMap((r) => r.items)
              .filter((i) => i.lineIndex === index)
              .reduce((sum, i) => sum + i.quantity, 0)
            return (
              <div key={index}>
                <div>
                  <strong>
                    {line.title || findVariant(state, line.variantId)?.product.name || 'Ürün'}
                  </strong>
                  <small>
                    {line.quantity - already} adet iade edilebilir · {money(lineTotal(line))}
                  </small>
                </div>
                <Field
                  label="İade adedi"
                  type="number"
                  value={String(quantities[index] ?? 0)}
                  onChange={(value) =>
                    setQuantities((current) => ({ ...current, [index]: Number(value) }))
                  }
                />
                <Checkbox
                  className="app-checkbox"
                  isSelected={line.kind === 'free' ? false : (restock[index] ?? true)}
                  isDisabled={line.kind === 'free'}
                  onChange={(value) => setRestock((current) => ({ ...current, [index]: value }))}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Label>Stoka al</Label>
                  </Checkbox.Content>
                </Checkbox>
              </div>
            )
          })}
        </div>
        <Field label="İade açıklaması" value={note} onChange={setNote} required />
        <Checkbox className="app-checkbox" isSelected={refund} onChange={setRefund}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Tahsil edilmiş tutar için geri ödeme kaydı oluştur</Label>
          </Checkbox.Content>
        </Checkbox>
        {refund && (
          <SelectButton
            label="Geri ödeme yöntemi"
            value={method}
            onChange={(value) => setMethod(value as typeof method)}
            options={[
              { id: 'cash', label: 'Nakit' },
              { id: 'card', label: 'Kart' },
              { id: 'transfer', label: 'Havale' },
            ]}
          />
        )}{' '}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
