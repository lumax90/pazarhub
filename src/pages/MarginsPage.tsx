import { useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { Calculator, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useApp } from '../app/AppProvider'
import type { MarginRule, MarginSettings } from '../domain/types'
import {
  calculateMargin,
  defaultMarginSettings,
  listingPricing,
  marginScopes,
} from '../domain/margins'
import { money } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import {
  Dialog,
  Field,
  FilterTabs,
  MoneyField,
  PageHeader,
  Panel,
  SelectButton,
} from '../components/ui/shared'
import { SearchSelect } from '../components/ui/SearchSelect'

export function MarginsPage() {
  const { state, run, can } = useApp()
  const [storeId, setStore] = useState(state.connections[0]?.id ?? ''),
    [scope, setScope] = useState<MarginRule['scope']>('all')
  const [editing, setEditing] = useState<MarginRule | null>(null),
    [templateOpen, setTemplateOpen] = useState(false),
    [deleting, setDeleting] = useState<MarginRule | null>(null),
    [busy, setBusy] = useState(false)
  const settings =
    state.marginSettings?.find((item) => item.storeId === storeId) ?? defaultMarginSettings(storeId)
  const rows = (state.marginRules ?? []).filter(
    (rule) => rule.storeId === storeId && rule.scope === scope,
  )
  const open = () =>
    setEditing({
      id: crypto.randomUUID(),
      storeId,
      scope,
      value: '',
      base: settings.base,
      markupBps: 0,
      commissionBps: 0,
      fixedCost: 0,
      shippingCost: 0,
      kind: 'percent',
      direction: 'increase',
      active: true,
      version: 0,
      formula: settings.formula,
      ...(['desi', 'priceRange'].includes(scope) ? { minimum: 0, maximum: 0 } : {}),
    })
  const title = (rule: MarginRule) =>
    rule.scope === 'product'
      ? (state.products.find((product) => product.id === rule.value)?.name ?? rule.value)
      : rule.scope === 'desi'
        ? `${rule.minimum}–${rule.maximum} desi`
        : rule.scope === 'priceRange'
          ? `${money(rule.minimum ?? 0)}–${money(rule.maximum ?? 0)}`
          : rule.value || 'Tüm ürünler'
  return (
    <div className="margins-workspace">
      <PageHeader
        title="Marj Ayarları"
        description="Ürün → desi → fiyat aralığı → marka → kategori → toplu. Tutarlar KDV dahil hesaplanır."
      />
      <Panel
        className="product-form-card"
        title="Mağaza fiyatı"
        actions={
          <SelectButton
            label="Marj mağazası"
            value={storeId}
            onChange={setStore}
            options={state.connections.map((store) => ({ id: store.id, label: store.name }))}
          />
        }
      >
        <div className="margin-template-summary">
          <div>
            <strong>
              {settings.base === 'cost' ? 'Alış fiyatından' : 'Satış fiyatından'} hesapla
            </strong>
            <p>
              {settings.formula === 'costsBefore'
                ? '(Taban + Kargo + Sabit gider) × Marj × Komisyon'
                : '(Taban × Marj × Komisyon) + Kargo + Sabit gider'}
            </p>
            <span>
              {settings.enabled ? 'Otomatik fiyat hesabı açık' : 'Otomatik fiyat hesabı kapalı'}
            </span>
          </div>
          <div className="row-actions">
            <Button
              variant="secondary"
              isDisabled={!storeId || !can('catalog.write')}
              onPress={() => setTemplateOpen(true)}
            >
              <Pencil size={14} />
              Şablonu düzenle
            </Button>
            <Button
              variant="secondary"
              isDisabled={!storeId || busy || !can('catalog.write')}
              onPress={async () => {
                setBusy(true)
                await run({ type: 'margin.apply', storeId })
                setBusy(false)
              }}
            >
              <RefreshCw size={14} />
              Şimdi uygula
            </Button>
          </div>
        </div>
        {!state.marginSettings?.some((item) => item.storeId === storeId) &&
          !!state.marginRules?.some((rule) => rule.storeId === storeId) && (
            <p className="description field-description">
              Mevcut kurallar kayıtlı hesaplama sırasını kullanır. Yeni şablonu kaydettiğinizde
              mağazanın tüm kurallarına uygulanır.
            </p>
          )}
      </Panel>
      <Panel flush className="list-panel">
        <FilterTabs
          label="Marj kapsamları"
          value={scope}
          onChange={(value) => setScope(value as MarginRule['scope'])}
          items={marginScopes.map((item) => ({
            ...item,
            count: (state.marginRules ?? []).filter(
              (rule) => rule.storeId === storeId && rule.scope === item.id,
            ).length,
          }))}
        />
        <div className="list-toolbar">
          <span className="record-count">{rows.length} kural</span>
          <Button variant="primary" isDisabled={!storeId || !can('catalog.write')} onPress={open}>
            <Plus size={15} />
            Kural ekle
          </Button>
        </div>
        <DataTable
          label="Mağaza marj kuralları"
          items={rows}
          columns={[
            {
              id: 'scope',
              label: 'Kapsam',
              rowHeader: true,
              cell: (rule) => (
                <div>
                  <strong>{title(rule)}</strong>
                  {(!rule.formula || rule.formula === 'legacy') && (
                    <span className="cell-secondary">Önceki hesaplama sırası</span>
                  )}
                </div>
              ),
            },
            {
              id: 'shipping',
              label: 'Kargo',
              className: 'align-right',
              cell: (rule) => money(rule.shippingCost ?? 0),
            },
            {
              id: 'cost',
              label: 'Sabit gider',
              className: 'align-right',
              cell: (rule) => money(rule.fixedCost),
            },
            {
              id: 'margin',
              label: 'Marj',
              cell: (rule) =>
                rule.excluded
                  ? 'Marj uygulanmaz'
                  : rule.kind === 'fixed'
                    ? `Sabit: ${money(rule.amount ?? 0)}`
                    : `${rule.direction === 'decrease' || rule.markupBps < 0 ? '−' : '+'}${rule.kind === 'amount' ? money(rule.amount ?? 0) : `%${Math.abs(rule.markupBps) / 100}`}`,
            },
            {
              id: 'commission',
              label: 'Komisyon',
              className: 'align-right',
              cell: (rule) =>
                rule.commissionBps === undefined
                  ? 'Kategori eşlemesinden'
                  : `%${rule.commissionBps / 100}`,
            },
            {
              id: 'status',
              label: 'Durum',
              cell: (rule) => (
                <Chip size="sm" variant="soft" color={rule.active ? 'success' : 'default'}>
                  {rule.active ? 'Etkin' : 'Kapalı'}
                </Chip>
              ),
            },
            {
              id: 'action',
              label: '',
              cell: (rule) => (
                <div className="row-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={!can('catalog.write')}
                    onPress={() => setEditing(rule)}
                  >
                    Düzenle
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    aria-label={`${title(rule)} kuralını sil`}
                    isDisabled={!can('catalog.write')}
                    onPress={() => setDeleting(rule)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ),
            },
          ]}
          emptyTitle="Kayıtlı marj bulunamadı"
          emptyDescription="Bu kapsam için mağazaya özel bir fiyat kuralı ekleyebilirsiniz."
        />
      </Panel>
      <Panel
        className="product-form-card"
        title="İlan fiyatları"
        description="Elle yazılan ilan fiyatı ve marjdan hariç tercihi önceliklidir."
      >
        <DataTable
          label="Hesaplanan ilan fiyatları"
          items={state.listings.filter((listing) => listing.storeId === storeId)}
          columns={[
            {
              id: 'name',
              label: 'Ürün',
              rowHeader: true,
              cell: (listing) =>
                state.products.find((product) => product.id === listing.productId)?.name,
            },
            {
              id: 'rule',
              label: 'Fiyat kaynağı',
              cell: (listing) => {
                const pricing = listingPricing(state, listing)
                return pricing.source === 'manual'
                  ? 'Mağazaya özel fiyat'
                  : pricing.source === 'excluded'
                    ? 'Marjdan hariç'
                    : pricing.source === 'frozen'
                      ? 'Son hesaplanan fiyat'
                      : pricing.rule
                        ? title(pricing.rule)
                        : 'Ürün fiyatı'
              },
            },
            {
              id: 'price',
              label: 'Satış fiyatı',
              className: 'align-right',
              cell: (listing) => money(listingPricing(state, listing).price),
            },
            {
              id: 'list',
              label: 'Liste fiyatı',
              className: 'align-right',
              cell: (listing) => {
                const value = listingPricing(state, listing).listPrice
                return Number.isFinite(value) ? money(value) : 'Mevcut liste fiyatını eşleyin'
              },
            },
          ]}
        />
      </Panel>
      {editing && (
        <MarginEditor
          key={editing.id}
          rule={editing}
          settings={settings}
          onClose={() => setEditing(null)}
        />
      )}
      {templateOpen && (
        <MarginTemplate settings={settings} onClose={() => setTemplateOpen(false)} />
      )}
      {deleting && (
        <Dialog
          open
          title="Marj kuralını sil"
          description={title(deleting)}
          onClose={() => {
            if (!busy) setDeleting(null)
          }}
          footer={
            <>
              <Button variant="secondary" isDisabled={busy} onPress={() => setDeleting(null)}>
                Vazgeç
              </Button>
              <Button
                variant="danger"
                isDisabled={busy}
                onPress={async () => {
                  setBusy(true)
                  const result = await run({
                    type: 'margin.delete',
                    id: deleting.id,
                    version: deleting.version ?? 0,
                  })
                  setBusy(false)
                  if (result.ok) setDeleting(null)
                }}
              >
                Sil
              </Button>
            </>
          }
        >
          <p className="description field-description">
            Kapsamdaki ilanlar bir sonraki uygun kural veya ürün fiyatını kullanır.
          </p>
        </Dialog>
      )}
    </div>
  )
}

function MarginEditor({
  rule,
  settings,
  onClose,
}: {
  rule: MarginRule
  settings: MarginSettings
  onClose: () => void
}) {
  const { state, run } = useApp(),
    [draft, setDraft] = useState({ ...rule }),
    [example, setExample] = useState(10000),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const set = <K extends keyof MarginRule>(key: K, value: MarginRule[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const options =
    draft.scope === 'product'
      ? state.products.map((product) => ({
          id: product.id,
          label: product.name,
          description: product.variants.map((variant) => variant.sku).join(' '),
        }))
      : [
          ...new Set(
            state.products.map((product) =>
              draft.scope === 'brand' ? product.brand : product.category,
            ),
          ),
        ]
          .filter(Boolean)
          .map((value) => ({ id: value, label: value }))
  const validNumbers =
    [
      example,
      draft.fixedCost,
      draft.shippingCost ?? 0,
      draft.amount ?? 0,
      draft.markupBps,
      draft.commissionBps ?? 0,
    ].every(Number.isSafeInteger) &&
    (draft.commissionBps ?? 0) >= 0 &&
    (draft.commissionBps ?? 0) < 10000
  const preview = validNumbers ? calculateMargin(example, draft, settings) : null
  const save = async () => {
    if (busy) return
    setBusy(true)
    const result = await run({ type: 'margin.save', rule: draft })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      wide
      title={marginScopes.find((scope) => scope.id === draft.scope)?.label ?? 'Marj kuralı'}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="margin-rule-form"
            isDisabled={busy || !validNumbers}
          >
            Kuralı kaydet
          </Button>
        </>
      }
    >
      <form
        id="margin-rule-form"
        className="margin-rule-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {['product', 'brand', 'category'].includes(draft.scope) && (
          <SearchSelect
            label="Kapsamdaki değer"
            value={draft.value}
            onChange={(value) => set('value', value)}
            options={options}
            disabled={busy}
          />
        )}
        {['priceRange', 'desi'].includes(draft.scope) && (
          <div className="form-grid">
            {draft.scope === 'priceRange' ? (
              <>
                <MoneyField
                  label="En düşük fiyat (₺)"
                  initialValue={draft.minimum ?? 0}
                  onChange={(value) => set('minimum', value)}
                />
                <MoneyField
                  label="En yüksek fiyat (₺)"
                  initialValue={draft.maximum ?? 0}
                  onChange={(value) => set('maximum', value)}
                />
              </>
            ) : (
              <>
                <Field
                  label="En düşük desi"
                  type="number"
                  min={0}
                  step={0.01}
                  value={String(draft.minimum ?? 0)}
                  onChange={(value) => set('minimum', Number(value))}
                />
                <Field
                  label="En yüksek desi"
                  type="number"
                  min={0}
                  step={0.01}
                  value={String(draft.maximum ?? 0)}
                  onChange={(value) => set('maximum', Number(value))}
                />
              </>
            )}
          </div>
        )}
        <Checkbox
          className="app-checkbox"
          isSelected={draft.excluded ?? false}
          onChange={(value) => set('excluded', value)}
          isDisabled={busy}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Bu kapsama marj uygulama</Label>
          </Checkbox.Content>
        </Checkbox>
        {!draft.excluded && (
          <>
            <SelectButton
              label="Marj türü"
              value={draft.kind ?? 'percent'}
              onChange={(value) => set('kind', value as MarginRule['kind'])}
              options={[
                { id: 'percent', label: 'Yüzde (%) — tabana oran' },
                { id: 'amount', label: 'Tutar (₺) — tabana ekle/çıkar' },
                { id: 'fixed', label: 'Sabit fiyat (₺)' },
              ]}
            />
            {draft.kind !== 'fixed' && (
              <SelectButton
                label="Marj yönü"
                value={draft.direction ?? (draft.markupBps < 0 ? 'decrease' : 'increase')}
                onChange={(value) => {
                  set('direction', value as MarginRule['direction'])
                  set('markupBps', Math.abs(draft.markupBps))
                }}
                options={[
                  { id: 'increase', label: 'Arttır' },
                  { id: 'decrease', label: 'Azalt' },
                ]}
              />
            )}
            {(draft.kind ?? 'percent') === 'percent' ? (
              <Field
                label="Marj değeri (%)"
                type="number"
                min={0}
                step={0.01}
                value={String(Math.abs(draft.markupBps) / 100)}
                onChange={(value) =>
                  set('markupBps', value === '' ? NaN : Math.round(Number(value) * 100))
                }
              />
            ) : (
              <MoneyField
                label={draft.kind === 'fixed' ? 'Sabit satış fiyatı (₺)' : 'Marj tutarı (₺)'}
                initialValue={draft.amount ?? 0}
                onChange={(value) => set('amount', value)}
              />
            )}
            {draft.kind !== 'fixed' && (
              <div className="form-grid">
                <MoneyField
                  label="Kargo ücreti (₺)"
                  initialValue={draft.shippingCost ?? 0}
                  onChange={(value) => set('shippingCost', value)}
                />
                <MoneyField
                  label="Sabit gider (₺)"
                  initialValue={draft.fixedCost}
                  onChange={(value) => set('fixedCost', value)}
                />
                <Field
                  label="Platform komisyonu (%)"
                  type="number"
                  min={0}
                  max={99.99}
                  step={0.01}
                  value={draft.commissionBps === undefined ? '' : String(draft.commissionBps / 100)}
                  onChange={(value) =>
                    set('commissionBps', value === '' ? undefined : Math.round(Number(value) * 100))
                  }
                  description="Boş bırakılırsa kategori eşlemesindeki komisyon kullanılır."
                />
              </div>
            )}
          </>
        )}
        <Checkbox
          className="app-checkbox"
          isSelected={draft.active}
          onChange={(value) => set('active', value)}
          isDisabled={busy}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Kural etkin</Label>
          </Checkbox.Content>
        </Checkbox>
        <div className="margin-example">
          <div>
            <Calculator size={18} />
            <strong>Canlı fiyat örneği</strong>
          </div>
          <MoneyField label="Örnek taban fiyat (₺)" initialValue={example} onChange={setExample} />
          <dl>
            <div>
              <dt>Kargo + sabit gider</dt>
              <dd>{preview ? money(preview.costs) : '—'}</dd>
            </div>
            <div>
              <dt>Marj sonrası</dt>
              <dd>{preview ? money(preview.afterMargin) : '—'}</dd>
            </div>
            <div>
              <dt>Komisyon sonrası</dt>
              <dd>{preview ? money(preview.afterCommission) : '—'}</dd>
            </div>
            <div>
              <dt>Pazaryerine gidecek fiyat</dt>
              <dd>{preview ? money(preview.price) : '—'}</dd>
            </div>
          </dl>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}

function MarginTemplate({ settings, onClose }: { settings: MarginSettings; onClose: () => void }) {
  const { run } = useApp(),
    [draft, setDraft] = useState({ ...settings }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const set = <K extends keyof MarginSettings>(key: K, value: MarginSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  return (
    <Dialog
      open
      wide
      title="Mağaza fiyat şablonu"
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true)
              const result = await run({ type: 'margin.settings', settings: draft })
              setBusy(false)
              if (result.ok) onClose()
              else setError(result.message)
            }}
          >
            Şablonu kaydet
          </Button>
        </>
      }
    >
      <div className="margin-rule-form">
        <Checkbox
          className="app-checkbox"
          isSelected={draft.enabled}
          onChange={(value) => set('enabled', value)}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Otomatik fiyat hesabı</Label>
          </Checkbox.Content>
        </Checkbox>
        <SelectButton
          label="Hesap hangi fiyattan başlasın?"
          value={draft.base}
          onChange={(value) => set('base', value as MarginSettings['base'])}
          options={[
            { id: 'price', label: 'Satış fiyatı (perakende)' },
            { id: 'cost', label: 'Alış fiyatı' },
          ]}
        />
        <SelectButton
          label="Hesap formülü"
          value={draft.formula}
          onChange={(value) => set('formula', value as MarginSettings['formula'])}
          options={[
            { id: 'costsBefore', label: '(Taban + Kargo + Sabit gider) × Marj × Komisyon' },
            { id: 'costsAfter', label: '(Taban × Marj × Komisyon) + Kargo + Sabit gider' },
          ]}
        />
        <SelectButton
          label="Platform komisyonu nasıl işlesin?"
          value={draft.commissionMode}
          onChange={(value) => set('commissionMode', value as MarginSettings['commissionMode'])}
          options={[
            { id: 'inside', label: 'Komisyonu fiyatın içinden düş' },
            { id: 'add', label: 'Komisyonu fiyatın üstüne ekle' },
          ]}
        />
        <SelectButton
          label="Yuvarlama"
          value={draft.rounding}
          onChange={(value) => set('rounding', value as MarginSettings['rounding'])}
          options={[
            { id: 'none', label: 'Yuvarlama yok (kuruşlu)' },
            { id: 'up99', label: 'Yukarı, ,99 ile bitir' },
            { id: 'up95', label: 'Yukarı, ,95 ile bitir' },
            { id: 'ceil', label: 'Yukarı tam sayı' },
            { id: 'nearest', label: 'En yakın tam sayı' },
          ]}
        />
        <SelectButton
          label="Liste fiyatı"
          value={draft.listPriceMode}
          onChange={(value) => set('listPriceMode', value as MarginSettings['listPriceMode'])}
          options={[
            { id: 'same', label: 'Liste fiyatı = satış fiyatı' },
            { id: 'markup', label: 'Satış fiyatının üzerine oran ekle' },
            { id: 'keep', label: 'Liste fiyatına dokunma' },
          ]}
        />
        {draft.listPriceMode === 'markup' && (
          <Field
            label="Liste fiyatı artışı (%)"
            type="number"
            min={0}
            step={0.01}
            value={String(draft.listMarkupBps / 100)}
            onChange={(value) => set('listMarkupBps', Math.round(Number(value) * 100))}
          />
        )}
        <p className="description field-description">
          Kaydetme mağazanın bütün marj kurallarına bu şablonu uygular. Platforma gönderim
          bağlantının stok/fiyat gönderimi tercihine bağlıdır.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
