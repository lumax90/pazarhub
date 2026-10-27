import { AppError, ProviderError } from '../errors'
import { array, record, text } from '../integrations/contracts'
import type { CatalogOption, CategorySchema, PublishConfig } from '../../src/domain/publishing'

export function failField(field: string, message: string): never {
  throw new AppError(422, 'PUBLICATION_INVALID', `${field}: ${message}`)
}
export const numericId = (value: string | undefined, field: string) => {
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)
    return failField(field, 'Geçerli sağlayıcı kimliği seçin.')
  return Number(value)
}
export function leafCategories(raw: unknown, root = 'categories'): CatalogOption[] {
  const tree = Array.isArray(raw) ? raw : record(raw)[root]
  if (!Array.isArray(tree))
    throw new ProviderError('INVALID_METADATA', 'Kategori ağacı beklenen biçimde değil.')
  const options: CatalogOption[] = []
  const walk = (rows: unknown[], path: string[], depth: number) => {
    if (depth > 30)
      throw new ProviderError('INVALID_METADATA', 'Kategori ağacı derinlik sınırını aştı.')
    for (const raw of rows) {
      const item = record(raw),
        name = text(item.name),
        children = array(item.subCategories)
      if (!text(item.id) || !name) continue
      const next = [...path, name]
      if (children.length) walk(children, next, depth + 1)
      else options.push({ id: text(item.id), name, path: next.join(' / '), leaf: true })
    }
  }
  walk(tree, [], 0)
  return options
}
export function selectionEntries(config: PublishConfig, schema: CategorySchema | null) {
  return Object.entries(config.attributes)
    .filter(([, v]) => v.valueIds?.length || v.customValue?.trim() || v.textLength)
    .map(([id, choice]) => ({
      id,
      choice,
      definition: schema?.attributes.find((a) => a.id === id),
    }))
}
export function failureMessages(values: unknown): { field?: string; message: string }[] {
  return array(values)
    .map((value) =>
      typeof value === 'string'
        ? { message: value.slice(0, 700) }
        : {
            field: text(record(value).field ?? record(value).attributeName) || undefined,
            message: text(
              record(value).message ?? record(value).reason ?? record(value).code,
            ).slice(0, 700),
          },
    )
    .filter((item) => item.message)
    .slice(0, 30)
}
export function assertMetadataOptions(options: CatalogOption[]) {
  if (options.some((o) => !o.id || !o.name))
    throw new ProviderError('INVALID_METADATA', 'Sağlayıcı seçenek kimliği veya etiketi eksik.')
  return options
}
