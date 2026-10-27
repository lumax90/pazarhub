import type { ListingContentFields } from '../../src/domain/listing-content'
import type { MarketplaceProvider } from '../../src/domain/integrations'
import type { AppState, Listing } from '../../src/domain/types'
import { canonicalJson, sha256 } from '../security'

export interface ContentSource {
  key: string
  fields: ListingContentFields
  members: string[]
  preserve: Record<string, unknown>
  fingerprint: string
}
export interface ContentPlan {
  listingId: string
  provider: MarketplaceProvider
  localKey: string
  source: ContentSource
  changes: Partial<ListingContentFields>
  createdAt: string
}
export const contentLocalKey = (state: AppState, listing: Listing) =>
  sha256(
    canonicalJson({
      listingId: listing.id,
      version: listing.version,
      variantId: listing.variantId,
      productVersion: state.products.find((product) => product.id === listing.productId)?.version,
      externalId: listing.externalId,
      sku: listing.externalSku,
      barcode: listing.externalBarcode,
      attributes: listing.attributes,
    }),
  )
export function contentSource(
  key: string,
  fields: ListingContentFields,
  members: string[],
  preserve: Record<string, unknown>,
): ContentSource {
  return {
    key,
    fields,
    members,
    preserve,
    fingerprint: sha256(canonicalJson({ key, fields, members, preserve })),
  }
}
export function contentMatches(
  source: ContentSource,
  changes: Partial<ListingContentFields>,
  slots = false,
) {
  return (
    (changes.title === undefined || changes.title === source.fields.title) &&
    (changes.description === undefined || changes.description === source.fields.description) &&
    (changes.images === undefined ||
      canonicalJson(
        slots ? source.fields.images.slice(0, changes.images.length) : source.fields.images,
      ) === canonicalJson(changes.images))
  )
}
