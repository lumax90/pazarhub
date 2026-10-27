import { useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { Check, Link2, Plus, RefreshCw } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { RemoteProduct } from '../../domain/integrations'
import { findVariant } from '../../domain/selectors'
import { apiRequest } from '../../lib/api'
import { useResource } from '../../lib/useResource'
import { money } from '../../lib/format'
import { DataTable } from '../ui/DataTable'
import type { Column } from '../ui/DataTable'
import { AsyncState } from '../ui/AsyncState'
import { Dialog, EmptyState, MoneyField, SearchBox, SelectButton } from '../ui/shared'

interface RemoteRow {
  id: string
  external_id: string
  document: RemoteProduct
  local_id: string | null
  seen_at: string
}
export function ProductMapping({ storeId }: { storeId: string }) {
  const { state, notify, refresh, can } = useApp()
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0)
  const [selected, setSelected] = useState<{ row: RemoteRow; mode: 'link' | 'import' } | null>(null)
  const [variantId, setVariantId] = useState(''),
    [search, setSearch] = useState('')
  const [stock, setStock] = useState(false),
    [tax, setTax] = useState('20'),
    [cost, setCost] = useState(0)
  const [busy, setBusy] = useState(false)
  const resource = useResource<{ products: RemoteRow[] }>(
    storeId && storeId !== 'all' && can('catalog.write')
      ? `/api/remote-products?connectionId=${encodeURIComponent(storeId)}&query=${encodeURIComponent(query)}&offset=${page * 50}&limit=50`
      : null,
  )
  const variants = state.products.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  )
  const suggestions = (row: RemoteRow) =>
    variants.filter(({ variant }) =>
      row.document.barcode
        ? variant.barcode === row.document.barcode
        : row.document.sku && variant.sku === row.document.sku,
    )
  const choose = (row: RemoteRow, mode: 'link' | 'import') => {
    setSelected({ row, mode })
    const suggested = suggestions(row)
    setVariantId(suggested.length === 1 ? suggested[0].variant.id : '')
    setSearch('')
    setStock(false)
    setTax(String(row.document.taxRate ?? 20))
    setCost(0)
  }
  const save = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      await apiRequest(`/api/remote-products/${selected.row.id}/map`, {
        method: 'POST',
        body:
          selected.mode === 'link'
            ? { mode: 'link', variantId }
            : {
                mode: 'import',
                initialStock: stock ? 'remote' : 'zero',
                taxRate: Number(tax),
                cost,
              },
      })
      notify(
        selected.mode === 'import'
          ? 'Ürün ve mağaza ilanı oluşturuldu.'
          : 'İlan yerel varyanta bağlandı.',
      )
      setSelected(null)
      await refresh()
      await resource.reload()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Eşleme kaydedilemedi.', 'error')
    } finally {
      setBusy(false)
    }
  }
  const columns: Column<RemoteRow>[] = [
    {
      id: 'product',
      label: 'Pazaryerindeki ürün',
      rowHeader: true,
      cell: (row) => (
        <div className="mapping-product">
          {row.document.images[0] && (
            <img src={row.document.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" />
          )}
          <div>
            <strong>{row.document.title}</strong>
            <small>
              {row.document.sku || 'Stok kodu yok'} · {row.document.barcode || 'Barkod yok'}
            </small>
          </div>
        </div>
      ),
    },
    {
      id: 'quantity',
      label: 'Uzak stok',
      className: 'align-right',
      cell: (row) => row.document.quantity,
    },
    {
      id: 'price',
      label: 'Uzak fiyat',
      className: 'align-right',
      cell: (row) => money(row.document.price),
    },
    {
      id: 'match',
      label: 'Yerel eşleme',
      cell: (row) =>
        row.local_id ? (
          <span>
            {findVariant(state, row.local_id)?.variant.sku ?? 'Bağlı'}
            <Chip size="sm" variant="soft" color="success">
              Bağlı
            </Chip>
          </span>
        ) : (
          <Chip
            size="sm"
            variant="soft"
            color={suggestions(row).length === 1 ? 'accent' : 'default'}
          >
            {suggestions(row).length === 1 ? 'Öneri var' : 'Eşleşme yok'}
          </Chip>
        ),
    },
    {
      id: 'actions',
      label: '',
      cell: (row) =>
        !row.local_id && (
          <div className="row-actions">
            <Button size="sm" variant="secondary" onPress={() => choose(row, 'link')}>
              <Link2 size={13} />
              Bağla
            </Button>
            <Button size="sm" variant="ghost" onPress={() => choose(row, 'import')}>
              <Plus size={13} />
              Ürün olarak al
            </Button>
          </div>
        ),
    },
  ]
  if (!storeId || storeId === 'all')
    return (
      <EmptyState
        title="Önce bir mağaza seçin"
        description="Uzak ilan havuzu seçtiğiniz bağlantıya aittir."
      />
    )
  return (
    <>
      <div className="mapping-toolbar">
        <SearchBox
          value={query}
          onChange={(value) => {
            setQuery(value)
            setPage(0)
          }}
          label="Uzak katalogda ara"
          placeholder="Pazaryeri adı, SKU veya barkod…"
        />
        <Button size="sm" variant="secondary" onPress={() => void resource.reload()}>
          <RefreshCw size={14} />
          Yenile
        </Button>
      </div>
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      <DataTable
        key={storeId + page + query}
        items={resource.data?.products ?? []}
        columns={columns}
        label="Uzak ürün eşlemeleri"
        emptyTitle="Uzak katalog henüz alınmadı"
        emptyDescription="Bağlantılar ekranından katalog almayı başlatın; ardından eşleme önerileri burada görünür."
      />
      <div className="mapping-toolbar">
        <Button
          variant="secondary"
          size="sm"
          isDisabled={page === 0}
          onPress={() => setPage((p) => p - 1)}
        >
          Önceki 50
        </Button>
        <span className="record-count">Sayfa {page + 1}</span>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={(resource.data?.products.length ?? 0) < 50}
          onPress={() => setPage((p) => p + 1)}
        >
          Sonraki 50
        </Button>
      </div>
      {selected && (
        <Dialog
          open
          title={selected.mode === 'link' ? 'Yerel varyanta bağla' : 'Uzak ürünü kataloğa al'}
          description={selected.row.document.title}
          onClose={() => setSelected(null)}
          footer={
            <>
              <Button variant="secondary" onPress={() => setSelected(null)} isDisabled={busy}>
                Vazgeç
              </Button>
              <Button
                variant="primary"
                onPress={() => void save()}
                isDisabled={busy || (selected.mode === 'link' && !variantId)}
              >
                <Check size={16} />
                {busy ? 'Kaydediliyor…' : 'Eşlemeyi kaydet'}
              </Button>
            </>
          }
        >
          {selected.mode === 'link' ? (
            <div className="form-section">
              <SearchBox
                value={search}
                onChange={setSearch}
                label="Yerel varyant ara"
                placeholder="Ürün veya stok kodu…"
              />
              <SelectButton
                label="Eşlenecek varyant"
                value={variantId}
                onChange={setVariantId}
                options={variants
                  .filter(({ product, variant }) =>
                    `${product.name} ${variant.sku} ${variant.barcode}`
                      .toLocaleLowerCase('tr-TR')
                      .includes(search.toLocaleLowerCase('tr-TR')),
                  )
                  .slice(0, 100)
                  .map(({ product, variant }) => ({
                    id: variant.id,
                    label: `${product.name} · ${variant.name} · ${variant.sku}`,
                  }))}
              />
              <p className="description field-description">
                Eşleme stok ve fiyatı değiştirmez. İlanın mevcut fiyatı mağazaya özel değer olarak
                kaydedilir.
              </p>
            </div>
          ) : (
            <div className="form-section">
              <div className="select-field">
                <label className="label">KDV oranı</label>
                <SelectButton
                  label="İçe alınan ürün KDV oranı"
                  value={tax}
                  onChange={setTax}
                  options={[0, 1, 10, 20].map((value) => ({
                    id: String(value),
                    label: `%${value}`,
                  }))}
                />
              </div>
              <MoneyField label="Alış maliyeti (₺)" initialValue={cost} onChange={setCost} />
              <Checkbox className="app-checkbox" isSelected={stock} onChange={setStock}>
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>
                    Açılış stoğunu pazaryerinden al ({selected.row.document.quantity} adet)
                  </Label>
                </Checkbox.Content>
              </Checkbox>
              <p className="description field-description">
                Seçilmezse sıfır stokla oluşturulur. Açılış stoğu hareket defterine yazılır.
              </p>
            </div>
          )}
        </Dialog>
      )}
    </>
  )
}
