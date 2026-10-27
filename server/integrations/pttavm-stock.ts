import type { AdapterContext, AdapterResult } from './contracts'
import { array, cents, integer, record, remoteInteger, text } from './contracts'
import { findVariant, listingPrice, listingQuantity } from '../../src/domain/selectors'
import { inventoryValues } from './contracts'
import { canonicalJson } from '../security'
import { ProviderError } from '../errors'
import { PttAvmApi } from './pttavm-api'
import { storeWarehouseIds } from '../../src/domain/stock-allocation'
import { pttVariantAttributes, pttVariantPrice, pttVariantValuesMatch } from './pttavm-catalog'

export async function synchronizePttInventory(
  api: PttAvmApi,
  context: AdapterContext,
  payload: Record<string, unknown>,
): Promise<AdapterResult> {
  const listing = context.state.listings.find(
    (item) => item.storeId === context.connectionId && item.id === payload.listingId,
  )
  if (!listing?.externalId)
    throw new ProviderError('MAPPING_REQUIRED', 'PttAVM ilan eşlemesi gerekli.')
  const parentSku = text(listing.attributes?.pttParentSku) || listing.externalBarcode
  if (!parentSku)
    throw new ProviderError('MAPPING_REQUIRED', 'PttAVM üst ürün satıcı kodu gerekli.')
  const parent = await api.parent(context, parentSku)
  if (!parent || text(parent.barkod) !== parentSku)
    throw new ProviderError('PRODUCT_IDENTITY_MISMATCH', 'PttAVM üst ürünü doğrulanamadı.')
  if (
    listing.attributes?.pttParentId &&
    String(listing.attributes.pttParentId) !== text(parent.urunId)
  )
    throw new ProviderError('PRODUCT_IDENTITY_MISMATCH', 'PttAVM üst ürün kimliği değişmiş.')
  const remote = array(parent.variantListesi).map(record)
  const members = remote.length
    ? remote.map((variant) => {
        const externalId = `${text(parent.urunId)}:${encodeURIComponent(text(variant.variantBarkod))}`
        const member = context.state.listings.find(
          (item) => item.storeId === context.connectionId && item.externalId === externalId,
        )
        const found = member && findVariant(context.state, member.variantId)
        if (!member || !found)
          throw new ProviderError(
            'PTT_GROUP_MAPPING',
            'PttAVM üst ürününün bütün varyantlarını eşleyin; ortak fiyat değişimi grubun tamamını etkiler.',
          )
        let attributes = pttVariantAttributes(member.attributes?.pttAttributes)
        if (!attributes.length)
          attributes = (found.product.variantAxes ?? []).map((axis) => ({
            definition: axis.name,
            value:
              axis.values.find((value) => value.id === found.variant.options?.[axis.id])?.name ??
              '',
          }))
        if (!pttVariantValuesMatch(variant, attributes))
          throw new ProviderError(
            'PTT_VARIANT_MAPPING',
            'Yerel varyant tip/değerleri PttAVM varyant sırasıyla uyuşmuyor. Eşlemeyi düzeltin.',
          )
        return {
          listingId: member.id,
          sku: text(variant.variantBarkod),
          attributes,
          price: listingPrice(context.state, member),
          quantity: listingQuantity(
            context.state,
            member,
            context.settings.stockBuffer,
            storeWarehouseIds(context.state, context.settings),
          ),
          taxRate: found.product.taxRate,
          archived: member.desiredStatus === 'archived' || !found.product.active,
        }
      })
    : (() => {
        if (listing.attributes?.hasVariants === 'yes')
          throw new ProviderError('PTT_GROUP_CHANGED', 'PttAVM varyant grubu değişmiş.')
        const found = findVariant(context.state, listing.variantId)
        if (!found || listing.externalId !== text(parent.urunId))
          throw new ProviderError(
            'PRODUCT_IDENTITY_MISMATCH',
            'PttAVM ürün ilişkisi doğrulanamadı.',
          )
        const values = inventoryValues(context, listing, payload)
        return [
          {
            listingId: listing.id,
            sku: parentSku,
            attributes: [],
            price: values.price,
            quantity: values.quantity,
            taxRate: found.product.taxRate,
            archived:
              Boolean(
                record(payload.inventoryPlan).archive ??
                payload.archive ??
                listing.desiredStatus === 'archived',
              ) || !found.product.active,
          },
        ]
      })()
  members.sort((a, b) => a.listingId.localeCompare(b.listingId))
  const target = members.find((member) => member.listingId === listing.id)
  if (!target || new Set(members.map((member) => member.listingId)).size !== members.length)
    throw new ProviderError('PTT_GROUP_CHANGED', 'PttAVM varyant grubu değişmiş.')
  const quantity = members.reduce((sum, member) => sum + member.quantity, 0),
    price = Math.min(...members.map((member) => member.price))
  if (
    members.length > 100 ||
    quantity > 9999 ||
    members.some(
      (member) =>
        !Number.isSafeInteger(member.price) ||
        member.price <= 100 ||
        !Number.isSafeInteger(member.quantity) ||
        member.quantity < 0,
    )
  )
    throw new ProviderError(
      'INVALID_PRICE_STOCK',
      'PttAVM fiyatı 1 TL’den büyük, toplam grup stoğu en fazla 9.999 ve grup en fazla 100 varyant olmalı.',
    )
  if (
    new Set(members.map((member) => member.taxRate)).size !== 1 ||
    ![0, 1, 10, 20].includes(target.taxRate)
  )
    throw new ProviderError('INVALID_TAX', 'PttAVM grubunun ortak KDV oranını kontrol edin.')
  const active = members.some((member) => !member.archived)
  const plan = { parentId: text(parent.urunId), parentSku, members, quantity, price, active }
  const saved = record(payload.inventoryPlan)
  if (
    (saved.price !== undefined && saved.price !== target.price) ||
    (saved.quantity !== undefined && saved.quantity !== target.quantity) ||
    (payload.pttPlan && canonicalJson(payload.pttPlan) !== canonicalJson(plan))
  )
    throw new ProviderError(
      'INVENTORY_PLAN_STALE',
      'PttAVM grup stoku, fiyatı veya eşlemesi değişti. Güncel eşitlemeyi başlatın.',
    )
  const wait = (extra: Record<string, unknown>, message: string): AdapterResult => ({
    message,
    nextPayload: { ...payload, pttPlan: plan, polls: integer(payload.polls) + 1, ...extra },
    delaySeconds: 30,
  })
  if (payload.trackingId && !(await api.tracking(context, text(payload.trackingId), parentSku)))
    return wait({}, 'PttAVM stok/fiyat satırı işleniyor.')
  const matches =
    parent.aktif === active &&
    cents(parent.kdVli) === price &&
    remoteInteger(parent.kdvOran) === target.taxRate &&
    remoteInteger(parent.miktar) === quantity &&
    (!remote.length ||
      members.every((member) => {
        const variant = remote.find((variant) => text(variant.variantBarkod) === member.sku)!
        return (
          pttVariantPrice(parent, variant) === member.price &&
          remoteInteger(variant.miktar) === member.quantity
        )
      }))
  if (matches)
    return {
      message: 'PttAVM üst ürün ve varyant stok/fiyatları katalogdan doğrulandı.',
      listingStatus: target.archived ? 'archived' : 'active',
    }
  if (payload.trackingId)
    return wait({}, 'PttAVM stok/fiyat değişiminin kataloğa yansıması bekleniyor.')
  const item = {
    barcode: parentSku,
    active,
    quantity,
    vatRate: target.taxRate,
    ...(target.taxRate === 0 ? { priceWithoutVAT: price / 100 } : { priceWithVAT: price / 100 }),
    ...(remote.length
      ? {
          variants: members.map((member) => ({
            attributes: member.attributes,
            quantity: member.quantity,
            price: (member.price - price) / 100,
          })),
        }
      : {}),
  }
  const response = record(
    await api.request(context, '/products/stock-prices', {
      method: 'POST',
      json: { items: [item] },
      idempotent: true,
    }),
  )
  if (response.success === false)
    throw new ProviderError(
      'PTT_STOCK_REJECTED',
      text(response.message) || 'PttAVM stok/fiyat isteğini reddetti.',
    )
  if (response.success !== true || !text(response.trackingId))
    throw new ProviderError(
      'MISSING_TRACKING_ID',
      'PttAVM stok/fiyat yanıtı doğrulanamadı; sonraki denemede önce katalog okunacak.',
      true,
      300,
    )
  return wait(
    { trackingId: text(response.trackingId) },
    'PttAVM stok/fiyat isteği alındı; katalogdan doğrulanacak.',
  )
}
