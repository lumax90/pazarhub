import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Chip, Tabs } from '@heroui/react'
import { ArrowRight, Check, Layers3, Plus, RefreshCw, Save } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Listing, Product, ProductPatch, Variant } from '../domain/types'
import {
  generateVariants,
  MAX_PRODUCT_VARIANTS,
  mergeProductPatch,
  validateProductStructure,
  rebaseProductDraft,
} from '../domain/products'
import { validateBundle } from '../domain/bundles'
import { listingPrice, productPrice, productStock } from '../domain/selectors'
import { MAIN_WAREHOUSE, warehouses } from '../domain/inventory'
import { publicationLabels } from '../domain/publishing'
import { channelNames } from '../domain/channels'
import { dateLabel, money } from '../lib/format'
import {
  ChannelIcon,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  SelectButton,
} from '../components/ui/shared'
import { ProductArt } from '../components/ui/ProductArt'
import { DataTable } from '../components/ui/DataTable'
import {
  ProductBasicFields,
  ProductDescriptionFields,
  ProductLogisticsFields,
  TechnicalAttributesEditor,
} from '../components/products/ProductFields'
import {
  BulkVariantValues,
  VariantAxesEditor,
  VariantFieldsTable,
} from '../components/products/VariantEditor'
import { ProductImages } from '../components/products/ProductImages'
import { productColorImageOptions } from '../domain/product-images'
import { ProductStockPanel } from '../components/products/ProductStockPanel'
import { NewListingButton } from './PublishingPage'
import {
  BundleComponentsEditor,
  BundleDescriptionOption,
  BundlePricingFields,
  BundleStockView,
} from '../components/products/BundleFields'

const tabs = [
  { id: 'information', label: 'Ürün Bilgileri' },
  { id: 'stocks', label: 'Stoklar' },
  { id: 'prices', label: 'Fiyatlar' },
  { id: 'description', label: 'Detay Açıklama' },
  { id: 'barcodes', label: 'Barkodlar' },
  { id: 'images', label: 'Resimler' },
  { id: 'variants', label: 'Varyantlar' },
  { id: 'attributes', label: 'Teknik Özellikler' },
  { id: 'integrations', label: 'Entegrasyonlar' },
]
type ChangeKey = keyof NonNullable<ProductPatch['changes']>
const basicKeys: ChangeKey[] = [
  'name',
  'subtitle',
  'invoiceName',
  'category',
  'categoryId',
  'modelCode',
  'brand',
  'brandId',
  'supplier',
  'supplierId',
  'unit',
  'taxRate',
  'currency',
  'lowStock',
  'active',
]
const logisticsKeys: ChangeKey[] = ['origin', 'gtip', 'dimensions']
const descriptionKeys: ChangeKey[] = ['description', 'shortDescription', 'note']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function ProductDetailPage() {
  const { id } = useParams(),
    { state, refresh } = useApp()
  const [reset, setReset] = useState(0)
  const product = state.products.find((p) => p.id === id)
  if (!product)
    return (
      <Panel>
        <EmptyState
          title="Ürün bulunamadı"
          description="Ürün listesine dönerek kayıtları kontrol edin."
          action={
            <Link to="/products" className="button button--secondary">
              Ürünlere dön
            </Link>
          }
        />
      </Panel>
    )
  return (
    <ProductWorkspace
      key={`${id}:${reset}`}
      product={product}
      reload={async () => {
        await refresh()
        setReset((value) => value + 1)
      }}
    />
  )
}

function ProductEditCard({
  title,
  description,
  children,
  onSave,
  dirty,
  disabled,
  saving,
  actions,
  saveLabel,
}: {
  title: string
  description?: string
  children: ReactNode
  onSave: () => void
  dirty: boolean
  disabled: boolean
  saving: boolean
  actions?: ReactNode
  saveLabel: string
}) {
  return (
    <Panel className="product-form-card" title={title} description={description} actions={actions}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!disabled && dirty) onSave()
        }}
      >
        {children}
        <div className="product-card-footer">
          <span>{dirty ? 'Kaydedilmemiş değişiklikler' : 'Bilgiler güncel'}</span>
          <Button variant="primary" type="submit" size="sm" isDisabled={disabled || !dirty}>
            <Save size={14} />
            {saving ? 'Kaydediliyor…' : saveLabel}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function ProductWorkspace({ product, reload }: { product: Product; reload: () => Promise<void> }) {
  const { state, run, can, getState } = useApp()
  const [params, setParams] = useSearchParams()
  const [base, setBase] = useState(() => structuredClone(product)),
    [draft, setDraft] = useState(() => structuredClone(product))
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(''),
    [epoch, setEpoch] = useState(0)
  const [prefix, setPrefix] = useState(product.modelCode || product.variants[0]?.sku || 'SKU')
  const [warehouseId, setWarehouse] = useState(MAIN_WAREHOUSE)
  const selected = tabs.some((tab) => tab.id === params.get('tab'))
    ? params.get('tab')!
    : 'information'
  const stale = (product.version ?? 0) !== (base.version ?? 0)
  const disabled = busy || !can('catalog.write')
  const change = <K extends keyof Product>(key: K, value: Product[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const updateVariant = (id: string, patch: Partial<Variant>) =>
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }))
  const changes = (keys: ChangeKey[]) =>
    Object.fromEntries(
      keys.filter((key) => !same(draft[key], base[key])).map((key) => [key, draft[key]]),
    ) as NonNullable<ProductPatch['changes']>
  const variantChanges = (
    keys: ('name' | 'price' | 'cost' | 'sku' | 'barcode' | 'options' | 'shelf')[],
  ) =>
    draft.variants.flatMap((v) => {
      const original = base.variants.find((item) => item.id === v.id)
      if (!original) return []
      const changed = keys.filter((key) => !same(v[key], original[key]))
      return changed.length
        ? [{ id: v.id, ...Object.fromEntries(changed.map((key) => [key, v[key]])) }]
        : []
    })
  const isDirty = (patch: ProductPatch) =>
    !!(
      Object.keys(patch.changes ?? {}).length ||
      patch.variants?.length ||
      patch.newVariants?.length
    )
  const newVariants = draft.variants.filter((v) => !base.variants.some((old) => old.id === v.id))
  const existingVariants = draft.variants.filter((v) =>
    base.variants.some((old) => old.id === v.id),
  )
  const bundlePricing =
    draft.bundle && base.bundle
      ? { ...base.bundle, priceMode: draft.bundle.priceMode, discountBps: draft.bundle.discountBps }
      : undefined
  const bundleContents =
    draft.bundle && base.bundle
      ? {
          ...base.bundle,
          components: draft.bundle.components,
          includeContents: draft.bundle.includeContents,
        }
      : undefined
  const patches: Record<string, ProductPatch> = {
    basics: { changes: changes(basicKeys) },
    logistics: { changes: changes(logisticsKeys) },
    prices: product.bundle
      ? {
          changes: !same(bundlePricing, base.bundle) ? { bundle: bundlePricing } : {},
          variants: variantChanges(['price']),
        }
      : { variants: variantChanges(['price', 'cost']) },
    description: { changes: changes(descriptionKeys) },
    barcodes: { variants: variantChanges(['sku', 'barcode', 'shelf']) },
    images: { changes: changes(['images', 'imageMetadata']) },
    variants: product.bundle
      ? { changes: !same(bundleContents, base.bundle) ? { bundle: bundleContents } : {} }
      : {
          changes: changes(['variantAxes']),
          variants: variantChanges(['name', 'options']),
          newVariants: newVariants.map((v) => ({
            ...v,
            stockByWarehouse: { [warehouseId]: v.stock },
          })),
        },
    attributes: { changes: changes(['technicalAttributes']) },
  }
  const save = async (key: string) => {
    if (
      key === 'prices' &&
      ((draft.currency ?? 'TRY') !== (base.currency ?? 'TRY') || draft.taxRate !== base.taxRate)
    ) {
      setError(
        'Fiyatları kaydetmeden önce para birimi/KDV değişikliğini Ürün Bilgileri kartından kaydedin.',
      )
      return
    }
    if (disabled || uploading || stale || !isDirty(patches[key])) return
    const patch = patches[key]
    const candidate = mergeProductPatch(base, patch)
    const problem = validateProductStructure(candidate) || validateBundle(state, candidate, base)
    if (problem) {
      setError(problem)
      return
    }
    if (
      candidate.variants.some(
        (v) =>
          ![v.price, v.cost].every((value) => Number.isSafeInteger(value) && value >= 0) ||
          !Number.isSafeInteger(v.stock) ||
          (v.stock < 0 &&
            !state.ecommerce?.allowNegativeStock &&
            !base.variants.some((old) => old.id === v.id && old.stock === v.stock)),
      )
    ) {
      setError('Fiyat, maliyet ve stok değerlerini kontrol edin.')
      return
    }
    if (
      newVariants.length &&
      key === 'variants' &&
      !warehouses(state).some((w) => w.id === warehouseId && w.active)
    ) {
      setError('Yeni varyantlar için etkin bir depo seçin.')
      return
    }
    setBusy(true)
    setError('')
    const result = await run({
      type: 'product.patch',
      id: product.id,
      expectedVersion: base.version ?? 0,
      patch,
    })
    setBusy(false)
    if (result.ok) {
      const version = result.entityVersion ?? (base.version ?? 0) + 1
      const committed = getState().products.find((item) => item.id === product.id)
      const saved =
        committed?.version === version
          ? structuredClone(committed)
          : { ...mergeProductPatch(base, patch), version }
      setBase(saved)
      setDraft((current) => rebaseProductDraft(base, current, saved, patch))
    } else setError(result.message)
  }
  const saveLabels: Record<string, string> = {
    basics: 'Ürün bilgilerini kaydet',
    logistics: 'Ölçüleri kaydet',
    prices: 'Fiyatları kaydet',
    description: 'Açıklamaları kaydet',
    barcodes: 'Barkodları kaydet',
    images: 'Resimleri kaydet',
    variants: product.bundle ? 'Paket içeriğini kaydet' : 'Varyantları kaydet',
    attributes: 'Teknik özellikleri kaydet',
  }
  const card = (
    key: string,
    title: string,
    children: ReactNode,
    description?: string,
    actions?: ReactNode,
  ) => (
    <ProductEditCard
      title={title}
      description={description}
      dirty={isDirty(patches[key])}
      disabled={disabled || stale || uploading}
      saving={busy}
      onSave={() => void save(key)}
      actions={actions}
      saveLabel={saveLabels[key]}
    >
      {children}
    </ProductEditCard>
  )
  const dirtyTab = (id: string) =>
    id === 'information'
      ? isDirty(patches.basics) || isDirty(patches.logistics)
      : !!patches[id] && isDirty(patches[id])
  const addVariant = () => {
    if (draft.variants.length >= MAX_PRODUCT_VARIANTS) return
    const skus = new Set([
      ...state.products.flatMap((p) => p.variants.map((v) => v.sku)),
      ...draft.variants.map((v) => v.sku),
    ])
    let index = draft.variants.length + 1
    while (skus.has(`${prefix}-${String(index).padStart(3, '0')}`)) index++
    change('variants', [
      ...draft.variants,
      {
        id: crypto.randomUUID(),
        name: `Varyant ${index}`,
        sku: `${prefix}-${String(index).padStart(3, '0')}`,
        barcode: '',
        price: draft.variants[0]?.price ?? 0,
        cost: draft.variants[0]?.cost ?? 0,
        stock: 0,
        options: {},
      },
    ])
  }
  const completeCombinations = () => {
    setError('')
    try {
      const problem = validateProductStructure({
        ...base,
        variants: draft.variants,
        variantAxes: draft.variantAxes,
      })
      if (problem) throw new Error(problem)
      const generated = generateVariants(
        draft.variantAxes ?? [],
        draft.variants,
        prefix,
        state.products.flatMap((p) => p.variants.map((v) => v.sku)),
      )
      const next = [
        ...draft.variants,
        ...generated.filter((v) => !draft.variants.some((old) => old.id === v.id)),
      ]
      if (next.length > MAX_PRODUCT_VARIANTS)
        throw new Error(`Bir üründe en fazla ${MAX_PRODUCT_VARIANTS} varyant olabilir.`)
      change('variants', next)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Kombinasyonlar oluşturulamadı.')
    }
  }
  return (
    <div className="product-workspace">
      <PageHeader
        back={{
          to: '/products',
          label: 'Ürünler',
          context: product.modelCode || product.variants[0]?.sku,
        }}
        title={product.name}
        description={
          product.subtitle || `${product.category} · ${product.brand || 'Marka belirtilmemiş'}`
        }
        actions={
          <Button variant="secondary" onPress={() => void reload()} isDisabled={busy || uploading}>
            <RefreshCw size={15} />
            Güncel kartı yükle
          </Button>
        }
      />
      <Panel className="product-overview-card">
        <ProductArt product={product} />
        <div className="product-overview-identity">
          <Chip size="sm" color={product.active ? 'success' : 'default'} variant="soft">
            <span className="status-dot" />
            {product.active ? 'Aktif ürün' : 'Pasif ürün'}
          </Chip>
          <span>
            {product.bundle
              ? 'Paket ürün'
              : product.variants.length > 1
                ? `${product.variants.length} varyant`
                : 'Varyantsız ürün'}
          </span>
          <small>
            {product.updatedAt ? `Güncelleme: ${dateLabel(product.updatedAt, true)}` : 'Ürün kartı'}
          </small>
        </div>
        <dl>
          <div>
            <dt>Toplam stok</dt>
            <dd>
              {productStock(product, state).toLocaleString('tr-TR')}{' '}
              <small>{product.unit ?? 'Adet'}</small>
            </dd>
          </div>
          <div>
            <dt>Satış fiyatı{product.variants.length > 1 ? ' · başlangıç' : ''}</dt>
            <dd>{money(productPrice(product, state))}</dd>
          </div>
          <div>
            <dt>KDV</dt>
            <dd>%{product.taxRate}</dd>
          </div>
        </dl>
      </Panel>
      {stale && (
        <div className="product-conflict" role="status">
          <span>Ürün başka bir işlemle güncellendi. Kaydetmeden önce güncel kartı yükleyin.</span>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={busy || uploading}
            onPress={() => void reload()}
          >
            <RefreshCw size={14} />
            Güncel bilgileri yükle
          </Button>
        </div>
      )}
      {error && (
        <div className="form-error product-page-error" role="alert">
          {error}
        </div>
      )}
      <Tabs
        variant="secondary"
        selectedKey={selected}
        onSelectionChange={(key) => {
          if (!busy && !uploading) {
            const next = new URLSearchParams(params)
            next.set('tab', String(key))
            setParams(next)
            setError('')
          }
        }}
        className="product-workspace-tabs"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Ürün düzenleme bölümleri">
            {tabs.map((tab) => (
              <Tabs.Tab id={tab.id} key={tab.id}>
                {tab.id === 'variants' && product.bundle ? 'Paket içeriği' : tab.label}
                {dirtyTab(tab.id) && (
                  <span className="product-unsaved-dot" aria-label="Kaydedilmemiş değişiklik" />
                )}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="information">
          <div className="product-information-grid">
            {card(
              'basics',
              'Ürün bilgileri',
              <ProductBasicFields product={draft} onChange={change} disabled={disabled} />,
              'Ana ürün kartı; bütün varyantların ortak bilgileri.',
            )}
            {card(
              'logistics',
              'Ölçüler ve gümrük bilgileri',
              <ProductLogisticsFields product={draft} onChange={change} disabled={disabled} />,
              'Paket ölçüleri, menşei ve GTİP.',
            )}
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="stocks">
          {product.bundle ? (
            <BundleStockView product={product} />
          ) : (
            <ProductStockPanel product={product} />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="prices">
          {product.bundle
            ? card(
                'prices',
                'Paket fiyatı',
                <BundlePricingFields
                  product={draft}
                  onChange={change}
                  disabled={disabled}
                  showContentsOption={false}
                />,
                'Bağlı veya sabit fiyat. Paket maliyeti bileşenlerin alış toplamıdır.',
              )
            : card(
                'prices',
                'Fiyatlar',
                <>
                  {existingVariants.length > 1 && (
                    <BulkVariantValues
                      currency={draft.currency}
                      taxRate={draft.taxRate}
                      disabled={disabled}
                      onApply={(patch) => {
                        setDraft((current) => ({
                          ...current,
                          variants: current.variants.map((v) =>
                            base.variants.some((old) => old.id === v.id) ? { ...v, ...patch } : v,
                          ),
                        }))
                        setEpoch((value) => value + 1)
                      }}
                    />
                  )}
                  <VariantFieldsTable
                    currency={draft.currency}
                    taxRate={draft.taxRate}
                    variants={existingVariants}
                    onChange={updateVariant}
                    mode="prices"
                    disabled={disabled}
                    epoch={epoch}
                  />
                </>,
                `Her stok kodunun fiyatı bağımsızdır. ${draft.currency ?? 'TRY'} · ${state.ecommerce?.pricesIncludeVat === false ? 'KDV hariç giriş; kayıt ve gönderimde KDV eklenir.' : 'KDV dahil giriş.'}`,
              )}
        </Tabs.Panel>
        <Tabs.Panel id="description">
          {card(
            'description',
            'Açıklamalar',
            <ProductDescriptionFields product={draft} onChange={change} disabled={disabled} />,
            'Detay açıklama, ürün içeriğini miras alan yeni mağaza ilanlarında kullanılır.',
          )}
        </Tabs.Panel>
        <Tabs.Panel id="barcodes">
          {card(
            'barcodes',
            'Barkodlar',
            <VariantFieldsTable
              variants={existingVariants}
              onChange={updateVariant}
              mode="barcodes"
              disabled={disabled}
            />,
            'Barkod ve stok kodları çalışma alanınızda benzersiz olmalı. Barkodları metin olarak saklarız; baştaki sıfırlar korunur.',
          )}
        </Tabs.Panel>
        <Tabs.Panel id="images">
          {card(
            'images',
            'Resimler',
            <ProductImages
              name={draft.name}
              images={draft.images ?? []}
              onChange={(images) => change('images', images)}
              disabled={disabled}
              onBusyChange={setUploading}
              metadata={draft.imageMetadata}
              onMetadataChange={(value) => change('imageMetadata', value)}
              colorOptions={productColorImageOptions(draft)}
            />,
            'İlk görsel kapaktır. Varyantın kendi renk görselleri ortak görsellerden önce gösterilir.',
          )}
        </Tabs.Panel>
        <Tabs.Panel id="variants">
          {product.bundle
            ? card(
                'variants',
                'Paket içeriği',
                <>
                  <BundleComponentsEditor product={draft} onChange={change} disabled={disabled} />
                  <BundleDescriptionOption product={draft} onChange={change} disabled={disabled} />
                </>,
                'Kayıtlı siparişlerin bileşenleri, sipariş anlık görüntüsünden izlenir.',
              )
            : card(
                'variants',
                'Varyantlar',
                <>
                  <VariantAxesEditor
                    axes={draft.variantAxes ?? []}
                    onChange={(axes) => {
                      setDraft((current) => ({
                        ...current,
                        variantAxes: axes,
                        variants: current.variants.map((v) => ({
                          ...v,
                          options: Object.fromEntries(
                            Object.entries(v.options ?? {}).filter(([key]) =>
                              axes.some((axis) => axis.id === key),
                            ),
                          ),
                        })),
                      }))
                    }}
                    disabled={disabled}
                  />
                  <div className="product-variant-actions">
                    <Field
                      label="Yeni varyant stok kodu öneki"
                      value={prefix}
                      onChange={setPrefix}
                      maxLength={140}
                      isDisabled={disabled}
                    />
                    <Button
                      variant="secondary"
                      isDisabled={
                        disabled || draft.variants.length >= MAX_PRODUCT_VARIANTS || !prefix.trim()
                      }
                      onPress={addVariant}
                    >
                      <Plus size={15} />
                      Varyant ekle
                    </Button>
                    {!!draft.variantAxes?.length && (
                      <Button
                        variant="secondary"
                        isDisabled={disabled || !prefix.trim()}
                        onPress={completeCombinations}
                      >
                        <Layers3 size={15} />
                        Eksik kombinasyonları ekle
                      </Button>
                    )}
                  </div>
                  <p className="description field-description">
                    Mevcut varyantlar için tip değerlerini seçin. Eksik kombinasyonlar yeni stok
                    kodlarıyla eklenir.
                  </p>
                  <VariantFieldsTable
                    variants={draft.variants}
                    onChange={updateVariant}
                    mode="variants"
                    axes={draft.variantAxes ?? []}
                    disabled={disabled}
                  />
                  {newVariants.length > 0 && (
                    <div className="product-new-variants">
                      <h3>{newVariants.length} yeni varyant</h3>
                      <SelectButton
                        label="Yeni varyantların açılış deposu"
                        value={warehouseId}
                        onChange={setWarehouse}
                        options={warehouses(state)
                          .filter((w) => w.active)
                          .map((w) => ({ id: w.id, label: w.name }))}
                        isDisabled={disabled}
                      />
                      <VariantFieldsTable
                        variants={newVariants}
                        onChange={updateVariant}
                        mode="create"
                        disabled={disabled}
                        onRemove={(id) =>
                          change(
                            'variants',
                            draft.variants.filter((v) => v.id !== id),
                          )
                        }
                      />
                    </div>
                  )}
                </>,
                'Renk, beden ve diğer tipler ana ürüne aittir. Her kombinasyon kendi SKU, barkod, fiyat ve stok kaydını taşır.',
              )}
        </Tabs.Panel>
        <Tabs.Panel id="attributes">
          {card(
            'attributes',
            'Teknik özellikler',
            <TechnicalAttributesEditor
              attributes={draft.technicalAttributes ?? []}
              onChange={(attributes) => change('technicalAttributes', attributes)}
              disabled={disabled}
            />,
            'Malzeme, üretim türü ve kullanım alanı gibi ortak özellikler.',
          )}
        </Tabs.Panel>
        <Tabs.Panel id="integrations">
          <ProductListings product={product} />
        </Tabs.Panel>
      </Tabs>
      {Object.values(patches).some(isDirty) && (
        <p className="product-draft-note">
          <Check size={14} />
          Değişiklikler sekmeler arasında korunur; ilgili kartın kaydet düğmesiyle işlenir.
        </p>
      )}
    </div>
  )
}

function ProductListings({ product }: { product: Product }) {
  const { state } = useApp()
  const listings = state.listings.filter((listing) => listing.productId === product.id)
  const label = (listing: Listing) =>
    listing.publication
      ? publicationLabels[listing.publication.phase]
      : {
          active: 'Yayında',
          pending: 'Bekliyor',
          rejected: 'Kontrol gerekiyor',
          archived: 'Arşivde',
        }[listing.status]
  return (
    <Panel
      className="product-form-card"
      title="Mağaza ilanları"
      description="Ürün → varyant → mağaza ilanı. Her mağazanın yayın durumu ve fiyatı ayrı izlenir."
      actions={<NewListingButton productId={product.id} />}
    >
      <DataTable
        label="Ürünün mağaza ilanları"
        items={listings}
        columns={[
          {
            id: 'store',
            label: 'Mağaza',
            rowHeader: true,
            cell: (l) => (
              <div className="product-listing-store">
                <ChannelIcon channel={l.channel} />
                <span>
                  <strong>
                    {state.connections.find((c) => c.id === l.storeId)?.name ??
                      channelNames[l.channel]}
                  </strong>
                  <small>{channelNames[l.channel]}</small>
                </span>
              </div>
            ),
          },
          {
            id: 'variant',
            label: 'Varyant',
            cell: (l) => (
              <div>
                {product.variants.find((v) => v.id === l.variantId)?.name}
                <span className="cell-secondary code-text">
                  {product.variants.find((v) => v.id === l.variantId)?.sku}
                </span>
              </div>
            ),
          },
          {
            id: 'price',
            label: 'Mağaza fiyatı',
            className: 'align-right',
            cell: (l) => money(listingPrice(state, l)),
          },
          {
            id: 'status',
            label: 'Yayın durumu',
            cell: (l) => (
              <Chip
                size="sm"
                variant="soft"
                color={
                  l.status === 'rejected' ? 'danger' : l.status === 'active' ? 'success' : 'default'
                }
              >
                {label(l)}
              </Chip>
            ),
          },
          {
            id: 'action',
            label: '',
            cell: (l) => (
              <Link
                className="button button--secondary button--sm"
                to={
                  l.publication
                    ? `/listings/prepare/${l.id}`
                    : `/listings?product=${encodeURIComponent(product.id)}`
                }
                aria-label={`${state.connections.find((c) => c.id === l.storeId)?.name ?? channelNames[l.channel]} ilanını aç`}
              >
                İlanı aç
                <ArrowRight size={14} />
              </Link>
            ),
          },
        ]}
        emptyTitle="Henüz mağaza ilanı yok"
        emptyDescription="Bağlı bir mağazada bu ürünün varyantlarını seçerek ilan hazırlayabilirsiniz."
      />
      <div className="product-integration-footer">
        <Link
          to={`/listings?product=${encodeURIComponent(product.id)}`}
          className="provider-doc-link"
        >
          Platform Listelemeleri
          <ArrowRight size={14} />
        </Link>
        <Link to="/connections" className="provider-doc-link">
          Mağaza bağlantıları
          <ArrowRight size={14} />
        </Link>
      </div>
    </Panel>
  )
}
