import { useState } from 'react'
import { Button, Chip, SurfaceContext } from '@heroui/react'
import { Barcode, Plus, Trash2, X } from 'lucide-react'
import { Link } from 'react-router'
import type { Variant, VariantAxis } from '../../domain/types'
import { MAX_VARIANT_AXES } from '../../domain/products'
import { barcodeScheme, gtinProblem, nextBarcodes, usedBarcodes } from '../../domain/barcodes'
import { DataTable } from '../ui/DataTable'
import type { Column } from '../ui/DataTable'
import { Field, MoneyField, SelectButton } from '../ui/shared'
import { SearchSelect } from '../ui/SearchSelect'
import { useApp } from '../../app/AppProvider'
import { definitionKey, definitionValues } from '../../domain/definitions'

export function VariantAxesEditor({
  axes,
  onChange,
  disabled,
}: {
  axes: VariantAxis[]
  onChange: (axes: VariantAxis[]) => void
  disabled?: boolean
}) {
  const { state } = useApp()
  return (
    <div className="variant-axes-editor">
      <SearchSelect
        label="Tanımlı varyant tipi"
        value=""
        options={(state.definitions ?? [])
          .filter(
            (definition) =>
              definition.kind === 'variant' &&
              definition.active &&
              !axes.some(
                (axis) =>
                  axis.definitionId === definition.id ||
                  definitionKey(axis.name) === definitionKey(definition.name),
              ),
          )
          .map((definition) => ({ id: definition.id, label: definition.name }))}
        disabled={disabled || axes.length >= MAX_VARIANT_AXES}
        onChange={(id) => {
          const definition = state.definitions?.find((definition) => definition.id === id)
          if (definition)
            onChange([
              ...axes,
              {
                id: crypto.randomUUID(),
                name: definition.name,
                definitionId: definition.id,
                values: [],
              },
            ])
        }}
      />
      {axes.map((axis, index) => (
        <AxisEditor
          key={axis.id}
          axis={axis}
          index={index}
          disabled={disabled}
          onChange={(next) => onChange(axes.map((a) => (a.id === axis.id ? next : a)))}
          onRemove={() => onChange(axes.filter((a) => a.id !== axis.id))}
        />
      ))}
      <Button
        variant="secondary"
        size="sm"
        isDisabled={disabled || axes.length >= MAX_VARIANT_AXES}
        onPress={() => onChange([...axes, { id: crypto.randomUUID(), name: '', values: [] }])}
      >
        <Plus size={15} />
        Varyant tipi ekle
      </Button>
      <p className="description field-description">
        En fazla 3 tip ve 500 kombinasyon. Örneğin renk × beden.
      </p>
    </div>
  )
}

function AxisEditor({
  axis,
  index,
  onChange,
  onRemove,
  disabled,
}: {
  axis: VariantAxis
  index: number
  onChange: (axis: VariantAxis) => void
  onRemove: () => void
  disabled?: boolean
}) {
  const { state } = useApp()
  const definition = state.definitions?.find(
    (definition) =>
      definition.kind === 'variant' &&
      (axis.definitionId
        ? definition.id === axis.definitionId
        : definitionKey(definition.name) === definitionKey(axis.name)),
  )
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const add = () => {
    const names = text
      .split(/[,;\n]/)
      .map((v) => v.trim())
      .filter(Boolean)
    const used = new Set(axis.values.map((v) => v.name.toLocaleLowerCase('tr-TR')))
    const values = [...axis.values]
    for (const name of names) {
      if (name.length > 100) {
        setError('Değerler en fazla 100 karakter olabilir.')
        return
      }
      const key = name.toLocaleLowerCase('tr-TR')
      if (!used.has(key)) {
        values.push({ id: crypto.randomUUID(), name })
        used.add(key)
      }
    }
    if (values.length > 100) {
      setError('Bir varyant tipinde en fazla 100 değer olabilir.')
      return
    }
    onChange({ ...axis, values })
    setText('')
    setError('')
  }
  return (
    <SurfaceContext value={{ variant: 'secondary' }}>
      <div className="variant-axis-card">
        <div className="variant-axis-heading">
          <Field
            label={`Varyant tipi ${index + 1}`}
            value={axis.name}
            onChange={(name) => onChange({ ...axis, name, definitionId: undefined })}
            placeholder="Örn. Renk"
            maxLength={100}
            required
            isDisabled={disabled}
          />
          <Button
            variant="ghost"
            isIconOnly
            isDisabled={disabled}
            aria-label={`${axis.name || `Varyant tipi ${index + 1}`} tipini kaldır`}
            onPress={onRemove}
          >
            <Trash2 size={16} />
          </Button>
        </div>
        <div className="variant-axis-values">
          {axis.values.map((value) => (
            <Chip key={value.id} variant="soft" size="sm">
              <span>{value.name}</span>
              <button
                className="close-button close-button--default"
                type="button"
                disabled={disabled}
                aria-label={`${axis.name}: ${value.name} kaldır`}
                onClick={() =>
                  onChange({ ...axis, values: axis.values.filter((v) => v.id !== value.id) })
                }
              >
                <X size={12} />
              </button>
            </Chip>
          ))}
        </div>
        {definition && (
          <SearchSelect
            label={`${axis.name} tanımlı değeri`}
            value=""
            disabled={disabled || !definition.active}
            options={definitionValues(state, definition)
              .filter(
                (value) =>
                  value.active &&
                  !axis.values.some(
                    (selected) =>
                      selected.definitionValueId === value.id ||
                      definitionKey(selected.name) === definitionKey(value.name),
                  ),
              )
              .map((value) => ({ id: value.id, label: value.name }))}
            onChange={(id) => {
              const value = definitionValues(state, definition).find((value) => value.id === id)
              if (value && !axis.values.some((selected) => selected.definitionValueId === value.id))
                onChange({
                  ...axis,
                  definitionId: definition.id,
                  values: [
                    ...axis.values,
                    { id: crypto.randomUUID(), name: value.name, definitionValueId: value.id },
                  ],
                })
            }}
          />
        )}
        <div
          className="variant-axis-add"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
              event.preventDefault()
              if (!disabled) add()
            }
          }}
        >
          <Field
            label={`${axis.name || `Tip ${index + 1}`} değerleri`}
            value={text}
            onChange={setText}
            placeholder="Siyah, Beyaz, Mavi"
            description="Değerleri virgülle ayırıp ekleyin."
            isDisabled={disabled}
          />
          <Button variant="outline" size="sm" isDisabled={disabled || !text.trim()} onPress={add}>
            Değerleri ekle
          </Button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </SurfaceContext>
  )
}

export function VariantFieldsTable({
  variants,
  onChange,
  mode,
  axes = [],
  disabled,
  epoch = 0,
  onRemove,
  currency = 'TRY',
  taxRate = 20,
}: {
  variants: Variant[]
  onChange: (id: string, patch: Partial<Variant>) => void
  mode: 'create' | 'prices' | 'barcodes' | 'variants'
  axes?: VariantAxis[]
  disabled?: boolean
  epoch?: number
  onRemove?: (id: string) => void
  currency?: string
  taxRate?: number
}) {
  const { state } = useApp()
  const netTaxRate = state.ecommerce?.pricesIncludeVat === false ? taxRate : undefined
  const symbol = currency === 'TRY' ? '₺' : currency
  const single = variants.length === 1
  const label = (text: string, variant: Variant) => (single ? text : `${text} · ${variant.name}`)
  const columns: Column<Variant>[] = [
    {
      id: 'variant',
      label: 'Varyant',
      rowHeader: true,
      cell: (variant) =>
        mode === 'variants' ? (
          <Field
            label={label('Varyant adı', variant)}
            value={variant.name}
            onChange={(name) => onChange(variant.id, { name })}
            maxLength={150}
            isDisabled={disabled}
          />
        ) : (
          <div className="variant-table-title">
            <strong>{variant.name}</strong>
            <span className="code-text">{variant.sku}</span>
          </div>
        ),
    },
  ]
  if (mode === 'variants')
    for (const axis of axes)
      columns.push({
        id: axis.id,
        label: axis.name || 'Varyant tipi',
        cell: (variant) => (
          <SelectButton
            label={`${axis.name || 'Tip'} · ${variant.name}`}
            value={variant.options?.[axis.id] ?? ''}
            onChange={(value) =>
              onChange(variant.id, { options: { ...variant.options, [axis.id]: value } })
            }
            options={axis.values.map((value) => ({ id: value.id, label: value.name }))}
            isDisabled={disabled}
          />
        ),
      })
  if (mode === 'create' || mode === 'barcodes')
    columns.push(
      {
        id: 'sku',
        label: 'Stok kodu',
        cell: (variant) => (
          <Field
            label={label('Stok kodu', variant)}
            value={variant.sku}
            onChange={(sku) => onChange(variant.id, { sku })}
            maxLength={160}
            required
            isDisabled={disabled}
          />
        ),
      },
      {
        id: 'barcode',
        label: 'Barkod',
        cell: (variant) => (
          <Field
            label={label('Barkod', variant)}
            value={variant.barcode}
            onChange={(barcode) => onChange(variant.id, { barcode })}
            maxLength={80}
            isDisabled={disabled}
            description={gtinProblem(variant.barcode)}
          />
        ),
      },
    )
  if (mode === 'barcodes')
    columns.push({
      id: 'shelf',
      label: 'Raf / konum',
      cell: (variant) => (
        <Field
          label={label('Raf / konum', variant)}
          value={variant.shelf ?? ''}
          onChange={(shelf) => onChange(variant.id, { shelf })}
          maxLength={100}
          isDisabled={disabled}
        />
      ),
    })
  if (mode === 'create' || mode === 'prices')
    columns.push(
      {
        id: 'price',
        label: `Satış fiyatı (${netTaxRate === undefined ? 'KDV dahil' : 'KDV hariç'})`,
        cell: (variant) => (
          <MoneyField
            key={`${variant.id}-price-${epoch}-${netTaxRate}-${currency}`}
            label={label(`Satış fiyatı (${symbol})`, variant)}
            netTaxRate={netTaxRate}
            initialValue={variant.price}
            onChange={(price) => onChange(variant.id, { price })}
            isDisabled={disabled}
          />
        ),
      },
      {
        id: 'cost',
        label: `Alış maliyeti (${netTaxRate === undefined ? 'KDV dahil' : 'KDV hariç'})`,
        cell: (variant) => (
          <MoneyField
            key={`${variant.id}-cost-${epoch}-${netTaxRate}-${currency}`}
            label={label(`Alış maliyeti (${symbol})`, variant)}
            netTaxRate={netTaxRate}
            initialValue={variant.cost}
            onChange={(cost) => onChange(variant.id, { cost })}
            isDisabled={disabled}
          />
        ),
      },
    )
  if (mode === 'create')
    columns.push({
      id: 'stock',
      label: 'Açılış stoğu',
      cell: (variant) => (
        <Field
          label={label('Açılış stoğu', variant)}
          type="number"
          min={0}
          max={100000000}
          step={1}
          value={String(variant.stock)}
          onChange={(value) => onChange(variant.id, { stock: value === '' ? NaN : Number(value) })}
          isDisabled={disabled}
        />
      ),
    })
  if (onRemove)
    columns.push({
      id: 'remove',
      label: '',
      cell: (variant) => (
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          isDisabled={disabled}
          aria-label={`${variant.name} taslak varyantını kaldır`}
          onPress={() => onRemove(variant.id)}
        >
          <Trash2 size={15} />
        </Button>
      ),
    })
  return (
    <div className={`variant-fields-table variant-fields-table--${mode}`}>
      {(mode === 'create' || mode === 'barcodes') && (
        <BarcodeGenerator variants={variants} onChange={onChange} disabled={disabled} />
      )}
      <DataTable
        items={variants}
        columns={columns}
        label={
          mode === 'prices'
            ? 'Varyant fiyatları'
            : mode === 'barcodes'
              ? 'Ürün barkodları'
              : 'Ürün varyantları'
        }
        paginate={variants.length > 10}
      />
    </div>
  )
}

/** Fills the empty barcodes from the prefix set in E-Ticaret Ayarları. */
function BarcodeGenerator({
  variants,
  onChange,
  disabled,
}: {
  variants: Variant[]
  onChange: (id: string, patch: Partial<Variant>) => void
  disabled?: boolean
}) {
  const { state, notify } = useApp()
  const scheme = barcodeScheme(state.ecommerce)
  const empty = variants.filter((variant) => !variant.barcode.trim())
  const generate = () => {
    if (!scheme) return
    try {
      const taken = [...usedBarcodes(state), ...variants.map((variant) => variant.barcode)]
      const codes = nextBarcodes(scheme, taken, empty.length)
      empty.forEach((variant, index) => onChange(variant.id, { barcode: codes[index] }))
    } catch (error) {
      notify((error as Error).message, 'error')
    }
  }
  return (
    <div className="variant-barcode-tools">
      <Button
        size="sm"
        variant="secondary"
        isDisabled={disabled || !scheme || !empty.length}
        onPress={generate}
      >
        <Barcode size={14} />
        {empty.length > 1 ? `Boş barkodları üret (${empty.length})` : 'Boş barkodları üret'}
      </Button>
      <p className="description field-description">
        {!scheme ? (
          <>
            Barkod üretmek için <Link to="/ecommerce-settings?tab=stock">E-Ticaret Ayarları</Link>
            ’nda GS1 firma önekinizi veya kendi barkod önekinizi girin.
          </>
        ) : scheme.kind === 'gs1' ? (
          `GS1 önekinizle (${scheme.prefix}) kontrol haneli EAN-13 üretilir.`
        ) : (
          `Kendi önekinizle (${scheme.prefix}) üretilir; Hepsiburada, ToptanTR ve PttAVM GS1 barkodu ister.`
        )}
      </p>
    </div>
  )
}

export function BulkVariantValues({
  onApply,
  openingStock = false,
  disabled,
  currency = 'TRY',
  taxRate = 20,
}: {
  onApply: (patch: Partial<Pick<Variant, 'price' | 'cost' | 'stock'>>) => void
  openingStock?: boolean
  disabled?: boolean
  currency?: string
  taxRate?: number
}) {
  const { state } = useApp()
  const netTaxRate = state.ecommerce?.pricesIncludeVat === false ? taxRate : undefined
  const symbol = currency === 'TRY' ? '₺' : currency
  const [price, setPrice] = useState(0),
    [cost, setCost] = useState(0),
    [stock, setStock] = useState('0')
  const validMoney = (value: number) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 1000000000
  return (
    <SurfaceContext value={{ variant: 'secondary' }}>
      <div className="variant-bulk-values">
        <div>
          <MoneyField
            label={`Ortak satış fiyatı (${symbol})`}
            netTaxRate={netTaxRate}
            initialValue={0}
            onChange={setPrice}
            isDisabled={disabled}
          />
          <Button
            variant="outline"
            size="sm"
            isDisabled={disabled || !validMoney(price)}
            onPress={() => onApply({ price })}
          >
            Satış fiyatını uygula
          </Button>
        </div>
        <div>
          <MoneyField
            label={`Ortak alış maliyeti (${symbol})`}
            netTaxRate={netTaxRate}
            initialValue={0}
            onChange={setCost}
            isDisabled={disabled}
          />
          <Button
            variant="outline"
            size="sm"
            isDisabled={disabled || !validMoney(cost)}
            onPress={() => onApply({ cost })}
          >
            Maliyeti uygula
          </Button>
        </div>
        {openingStock && (
          <div>
            <Field
              label="Ortak açılış stoğu"
              type="number"
              min={0}
              max={100000000}
              step={1}
              value={stock}
              onChange={setStock}
              isDisabled={disabled}
            />
            <Button
              variant="outline"
              size="sm"
              isDisabled={
                disabled ||
                !stock.trim() ||
                !Number.isInteger(Number(stock)) ||
                Number(stock) < 0 ||
                Number(stock) > 100000000
              }
              onPress={() => onApply({ stock: Number(stock) })}
            >
              Stoğu uygula
            </Button>
          </div>
        )}
        <p className="description field-description">
          Seçilen değer bütün satırlara uygulanır; kaydettiğinizde işlenir.
        </p>
      </div>
    </SurfaceContext>
  )
}
