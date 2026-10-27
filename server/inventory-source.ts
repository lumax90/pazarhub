import type { AppState, Listing } from '../src/domain/types'
import type { IntegrationSettings } from '../src/domain/integrations'
import {
  findVariant,
  listingPrice,
  listingListPrice,
  listingQuantity,
} from '../src/domain/selectors'
import { storeWarehouseIds } from '../src/domain/stock-allocation'
import { canonicalJson, sha256 } from './security'
import { ProviderError } from './errors'

export function inventorySourceKey(
  state: AppState,
  storeId: string,
  listingId: string,
  settings: IntegrationSettings,
) {
  const target = state.listings.find((item) => item.id === listingId && item.storeId === storeId)
  if (!target)
    throw new ProviderError('LISTING_NOT_FOUND', 'Stok gönderiminin ilan eşlemesi bulunamadı.')
  const group =
    target.channel === 'pttavm'
      ? target.attributes?.pttParentSku
      : target.channel === 'toptantr'
        ? target.attributes?.productCode
        : undefined
  const members = group
    ? state.listings.filter(
        (item) =>
          item.storeId === storeId &&
          (target.channel === 'pttavm'
            ? item.attributes?.pttParentSku
            : item.attributes?.productCode) === group,
      )
    : [target]
  return sha256(
    canonicalJson({
      warehouseIds: storeWarehouseIds(state, settings),
      stockBuffer: settings.stockBuffer,
      members: members
        .map((listing: Listing) => ({
          id: listing.id,
          externalId: listing.externalId,
          externalSku: listing.externalSku,
          externalBarcode: listing.externalBarcode,
          variantId: listing.variantId,
          attributes: listing.attributes,
          price: listingPrice(state, listing),
          listPrice: ['trendyol', 'n11', 'pazarama'].includes(listing.channel)
            ? listingListPrice(state, listing)
            : undefined,
          quantity: listingQuantity(
            state,
            listing,
            settings.stockBuffer,
            storeWarehouseIds(state, settings),
          ),
          archived: listing.desiredStatus === 'archived',
          taxRate: findVariant(state, listing.variantId)?.product.taxRate,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  )
}
