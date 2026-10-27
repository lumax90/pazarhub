import type { AppState, Listing, Product, Variant } from './types'
import type { MarketplaceProvider } from './integrations'
import type { AttributeSelection, PublishConfig } from './publishing'
import { COLOR_DEFINITION_ID } from './definitions'

export function categoryMappingFor(
  state: AppState,
  storeId: string,
  provider: MarketplaceProvider,
  product: Product,
) {
  const matches = (mapping: NonNullable<AppState['categoryMappings']>[number]) =>
    mapping.localCategoryId
      ? mapping.localCategoryId === product.categoryId
      : mapping.localCategory === product.category
  return (
    state.categoryMappings?.find(
      (mapping) => !mapping.provider && mapping.storeId === storeId && matches(mapping),
    ) ??
    state.categoryMappings?.find((mapping) => mapping.provider === provider && matches(mapping))
  )
}
export function catalogDefaults(
  state: AppState,
  listing: Listing,
  product: Product,
  variant: Variant,
): Partial<PublishConfig> & { attributes: Record<string, AttributeSelection> } {
  const category = categoryMappingFor(state, listing.storeId, listing.channel, product)
  const categoryId = listing.publishConfig?.categoryId ?? category?.categoryId
  const compatible = category?.categoryId === categoryId ? category : undefined
  const attributes: Record<string, AttributeSelection> = structuredClone(
    compatible?.attributes ?? {},
  )
  const mappings = (state.catalogValueMappings ?? []).filter(
    (mapping) =>
      mapping.provider === listing.channel &&
      (!mapping.categoryId || mapping.categoryId === categoryId),
  )
  const brand = mappings.find(
    (mapping) => mapping.kind === 'brand' && mapping.definitionId === product.brandId,
  )
  const apply = (
    definitionId: string | undefined,
    values: { id?: string; name: string }[],
    kind: 'variant' | 'attribute',
  ) => {
    const mapping = mappings.find(
      (item) =>
        item.kind === kind && item.definitionId === definitionId && item.categoryId === categoryId,
    )
    if (!mapping?.attributeId || !values.length) return
    const selected = values.map((value) => (value.id ? mapping.values[value.id] : undefined))
    if (mapping.useSameText) {
      attributes[mapping.attributeId] = {
        customValue: values.map((value) => value.name).join(', '),
      }
    } else if (selected.every((value): value is AttributeSelection => !!value)) {
      const ids = selected.flatMap((value) => value.valueIds ?? [])
      const custom = selected.map((value) => value.customValue).filter(Boolean)
      if (ids.length && !custom.length)
        attributes[mapping.attributeId] = {
          valueIds: [...new Set(ids)],
          labels: selected.flatMap((value) => value.labels ?? []),
        }
      else if (custom.length === 1 && !ids.length)
        attributes[mapping.attributeId] = { customValue: custom[0] }
    }
  }
  for (const attribute of product.technicalAttributes ?? [])
    apply(
      attribute.definitionId,
      (attribute.valueIds ?? []).map((id, index) => ({
        id,
        name: attribute.valueLabels?.[index] ?? attribute.value,
      })),
      'attribute',
    )
  for (const axis of product.variantAxes ?? []) {
    const value = axis.values.find((value) => value.id === variant.options?.[axis.id])
    if (value)
      apply(
        axis.definitionId ?? (axis.name === 'Renk' ? COLOR_DEFINITION_ID : undefined),
        [{ id: value.definitionValueId, name: value.name }],
        'variant',
      )
  }
  return {
    ...(category ? { categoryId: category.categoryId, categoryName: category.categoryName } : {}),
    ...(brand?.brandId ? { brandId: brand.brandId, brandName: brand.brandName } : {}),
    attributes,
  }
}
