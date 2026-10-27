import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@heroui/react'
import { ArrowLeft, ArrowRight, Check, ImagePlus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Product } from '../domain/types'
import { findVariant } from '../domain/selectors'
import { validateBundle } from '../domain/bundles'
import { Field, PageHeader, Panel } from '../components/ui/shared'
import {
  ProductBasicFields,
  ProductDescriptionFields,
  ProductLogisticsFields,
} from '../components/products/ProductFields'
import { BundleComponentsEditor, BundlePricingFields } from '../components/products/BundleFields'
import { ProductImages } from '../components/products/ProductImages'
import { DefinitionField } from '../components/inventory/DefinitionField'
import { categoryPath, categoryTree, definitionActive } from '../domain/definitions'

export function NewBundlePage() {
  const { state, run, can } = useApp(),
    navigate = useNavigate()
  const [product, setProduct] = useState<Product>(() => {
    const used = new Set(state.products.flatMap((p) => p.variants.map((v) => v.sku)))
    let sequence = state.products.length + 1
    while (used.has(`PKT-${String(sequence).padStart(4, '0')}`)) sequence++
    const code = `PKT-${String(sequence).padStart(4, '0')}`
    return {
      id: crypto.randomUUID(),
      name: '',
      category: '',
      brand: state.preferences.businessName,
      description: '',
      art: 'bag',
      color: '#c5b29d',
      active: true,
      taxRate: 20,
      lowStock: 5,
      unit: 'Adet',
      modelCode: code,
      variants: [
        {
          id: crypto.randomUUID(),
          name: 'Paket',
          sku: code,
          barcode: '',
          price: 0,
          cost: 0,
          stock: 0,
        },
      ],
      bundle: { components: [], priceMode: 'linked', discountBps: 0, includeContents: false },
    }
  })
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState('')
  const disabled = busy || !can('catalog.write')
  const change = <K extends keyof Product>(key: K, value: Product[K]) =>
    setProduct((current) => ({ ...current, [key]: value }))
  const chooseCategory = (category: string, categoryId?: string) =>
    setProduct((current) => ({ ...current, category, categoryId }))
  const copyImages = () =>
    change(
      'images',
      [
        ...new Set(
          product.bundle!.components.flatMap(
            (component) =>
              findVariant(state, component.variantId)?.product.images?.slice(0, 1) ?? [],
          ),
        ),
      ].slice(0, 12),
    )
  const next = () => {
    setError('')
    if (!product.category.trim()) {
      setError('Paket kategorisini seçin.')
      return
    }
    if (step === 1) {
      const parts = product.bundle!.components
      if (
        !parts.length ||
        parts.some((part) => !Number.isInteger(part.quantity) || part.quantity < 1) ||
        parts.reduce((sum, part) => sum + part.quantity, 0) < 2
      ) {
        setError('Paket en az iki adet ürün içermeli. Bileşenleri ve miktarlarını kontrol edin.')
        return
      }
      if (!product.images?.length) copyImages()
    }
    setStep((value) => value + 1)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled || uploading) return
    if (step < 2) {
      next()
      return
    }
    const problem = validateBundle(state, product)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    const result = await run({ type: 'product.save', product })
    setBusy(false)
    if (result.ok) navigate(`/products/${product.id}?tab=variants`, { replace: true })
    else setError(result.message)
  }
  return (
    <div className="product-workspace bundle-workspace">
      <PageHeader
        title="Paket oluştur"
        description="Ürünleri tek paket/set altında birleştirin; stok bileşenlerden hesaplansın."
        actions={
          <Link to="/products" className="button button--secondary">
            <ArrowLeft size={15} />
            Listeye dön
          </Link>
        }
      />
      <nav className="product-steps" aria-label="Paket oluşturma adımları">
        {['Kategori', 'İçerik', 'Paket bilgileri'].map((label, index) => (
          <button
            key={label}
            type="button"
            className={`button button--md ${step === index ? 'button--secondary is-current' : 'button--ghost'} ${index < step ? 'is-complete' : ''}`}
            aria-current={step === index ? 'step' : undefined}
            disabled={index > step || disabled || uploading}
            onClick={() => setStep(index)}
          >
            <span className="product-step-number">
              {index < step ? <Check size={16} /> : index + 1}
            </span>
            <span>
              <strong>{label}</strong>
              <small>
                {index === 0
                  ? product.category || 'Kategori seçin'
                  : index === 1
                    ? `${product.bundle!.components.length} bileşen`
                    : 'Fiyat ve görseller'}
              </small>
            </span>
          </button>
        ))}
      </nav>
      <form onSubmit={submit}>
        {step === 0 && (
          <Panel
            className="product-form-card product-wizard-category"
            title="Ürün kategorisi"
            description="Paketin listeleneceği kategoriyi belirleyin."
          >
            <DefinitionField
              kind="category"
              label="Paket kategorisi"
              value={product.category}
              definitionId={product.categoryId}
              onChange={chooseCategory}
              disabled={disabled}
            />
            <div className="product-category-choices">
              {categoryTree(state.definitions ?? [])
                .filter((category) => definitionActive(state.definitions ?? [], category))
                .map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    onClick={() =>
                      chooseCategory(categoryPath(state.definitions ?? [], category), category.id)
                    }
                    className={`button button--md ${
                      product.category === categoryPath(state.definitions ?? [], category)
                        ? 'button--secondary is-selected'
                        : 'button--ghost'
                    }`}
                  >
                    <strong>{categoryPath(state.definitions ?? [], category)}</strong>
                  </button>
                ))}
            </div>
          </Panel>
        )}
        {step === 1 && (
          <Panel
            className="product-form-card"
            title="Paketin içeriği"
            description="Pakete girecek mevcut ürün varyantlarını ve her birinin adedini belirleyin."
          >
            <BundleComponentsEditor product={product} onChange={change} disabled={disabled} />
          </Panel>
        )}
        {step === 2 && (
          <>
            <div className="product-information-grid">
              <Panel className="product-form-card" title="Paket bilgileri">
                <ProductBasicFields
                  product={product}
                  onChange={change}
                  disabled={disabled}
                  nameLabel="Paket adı"
                />
                <div className="form-grid bundle-code-fields">
                  <Field
                    label="Paket stok kodu"
                    value={product.variants[0].sku}
                    onChange={(sku) =>
                      change(
                        'variants',
                        product.variants.map((v) => ({ ...v, sku })),
                      )
                    }
                    required
                    isDisabled={disabled}
                    maxLength={160}
                  />
                  <Field
                    label="Paket barkodu"
                    value={product.variants[0].barcode}
                    onChange={(barcode) =>
                      change(
                        'variants',
                        product.variants.map((v) => ({ ...v, barcode })),
                      )
                    }
                    required
                    isDisabled={disabled}
                    maxLength={80}
                    description="Rakamlarla girin; baştaki sıfırlar korunur."
                  />
                </div>
              </Panel>
              <Panel className="product-form-card" title="Ölçüler ve gümrük bilgileri">
                <ProductLogisticsFields product={product} onChange={change} disabled={disabled} />
              </Panel>
            </div>
            <Panel
              className="product-form-card"
              title="Paket fiyatı"
              description="Tutarlar KDV dahildir."
            >
              <BundlePricingFields product={product} onChange={change} disabled={disabled} />
            </Panel>
            <Panel className="product-form-card" title="Açıklamalar">
              <ProductDescriptionFields product={product} onChange={change} disabled={disabled} />
            </Panel>
            <Panel
              className="product-form-card"
              title="Görseller"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={disabled || uploading}
                  onPress={copyImages}
                >
                  <ImagePlus size={15} />
                  Ürün kapaklarından al
                </Button>
              }
            >
              <ProductImages
                name={product.name}
                images={product.images ?? []}
                onChange={(images) => change('images', images)}
                disabled={disabled}
                onBusyChange={setUploading}
              />
            </Panel>
          </>
        )}
        {error && (
          <p className="form-error product-page-error" role="alert">
            {error}
          </p>
        )}
        <div className="product-wizard-footer">
          <span>{step + 1} / 3</span>
          <div>
            {step > 0 && (
              <Button
                variant="secondary"
                isDisabled={disabled || uploading}
                onPress={() => {
                  setStep((value) => value - 1)
                  setError('')
                }}
              >
                <ArrowLeft size={15} />
                Geri
              </Button>
            )}
            <Button variant="primary" type="submit" isDisabled={disabled || uploading}>
              {busy ? 'Kaydediliyor…' : step === 2 ? 'Paketi kaydet' : 'Devam'}
              <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
