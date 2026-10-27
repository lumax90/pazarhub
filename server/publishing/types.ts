import type {
  CatalogOption,
  CategorySchema,
  MetadataQuery,
  MetadataResult,
  PublishConfig,
  PublishingProvider,
  PublicationState,
} from '../../src/domain/publishing'
import type { Listing, Product, Variant } from '../../src/domain/types'
import type { AdapterContext } from '../integrations/contracts'

export interface PublicationPlan {
  listingId: string
  productId: string
  provider: PublishingProvider
  version: number
  snapshotHash: string
  title: string
  description: string
  images: string[]
  sku: string
  barcode: string
  price: number
  listPrice?: number
  quantity: number
  categoryName?: string
  config: PublishConfig
  body: Record<string, unknown>
  attributes: { name: string; value: string; source: 'listing' | 'mapping' }[]
  group?: PublicationPlan[]
}
export interface PreparedListing {
  groupFingerprint?: string
  listing: Listing
  product: Product
  variant: Variant
  config: PublishConfig
  title: string
  description: string
  images: string[]
  price: number
  listPrice?: number
  quantity: number
}
export interface Inspection {
  state: PublicationState
  externalId?: string
  attributes?: Record<string, string | number>
  again?: boolean
  phase?: string
  pollAfterSeconds?: number
  members?: {
    listingId: string
    state: PublicationState
    externalId?: string
    attributes?: Record<string, string | number>
  }[]
}
export interface PublicationAdapter {
  provider: PublishingProvider
  metadata(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult>
  build(
    context: AdapterContext,
    item: PreparedListing,
    schema: CategorySchema | null,
  ): Record<string, unknown>
  submit(context: AdapterContext, plan: PublicationPlan): Promise<string>
  combine?(context: AdapterContext, plans: PublicationPlan[]): Promise<Record<string, unknown>>
  inspect(
    context: AdapterContext,
    plan: PublicationPlan,
    reference: string,
    phase?: string,
  ): Promise<Inspection>
}
export interface MetadataAccess {
  get(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult>
  remember(context: AdapterContext, query: MetadataQuery, options: CatalogOption[]): Promise<void>
  findValue(
    context: AdapterContext,
    categoryId: string,
    attributeId: string,
    id: string,
  ): Promise<CatalogOption | null>
}
