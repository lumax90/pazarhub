import { useId } from 'react'
import { Button, Dropdown, Label } from '@heroui/react'
import { Plus, Trash2 } from 'lucide-react'
import type { Product, ProductAttribute, ProductDimensions } from '../../domain/types'
import { productUnits } from '../../domain/products'
import { Field, SelectButton } from '../ui/shared'
import { DefinitionField } from '../inventory/DefinitionField'
import { useApp } from '../../app/AppProvider'
import { SearchSelect } from '../ui/SearchSelect'
import { currencyCodes } from '../../domain/money'
import type { CurrencyCode } from '../../domain/money'

export type ProductChange = <K extends keyof Product>(key: K, value: Product[K]) => void
interface ProductFieldsProps {
  product: Product
  onChange: ProductChange
  disabled?: boolean
}

export function ProductBasicFields({
  product,
  onChange,
  disabled,
  nameLabel = 'Ürün adı',
}: ProductFieldsProps & { nameLabel?: string }) {
  return (
    <div className="form-grid">
      <Field
        label={nameLabel}
        value={product.name}
        onChange={(v) => onChange('name', v)}
        required
        maxLength={300}
        className="span-2"
        isDisabled={disabled}
      />
      <Field
        label="Alt başlık"
        value={product.subtitle ?? ''}
        onChange={(v) => onChange('subtitle', v)}
        maxLength={300}
        className="span-2"
        isDisabled={disabled}
      />
      <Field
        label="Fatura adı"
        value={product.invoiceName ?? ''}
        onChange={(v) => onChange('invoiceName', v)}
        maxLength={300}
        description="Boş bırakırsanız ürün adı kullanılır. Yeni satışların fatura kalemine aktarılır."
        className="span-2"
        isDisabled={disabled}
      />
      <DefinitionField
        kind="category"
        label="Kategori"
        value={product.category}
        definitionId={product.categoryId}
        onChange={(v, id) => {
          onChange('category', v)
          onChange('categoryId', id)
        }}
        disabled={disabled}
      />
      <Field
        label="Model kodu"
        value={product.modelCode ?? ''}
        onChange={(v) => onChange('modelCode', v)}
        maxLength={160}
        description="Varyantları bir arada tutan ana ürün kodu."
        isDisabled={disabled}
      />
      <DefinitionField
        kind="brand"
        label="Marka"
        value={product.brand}
        definitionId={product.brandId}
        onChange={(v, id) => {
          onChange('brand', v)
          onChange('brandId', id)
        }}
        disabled={disabled}
      />
      <DefinitionField
        kind="supplier"
        label="Tedarikçi"
        value={product.supplier ?? ''}
        definitionId={product.supplierId}
        onChange={(v, id) => {
          onChange('supplier', v)
          onChange('supplierId', id)
        }}
        disabled={disabled}
      />
      <div className="select-field">
        <label className="label">Birim</label>
        <SelectButton
          label="Ürün birimi"
          value={product.unit ?? 'Adet'}
          onChange={(v) => onChange('unit', v)}
          options={[...new Set([...productUnits, ...(product.unit ? [product.unit] : [])])].map(
            (v) => ({ id: v, label: v }),
          )}
          isDisabled={disabled}
        />
      </div>
      <div className="select-field">
        <label className="label">KDV oranı</label>
        <SelectButton
          label="Ürün KDV oranı"
          value={String(product.taxRate)}
          onChange={(v) => onChange('taxRate', Number(v))}
          options={[...new Set([0, 1, 10, 20, product.taxRate])].map((v) => ({
            id: String(v),
            label: `%${v}`,
          }))}
          isDisabled={disabled}
        />
      </div>
      <Field
        label="Kritik stok eşiği"
        type="number"
        min={0}
        max={100000}
        step={1}
        value={String(product.lowStock)}
        onChange={(v) => onChange('lowStock', v === '' ? NaN : Number(v))}
        isDisabled={disabled}
      />
      <div className="select-field">
        <label className="label">Para birimi</label>
        <SelectButton
          label="Ürün para birimi"
          value={product.currency ?? 'TRY'}
          onChange={(value) => onChange('currency', value as CurrencyCode)}
          options={currencyCodes.map((id) => ({
            id,
            label: id === 'TRY' ? 'TRY · Türk Lirası' : id,
          }))}
          isDisabled={disabled}
        />
      </div>
      <div className="select-field">
        <label className="label">Ürün durumu</label>
        <SelectButton
          label="Ürün aktifliği"
          value={product.active ? 'active' : 'inactive'}
          onChange={(v) => onChange('active', v === 'active')}
          options={[
            { id: 'active', label: 'Aktif' },
            { id: 'inactive', label: 'Pasif' },
          ]}
          isDisabled={disabled}
        />
      </div>
    </div>
  )
}

export function ProductLogisticsFields({ product, onChange, disabled }: ProductFieldsProps) {
  const dimensions: { key: keyof ProductDimensions; label: string; max: number }[] = [
    { key: 'lengthCm', label: 'Uzunluk (cm)', max: 100000 },
    { key: 'widthCm', label: 'Genişlik (cm)', max: 100000 },
    { key: 'heightCm', label: 'Yükseklik (cm)', max: 100000 },
    { key: 'weightGr', label: 'Ağırlık (gr)', max: 100000000 },
    { key: 'desi', label: 'Desi', max: 10000 },
  ]
  return (
    <div className="form-grid">
      <Field
        label="Menşei ülke kodu"
        placeholder="TR"
        value={product.origin ?? ''}
        onChange={(v) => onChange('origin', v.toUpperCase())}
        maxLength={2}
        description="İki harfli ülke kodu; örneğin TR."
        isDisabled={disabled}
      />
      <Field
        label="GTİP"
        value={product.gtip ?? ''}
        onChange={(v) => onChange('gtip', v)}
        maxLength={12}
        description="12 haneli gümrük tarife numarası."
        isDisabled={disabled}
      />
      {dimensions.map(({ key, label, max }) => (
        <Field
          key={key}
          label={label}
          type="number"
          min={0}
          max={max}
          step="any"
          value={product.dimensions?.[key] === undefined ? '' : String(product.dimensions[key])}
          onChange={(v) => {
            const next = { ...product.dimensions }
            if (v === '') delete next[key]
            else next[key] = Number(v)
            onChange('dimensions', next)
          }}
          isDisabled={disabled}
        />
      ))}
    </div>
  )
}

export function ProductDescriptionFields({ product, onChange, disabled }: ProductFieldsProps) {
  const id = useId()
  return (
    <div className="product-description-fields">
      {(
        [
          { key: 'shortDescription', label: 'Kısa açıklama', rows: 3, max: 2000 },
          { key: 'description', label: 'Detay açıklama', rows: 10, max: 30000 },
          { key: 'note', label: 'İç not', rows: 3, max: 5000 },
        ] as const
      ).map((field) => (
        <div className="native-textarea-field" key={field.key}>
          <label className="label" htmlFor={`${id}-${field.key}`}>
            {field.label}
          </label>
          <textarea
            className="textarea textarea--secondary"
            id={`${id}-${field.key}`}
            value={product[field.key] ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            rows={field.rows}
            maxLength={field.max}
            disabled={disabled}
          />
          <span className="description field-description">
            {field.key === 'note'
              ? 'Yalnızca çalışma alanınızda görünür.'
              : `${(product[field.key]?.length ?? 0).toLocaleString('tr-TR')} / ${field.max.toLocaleString('tr-TR')} karakter`}
          </span>
        </div>
      ))}
    </div>
  )
}

export function TechnicalAttributesEditor({
  attributes,
  onChange,
  disabled,
}: {
  attributes: ProductAttribute[]
  onChange: (attributes: ProductAttribute[]) => void
  disabled?: boolean
}) {
  const { state } = useApp()
  const definitions = (state.definitions ?? []).filter(
    (definition) => definition.kind === 'attribute',
  )
  return (
    <div className="technical-attributes-editor">
      <SearchSelect
        label="Tanımlı özellik ekle"
        value=""
        options={definitions
          .filter(
            (definition) =>
              definition.active &&
              !attributes.some((attribute) => attribute.definitionId === definition.id),
          )
          .map((definition) => ({ id: definition.id, label: definition.name }))}
        disabled={disabled || attributes.length >= 100}
        onChange={(id) => {
          const definition = definitions.find((definition) => definition.id === id)
          if (definition && !attributes.some((attribute) => attribute.definitionId === id))
            onChange([
              ...attributes,
              {
                id: crypto.randomUUID(),
                name: definition.name,
                value: '',
                definitionId: id,
                valueIds: [],
              },
            ])
        }}
      />
      {!attributes.length && (
        <p className="empty-inline">
          Malzeme, kullanım alanı veya üretim türü gibi özellikleri ekleyin.
        </p>
      )}
      {attributes.map((attribute, index) => (
        <div className="technical-attribute-row" key={attribute.id}>
          {attribute.definitionId &&
          definitions.some((definition) => definition.id === attribute.definitionId) ? (
            <>
              <div className="technical-definition-name">
                <strong>{attribute.name}</strong>
                <small>Tanımlı özellik</small>
              </div>
              <Dropdown>
                <Button
                  variant="secondary"
                  aria-label={`${attribute.name} değerleri`}
                  isDisabled={
                    disabled ||
                    !definitions.find((definition) => definition.id === attribute.definitionId)
                      ?.active
                  }
                >
                  {attribute.value || 'Değer seçin'}
                </Button>
                <Dropdown.Popover className="app-dropdown">
                  <Dropdown.Menu
                    aria-label={`${attribute.name} değer seçenekleri`}
                    selectionMode="multiple"
                    selectedKeys={new Set(attribute.valueIds ?? [])}
                    onSelectionChange={(keys) => {
                      const definition = definitions.find(
                        (definition) => definition.id === attribute.definitionId,
                      )!
                      const ids =
                        keys === 'all'
                          ? (definition.values ?? [])
                              .filter((value) => value.active)
                              .map((value) => value.id)
                          : [...keys].map(String)
                      const labels = ids.map(
                        (id) => definition.values?.find((value) => value.id === id)?.name ?? '',
                      )
                      onChange(
                        attributes.map((item) =>
                          item.id === attribute.id
                            ? {
                                ...item,
                                valueIds: ids,
                                valueLabels: labels,
                                value: labels.join(', '),
                              }
                            : item,
                        ),
                      )
                    }}
                  >
                    {definitions
                      .find((definition) => definition.id === attribute.definitionId)
                      ?.values?.filter(
                        (value) => value.active || attribute.valueIds?.includes(value.id),
                      )
                      .map((value) => (
                        <Dropdown.Item
                          key={value.id}
                          id={value.id}
                          textValue={value.name}
                          shouldCloseOnSelect={false}
                          isDisabled={!value.active}
                        >
                          <Label>
                            {value.name}
                            {value.active ? '' : ' (pasif)'}
                          </Label>
                        </Dropdown.Item>
                      ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </>
          ) : (
            <>
              <Field
                label={`Özellik ${index + 1}`}
                value={attribute.name}
                onChange={(name) =>
                  onChange(
                    attributes.map((a) =>
                      a.id === attribute.id
                        ? {
                            ...a,
                            name,
                            definitionId: undefined,
                            valueIds: undefined,
                            valueLabels: undefined,
                          }
                        : a,
                    ),
                  )
                }
                placeholder="Örn. Malzeme"
                maxLength={100}
                required
                isDisabled={disabled}
              />
              <Field
                label={`Değer ${index + 1}`}
                value={attribute.value}
                onChange={(value) =>
                  onChange(attributes.map((a) => (a.id === attribute.id ? { ...a, value } : a)))
                }
                placeholder="Örn. Seramik"
                maxLength={1000}
                required
                isDisabled={disabled}
              />
            </>
          )}
          <Button
            isIconOnly
            variant="ghost"
            aria-label={`${attribute.name || `Özellik ${index + 1}`} kaldır`}
            isDisabled={disabled}
            onPress={() => onChange(attributes.filter((a) => a.id !== attribute.id))}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        isDisabled={disabled || attributes.length >= 100}
        onPress={() => onChange([...attributes, { id: crypto.randomUUID(), name: '', value: '' }])}
      >
        <Plus size={15} />
        Özellik ekle
      </Button>
    </div>
  )
}
