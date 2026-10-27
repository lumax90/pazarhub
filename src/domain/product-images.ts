import type { Product, Variant } from './types'
import { COLOR_DEFINITION_ID } from './definitions'

type ImageProduct = Pick<Product, 'images' | 'imageMetadata' | 'variantAxes'>
export function productColorImageOptions(product: ImageProduct) {
  return (product.variantAxes ?? [])
    .filter(
      (axis) =>
        axis.definitionId === COLOR_DEFINITION_ID ||
        axis.name.trim().toLocaleLowerCase('tr-TR') === 'renk',
    )
    .flatMap((axis) =>
      axis.values.map((value) => ({
        id: JSON.stringify([axis.id, value.id]),
        label: value.name,
        axisId: axis.id,
        valueId: value.id,
      })),
    )
}
export function imagesForVariant(product: ImageProduct, variant?: Pick<Variant, 'options'>) {
  const images = product.images ?? []
  if (!variant) return images
  const matching = images.filter((url) => {
    const data = product.imageMetadata?.[url]
    return data?.axisId && variant.options?.[data.axisId] === data.valueId
  })
  const common = images.filter((url) => !product.imageMetadata?.[url]?.axisId)
  return [...matching, ...common]
}
