import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Chip, Description, Label, Radio, RadioGroup } from '@heroui/react'
import { ArrowLeft, ArrowRight, Check, Layers3, Package, Plus, Warehouse } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, useNavigate } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Product, Variant } from '../domain/types'
import {
  generateVariants,
  MAX_PRODUCT_VARIANTS,
  validateProductStructure,
} from '../domain/products'
import { MAIN_WAREHOUSE, warehouses } from '../domain/inventory'
import { Field, PageHeader, Panel, SelectButton } from '../components/ui/shared'
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
import { ProductArt } from '../components/ui/ProductArt'
import { DefinitionField } from '../components/inventory/DefinitionField'
import { categoryPath, categoryTree, definitionActive } from '../domain/definitions'
import { matches, money } from '../lib/format'
import { useRevealMotion } from '../lib/motion'

function newProduct(products: Product[], businessName: string): Product {
  const codes = new Set(products.flatMap((p) => p.variants.map((v) => v.sku)))
  let index = products.length + 1
  while (codes.has(`KS-${String(index).padStart(3, '0')}`)) index++
  const code = `KS-${String(index).padStart(3, '0')}`
  return {
    id: crypto.randomUUID(),
    name: '',
    category: '',
    brand: businessName,
    description: '',
    art: 'vase',
    color: '#b7a48e',
    taxRate: 20,
    active: true,
    lowStock: 10,
    modelCode: code,
    unit: 'Adet',
    variants: [
      {
        id: crypto.randomUUID(),
        name: 'Standart',
        sku: code,
        barcode: '',
        price: 0,
        cost: 0,
        stock: 0,
      },
    ],
  }
}

export function NewProductPage() {
  const reveal = useRevealMotion()
  const { state, run, can } = useApp(),
    navigate = useNavigate()
  const [draft, setDraft] = useState(() => ({
    ...newProduct(state.products, state.preferences.businessName),
    currency: state.ecommerce?.defaultCurrency ?? 'TRY',
    taxRate: state.ecommerce?.defaultTaxRate ?? 20,
    origin: state.ecommerce?.defaultOrigin ?? 'TR',
    lowStock: state.ecommerce?.lowStock ?? 10,
  }))
  const [step, setStep] = useState(0),
    [furthest, setFurthest] = useState(0)
  const [variantMode, setVariantMode] = useState('single'),
    [prefix, setPrefix] = useState(draft.modelCode!)
  const [warehouseId, setWarehouse] = useState(MAIN_WAREHOUSE)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [epoch, setEpoch] = useState(0)
  const disabled = busy || !can('catalog.write')
  const categories = categoryTree(state.definitions ?? [])
    .filter((category) => definitionActive(state.definitions ?? [], category))
    .map((category) => categoryPath(state.definitions ?? [], category))
  const change = <K extends keyof Product>(key: K, value: Product[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const chooseCategory = (category: string, categoryId?: string) =>
    setDraft((current) => ({
      ...current,
      category,
      categoryId:
        categoryId ??
        state.definitions?.find(
          (item) =>
            item.kind === 'category' && categoryPath(state.definitions ?? [], item) === category,
        )?.id,
    }))
  const updateVariant = (id: string, patch: Partial<Variant>) =>
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }))
  const steps = ['Kategori', 'Varyasyon', 'Ürün bilgileri']
  const advance = () => {
    setError('')
    if (step === 0 && !draft.category.trim()) {
      setError('Bir kategori seçin veya + düğmesiyle yeni kategori ekleyin.')
      return
    }
    if (step === 1) {
      try {
        if (!prefix.trim() || prefix.trim().length > 140)
          throw new Error('Stok kodu öneki 1–140 karakter olmalı.')
        const variants =
          variantMode === 'multiple'
            ? generateVariants(
                draft.variantAxes ?? [],
                draft.variants,
                prefix,
                state.products.flatMap((p) => p.variants.map((v) => v.sku)),
              )
            : [{ ...draft.variants[0], name: 'Standart', sku: prefix.trim(), options: undefined }]
        setDraft((current) => ({
          ...current,
          variants,
          modelCode: prefix.trim(),
          variantAxes: variantMode === 'multiple' ? current.variantAxes : [],
        }))
        setEpoch((value) => value + 1)
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : 'Varyasyonları kontrol edin.')
        return
      }
    }
    setStep(step + 1)
    setFurthest(Math.max(furthest, step + 1))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled || uploading) return
    if (step < 2) {
      advance()
      return
    }
    setError('')
    const problem = validateProductStructure(draft)
    if (problem) {
      setError(problem)
      return
    }
    if (!draft.name.trim() || !draft.category.trim()) {
      setError('Ürün adı ve kategoriyi tamamlayın.')
      return
    }
    if (
      draft.variants.some(
        (v) =>
          !v.sku.trim() ||
          !Number.isInteger(v.stock) ||
          v.stock < 0 ||
          [v.price, v.cost].some(
            (value) => !Number.isSafeInteger(value) || value < 0 || value > 1000000000,
          ),
      )
    ) {
      setError('Varyantların stok kodunu, fiyatını ve açılış miktarını kontrol edin.')
      return
    }
    if (!warehouses(state).some((w) => w.id === warehouseId && w.active)) {
      setError('Etkin bir açılış deposu seçin.')
      return
    }
    setBusy(true)
    const result = await run({
      type: 'product.save',
      product: {
        ...draft,
        variants: draft.variants.map((v) => ({
          ...v,
          stockByWarehouse: { [warehouseId]: v.stock },
        })),
      },
    })
    setBusy(false)
    if (result.ok) navigate(`/products/${result.id ?? draft.id}`, { replace: true })
    else setError(result.message)
  }
  return (
    <div className="product-workspace">
      <PageHeader
        title="Yeni ürün"
        description="Kategoriden başlayın, varyasyonları seçin ve ürün kartınızı tamamlayın."
        actions={
          <Link to="/products" className="button button--secondary">
            <ArrowLeft size={15} />
            Ürünlere dön
          </Link>
        }
      />
      <nav className="product-steps" aria-label="Ürün oluşturma adımları">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`button button--md ${step === index ? 'button--secondary is-current' : 'button--ghost'} ${index < step ? 'is-complete' : ''}`}
            aria-current={step === index ? 'step' : undefined}
            disabled={disabled || uploading || index > furthest || index > step}
            onClick={() => {
              setStep(index)
              setError('')
            }}
          >
            <span className="product-step-number">
              {index < step ? <Check size={17} /> : index + 1}
            </span>
            <span>
              <strong>{label}</strong>
              <small>
                {index === 0
                  ? draft.category || 'Kategori belirleyin'
                  : index === 1
                    ? variantMode === 'multiple'
                      ? 'Varyantlı ürün'
                      : 'Varyantsız ürün'
                    : 'Fiyat, stok ve içerik'}
              </small>
            </span>
          </button>
        ))}
      </nav>
      {!can('catalog.write') && (
        <p className="inline-notice">Ürün oluşturmak için katalog düzenleme yetkisi gerekiyor.</p>
      )}
      <form id="new-product-form" onSubmit={submit}>
        <motion.div key={step} {...reveal}>
          {step === 0 && (
            <Panel
              className="product-form-card product-wizard-category"
              title="Ürün kategorisi"
              description="Katalogdaki bir kategoriyi seçin veya yeni bir kategori adı yazın."
            >
              <DefinitionField
                kind="category"
                label="Kategori"
                value={draft.category}
                definitionId={draft.categoryId}
                onChange={chooseCategory}
                disabled={disabled}
              />
              <div className="product-category-choices">
                {categories
                  .filter((category) => matches(category, draft.category))
                  .map((category) => (
                    <button
                      type="button"
                      key={category}
                      className={`button button--md ${draft.category === category ? 'button--secondary is-selected' : 'button--ghost'}`}
                      disabled={disabled}
                      onClick={() => chooseCategory(category)}
                    >
                      <span className="product-category-icon">
                        <Package size={19} />
                      </span>
                      <span>
                        <strong>{category}</strong>
                        <small>
                          {state.products.filter((p) => p.category === category).length} ürün
                        </small>
                      </span>
                      {draft.category === category ? <Check size={17} /> : <ArrowRight size={16} />}
                    </button>
                  ))}
                {draft.category.trim() && !categories.includes(draft.category.trim()) && (
                  <div className="new-category-note">
                    <Plus size={16} />
                    <span>
                      <strong>{draft.category.trim()}</strong> ürün kaydedildiğinde katalogda yer
                      alacak.
                    </span>
                  </div>
                )}
                {!categories.length && !draft.category && (
                  <p className="empty-inline">
                    İlk ürününüzle birlikte ilk kategorinizi de oluşturabilirsiniz.
                  </p>
                )}
              </div>
            </Panel>
          )}
          {step === 1 && (
            <Panel
              className="product-form-card product-wizard-variants"
              title="Varyasyon tercihi"
              description="Ürünün renk, beden veya ölçü gibi ayrı stok kodları olacak mı?"
            >
              <RadioGroup
                aria-label="Ürün varyasyon türü"
                value={variantMode}
                onChange={(value) => {
                  setVariantMode(value)
                  if (value === 'multiple' && !draft.variantAxes?.length)
                    change('variantAxes', [{ id: crypto.randomUUID(), name: 'Renk', values: [] }])
                }}
                className="product-type-choices"
                isDisabled={disabled}
              >
                <Radio value="single" className="product-type-choice">
                  <Radio.Content>
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    <Package size={23} />
                    <Label>Varyantsız ürün</Label>
                  </Radio.Content>
                  <Description>Tek stok kodu, tek fiyat ve barkod.</Description>
                </Radio>
                <Radio value="multiple" className="product-type-choice">
                  <Radio.Content>
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    <Layers3 size={23} />
                    <Label>Varyantlı ürün</Label>
                  </Radio.Content>
                  <Description>Renk, beden veya ölçüye göre ayrı stok ve fiyat.</Description>
                </Radio>
              </RadioGroup>
              <Field
                label={variantMode === 'multiple' ? 'Stok kodu öneki' : 'Stok kodu'}
                value={prefix}
                onChange={setPrefix}
                required
                maxLength={140}
                description={
                  variantMode === 'multiple'
                    ? 'Kombinasyon kodları bu önekle oluşturulur; sonraki adımda düzenlenebilir.'
                    : 'Kataloğunuzda benzersiz bir kod kullanın.'
                }
                isDisabled={disabled}
              />
              {variantMode === 'multiple' && (
                <>
                  <VariantAxesEditor
                    axes={draft.variantAxes ?? []}
                    onChange={(axes) => change('variantAxes', axes)}
                    disabled={disabled}
                  />
                  <div className="variant-combination-summary">
                    <Layers3 size={18} />
                    <span>
                      <strong>
                        {(draft.variantAxes ?? []).reduce(
                          (total, axis) => total * axis.values.length,
                          draft.variantAxes?.length ? 1 : 0,
                        )}
                      </strong>{' '}
                      kombinasyon hazırlanacak
                    </span>
                    <Chip size="sm" variant="soft">
                      En fazla {MAX_PRODUCT_VARIANTS}
                    </Chip>
                  </div>
                </>
              )}
            </Panel>
          )}
          {step === 2 && (
            <>
              <div className="product-editor-layout">
                <div className="product-editor-main">
                  <Panel
                    className="product-form-card"
                    title="Ürün bilgileri"
                    description="Varyantların paylaşacağı temel ürün bilgileri."
                  >
                    <ProductBasicFields product={draft} onChange={change} disabled={disabled} />
                  </Panel>
                  <Panel
                    className="product-form-card"
                    title="Ölçüler ve gümrük bilgileri"
                    description="Bildiğiniz alanları doldurun; mağaza ilanlarında kullanılabilir."
                  >
                    <ProductLogisticsFields product={draft} onChange={change} disabled={disabled} />
                  </Panel>
                </div>
                <aside className="product-draft-summary">
                  <Panel className="product-form-card">
                    <ProductArt product={{ ...draft, name: draft.name || 'Yeni ürün' }} />
                    <Chip size="sm" variant="soft" color="accent">
                      Ürün taslağı
                    </Chip>
                    <h2>{draft.name || 'Yeni ürününüz'}</h2>
                    <p>{draft.category}</p>
                    <dl>
                      <div>
                        <dt>Varyant</dt>
                        <dd>{draft.variants.length}</dd>
                      </div>
                      <div>
                        <dt>Açılış stoğu</dt>
                        <dd>
                          {draft.variants.reduce(
                            (sum, v) => sum + (Number.isFinite(v.stock) ? v.stock : 0),
                            0,
                          )}{' '}
                          {draft.unit ?? 'Adet'}
                        </dd>
                      </div>
                      <div>
                        <dt>Başlangıç fiyatı</dt>
                        <dd>
                          {money(
                            Math.min(
                              ...draft.variants.map((v) =>
                                Number.isFinite(v.price) ? v.price : 0,
                              ),
                            ),
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className="description field-description">
                      Ürünü oluşturduktan sonra stok, fiyat ve mağaza ilanlarını kendi sekmelerinden
                      yönetebilirsiniz.
                    </p>
                  </Panel>
                </aside>
              </div>
              <Panel
                className="product-form-card"
                title={
                  draft.variants.length > 1
                    ? 'Varyant fiyatları ve açılış stoğu'
                    : 'Fiyat ve açılış stoğu'
                }
                description={`${draft.currency ?? 'TRY'} · ${state.ecommerce?.pricesIncludeVat === false ? 'Tutarlar KDV hariç girilir.' : 'Tutarlar KDV dahildir.'} Açılışlar seçilen depoya işlenir.`}
                actions={
                  <SelectButton
                    label="Açılış deposu"
                    value={warehouseId}
                    onChange={setWarehouse}
                    options={warehouses(state)
                      .filter((w) => w.active)
                      .map((w) => ({ id: w.id, label: w.name, icon: <Warehouse size={15} /> }))}
                    isDisabled={disabled}
                  />
                }
              >
                {draft.variants.length > 1 && (
                  <BulkVariantValues
                    currency={draft.currency}
                    taxRate={draft.taxRate}
                    openingStock
                    disabled={disabled}
                    onApply={(patch) => {
                      setDraft((current) => ({
                        ...current,
                        variants: current.variants.map((v) => ({ ...v, ...patch })),
                      }))
                      setEpoch((value) => value + 1)
                    }}
                  />
                )}
                <VariantFieldsTable
                  currency={draft.currency}
                  taxRate={draft.taxRate}
                  variants={draft.variants}
                  onChange={updateVariant}
                  mode="create"
                  disabled={disabled}
                  epoch={epoch}
                />
              </Panel>
              <Panel className="product-form-card" title="Teknik özellikler">
                <TechnicalAttributesEditor
                  attributes={draft.technicalAttributes ?? []}
                  onChange={(attributes) => change('technicalAttributes', attributes)}
                  disabled={disabled}
                />
              </Panel>
              <Panel className="product-form-card" title="Açıklamalar">
                <ProductDescriptionFields product={draft} onChange={change} disabled={disabled} />
              </Panel>
              <Panel
                className="product-form-card"
                title="Resimler"
                description="Kapak ve ürün görsellerini ekleyin."
              >
                <ProductImages
                  name={draft.name}
                  images={draft.images ?? []}
                  onChange={(images) => change('images', images)}
                  disabled={disabled}
                  onBusyChange={setUploading}
                  metadata={draft.imageMetadata}
                  onMetadataChange={(value) => change('imageMetadata', value)}
                  colorOptions={productColorImageOptions(draft)}
                />
              </Panel>
            </>
          )}
        </motion.div>
        {error && (
          <p className="form-error product-page-error" role="alert">
            {error}
          </p>
        )}
        <div className="product-wizard-footer">
          <span>
            {step + 1} / 3 <span>· {steps[step]}</span>
          </span>
          <div>
            {step > 0 && (
              <Button
                variant="secondary"
                isDisabled={busy || uploading}
                onPress={() => {
                  setStep(step - 1)
                  setError('')
                }}
              >
                <ArrowLeft size={15} />
                Geri
              </Button>
            )}
            <Button variant="primary" type="submit" isDisabled={disabled || uploading}>
              {busy ? 'Oluşturuluyor…' : step === 2 ? 'Ürünü oluştur' : 'Devam'}
              {step === 2 ? <Check size={16} /> : <ArrowRight size={16} />}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
