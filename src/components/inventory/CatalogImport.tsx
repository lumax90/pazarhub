import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { ArrowRight, Check, FileUp, RefreshCw } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { currencyMoney } from '../../domain/money'
import { importFields } from '../../domain/catalog-import'
import type {
  ImportField,
  ImportInspection,
  ImportOptions,
  ImportPreview,
} from '../../domain/catalog-import'
import { warehouses } from '../../domain/inventory'
import { apiMutation, apiRequest } from '../../lib/api'
import { downloadCsv } from '../../lib/format'
import { DataTable } from '../ui/DataTable'
import { Dialog, SectionTitle, SelectButton } from '../ui/shared'

export function CatalogImportButton() {
  const { mode, can } = useApp(),
    [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="secondary"
        isDisabled={mode !== 'live' || !can('catalog.write')}
        onPress={() => setOpen(true)}
      >
        <FileUp size={16} />
        İçe aktar
      </Button>
      {open && <CatalogImportDialog onClose={() => setOpen(false)} />}
    </>
  )
}
function CatalogImportDialog({ onClose }: { onClose: () => void }) {
  const { state, notify, refresh, can } = useApp()
  const [source, setSource] = useState<{
      name: string
      text: string
      format: 'csv' | 'xml'
    } | null>(null),
    [inspection, setInspection] = useState<ImportInspection | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const [options, setOptions] = useState<ImportOptions>({
    mapping: {},
    mode: 'create',
    decimal: ',',
    warehouseId: warehouses(state).find((w) => w.active)?.id ?? 'main',
  })
  const inspect = async (
    file: { name: string; text: string; format: 'csv' | 'xml' },
    recordPath?: string,
  ) => {
    setBusy('file')
    setError('')
    setPreview(null)
    try {
      const result = await apiRequest<ImportInspection>('/api/catalog-imports', {
        method: 'POST',
        body: { ...file, recordPath },
      })
      setSource(file)
      setInspection(result)
      setOptions((old) => ({
        ...old,
        mapping: result.suggested,
        decimal: result.samples.some((row) =>
          /\.\d{1,2}$/.test(row[result.suggested.price ?? ''] ?? ''),
        )
          ? '.'
          : ',',
      }))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Dosya okunamadı.')
    } finally {
      setBusy('')
    }
  }
  const readFile = async (file: File) => {
    setError('')
    if (!/\.(csv|xml)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      setError('En fazla 2 MB boyutunda CSV veya XML dosyası seçin.')
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const encoding =
        bytes[0] === 255 && bytes[1] === 254
          ? 'utf-16le'
          : bytes[0] === 254 && bytes[1] === 255
            ? 'utf-16be'
            : 'utf-8'
      let text: string
      try {
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
      } catch {
        text = new TextDecoder('windows-1254').decode(bytes)
      }
      await inspect({ name: file.name, text, format: /\.xml$/i.test(file.name) ? 'xml' : 'csv' })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Dosya okunamadı.')
    }
  }
  const set = <K extends keyof ImportOptions>(key: K, value: ImportOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }))
    setPreview(null)
  }
  const map = (field: ImportField, column: string) => {
    const next = { ...options.mapping }
    if (column) next[field] = column
    else delete next[field]
    set('mapping', next)
  }
  const review = async () => {
    if (!inspection || busy) return
    setBusy('preview')
    setError('')
    try {
      setPreview(
        await apiRequest<ImportPreview>(`/api/catalog-imports/${inspection.id}/preview`, {
          method: 'POST',
          body: options,
        }),
      )
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Önizleme oluşturulamadı.')
    } finally {
      setBusy('')
    }
  }
  const apply = async () => {
    if (!inspection || !preview || busy) return
    setBusy('apply')
    setError('')
    try {
      const result = await apiMutation<{ ok: true; count: number }>(
        `/api/catalog-imports/${inspection.id}/apply`,
        { previewId: preview.id },
      )
      await refresh()
      notify(`${result.count} varyant içe aktarıldı.`)
      onClose()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'İçe aktarma tamamlanamadı.')
    } finally {
      setBusy('')
    }
  }
  return (
    <Dialog
      open
      wide
      title="Kataloğu içe aktar"
      description="CSV veya XML dosyasını eşleyin, değişiklikleri önizleyin ve tek işlemde kaydedin."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          {preview ? (
            <>
              <Button variant="secondary" isDisabled={!!busy} onPress={() => setPreview(null)}>
                Eşlemeye dön
              </Button>
              <Button
                variant="primary"
                isDisabled={!!busy || preview.errors.length > 0}
                onPress={() => void apply()}
              >
                <Check size={15} />
                {busy === 'apply' ? 'Kaydediliyor…' : 'İçe aktarmayı uygula'}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              isDisabled={!!busy || !inspection || !options.mapping.sku}
              onPress={() => void review()}
            >
              Önizlemeyi oluştur
              <ArrowRight size={15} />
            </Button>
          )}
        </>
      }
    >
      <div className="catalog-import-steps">
        <Chip variant="soft" color={inspection ? 'default' : 'accent'} size="sm">
          1. Dosya
        </Chip>
        <span>→</span>
        <Chip variant="soft" color={inspection && !preview ? 'accent' : 'default'} size="sm">
          2. Alan eşleme
        </Chip>
        <span>→</span>
        <Chip variant="soft" color={preview ? 'accent' : 'default'} size="sm">
          3. Önizleme
        </Chip>
      </div>
      {error && (
        <div className="resource-error" role="alert">
          {error}
          {inspection && (
            <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={() => void review()}>
              <RefreshCw size={14} />
              Önizlemeyi yenile
            </Button>
          )}
        </div>
      )}
      {!preview ? (
        <>
          <SectionTitle title="Dosya seçimi">
            <label className="label file-upload-button">
              En fazla 500 varyant · CSV / XML
              <input
                className="input input--secondary"
                aria-label="CSV veya XML dosyası"
                type="file"
                accept=".csv,.xml"
                disabled={!!busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void readFile(file)
                }}
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              onPress={() =>
                downloadCsv(
                  'pazarhub-katalog-sablonu.csv',
                  [
                    'Model',
                    'SKU',
                    'Barkod',
                    'Ürün adı',
                    'Varyant',
                    'Kategori',
                    'Marka',
                    'Satış fiyatı',
                    'Alış maliyeti',
                    'Stok',
                    'KDV',
                  ],
                  [
                    [
                      'KUPA',
                      'KUPA-BEYAZ',
                      '869000000001',
                      'Seramik kupa',
                      'Beyaz',
                      'Mutfak',
                      'Atölye',
                      '149,90',
                      '70,00',
                      12,
                      20,
                    ],
                    [
                      'KUPA',
                      'KUPA-SIYAH',
                      '869000000002',
                      'Seramik kupa',
                      'Siyah',
                      'Mutfak',
                      'Atölye',
                      '159,90',
                      '75,00',
                      8,
                      20,
                    ],
                  ],
                )
              }
            >
              CSV şablonunu indir
            </Button>
            {inspection && (
              <div className="import-file-summary">
                <FileUp size={18} />
                <strong>{inspection.name}</strong>
                <span>
                  {inspection.count} kayıt · {inspection.columns.length} sütun
                </span>
              </div>
            )}
            {inspection && inspection.recordPaths.length > 1 && (
              <SelectButton
                label="XML kayıt yolu"
                value={inspection.recordPath ?? ''}
                isDisabled={!!busy}
                options={inspection.recordPaths.map((p) => ({
                  id: p.path,
                  label: `${p.path} · ${p.count} kayıt`,
                }))}
                onChange={(path) => {
                  if (source) void inspect(source, path)
                }}
              />
            )}
          </SectionTitle>
          {inspection && (
            <>
              <SectionTitle title="İçe aktarma ayarları">
                <div className="form-grid">
                  <SelectButton
                    label="İçe aktarma yöntemi"
                    value={options.mode}
                    onChange={(value) => set('mode', value as ImportOptions['mode'])}
                    options={[
                      { id: 'create', label: 'Yalnız yeni SKU ekle' },
                      { id: 'upsert', label: 'SKU üzerinden güncelle / ekle' },
                    ]}
                  />
                  <SelectButton
                    label="Ondalık ayıracı"
                    value={options.decimal}
                    onChange={(value) => set('decimal', value as ImportOptions['decimal'])}
                    options={[
                      { id: ',', label: 'Türkçe · 1.250,50' },
                      { id: '.', label: 'Nokta · 1,250.50' },
                    ]}
                  />
                  <SelectButton
                    label="Stok için hedef depo"
                    value={options.warehouseId}
                    onChange={(value) => set('warehouseId', value)}
                    options={warehouses(state)
                      .filter((w) => w.active)
                      .map((w) => ({ id: w.id, label: w.name }))}
                  />
                </div>
                <p className="description field-description">
                  Ortak model kodu aynı olan satırlar tek ürünün varyantları olur. Boş hücreler
                  mevcut değerleri korur. Stok sütunu seçilen deponun toplam bakiyesidir.
                </p>
              </SectionTitle>
              <SectionTitle title="Dosya alanlarını eşleyin">
                <div className="import-mapping-grid">
                  {importFields.map((field) => (
                    <div className="import-mapping-field" key={field.id}>
                      <strong className="label">
                        {field.label}
                        {field.id === 'sku' ? ' *' : ''}
                      </strong>
                      <SelectButton
                        label={`${field.label} sütunu`}
                        value={options.mapping[field.id] ?? ''}
                        onChange={(value) => map(field.id, value)}
                        isDisabled={field.id === 'stock' && !can('stock.write')}
                        options={[
                          { id: '', label: 'Eşleme yok' },
                          ...inspection.columns.map((c) => ({ id: c, label: c })),
                        ]}
                      />
                      <small>
                        {options.mapping[field.id]
                          ? inspection.samples[0]?.[options.mapping[field.id]!] || 'İlk kayıtta boş'
                          : 'Dosyadan alınmayacak'}
                      </small>
                    </div>
                  ))}
                </div>
              </SectionTitle>
            </>
          )}
          {busy === 'file' && (
            <p role="status" className="description field-description">
              Dosya alanları okunuyor…
            </p>
          )}
        </>
      ) : (
        <>
          <div className="import-preview-summary">
            <span>
              <strong>{preview.newProducts}</strong> yeni ürün
            </span>
            <span>
              <strong>{preview.updatedProducts}</strong> güncellenen ürün
            </span>
            <span>
              <strong>{preview.stockChanges}</strong> depo düzeltmesi
            </span>
          </div>
          {preview.errors.length > 0 && (
            <div className="import-errors" role="alert">
              <strong>{preview.errors.length} hata düzeltilmeli</strong>
              <ul>
                {preview.errors.slice(0, 30).map((issue, index) => (
                  <li key={index}>
                    {issue.row ? `${issue.row}. kayıt · ` : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DataTable
            label="İçe aktarma önizlemesi"
            items={preview.rows}
            columns={[
              { id: 'row', label: 'Kayıt', cell: (r) => r.row },
              {
                id: 'sku',
                label: 'SKU / ürün',
                rowHeader: true,
                cell: (r) => (
                  <span>
                    <strong>{r.sku}</strong>
                    <small className="cell-secondary">{r.name}</small>
                  </span>
                ),
              },
              {
                id: 'type',
                label: 'İşlem',
                cell: (r) => (
                  <Chip
                    size="sm"
                    variant="soft"
                    color={r.action === 'create' ? 'success' : 'accent'}
                  >
                    {r.action === 'create' ? 'Yeni varyant' : 'Güncelleme'}
                  </Chip>
                ),
              },
              {
                id: 'price',
                label: 'Satış fiyatı',
                className: 'align-right',
                cell: (r) => currencyMoney(r.price, r.currency),
              },
              { id: 'stock', label: 'Depo stoku', cell: (r) => r.stock ?? 'Korunur' },
            ]}
          />
          <p className="description field-description">
            Stok ve fiyat işlemleri birlikte kaydedilir. Kaynak veri değişirse önizlemeyi
            yenilemeniz istenir.
          </p>
        </>
      )}
    </Dialog>
  )
}
