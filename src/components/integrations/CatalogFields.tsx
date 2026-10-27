import { useDeferredValue, useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { Check, ChevronDown, Link2, Search } from 'lucide-react'
import type {
  AttributeSelection,
  CatalogAttribute,
  CatalogOption,
  CategorySchema,
  MetadataResource,
} from '../../domain/publishing'
import { useResource } from '../../lib/useResource'
import { AsyncState } from '../ui/AsyncState'
import { Dialog, EmptyState, Field, SearchBox } from '../ui/shared'
import type { Product, Variant } from '../../domain/types'
import { ProductAttributeFill } from '../products/ProductAttributeFill'

interface OptionResponse {
  options: CatalogOption[]
  hasMore: boolean
  nextOffset: number | null
  remoteHasMore: boolean
  page: number
  total: number
}
export function CatalogPicker({
  storeId,
  resource,
  label,
  categoryId,
  attributeId,
  value = [],
  onChange,
  multiple = false,
  disabled = false,
}: {
  storeId: string
  resource: MetadataResource
  label: string
  categoryId?: string
  attributeId?: string
  value?: CatalogOption[]
  onChange: (options: CatalogOption[]) => void
  multiple?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [offset, setOffset] = useState(0),
    [chosen, setChosen] = useState<CatalogOption[]>(value)
  const deferred = useDeferredValue(query)
  const params = new URLSearchParams({
    resource,
    query: deferred,
    page: String(page),
    offset: String(offset),
    ...(categoryId ? { categoryId } : {}),
    ...(attributeId ? { attributeId } : {}),
  })
  const result = useResource<OptionResponse>(
    open ? `/api/publishing/${storeId}/metadata?${params}` : null,
  )
  const choose = (option: CatalogOption) => {
    if (!multiple) {
      onChange([option])
      setOpen(false)
      return
    }
    setChosen((items) =>
      items.some((item) => item.id === option.id)
        ? items.filter((item) => item.id !== option.id)
        : [...items, option],
    )
  }
  return (
    <>
      <Button
        variant="secondary"
        isDisabled={disabled}
        className="catalog-picker"
        aria-label={label}
        onPress={() => {
          setChosen(value)
          setQuery('')
          setPage(0)
          setOffset(0)
          setOpen(true)
        }}
      >
        <span>{value.length ? value.map((v) => v.path || v.name).join(', ') : label}</span>
        <ChevronDown size={14} />
      </Button>
      {open && (
        <Dialog
          open
          wide
          title={label}
          description={
            resource === 'asin'
              ? '10 karakterli ASIN ile Türkiye kataloğunda arayın.'
              : multiple
                ? 'Bir veya daha fazla değer seçin.'
                : 'Sağlayıcının güncel listesinden seçim yapın.'
          }
          onClose={() => setOpen(false)}
          footer={
            <>
              <span className="description field-description">
                {multiple ? `${chosen.length} değer seçili` : `${result.data?.total ?? 0} sonuç`}
              </span>
              <Button variant="secondary" onPress={() => setOpen(false)}>
                Vazgeç
              </Button>
              {multiple && (
                <Button
                  variant="primary"
                  onPress={() => {
                    onChange(chosen)
                    setOpen(false)
                  }}
                >
                  Seçimi uygula
                </Button>
              )}
            </>
          }
        >
          <SearchBox
            value={query}
            onChange={(value) => {
              setQuery(value)
              setOffset(0)
            }}
            label={`${label} ara`}
            placeholder={
              resource === 'asin'
                ? 'ASIN girin, örn. B0…'
                : resource === 'brands'
                  ? 'Marka adını yazın…'
                  : 'Ad veya kimlik ile ara…'
            }
          />
          <AsyncState
            loading={result.loading}
            error={result.error}
            retry={() => void result.reload()}
          />
          <div className="catalog-options" role="group" aria-label={`${label} seçenekleri`}>
            {result.data?.options.map((option) => (
              <Button
                key={option.id}
                variant={chosen.some((v) => v.id === option.id) ? 'secondary' : 'ghost'}
                className="catalog-option"
                aria-pressed={chosen.some((v) => v.id === option.id)}
                onPress={() => choose(option)}
              >
                {option.image && (
                  <img src={option.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                )}
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.path || `ID: ${option.id}`}</small>
                </span>
                {chosen.some((v) => v.id === option.id) && <Check size={16} />}
              </Button>
            ))}
          </div>
          {!result.loading && !result.error && !result.data?.options.length && (
            <EmptyState
              title="Sonuç bulunamadı"
              description={
                resource === 'brands' || resource === 'asin'
                  ? 'Arama alanını doldurun veya başka bir değer deneyin.'
                  : 'Aramayı değiştirebilir veya sonraki sağlayıcı sayfasına geçebilirsiniz.'
              }
              icon={<Search size={22} />}
            />
          )}
          <div className="catalog-pagination">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={offset === 0 && page === 0}
              onPress={() => {
                if (offset > 0) setOffset(Math.max(0, offset - 100))
                else {
                  setPage((p) => Math.max(0, p - 1))
                  setOffset(0)
                }
              }}
            >
              Önceki
            </Button>
            <span>
              Sayfa {page + 1} · {offset + 1}–{offset + (result.data?.options.length ?? 0)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!result.data?.hasMore && !result.data?.remoteHasMore}
              onPress={() => {
                if (result.data?.hasMore) setOffset(result.data.nextOffset!)
                else {
                  setPage((p) => p + 1)
                  setOffset(0)
                }
              }}
            >
              Sonraki
            </Button>
          </div>
        </Dialog>
      )}
    </>
  )
}

export function CategoryAttributes({
  storeId,
  categoryId,
  values,
  onChange,
  inherited = {},
  commonOnly = false,
  disabled = false,
  product,
  variant,
}: {
  storeId: string
  categoryId?: string
  values: Record<string, AttributeSelection>
  onChange: (values: Record<string, AttributeSelection>) => void
  inherited?: Record<string, AttributeSelection>
  commonOnly?: boolean
  disabled?: boolean
  product?: Product
  variant?: Variant
}) {
  const [optional, setOptional] = useState(false)
  const [filling, setFilling] = useState(false)
  const data = useResource<{ schema: CategorySchema }>(
    categoryId
      ? `/api/publishing/${storeId}/metadata?resource=attributes&categoryId=${encodeURIComponent(categoryId)}`
      : null,
  )
  if (!categoryId)
    return (
      <p className="empty-inline">
        Özellikleri görmek için son seviye pazaryeri kategorisini seçin.
      </p>
    )
  const fields = (data.data?.schema.attributes ?? []).filter(
    (field) => !commonOnly || (!field.variant && !field.slicer && !field.personalization),
  )
  return (
    <>
      <AsyncState loading={data.loading} error={data.error} retry={() => void data.reload()} />
      {product && variant && fields.length > 0 && (
        <ProductAttributeFill
          key={`${categoryId}:${product.id}:${product.version ?? 0}:${variant.id}`}
          storeId={storeId}
          categoryId={categoryId}
          product={product}
          variant={variant}
          fields={fields}
          values={values}
          inherited={inherited}
          onChange={onChange}
          disabled={disabled}
          onBusyChange={setFilling}
        />
      )}
      {fields.length > 0 && (
        <Checkbox className="app-checkbox" isSelected={optional} onChange={setOptional}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Opsiyonel özellikleri de göster</Label>
          </Checkbox.Content>
        </Checkbox>
      )}
      <div className="catalog-attributes-grid">
        {fields
          .filter(
            (field) =>
              optional ||
              field.required ||
              field.variant ||
              field.slicer ||
              values[field.id] ||
              inherited[field.id],
          )
          .map((field) => (
            <AttributeField
              key={`${categoryId}:${field.id}`}
              storeId={storeId}
              categoryId={categoryId}
              field={field}
              value={values[field.id] ?? inherited[field.id] ?? {}}
              inherited={!Object.hasOwn(values, field.id) && !!inherited[field.id]}
              disabled={disabled || filling}
              onChange={(value) => onChange({ ...values, [field.id]: value })}
              onReset={() => {
                const next = { ...values }
                delete next[field.id]
                onChange(next)
              }}
            />
          ))}
      </div>
      {data.data && fields.length === 0 && (
        <p className="empty-inline">Bu kategori için ek ortak özellik yok.</p>
      )}
    </>
  )
}
function AttributeField({
  storeId,
  categoryId,
  field,
  value,
  onChange,
  inherited,
  onReset,
  disabled,
}: {
  storeId: string
  categoryId: string
  field: CatalogAttribute
  value: AttributeSelection
  onChange: (value: AttributeSelection) => void
  inherited: boolean
  onReset: () => void
  disabled: boolean
}) {
  const custom = Object.hasOwn(value, 'customValue')
  return (
    <div className="catalog-attribute">
      <div className="catalog-attribute-label">
        <strong>
          {field.name}
          {field.required && <b> *</b>}
        </strong>
        {(field.variant || field.slicer) && (
          <Chip size="sm" variant="soft" color="accent">
            {field.variant ? 'Varyant' : 'Ayrı kart'}
          </Chip>
        )}
      </div>
      {field.personalization ? (
        <Field
          label={`${field.name} karakter sınırı`}
          type="number"
          value={String(value.textLength ?? '')}
          readOnly={disabled}
          onChange={(v) => onChange(v === '' ? {} : { textLength: Number(v) })}
        />
      ) : custom ? (
        <Field
          label={`${field.name} değeri`}
          value={value.customValue ?? ''}
          onChange={(customValue) => onChange({ customValue })}
          readOnly={disabled}
        />
      ) : (
        <CatalogPicker
          storeId={storeId}
          categoryId={categoryId}
          attributeId={field.id}
          resource="values"
          label={`${field.name} seçin`}
          multiple={field.multiple}
          disabled={disabled}
          value={(value.valueIds ?? []).map((id, index) => ({
            id,
            name: value.labels?.[index] ?? id,
          }))}
          onChange={(options) =>
            onChange({ valueIds: options.map((o) => o.id), labels: options.map((o) => o.name) })
          }
        />
      )}
      <div className="attribute-controls">
        {inherited ? (
          <span>
            <Link2 size={12} />
            Kategori eşlemesinden
          </span>
        ) : (
          <button
            className="button button--md button--ghost"
            type="button"
            disabled={disabled}
            onClick={onReset}
          >
            Varsayılana dön
          </button>
        )}
        {field.allowCustom && (
          <button
            className="button button--md button--ghost"
            type="button"
            disabled={disabled}
            onClick={() => onChange(custom ? {} : { customValue: '' })}
          >
            {custom ? 'Listeden seç' : 'Serbest değer gir'}
          </button>
        )}
      </div>
    </div>
  )
}
