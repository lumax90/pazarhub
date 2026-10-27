import { useState } from 'react'
import { Button, Checkbox, Chip, Description, Label, Radio, RadioGroup } from '@heroui/react'
import { Package, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../../app/AppProvider'
import type { Product } from '../../domain/types'
import { availableStock, findVariant } from '../../domain/selectors'
import {
  bundleTotals,
  MAX_BUNDLE_COMPONENTS,
  variantPrice,
  variantStock,
} from '../../domain/bundles'
import { MAIN_WAREHOUSE, warehouses } from '../../domain/inventory'
import { money } from '../../lib/format'
import { fromTry, toTry } from '../../domain/money'
import type { ProductChange } from './ProductFields'
import { Field, MoneyField, Panel, SelectButton } from '../ui/shared'
import { SearchSelect } from '../ui/SearchSelect'
import { DataTable } from '../ui/DataTable'

export function BundleComponentsEditor({
  product,
  onChange,
  disabled,
}: {
  product: Product
  onChange: ProductChange
  disabled?: boolean
}) {
  const { state } = useApp()
  const bundle = product.bundle!
  const totals = bundleTotals(state, product)
  const draftState = {
    ...state,
    products: [product, ...state.products.filter((p) => p.id !== product.id)],
  }
  return (
    <div className="bundle-components-editor">
      <SearchSelect
        label="Ürün ekle"
        value=""
        placeholder="Ürün adı, stok kodu veya barkod…"
        disabled={disabled || bundle.components.length >= MAX_BUNDLE_COMPONENTS}
        options={state.products
          .filter((p) => !p.bundle && p.id !== product.id)
          .flatMap((p) =>
            p.variants.map((v) => ({
              id: v.id,
              label: `${p.name} · ${v.name}`,
              description: `${v.sku} · ${money(variantPrice(state, v.id))}${p.active ? '' : ' · Pasif ürün'}`,
              search: v.barcode,
            })),
          )}
        onChange={(variantId) => {
          if (variantId && !bundle.components.some((c) => c.variantId === variantId))
            onChange('bundle', {
              ...bundle,
              components: [...bundle.components, { variantId, quantity: 1 }],
            })
        }}
      />
      <div className="bundle-component-table">
        <DataTable
          label="Paket bileşenleri"
          items={bundle.components.map((component) => ({ id: component.variantId, ...component }))}
          pageSize={10}
          paginate={bundle.components.length > 10}
          columns={[
            {
              id: 'product',
              label: 'Ürün',
              rowHeader: true,
              cell: (component) => {
                const found = findVariant(state, component.variantId)
                return (
                  <div>
                    <strong>{found?.product.name ?? 'Ürün bulunamadı'}</strong>
                    <span className="cell-secondary">
                      {found?.variant.name} · {found?.variant.sku}
                    </span>
                  </div>
                )
              },
            },
            {
              id: 'quantity',
              label: 'Paketteki adet',
              cell: (component) => (
                <Field
                  label={`${findVariant(state, component.id)?.variant.sku ?? component.id} paket adedi`}
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={String(component.quantity)}
                  onChange={(value) =>
                    onChange('bundle', {
                      ...bundle,
                      components: bundle.components.map((c) =>
                        c.variantId === component.id
                          ? { ...c, quantity: value === '' ? NaN : Number(value) }
                          : c,
                      ),
                    })
                  }
                  isDisabled={disabled}
                />
              ),
            },
            {
              id: 'stock',
              label: 'Stok',
              className: 'align-right',
              cell: (component) => variantStock(state, component.id),
            },
            {
              id: 'cost',
              label: 'Alış toplamı',
              className: 'align-right',
              cell: (component) => {
                const found = findVariant(state, component.id)
                const value = found
                  ? toTry(
                      found.variant.cost,
                      found.product.currency,
                      state.exchangeRates,
                      state.ecommerce?.exchangeRateType,
                    )
                  : 0
                return value ? money(value * component.quantity) : '—'
              },
            },
            {
              id: 'price',
              label: 'Satış toplamı',
              className: 'align-right',
              cell: (component) => money(variantPrice(state, component.id) * component.quantity),
            },
            {
              id: 'action',
              label: '',
              cell: (component) => (
                <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  aria-label={`${findVariant(state, component.id)?.variant.sku ?? component.id} bileşenini kaldır`}
                  isDisabled={disabled}
                  onPress={() =>
                    onChange('bundle', {
                      ...bundle,
                      components: bundle.components.filter((c) => c.variantId !== component.id),
                    })
                  }
                >
                  <Trash2 size={15} />
                </Button>
              ),
            },
          ]}
          emptyTitle="Henüz ürün eklenmedi"
          emptyDescription="Pakete girecek varyantları arayın ve her birinin adedini belirleyin."
        />
      </div>
      <div className="bundle-summary-strip">
        <span>
          İçerik
          <strong>
            {bundle.components.length} ürün ·{' '}
            {bundle.components.reduce(
              (sum, c) => sum + (Number.isFinite(c.quantity) ? c.quantity : 0),
              0,
            )}{' '}
            adet
          </strong>
        </span>
        <span>
          Alış toplamı
          <strong>
            {totals.costKnown && Number.isFinite(totals.cost) ? money(totals.cost) : '—'}
          </strong>
        </span>
        <span>
          Satış toplamı<strong>{Number.isFinite(totals.price) ? money(totals.price) : '—'}</strong>
        </span>
        <span>
          Paket stoğu<strong>{variantStock(draftState, product.variants[0].id)}</strong>
        </span>
      </div>
      <p className="description field-description">
        Paket en az iki adet ürün içermeli. Aynı varyant için miktarı artırabilirsiniz.
      </p>
    </div>
  )
}

export function BundlePricingFields({
  product,
  onChange,
  disabled,
  showContentsOption = true,
}: {
  product: Product
  onChange: ProductChange
  disabled?: boolean
  showContentsOption?: boolean
}) {
  const { state } = useApp(),
    [epoch, setEpoch] = useState(0)
  const bundle = product.bundle!,
    totals = bundleTotals(state, product)
  const price =
    bundle.priceMode === 'linked'
      ? Number.isSafeInteger(totals.price) && Number.isInteger(bundle.discountBps)
        ? Number((BigInt(totals.price) * BigInt(10000 - bundle.discountBps) + 5000n) / 10000n)
        : NaN
      : toTry(
          product.variants[0].price,
          product.currency,
          state.exchangeRates,
          state.ecommerce?.exchangeRateType,
        )
  return (
    <div className="bundle-pricing">
      <RadioGroup
        aria-label="Paket fiyat modeli"
        value={bundle.priceMode}
        onChange={(mode) => {
          onChange('bundle', { ...bundle, priceMode: mode as 'linked' | 'fixed' })
          onChange(
            'variants',
            product.variants.map((v) => ({
              ...v,
              price:
                mode === 'linked'
                  ? 0
                  : Number.isFinite(price)
                    ? fromTry(
                        price,
                        product.currency,
                        state.exchangeRates,
                        state.ecommerce?.exchangeRateType,
                      )
                    : 0,
              cost: 0,
            })),
          )
          setEpoch((value) => value + 1)
        }}
        isDisabled={disabled}
      >
        <Radio value="linked" className="bundle-price-choice">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Label>Ürün fiyatlarıyla eşle</Label>
          </Radio.Content>
          <Description>Bileşen fiyatları değiştiğinde aynı indirimle güncellenir.</Description>
        </Radio>
        <Radio value="fixed" className="bundle-price-choice">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Label>Fiyatı sabit tut</Label>
          </Radio.Content>
          <Description>Paketin satış fiyatını siz belirlersiniz.</Description>
        </Radio>
      </RadioGroup>
      <div className="form-grid">
        {bundle.priceMode === 'linked' ? (
          <Field
            label="Paket indirimi (%)"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={String(bundle.discountBps / 100)}
            onChange={(value) =>
              onChange('bundle', {
                ...bundle,
                discountBps: value === '' ? NaN : Math.round(Number(value) * 100),
              })
            }
            isDisabled={disabled}
            description="İçindeki ürünlerin toplam satış fiyatına uygulanır."
          />
        ) : (
          <MoneyField
            key={`${epoch}-${product.currency}-${product.taxRate}-${state.ecommerce?.pricesIncludeVat}`}
            label={`Sabit paket fiyatı (${!product.currency || product.currency === 'TRY' ? '₺' : product.currency})`}
            netTaxRate={state.ecommerce?.pricesIncludeVat === false ? product.taxRate : undefined}
            initialValue={product.variants[0].price}
            onChange={(price) =>
              onChange(
                'variants',
                product.variants.map((v) => ({ ...v, price, cost: 0 })),
              )
            }
            isDisabled={disabled}
          />
        )}
        <div className="bundle-final-price">
          <span>Satış fiyatı · KDV dahil</span>
          <strong>{Number.isFinite(price) ? money(price) : '—'}</strong>
          <small>
            Alış toplamı: {totals.costKnown ? money(totals.cost) : 'Maliyet bilgisi eksik'}
          </small>
        </div>
      </div>
      {showContentsOption && (
        <BundleDescriptionOption product={product} onChange={onChange} disabled={disabled} />
      )}
    </div>
  )
}

export function BundleDescriptionOption({
  product,
  onChange,
  disabled,
}: {
  product: Product
  onChange: ProductChange
  disabled?: boolean
}) {
  return (
    <>
      <Checkbox
        className="app-checkbox"
        isSelected={product.bundle?.includeContents ?? false}
        onChange={(includeContents) => onChange('bundle', { ...product.bundle!, includeContents })}
        isDisabled={disabled}
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Label>Paket içeriğini açıklamaya ekle</Label>
        </Checkbox.Content>
      </Checkbox>
      <p className="description field-description">
        Stok kodu, ürün adı ve adet tablosu paket kaydedilirken yenilenir.
      </p>
    </>
  )
}

export function BundleStockView({ product }: { product: Product }) {
  const { state } = useApp(),
    [warehouse, setWarehouse] = useState(MAIN_WAREHOUSE)
  const variantId = product.variants[0].id
  return (
    <Panel
      className="product-form-card"
      title="Paket stoğu"
      description="Bileşenler aynı depoda bulunduğunda hazırlanabilecek paket adedi."
      actions={
        <SelectButton
          label="Paket stok deposu"
          value={warehouse}
          onChange={setWarehouse}
          options={warehouses(state).map((w) => ({ id: w.id, label: w.name }))}
        />
      }
    >
      <div className="bundle-stock-summary">
        <Package size={24} />
        <div>
          <strong>
            {availableStock(state, variantId, undefined, warehouse)} paket satılabilir
          </strong>
          <p>
            Fiziksel içerikten {variantStock(state, variantId, warehouse)} paket hazırlanabilir.
            Sipariş rezervasyonları bileşenlerle ortaktır.
          </p>
        </div>
        <Chip variant="soft" size="sm">
          İçerikten hesaplanır
        </Chip>
      </div>
      <DataTable
        label="Paket bileşen stokları"
        items={product.bundle!.components.map((c) => ({ ...c, id: c.variantId }))}
        columns={[
          {
            id: 'name',
            label: 'Bileşen',
            rowHeader: true,
            cell: (c) => {
              const found = findVariant(state, c.id)
              return (
                <div>
                  <strong>{found?.product.name}</strong>
                  <span className="cell-secondary">
                    {found?.variant.name} · {found?.variant.sku}
                  </span>
                </div>
              )
            },
          },
          { id: 'quantity', label: 'Pakette', className: 'align-right', cell: (c) => c.quantity },
          {
            id: 'stock',
            label: 'Depo stoğu',
            className: 'align-right',
            cell: (c) => variantStock(state, c.id, warehouse),
          },
          {
            id: 'available',
            label: 'Satılabilir',
            className: 'align-right',
            cell: (c) => availableStock(state, c.id, undefined, warehouse),
          },
          {
            id: 'action',
            label: '',
            cell: (c) => (
              <Link
                className="provider-doc-link"
                to={`/products/${findVariant(state, c.id)?.product.id}?tab=stocks`}
              >
                Stok kartını aç
              </Link>
            ),
          },
        ]}
        paginate={product.bundle!.components.length > 10}
      />
    </Panel>
  )
}
