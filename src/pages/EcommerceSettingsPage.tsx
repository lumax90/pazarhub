import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { Check, RefreshCw } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { AppState, EcommerceSettings } from '../domain/types'
import { defaultEcommerceSettings } from '../domain/ecommerce'
import {
  barcodePrefixProblem,
  barcodeScheme,
  gs1PrefixProblem,
  nextBarcodes,
  usedBarcodes,
} from '../domain/barcodes'
import { currencyCodes } from '../domain/money'
import { apiRequest } from '../lib/api'
import { Field, FilterTabs, PageHeader, Panel, SelectButton } from '../components/ui/shared'
import { DataTable } from '../components/ui/DataTable'
import { warehouses } from '../domain/inventory'

const tabs = [
  { id: 'general', label: 'Genel' },
  { id: 'stock', label: 'Ürün ve Stok' },
  { id: 'currency', label: 'Döviz Kurları' },
  { id: 'orders', label: 'Siparişler' },
]

/** What "Boş barkodları üret" will do with the prefixes as typed. */
function barcodeHelp(state: AppState, draft: EcommerceSettings) {
  const scheme = barcodeScheme(draft)
  if (!scheme)
    return 'GS1 Türkiye’den aldığınız firma önekini girin: ürün kartındaki “Boş barkodları üret” bu önekle kontrol haneli EAN-13 barkodlar üretir ve bunlar her pazaryerinde geçerlidir. GS1 öneki yoksa kendi önekinizle yalnız serbest barkod kabul eden pazaryerleri (ör. Trendyol) için barkod üretilir.'
  try {
    const [next] = nextBarcodes(scheme, usedBarcodes(state), 1)
    return scheme.kind === 'gs1'
      ? `Kontrol haneli EAN-13 barkodlar üretilir; sıradaki: ${next}. Pazarhub’daki ürünlerin en büyük numarasından devam eder. Bu önekle Pazarhub dışında numara verdiyseniz o ürünleri önce Pazarhub’a ekleyin; aksi hâlde aynı numara yeniden üretilebilir.`
      : `GS1 öneki olmadığından ${next} gibi barkodlar üretilir. Trendyol gibi serbest barkod kabul eden pazaryerlerinde kullanılabilir; Hepsiburada, ToptanTR ve PttAVM GS1 barkodu ister.`
  } catch (error) {
    return (error as Error).message
  }
}

export function EcommerceSettingsPage() {
  const [params] = useSearchParams()
  const { state, run, refresh, can, mode } = useApp(),
    [draft, setDraft] = useState<EcommerceSettings>(() =>
      structuredClone(state.ecommerce ?? defaultEcommerceSettings),
    ),
    [tab, setTab] = useState(() =>
      tabs.some((item) => item.id === params.get('tab')) ? params.get('tab')! : 'general',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const set = <K extends keyof EcommerceSettings>(key: K, value: EcommerceSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (busy) return
    setBusy(true)
    const result = await run({ type: 'ecommerce.settings', settings: draft })
    setBusy(false)
    if (result.ok) set('version', draft.version + 1)
    else setError(result.message)
  }
  return (
    <div>
      <PageHeader
        title="E-Ticaret Ayarları"
        description="Ürün fiyatı, döviz ve stok işlemlerinin varsayılan davranışı."
        actions={
          <Button
            variant="primary"
            isDisabled={busy || !can('workspace.manage')}
            onPress={() => void save()}
          >
            <Check size={15} />
            Ayarları kaydet
          </Button>
        }
      />
      <Panel className="product-form-card">
        <FilterTabs label="E-ticaret ayar bölümleri" value={tab} onChange={setTab} items={tabs} />
        <div className="form-section margin-rule-form ecommerce-settings-body">
          {tab === 'general' && (
            <div className="form-grid">
              <Field
                label="Varsayılan KDV oranı (%)"
                type="number"
                min={0}
                max={100}
                value={String(draft.defaultTaxRate)}
                onChange={(value) => set('defaultTaxRate', Number(value))}
              />
              <SelectButton
                label="Varsayılan döviz"
                value={draft.defaultCurrency}
                onChange={(value) =>
                  set('defaultCurrency', value as EcommerceSettings['defaultCurrency'])
                }
                options={currencyCodes.map((id) => ({ id, label: id }))}
              />
              <Field
                label="Varsayılan menşei"
                maxLength={2}
                value={draft.defaultOrigin}
                onChange={(value) => set('defaultOrigin', value.toUpperCase())}
              />
            </div>
          )}
          {tab === 'stock' && (
            <>
              <Checkbox
                className="app-checkbox"
                isSelected={draft.pricesIncludeVat}
                onChange={(value) => set('pricesIncludeVat', value)}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>Ürün fiyatları KDV dahil girilir</Label>
                </Checkbox.Content>
              </Checkbox>
              <p className="description field-description">
                Kapalıyken ürün fiyat kartlarında KDV hariç giriş yapılır. Kayıtlar ve pazaryerine
                gönderilen tutarlar KDV dahil korunur; mevcut fiyatlar ayar değişince yeniden
                yazılmaz.
              </p>
              <Checkbox
                className="app-checkbox"
                isSelected={draft.allowNegativeStock}
                onChange={(value) => set('allowNegativeStock', value)}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>Eksi stoğa izin ver (fazla satış)</Label>
                </Checkbox.Content>
              </Checkbox>
              <p className="description field-description">
                Pazaryerine gönderilen stok en az sıfırdır. Paket satışları fiziksel bileşen stoğuna
                işlenir.
              </p>
              <SelectButton
                label="E-ticaret stok depoları"
                value={draft.stockScope ?? 'selected'}
                onChange={(value) => {
                  set('stockScope', value as 'all' | 'selected')
                  if (!draft.warehouseIds) set('warehouseIds', ['main'])
                }}
                options={[
                  { id: 'selected', label: 'Seçili depolar' },
                  { id: 'all', label: 'Tüm etkin depolar' },
                ]}
              />
              {(draft.stockScope ?? 'selected') === 'selected' && (
                <div className="form-grid">
                  {warehouses(state)
                    .filter((warehouse) => warehouse.active)
                    .map((warehouse) => (
                      <Checkbox
                        key={warehouse.id}
                        className="app-checkbox"
                        isSelected={(draft.warehouseIds ?? ['main']).includes(warehouse.id)}
                        onChange={(checked) => {
                          set('stockScope', 'selected')
                          set(
                            'warehouseIds',
                            checked
                              ? [...(draft.warehouseIds ?? ['main']), warehouse.id]
                              : (draft.warehouseIds ?? ['main']).filter(
                                  (id) => id !== warehouse.id,
                                ),
                          )
                        }}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label>E-ticaret deposu · {warehouse.name}</Label>
                        </Checkbox.Content>
                      </Checkbox>
                    ))}
                </div>
              )}
              <p className="description field-description">
                Yeni siparişler seçilen depolardan karşılanır. Mağazada özel depo seçilmişse o seçim
                kullanılır. Paket içindeki bileşenler aynı depoda bulunmalı; tam paket adetleri
                depolar arasında dağıtılabilir.
              </p>
              <div className="form-grid">
                <Field
                  label="Yeni ürün düşük stok eşiği"
                  type="number"
                  min={0}
                  value={String(draft.lowStock)}
                  onChange={(value) => set('lowStock', Number(value))}
                />
                <Field
                  label="Kritik stok miktarı"
                  type="number"
                  min={0}
                  value={String(draft.criticalStock)}
                  onChange={(value) => set('criticalStock', Number(value))}
                />
              </div>
              <div className="form-grid">
                <Field
                  label="GS1 firma öneki"
                  value={draft.gs1Prefix ?? ''}
                  onChange={(value) => set('gs1Prefix', value.replace(/\D/g, '') || undefined)}
                  maxLength={11}
                  placeholder="Örn. 8691234"
                  error={draft.gs1Prefix && gs1PrefixProblem(draft.gs1Prefix)}
                />
                <Field
                  label="Kendi barkod önekiniz"
                  value={draft.barcodePrefix ?? ''}
                  onChange={(value) =>
                    set('barcodePrefix', value.toUpperCase().replace(/[^A-Z0-9]/g, '') || undefined)
                  }
                  maxLength={12}
                  placeholder="Örn. MARKA"
                  error={draft.barcodePrefix && barcodePrefixProblem(draft.barcodePrefix)}
                />
              </div>
              <p className="description field-description">{barcodeHelp(state, draft)}</p>
            </>
          )}
          {tab === 'currency' && (
            <>
              <div className="row-actions">
                <SelectButton
                  label="Kullanılacak kur türü"
                  value={draft.exchangeRateType}
                  onChange={(value) =>
                    set('exchangeRateType', value as EcommerceSettings['exchangeRateType'])
                  }
                  options={[
                    { id: 'forexSelling', label: 'Döviz Satış' },
                    { id: 'forexBuying', label: 'Döviz Alış' },
                    { id: 'banknoteSelling', label: 'Efektif Satış' },
                    { id: 'banknoteBuying', label: 'Efektif Alış' },
                  ]}
                />
                <Button
                  variant="secondary"
                  isDisabled={busy || mode !== 'live' || !can('workspace.manage')}
                  onPress={async () => {
                    setBusy(true)
                    setError('')
                    try {
                      await apiRequest('/api/exchange-rates/refresh', { method: 'POST', body: {} })
                      await refresh()
                    } catch (error) {
                      setError((error as Error).message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <RefreshCw size={14} />
                  TCMB’den güncelle
                </Button>
              </div>
              <p className="description field-description">
                TCMB · {state.exchangeRates?.date ?? 'Kur verisi henüz alınmadı'}. Saatlik
                yenilenir; tatillerde son yayımlanan kur kullanılır. Satışta kullanılan tutar ve kur
                geçmiş kayda sabitlenir.
              </p>
              <DataTable
                label="TCMB kurları"
                items={Object.entries(state.exchangeRates?.rates ?? {}).map(([id, rates]) => ({
                  id,
                  rates,
                }))}
                columns={[
                  { id: 'currency', label: 'Döviz', rowHeader: true, cell: (item) => item.id },
                  {
                    id: 'rate',
                    label: '1 birim karşılığı (TRY)',
                    cell: (item) =>
                      (Number(item.rates?.[draft.exchangeRateType]) / 100000000).toLocaleString(
                        'tr-TR',
                        { minimumFractionDigits: 4, maximumFractionDigits: 8 },
                      ),
                  },
                ]}
                paginate={false}
              />
            </>
          )}
          {tab === 'orders' && (
            <>
              <div className="form-grid">
                <Field
                  label="Sipariş listesi açılış aralığı (gün)"
                  type="number"
                  min={1}
                  max={15}
                  value={String(draft.orderDays)}
                  onChange={(value) => set('orderDays', Number(value))}
                />
                <Field
                  label="Varsayılan termin (gün)"
                  type="number"
                  min={0}
                  max={90}
                  value={String(draft.dueDays)}
                  onChange={(value) => set('dueDays', Number(value))}
                />
                <div className="select-field">
                  <label className="label">Sipariş faturası ne zaman kesilsin?</label>
                  <SelectButton
                    label="Sipariş faturası ne zaman kesilsin?"
                    value={draft.invoiceTiming ?? 'on_approval'}
                    onChange={(value) =>
                      set('invoiceTiming', value as EcommerceSettings['invoiceTiming'])
                    }
                    options={[
                      { id: 'manual', label: 'Kesilmesin (elle)' },
                      { id: 'on_created', label: 'Sipariş girilince' },
                      { id: 'on_approval', label: 'Onaylandığında' },
                      { id: 'on_shipped', label: 'Kargoya verildiğinde' },
                      { id: 'on_delivered', label: 'Teslim edildiğinde' },
                    ]}
                  />
                </div>
              </div>
              <p className="description field-description">
                Fatura önce burada oluşur; etkin ve test edilmiş varsayılan Paraşüt hesabı varsa
                aktarım ayrı iş olarak başlatılır. Zaman seçimi yeni siparişe kaydedilir; ayar
                değişince geçmiş siparişler veya faturalar yeniden kesilmez. Fatura oluşturma stok
                çıkışını tekrar etmez.
              </p>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Panel>
    </div>
  )
}
