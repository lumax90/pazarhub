import { z } from 'zod'
import { identifier, uuid } from '../validation'

const numeric = z
  .string()
  .regex(/^\d+$/)
  .max(18)
  .refine(
    (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0,
    'Geçerli pozitif kimlik gerekli.',
  )
export const catalogIdSchema = z.union([numeric, uuid, identifier])
const id = catalogIdSchema
export const attributeSelectionSchema = z
  .strictObject({
    valueIds: z.array(id).max(50).optional(),
    labels: z.array(z.string().max(300)).max(50).optional(),
    customValue: z.string().trim().max(500).optional(),
    textLength: z.number().int().min(1).max(5000).optional(),
  })
  .refine(
    (value) => !(value.customValue && value.valueIds?.length),
    'Serbest metin ve liste değeri birlikte kullanılamaz.',
  )
export const attributeMapSchema = z.record(id, attributeSelectionSchema)
export const publishConfigSchema = z.strictObject({
  categoryId: id.optional(),
  categoryName: z.string().max(500).optional(),
  brandId: id.optional(),
  brandName: z.string().max(300).optional(),
  productMainId: identifier.optional(),
  title: z.string().trim().max(300).optional(),
  description: z.string().max(30000).optional(),
  images: z.array(z.string().url().max(2048)).max(12).optional(),
  attributes: attributeMapSchema,
  dimensionalWeight: z.number().min(0).max(10000).optional(),
  origin: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  shipmentAddressId: id.optional(),
  returningAddressId: id.optional(),
  deliveryDuration: z.number().int().min(0).max(30).optional(),
  shipmentTemplate: z.string().trim().max(255).optional(),
  preparingDay: z.number().int().min(0).max(90).optional(),
  itemPerPackage: z.number().int().min(1).max(100000).optional(),
  deliveryType: z.number().int().min(1).max(3).optional(),
  deliveryMessageType: z.number().int().positive().optional(),
  asin: z
    .string()
    .regex(/^[A-Z0-9]{10}$/)
    .optional(),
  condition: z
    .enum(['new_new', 'used_like_new', 'used_very_good', 'used_good', 'used_acceptable'])
    .optional(),
})
export const metadataQuerySchema = z.object({
  resource: z.enum(['categories', 'attributes', 'values', 'brands', 'asin', 'shipmentTemplates']),
  categoryId: id.optional(),
  attributeId: id.optional(),
  query: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(0).max(1000).default(0),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
})
