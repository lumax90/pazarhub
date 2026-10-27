import { useState } from 'react'
import { Button } from '@heroui/react'
import { useApp } from '../../app/AppProvider'
import { productPrice } from '../../domain/selectors'
import { money } from '../../lib/format'
import { DataTable } from '../ui/DataTable'
import { Dialog, Field, SelectButton } from '../ui/shared'

export function BulkProducts({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { state, run } = useApp()
  const [products] = useState(() =>
    state.products.filter((p) => ids.includes(p.id)).map((p) => structuredClone(p)),
  )
  const [action, setAction] = useState('price'),
    [value, setValue] = useState('10'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const change =
    action === 'price'
      ? { pricePercent: Number(value) }
      : action === 'category'
        ? { category: value }
        : action === 'brand'
          ? { brand: value }
          : { active: action === 'activate' }
  const targets = products.filter(
    (product) => action !== 'price' || product.bundle?.priceMode !== 'linked',
  )
  const apply = async () => {
    if (busy) return
    setBusy(true)
    const result = await run({
      type: 'product.bulk',
      ids: targets.map((p) => p.id),
      expectedVersions: Object.fromEntries(targets.map((p) => [p.id, p.version ?? 0])),
      change,
    })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      wide
      title="Toplu ürün düzenleme"
      description={`Geçerli filtredeki ilk ${products.length} ürün. Aşağıdaki önizleme bu ürünlere uygulanacak.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            isDisabled={
              busy || !targets.length || (action === 'price' && !Number.isFinite(Number(value)))
            }
            onPress={() => void apply()}
          >
            Önizlemeyi uygula
          </Button>
        </>
      }
    >
      <div className="form-section">
        <SelectButton
          label="Toplu işlem türü"
          value={action}
          onChange={(next) => {
            setAction(next)
            setValue(next === 'price' ? '10' : '')
          }}
          options={[
            { id: 'price', label: 'Satış fiyatını yüzde değiştir' },
            { id: 'category', label: 'Kategori değiştir' },
            { id: 'brand', label: 'Marka değiştir' },
            { id: 'activate', label: 'Ürünleri etkinleştir' },
            { id: 'deactivate', label: 'Ürünleri pasifleştir' },
          ]}
        />
        {['price', 'category', 'brand'].includes(action) && (
          <Field
            label={action === 'price' ? 'Değişim yüzdesi (azalış için eksi)' : 'Yeni değer'}
            value={value}
            onChange={setValue}
            type={action === 'price' ? 'number' : 'text'}
          />
        )}
        {targets.length !== products.length && (
          <p className="description field-description">
            Bağlı paket fiyatları bileşenlerden hesaplanır; bu satırlara doğrudan fiyat değişikliği
            uygulanmaz.
          </p>
        )}
        <DataTable
          label="Toplu değişiklik önizlemesi"
          items={products}
          columns={[
            { id: 'name', label: 'Ürün', rowHeader: true, cell: (p) => p.name },
            {
              id: 'before',
              label: 'Mevcut',
              cell: (p) =>
                action === 'price'
                  ? money(productPrice(p, state))
                  : action === 'category'
                    ? p.category
                    : action === 'brand'
                      ? p.brand
                      : p.active
                        ? 'Aktif'
                        : 'Pasif',
            },
            {
              id: 'after',
              label: 'Yeni değer',
              cell: (p) =>
                action === 'price'
                  ? p.bundle?.priceMode === 'linked'
                    ? 'Bileşen fiyatlarından'
                    : money(Math.round(productPrice(p, state) * (1 + Number(value) / 100)))
                  : action === 'category' || action === 'brand'
                    ? value
                    : action === 'activate'
                      ? 'Aktif'
                      : 'Pasif',
            },
          ]}
        />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
