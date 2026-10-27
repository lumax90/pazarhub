import type { MarketplaceProvider } from './integrations'

export type PublishingProvider =
  'trendyol' | 'n11' | 'amazon' | 'ciceksepeti' | 'pazarama' | 'hepsiburada' | 'toptantr' | 'pttavm'
export interface CatalogOption {
  id: string
  name: string
  path?: string
  leaf?: boolean
  image?: string
}
export interface AttributeSelection {
  valueIds?: string[]
  labels?: string[]
  customValue?: string
  textLength?: number
}
export interface CatalogAttribute {
  id: string
  name: string
  required: boolean
  variant: boolean
  slicer: boolean
  allowCustom: boolean
  multiple: boolean
  personalization?: boolean
  values?: CatalogOption[]
}
export interface CategorySchema {
  id: string
  name: string
  attributes: CatalogAttribute[]
}
export type MetadataResource =
  'categories' | 'attributes' | 'values' | 'brands' | 'asin' | 'shipmentTemplates'
export interface MetadataQuery {
  resource: MetadataResource
  categoryId?: string
  attributeId?: string
  query?: string
  page?: number
}
export interface MetadataResult {
  options?: CatalogOption[]
  schema?: CategorySchema
  hasMore?: boolean
  page?: number
}
export interface PublishConfig {
  categoryId?: string
  categoryName?: string
  brandId?: string
  brandName?: string
  productMainId?: string
  title?: string
  description?: string
  images?: string[]
  attributes: Record<string, AttributeSelection>
  dimensionalWeight?: number
  origin?: string
  shipmentAddressId?: string
  returningAddressId?: string
  deliveryDuration?: number
  shipmentTemplate?: string
  preparingDay?: number
  deliveryType?: number
  deliveryMessageType?: number
  asin?: string
  itemPerPackage?: number
  condition?: 'new_new' | 'used_like_new' | 'used_very_good' | 'used_good' | 'used_acceptable'
}
export type PublicationPhase =
  'draft' | 'queued' | 'submitted' | 'review' | 'listed' | 'live' | 'rejected' | 'uncertain'
export interface PublicationState {
  phase: PublicationPhase
  reference?: string
  jobId?: string
  message?: string
  checkedAt?: string
  submittedAt?: string
  reconciledByIdentity?: boolean
  errors?: { field?: string; message: string }[]
}
export interface CategoryMapping {
  id: string
  storeId: string
  localCategory: string
  categoryId: string
  categoryName: string
  attributes: Record<string, AttributeSelection>
  updatedAt: string
  version: number
  provider?: MarketplaceProvider
  localCategoryId?: string
  commissionBps?: number
}
export interface CatalogValueMapping {
  id: string
  provider: MarketplaceProvider
  version: number
  kind: 'brand' | 'variant' | 'attribute'
  definitionId: string
  categoryId?: string
  attributeId?: string
  attributeName?: string
  brandId?: string
  brandName?: string
  useSameText?: boolean
  values: Record<string, AttributeSelection>
  updatedAt: string
}
export interface PublicationDefinition {
  provider: PublishingProvider
  name: string
  mode: 'product' | 'offer'
  metadata: MetadataResource[]
  maxTitle: number
  maxImages: number
  maxBarcode: number
  maxMainId: number
  grouped?: boolean
  immutableMainId?: boolean
}
export const publicationDefinitions: Record<PublishingProvider, PublicationDefinition> = {
  pttavm: {
    provider: 'pttavm',
    name: 'PttAVM',
    mode: 'product',
    grouped: true,
    immutableMainId: true,
    metadata: ['categories', 'attributes'],
    maxTitle: 200,
    maxImages: 12,
    maxBarcode: 14,
    maxMainId: 40,
  },
  toptantr: {
    provider: 'toptantr',
    name: 'ToptanTR',
    mode: 'product',
    grouped: true,
    metadata: ['categories', 'attributes', 'values', 'brands'],
    maxTitle: 300,
    maxImages: 12,
    maxBarcode: 14,
    maxMainId: 100,
  },
  hepsiburada: {
    provider: 'hepsiburada',
    name: 'Hepsiburada',
    mode: 'product',
    metadata: ['categories', 'attributes', 'values'],
    maxTitle: 200,
    maxImages: 10,
    maxBarcode: 13,
    maxMainId: 100,
  },
  pazarama: {
    provider: 'pazarama',
    name: 'Pazarama',
    mode: 'product',
    metadata: ['categories', 'attributes', 'values', 'brands'],
    maxTitle: 100,
    maxImages: 12,
    maxBarcode: 80,
    maxMainId: 10,
  },
  ciceksepeti: {
    provider: 'ciceksepeti',
    name: 'Çiçeksepeti',
    mode: 'product',
    metadata: ['categories', 'attributes', 'values'],
    maxTitle: 255,
    maxImages: 12,
    maxBarcode: 50,
    maxMainId: 100,
  },
  trendyol: {
    provider: 'trendyol',
    name: 'Trendyol',
    mode: 'product',
    metadata: ['categories', 'attributes', 'values', 'brands'],
    maxTitle: 100,
    maxImages: 8,
    maxBarcode: 40,
    maxMainId: 40,
  },
  n11: {
    provider: 'n11',
    name: 'n11',
    mode: 'product',
    metadata: ['categories', 'attributes', 'values', 'shipmentTemplates'],
    maxTitle: 255,
    maxImages: 12,
    maxBarcode: 80,
    maxMainId: 100,
  },
  amazon: {
    provider: 'amazon',
    name: 'Amazon Türkiye',
    mode: 'offer',
    metadata: ['asin'],
    maxTitle: 300,
    maxImages: 12,
    maxBarcode: 80,
    maxMainId: 100,
  },
}
export const supportsPublishing = (provider: string): provider is PublishingProvider =>
  Object.hasOwn(publicationDefinitions, provider)
export const publicationLabels: Record<PublicationPhase, string> = {
  listed: 'İlan hazır · stok bekliyor',
  draft: 'Taslak',
  queued: 'Gönderim sırasında',
  submitted: 'İstek alındı',
  review: 'Platform incelemesinde',
  live: 'Yayında',
  rejected: 'Düzeltme gerekiyor',
  uncertain: 'Sonuç doğrulanmalı',
}
export interface PublishPreview {
  id: string
  listingId: string
  provider: MarketplaceProvider
  title: string
  sku: string
  barcode: string
  price: number
  listPrice?: number
  quantity: number
  categoryName?: string
  attributes: { name: string; value: string; source: 'listing' | 'mapping' }[]
  body: Record<string, unknown>
  expiresAt: string
  warnings: string[]
  members?: { listingId: string; sku: string; barcode: string; price: number; quantity: number }[]
}
