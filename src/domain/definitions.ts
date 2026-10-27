import type { AppState, CatalogDefinition, DefinitionKind, DefinitionValue, Product } from './types'

export const COLOR_DEFINITION_ID = 'system-color'
export const definitionSingular: Record<DefinitionKind, string> = {
  category: 'kategori',
  brand: 'marka',
  supplier: 'tedarikçi',
  color: 'renk',
  variant: 'varyant',
  attribute: 'özellik',
}
export const definitionLabels: Record<DefinitionKind, string> = {
  category: 'Ürün Kategorileri',
  brand: 'Markalar',
  supplier: 'Tedarikçiler',
  color: 'Renkler',
  variant: 'Varyantlar',
  attribute: 'Teknik Özellikler',
}
export const definitionKindPaths: Record<DefinitionKind, string> = {
  category: 'categories',
  brand: 'brands',
  supplier: 'suppliers',
  color: 'colors',
  variant: 'variants',
  attribute: 'specs',
}
export const definitionKey = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')
export const definitionOrderKey = (definitions: CatalogDefinition[], kind: DefinitionKind) =>
  JSON.stringify(
    definitions
      .filter((item) => item.kind === kind)
      .map((item) => [item.id, item.version, item.parentId, item.sortOrder])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
export const emptyDefinitions = (): CatalogDefinition[] => [
  {
    id: COLOR_DEFINITION_ID,
    kind: 'variant',
    name: 'Renk',
    active: true,
    sortOrder: 0,
    version: 1,
    values: [],
  },
]

export function categoryPath(definitions: CatalogDefinition[], category: CatalogDefinition) {
  const parts = [category.name],
    seen = new Set([category.id])
  let parentId = category.parentId
  while (parentId) {
    if (seen.has(parentId) || seen.size > 32)
      throw new Error('Kategori ağacında döngü veya fazla derinlik var.')
    seen.add(parentId)
    const parent = definitions.find((item) => item.id === parentId && item.kind === 'category')
    if (!parent) throw new Error('Üst kategori bulunamadı.')
    parts.unshift(parent.name)
    parentId = parent.parentId
  }
  return parts.join(' / ')
}
export function definitionActive(
  definitions: CatalogDefinition[],
  definition: CatalogDefinition,
): boolean {
  if (!definition.active) return false
  const seen = new Set<string>()
  let current: CatalogDefinition | undefined = definition
  while (current?.parentId) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    current = definitions.find((item) => item.id === current!.parentId && item.kind === 'category')
    if (!current?.active) return false
  }
  return true
}
export function definitionValues(
  state: AppState,
  definition: CatalogDefinition,
): DefinitionValue[] {
  return definition.id === COLOR_DEFINITION_ID
    ? (state.definitions ?? [])
        .filter((item) => item.kind === 'color')
        .map((item) => ({
          id: item.id,
          name: item.name,
          active: item.active,
          sortOrder: item.sortOrder,
        }))
    : [...(definition.values ?? [])]
}
export function categoryTree(definitions: CatalogDefinition[]): CatalogDefinition[] {
  const categories = definitions.filter((definition) => definition.kind === 'category')
  const result: CatalogDefinition[] = [],
    visited = new Set<string>()
  const append = (parentId?: string) => {
    for (const definition of categories
      .filter((item) => item.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'))) {
      if (visited.has(definition.id)) continue
      visited.add(definition.id)
      result.push(definition)
      append(definition.id)
    }
  }
  append()
  return result
}

function ensureDefinition(state: AppState, kind: DefinitionKind, name: string, id: () => string) {
  const normalized = definitionKey(name)
  const existing = state.definitions!.find(
    (item) =>
      item.kind === kind &&
      definitionKey(kind === 'category' ? categoryPath(state.definitions!, item) : item.name) ===
        normalized,
  )
  if (existing) return existing
  const definition: CatalogDefinition = {
    id: id(),
    kind,
    name: name.trim(),
    active: true,
    sortOrder: state.definitions!.filter((item) => item.kind === kind).length,
    version: 1,
    ...(['variant', 'attribute'].includes(kind) ? { values: [] } : {}),
  }
  state.definitions!.push(definition)
  return definition
}
function ensureValue(
  state: AppState,
  definition: CatalogDefinition,
  name: string,
  id: () => string,
) {
  if (definition.id === COLOR_DEFINITION_ID) {
    const color = ensureDefinition(state, 'color', name, id)
    return { id: color.id, name: color.name, active: color.active, sortOrder: color.sortOrder }
  }
  const current = definition.values?.find(
    (value) => definitionKey(value.name) === definitionKey(name),
  )
  if (current) return current
  const value: DefinitionValue = {
    id: id(),
    name: name.trim(),
    active: true,
    sortOrder: definition.values?.length ?? 0,
  }
  definition.values = [...(definition.values ?? []), value]
  definition.version++
  return value
}

/** Adds catalog identities without inferring a category tree, colors, or historical facts. */
export function initializeDefinitions(
  state: AppState,
  id: () => string = () => crypto.randomUUID(),
) {
  if (state.definitions) return
  state.definitions = emptyDefinitions()
  for (const product of state.products) {
    for (const [kind, field] of [
      ['category', 'categoryId'],
      ['brand', 'brandId'],
      ['supplier', 'supplierId'],
    ] as const)
      if (product[kind]?.trim())
        product[field] = ensureDefinition(state, kind, product[kind]!, id).id
    for (const axis of product.variantAxes ?? []) {
      const definition =
        definitionKey(axis.name) === 'renk'
          ? state.definitions[0]
          : ensureDefinition(state, 'variant', axis.name, id)
      axis.definitionId = definition.id
      for (const value of axis.values)
        value.definitionValueId = ensureValue(state, definition, value.name, id).id
    }
    for (const attribute of product.technicalAttributes ?? []) {
      const definition = ensureDefinition(state, 'attribute', attribute.name, id)
      attribute.definitionId = definition.id
      attribute.valueIds = [ensureValue(state, definition, attribute.value, id).id]
      attribute.valueLabels = [attribute.value]
    }
  }
}

export function hydrateDefinitionReferences(state: AppState) {
  const definitions = state.definitions ?? []
  for (const product of state.products) {
    const before = JSON.stringify(product)
    for (const [kind, field] of [
      ['category', 'categoryId'],
      ['brand', 'brandId'],
      ['supplier', 'supplierId'],
    ] as const) {
      if (product[field] || !product[kind]?.trim()) continue
      const definition = definitions.find(
        (item) =>
          item.kind === kind &&
          definitionKey(kind === 'category' ? categoryPath(definitions, item) : item.name) ===
            definitionKey(product[kind]!),
      )
      if (definition) product[field] = definition.id
    }
    for (const attribute of product.technicalAttributes ?? [])
      if (attribute.definitionId && attribute.valueIds && !attribute.valueLabels) {
        const definition = definitions.find((item) => item.id === attribute.definitionId)
        const values = attribute.valueIds.map(
          (id) => definition?.values?.find((value) => value.id === id)?.name,
        )
        if (values.every((value): value is string => value !== undefined))
          attribute.valueLabels = values
      }
    if (JSON.stringify(product) !== before) product.version = (product.version ?? 0) + 1
  }
}

export function bindProductDefinitions(
  state: AppState,
  product: Product,
  previous?: Product,
  id: () => string = () => crypto.randomUUID(),
): string | null {
  initializeDefinitions(state, id)
  for (const [kind, field] of [
    ['category', 'category'],
    ['brand', 'brand'],
    ['supplier', 'supplier'],
  ] as const) {
    const value = product[field]
    const reference = (
      { category: 'categoryId', brand: 'brandId', supplier: 'supplierId' } as const
    )[field]
    if (!value?.trim()) {
      delete product[reference]
      continue
    }
    const definition = product[reference]
      ? state.definitions!.find((item) => item.id === product[reference] && item.kind === kind)
      : ensureDefinition(state, kind, value, id)
    if (!definition) return 'Seçilen tanım silindi veya bulunamadı. Güncel tanımlardan seçin.'
    if (
      !definitionActive(state.definitions!, definition) &&
      (previous?.[reference]
        ? previous[reference] !== definition.id
        : definitionKey(previous?.[field] ?? '') !== definitionKey(value))
    )
      return `${definition.name} pasif; yeni seçim için aktif bir tanım kullanın.`
    product[reference] = definition.id
    product[field] =
      kind === 'category' ? categoryPath(state.definitions!, definition) : definition.name
  }
  for (const axis of product.variantAxes ?? []) {
    const definition = axis.definitionId
      ? state.definitions!.find((item) => item.id === axis.definitionId && item.kind === 'variant')
      : definitionKey(axis.name) === 'renk'
        ? state.definitions!.find((item) => item.id === COLOR_DEFINITION_ID)
        : ensureDefinition(state, 'variant', axis.name, id)
    if (!definition) return 'Varyant tanımı bulunamadı.'
    const oldAxis = previous?.variantAxes?.find((item) => item.id === axis.id)
    if (!definition.active && oldAxis?.definitionId !== definition.id)
      return `${definition.name} pasif; yeni ürün için seçilemez.`
    axis.definitionId = definition.id
    axis.name = definition.name
    for (const value of axis.values) {
      const options = definitionValues(state, definition)
      const option = value.definitionValueId
        ? options.find((item) => item.id === value.definitionValueId)
        : ensureValue(state, definition, value.name, id)
      if (!option) return 'Varyant değeri bulunamadı.'
      if (!option.active && !oldAxis?.values.some((old) => old.definitionValueId === option.id))
        return `${option.name} pasif; yeni seçimde kullanılamaz.`
      value.definitionValueId = option.id
      value.name = option.name
    }
  }
  for (const attribute of product.technicalAttributes ?? []) {
    const definition = attribute.definitionId
      ? state.definitions!.find(
          (item) => item.id === attribute.definitionId && item.kind === 'attribute',
        )
      : ensureDefinition(state, 'attribute', attribute.name, id)
    if (!definition) return 'Teknik özellik tanımı bulunamadı.'
    const old = previous?.technicalAttributes?.find((item) => item.id === attribute.id)
    if (!definition.active && old?.definitionId !== definition.id)
      return `${definition.name} pasif; yeni seçimde kullanılamaz.`
    // A text edit in the older editor is an explicit new value, not a stale cached label.
    const editedText =
      attribute.value !== old?.value && attribute.valueIds?.join() === old?.valueIds?.join()
    const ids =
      attribute.valueIds?.length && !editedText
        ? attribute.valueIds
        : [ensureValue(state, definition, attribute.value, id).id]
    if (new Set(ids).size !== ids.length) return 'Teknik özellik değeri iki kez seçilemez.'
    const values = ids.map((valueId) => definition.values?.find((value) => value.id === valueId))
    if (values.some((value) => !value)) return 'Teknik özellik değeri bulunamadı.'
    if (values.some((value) => !value!.active && !old?.valueIds?.includes(value!.id)))
      return 'Pasif teknik değer yeni seçimde kullanılamaz.'
    attribute.definitionId = definition.id
    attribute.name = definition.name
    attribute.valueIds = ids
    attribute.value = values.map((value) => value!.name).join(', ')
    if (attribute.value.length > 1000)
      return 'Teknik özellik değerleri toplamı 1.000 karakteri aşıyor.'
    attribute.valueLabels = values.map((value) => value!.name)
  }
  return null
}

export function definitionUsage(state: AppState, definition: CatalogDefinition, valueId?: string) {
  const path =
    definition.kind === 'category'
      ? categoryPath(state.definitions ?? [], definition)
      : definition.name
  return state.products.filter((product) => {
    if (definition.kind === 'category')
      return product.categoryId
        ? product.categoryId === definition.id
        : definitionKey(product.category) === definitionKey(path)
    if (definition.kind === 'brand' || definition.kind === 'supplier') {
      const ref = definition.kind === 'brand' ? product.brandId : product.supplierId
      return ref
        ? ref === definition.id
        : definitionKey(product[definition.kind] ?? '') === definitionKey(definition.name)
    }
    if (definition.kind === 'variant')
      return product.variantAxes?.some(
        (axis) =>
          axis.definitionId === definition.id &&
          (!valueId || axis.values.some((value) => value.definitionValueId === valueId)),
      )
    if (definition.kind === 'color')
      return product.variantAxes?.some(
        (axis) =>
          axis.definitionId === COLOR_DEFINITION_ID &&
          axis.values.some((value) => value.definitionValueId === definition.id),
      )
    return product.technicalAttributes?.some(
      (attribute) =>
        attribute.definitionId === definition.id &&
        (!valueId || attribute.valueIds?.includes(valueId)),
    )
  }).length
}

function synchronizeReferences(state: AppState, before: CatalogDefinition[], now: string) {
  const after = state.definitions!
  const paths = new Map(
    before
      .filter((d) => d.kind === 'category')
      .map((d) => [
        definitionKey(categoryPath(before, d)),
        after.some((next) => next.id === d.id)
          ? categoryPath(
              after,
              after.find((next) => next.id === d.id)!,
            )
          : categoryPath(before, d),
      ]),
  )
  for (const product of state.products) {
    const previous = JSON.stringify(product)
    const category = after.find((definition) => definition.id === product.categoryId)
    product.category = category
      ? categoryPath(after, category)
      : (paths.get(definitionKey(product.category)) ?? product.category)
    for (const field of ['brand', 'supplier'] as const) {
      const reference = field === 'brand' ? product.brandId : product.supplierId
      const old = before.find(
        (d) =>
          d.kind === field &&
          (reference
            ? d.id === reference
            : definitionKey(d.name) === definitionKey(product[field] ?? '')),
      )
      const next = old && after.find((d) => d.id === old.id)
      if (next) product[field] = next.name
    }
    const oldAxes = structuredClone(product.variantAxes ?? [])
    for (const axis of product.variantAxes ?? []) {
      const definition = after.find((d) => d.id === axis.definitionId)
      if (!definition) continue
      axis.name = definition.name
      for (const value of axis.values) {
        const option = definitionValues(state, definition).find(
          (option) => option.id === value.definitionValueId,
        )
        if (option) value.name = option.name
      }
    }
    for (const variant of product.variants) {
      if (!oldAxes.length) continue
      const autoName = oldAxes
        .map(
          (axis) =>
            axis.values.find((value) => value.id === variant.options?.[axis.id])?.name ?? '',
        )
        .join(' / ')
        .slice(0, 150)
      if (autoName === variant.name)
        variant.name = (product.variantAxes ?? [])
          .map(
            (axis) =>
              axis.values.find((value) => value.id === variant.options?.[axis.id])?.name ?? '',
          )
          .join(' / ')
          .slice(0, 150)
    }
    product.technicalAttributes = product.technicalAttributes?.flatMap((attribute) => {
      if (!attribute.definitionId) return [attribute]
      const definition = after.find((d) => d.id === attribute.definitionId)
      if (!definition) return []
      const values = (attribute.valueIds ?? [])
        .map((id) => definition.values?.find((v) => v.id === id))
        .filter((v): v is DefinitionValue => !!v)
      const value = values.map((v) => v.name).join(', ')
      if (value.length > 1000) throw new Error('Teknik özellik değerleri ürün sınırını aşıyor.')
      return values.length
        ? [
            {
              ...attribute,
              name: definition.name,
              valueIds: values.map((v) => v.id),
              valueLabels: values.map((v) => v.name),
              value,
            },
          ]
        : []
    })
    if (JSON.stringify(product) !== previous) {
      product.version = (product.version ?? 0) + 1
      product.updatedAt = now
    }
  }
  for (const mapping of state.categoryMappings ?? []) {
    const next = paths.get(definitionKey(mapping.localCategory))
    if (next && next !== mapping.localCategory) {
      mapping.localCategory = next
      mapping.version++
      mapping.updatedAt = now
    }
  }
  for (const rule of state.marginRules ?? []) {
    if (rule.scope === 'category') rule.value = paths.get(definitionKey(rule.value)) ?? rule.value
    if (rule.scope === 'brand') {
      const old = before.find(
        (d) => d.kind === 'brand' && definitionKey(d.name) === definitionKey(rule.value),
      )
      const next = old && after.find((d) => d.id === old.id)
      if (next) rule.value = next.name
    }
  }
}

export function saveDefinition(
  state: AppState,
  next: CatalogDefinition,
  now: string,
): string | null {
  initializeDefinitions(state)
  const old = state.definitions!.find((item) => item.id === next.id)
  if ((old?.version ?? 0) !== next.version || (old && old.kind !== next.kind))
    return 'Tanım başka bir işlemle değişti. Güncel kaydı açın.'
  if (!next.name.trim()) return 'Tanım adı gerekli.'
  if (!Number.isSafeInteger(next.sortOrder) || !Number.isSafeInteger(next.version))
    return 'Tanım sırasını ve sürümünü kontrol edin.'
  if (
    next.id === COLOR_DEFINITION_ID &&
    (next.kind !== 'variant' || next.name !== 'Renk' || !next.active || next.values?.length)
  )
    return 'Renk sistem varyantıdır; değerleri Renkler ekranından yönetilir.'
  if (next.kind !== 'category' && next.parentId)
    return 'Üst kategori yalnız kategori kaydında kullanılabilir.'
  if (next.kind !== 'variant' && next.kind !== 'attribute' && next.values?.length)
    return 'Bu tanımda seçenek listesi kullanılamaz.'
  if (
    new Set((next.values ?? []).map((v) => v.id)).size !== (next.values?.length ?? 0) ||
    new Set((next.values ?? []).map((v) => definitionKey(v.name))).size !==
      (next.values?.length ?? 0) ||
    next.values?.some((v) => !v.name.trim())
  )
    return 'Seçenekler boş olamaz veya tekrarlanamaz.'
  if (next.kind === 'variant' && next.values?.some((value) => value.name.length > 100))
    return 'Varyant seçenekleri en fazla 100 karakter olabilir.'
  for (const value of old?.values ?? [])
    if (!next.values?.some((v) => v.id === value.id) && definitionUsage(state, old!, value.id))
      return 'Kullanılan değeri kaldırmak için Değeri sil işlemini kullanın.'
  const before = structuredClone(state.definitions!)
  state.definitions = state
    .definitions!.filter((d) => d.id !== next.id)
    .concat({ ...next, name: next.name.trim(), version: (old?.version ?? 0) + 1 })
  try {
    const names = new Set<string>()
    for (const definition of state.definitions) {
      const name =
        definition.kind === 'category'
          ? categoryPath(state.definitions, definition)
          : definition.name
      if (definition.kind === 'category' && name.length > 300)
        return 'Kategori yolu 300 karakteri aşamaz.'
      const key = `${definition.kind}:${definitionKey(name)}`
      if (names.has(key)) return 'Aynı ad/yolda bir tanım zaten var.'
      names.add(key)
    }
    if (next.kind === 'category' && !next.active)
      for (const definition of state.definitions) {
        let parent = definition.parentId
        while (parent) {
          if (parent === next.id) {
            definition.active = false
            definition.version++
            break
          }
          parent = state.definitions.find((d) => d.id === parent)?.parentId
        }
      }
    const saved = state.definitions.find((definition) => definition.id === next.id)!
    if (saved.kind === 'category' && saved.active && !definitionActive(state.definitions, saved))
      return 'Önce üst kategoriyi aktif hale getirin.'
    synchronizeReferences(state, before, now)
    const mappingKeys = (state.categoryMappings ?? []).map(
      (mapping) =>
        `${mapping.provider ? `provider:${mapping.provider}` : mapping.storeId}:${definitionKey(mapping.localCategory)}`,
    )
    if (new Set(mappingKeys).size !== mappingKeys.length)
      return 'Kategori değişikliği mevcut pazaryeri eşlemeleriyle çakışıyor.'
  } catch (error) {
    return (error as Error).message
  }
  return null
}
export function deleteDefinition(
  state: AppState,
  id: string,
  version: number,
  expectedUsage: number,
  now: string,
  valueId?: string,
): string | null {
  initializeDefinitions(state)
  const definition = state.definitions!.find((d) => d.id === id)
  if (!definition || definition.version !== version) return 'Tanım değişti veya bulunamadı.'
  if (id === COLOR_DEFINITION_ID) return 'Renk sistem varyantı silinemez.'
  const usage = definitionUsage(state, definition, valueId)
  if (usage !== expectedUsage) return 'Kullanım sayısı değişti. Silme penceresini yeniden açın.'
  if (usage && definition.kind !== 'attribute')
    return 'Kullanılan tanım silinemez; pasife alabilirsiniz.'
  if (state.definitions!.some((d) => d.parentId === id))
    return 'Alt kategorisi bulunan kategori silinemez.'
  if (
    state.catalogValueMappings?.some(
      (mapping) =>
        (mapping.definitionId === id && (!valueId || Object.hasOwn(mapping.values, valueId))) ||
        (definition.kind === 'color' && Object.hasOwn(mapping.values, id)),
    )
  )
    return 'Tanım pazaryeri değer eşlemesinde kullanılıyor. Önce eşlemeyi kaldırın veya tanımı pasife alın.'
  const path =
    definition.kind === 'category' ? categoryPath(state.definitions!, definition) : definition.name
  if (
    !valueId &&
    (state.categoryMappings?.some(
      (mapping) =>
        definition.kind === 'category' &&
        definitionKey(mapping.localCategory) === definitionKey(path),
    ) ||
      state.marginRules?.some(
        (rule) =>
          rule.scope === definition.kind && definitionKey(rule.value) === definitionKey(path),
      ))
  )
    return 'Tanım kategori eşlemesinde veya marj kuralında kullanılıyor; önce ilgili kaydı düzenleyin.'
  const before = structuredClone(state.definitions!)
  if (valueId) {
    if (!definition.values?.some((value) => value.id === valueId)) return 'Değer bulunamadı.'
    definition.values = definition.values.filter((value) => value.id !== valueId)
    definition.version++
  } else state.definitions = state.definitions!.filter((d) => d.id !== id)
  synchronizeReferences(state, before, now)
  return null
}

export function moveDefinition(
  state: AppState,
  command: { id: string; parentId?: string; beforeId?: string; expectedOrder: string },
  now: string,
): string | null {
  const definition = state.definitions?.find((item) => item.id === command.id)
  if (!definition || !['category', 'attribute'].includes(definition.kind))
    return 'Sıralanacak tanım bulunamadı.'
  if (definitionOrderKey(state.definitions!, definition.kind) !== command.expectedOrder)
    return 'Tanım sırası değişti. Güncel listeyi kontrol edin.'
  if (definition.kind !== 'category' && command.parentId) return 'Bu tanımın üst kategorisi olamaz.'
  const before = structuredClone(state.definitions!)
  definition.parentId = command.parentId
  if (!definition.parentId) delete definition.parentId
  const siblings = state
    .definitions!.filter(
      (item) =>
        item.kind === definition.kind &&
        item.id !== definition.id &&
        item.parentId === definition.parentId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'))
  const position = command.beforeId
    ? siblings.findIndex((item) => item.id === command.beforeId)
    : siblings.length
  if (position < 0) return 'Hedef tanım aynı düzeyde bulunamadı.'
  siblings.splice(position, 0, definition)
  for (const [index, item] of siblings.entries()) {
    if (item.sortOrder !== index || item.id === definition.id) {
      item.sortOrder = index
      item.version++
    }
  }
  try {
    for (const item of state.definitions!)
      if (item.kind === 'category') {
        if (categoryPath(state.definitions!, item).length > 300)
          return 'Kategori yolu 300 karakteri aşamaz.'
      }
    if (
      definition.kind === 'category' &&
      definition.active &&
      !definitionActive(state.definitions!, definition)
    )
      return 'Önce üst kategoriyi aktif hale getirin.'
    const paths = state
      .definitions!.filter((item) => item.kind === 'category')
      .map((item) => definitionKey(categoryPath(state.definitions!, item)))
    if (new Set(paths).size !== paths.length) return 'Aynı yolda başka kategori var.'
    synchronizeReferences(state, before, now)
    const keys = (state.categoryMappings ?? []).map(
      (mapping) =>
        `${mapping.provider ? `provider:${mapping.provider}` : mapping.storeId}:${definitionKey(mapping.localCategory)}`,
    )
    if (new Set(keys).size !== keys.length)
      return 'Kategori taşıma mevcut pazaryeri eşlemesiyle çakışıyor.'
  } catch (error) {
    return (error as Error).message
  }
  return null
}
