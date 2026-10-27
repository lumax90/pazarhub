import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { CopyCheck } from 'lucide-react'
import type { Product, Variant } from '../../domain/types'
import type { AttributeSelection, CatalogAttribute, CatalogOption } from '../../domain/publishing'
import { attributeNameKey, productAttributeValues } from '../../domain/products'
import { apiRequest } from '../../lib/api'

interface Options {
  options: CatalogOption[]
  hasMore: boolean
  nextOffset: number | null
  remoteHasMore: boolean
}

export function ProductAttributeFill({
  storeId,
  categoryId,
  product,
  variant,
  fields,
  values,
  inherited,
  onChange,
  disabled,
  onBusyChange,
}: {
  storeId: string
  categoryId: string
  product: Product
  variant: Variant
  fields: CatalogAttribute[]
  values: Record<string, AttributeSelection>
  inherited: Record<string, AttributeSelection>
  onChange: (values: Record<string, AttributeSelection>) => void
  disabled: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const local = productAttributeValues(product, variant)
  const candidates = fields.filter(
    (field) =>
      !field.personalization &&
      local.has(attributeNameKey(field.name)) &&
      !Object.hasOwn(values, field.id) &&
      !Object.hasOwn(inherited, field.id),
  )
  const fill = async () => {
    if (busy || disabled) return
    const epoch = generation.current
    setBusy(true)
    onBusyChange(true)
    setMessage('')
    try {
      const next = { ...values },
        skipped: string[] = []
      let added = 0
      for (const field of candidates) {
        if (epoch !== generation.current) return
        const source = local.get(attributeNameKey(field.name))!
        if (field.allowCustom && source.value.length <= 500) {
          next[field.id] = { customValue: source.value }
          added++
          continue
        }
        const matches = new Map<string, CatalogOption>()
        let page = 0,
          offset = 0,
          complete = false
        for (let attempt = 0; attempt < 10; attempt++) {
          const query = new URLSearchParams({
            resource: 'values',
            categoryId,
            attributeId: field.id,
            query: source.value,
            page: String(page),
            offset: String(offset),
          })
          const response = await apiRequest<Options>(`/api/publishing/${storeId}/metadata?${query}`)
          if (epoch !== generation.current) return
          for (const option of response.options)
            if (attributeNameKey(option.name) === attributeNameKey(source.value))
              matches.set(option.id, option)
          if (matches.size > 1) break
          if (response.hasMore && response.nextOffset !== null) offset = response.nextOffset
          else if (response.remoteHasMore) {
            page++
            offset = 0
          } else {
            complete = true
            break
          }
        }
        if (complete && matches.size === 1) {
          const option = [...matches.values()][0]
          next[field.id] = { valueIds: [option.id], labels: [option.name] }
          added++
        } else skipped.push(field.name)
      }
      if (epoch !== generation.current) return
      if (added) onChange(next)
      setMessage(
        `${added} özellik ürün/varyant kartından dolduruldu.${skipped.length ? ` Listeden seçilmesi gerekenler: ${skipped.join(', ')}.` : ''}`,
      )
    } catch (error) {
      if (epoch === generation.current)
        setMessage(error instanceof Error ? error.message : 'Ürün özellikleri alınamadı.')
    } finally {
      if (epoch === generation.current) {
        setBusy(false)
        onBusyChange(false)
      }
    }
  }
  if (!local.size) return null
  return (
    <div className="product-attribute-fill">
      <div>
        <strong>Ürün ve varyant özellikleri</strong>
        <p>
          Adı eşleşen boş alanlar doldurulur. Listeli değerler pazaryerinin seçenekleriyle
          doğrulanır.
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        isDisabled={disabled || busy || !candidates.length}
        onPress={() => void fill()}
      >
        <CopyCheck size={15} />
        {busy ? 'Değerler kontrol ediliyor…' : 'Üründen doldur'}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  )
}
