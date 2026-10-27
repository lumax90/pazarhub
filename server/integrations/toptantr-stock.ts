import type { AdapterContext } from './contracts'
import { array, cents, integer, record, remoteInteger, text } from './contracts'
import type { AdapterResult } from './contracts'
import { availableStock, findVariant, listingPrice } from '../../src/domain/selectors'
import { ProviderError } from '../errors'
import { canonicalJson } from '../security'
import type { ToptanTrApi } from './toptantr'
import { storeWarehouseIds } from '../../src/domain/stock-allocation'

export function isToptanSharedStock(product: Record<string, unknown>, types: unknown): boolean {
  if (!Array.isArray(types))
    throw new ProviderError('INVALID_METADATA', 'ToptanTR varyasyon stok modeli doğrulanamadı.')
  const definitions = types.map(record),
    used = new Set<string>()
  for (const variant of array(product.productAttributeCombinations).map(record)) {
    const xmlIds = [
      ...text(variant.attributesXml).matchAll(/<ProductAttribute\s+ID\s*=\s*["'](\d+)["']/gi),
    ].map((match) => match[1])
    if (xmlIds.length) {
      for (const id of xmlIds) {
        if (!definitions.some((definition) => text(definition.id) === id))
          throw new ProviderError(
            'STOCK_MODEL_UNKNOWN',
            'ToptanTR varyasyon türleri kategori şemasıyla uyuşmuyor.',
          )
        used.add(id)
      }
      continue
    }
    const values = array(variant.attributes).map(record)
    if (!values.length && definitions.length === 1) {
      used.add(text(definitions[0].id))
      continue
    }
    if (!values.length)
      throw new ProviderError('STOCK_MODEL_UNKNOWN', 'ToptanTR varyasyon türleri doğrulanamadı.')
    for (const value of values) {
      const matched = definitions.filter((definition) =>
        array(definition.options).some((option) => text(record(option).id) === text(value.id)),
      )
      if (matched.length !== 1)
        throw new ProviderError(
          'STOCK_MODEL_UNKNOWN',
          'ToptanTR varyasyon değeri tek bir stok modeline eşlenemedi.',
        )
      used.add(text(matched[0].id))
    }
  }
  return (
    used.size === 1 &&
    definitions.some(
      (definition) =>
        used.has(text(definition.id)) &&
        text(definition.name).toLocaleLowerCase('tr-TR') === 'seçenekler',
    )
  )
}

export interface ToptanSharedStockPlan {
  productCode: string
  baseId: string
  sourceVariantId: string
  sourceQuantity: number
  baseQuantity: number
  members: {
    listingId: string
    externalId: string
    sku: string
    units: number
    itemPerPackage: number
    price: number
    quantity: number
    archived: boolean
  }[]
}

export function planToptanSharedStock(
  context: AdapterContext,
  product: Record<string, unknown>,
): ToptanSharedStockPlan {
  const warehouseIds = storeWarehouseIds(context.state, context.settings)
  if (warehouseIds.length !== 1)
    throw new ProviderError(
      'SHARED_PACKAGE_WAREHOUSE',
      'ToptanTR ortak paket stoğu için mağazada tek depo seçin; depoların parçaları bir pakette birleştirilmez.',
    )
  if (context.settings.stockBuffer !== 0)
    throw new ProviderError(
      'SHARED_PACKAGE_BUFFER',
      'ToptanTR ortak paket stoğunda tamponu 0 seçin; paket ve adet tamponları aynı stok kaynağında bağımsız uygulanamaz.',
    )
  const remote = array(product.productAttributeCombinations).map(record)
  const base = [...remote].sort(
    (a, b) =>
      integer(a.itemPerPackage, 1) - integer(b.itemPerPackage, 1) ||
      text(a.id).localeCompare(text(b.id)),
  )[0]
  if (!base || !text(product.productCode))
    throw new ProviderError(
      'SHARED_PACKAGE_STOCK',
      'Ortak stok üst ürün kimliği veya baz varyasyonu bulunamadı.',
    )
  let sourceVariantId = ''
  const members = remote.map((combination) => {
    if (!/^[1-9]\d*$/.test(text(combination.id)) || !Number.isSafeInteger(Number(combination.id)))
      throw new ProviderError('STOCK_MODEL_UNKNOWN', 'ToptanTR varyasyon kimliği geçersiz.')
    const listing = context.state.listings.find(
      (listing) =>
        listing.storeId === context.connectionId && listing.externalId === text(combination.id),
    )
    const found = listing && findVariant(context.state, listing.variantId)
    if (!listing || !found)
      throw new ProviderError(
        'SHARED_PACKAGE_STOCK',
        'Ortak stoklu Adet/Paket/Koli varyasyonlarının tümünü fiziksel ürün ve paket bileşenleriyle eşleyin.',
      )
    if (
      (listing.externalSku && listing.externalSku !== text(combination.barcode)) ||
      (listing.externalBarcode &&
        text(combination.gtin) &&
        listing.externalBarcode !== text(combination.gtin))
    )
      throw new ProviderError(
        'PRODUCT_IDENTITY_MISMATCH',
        'ToptanTR varyasyon SKU/barkod eşlemesi değişmiş.',
      )
    if (listing.attributes?.productCode && listing.attributes.productCode !== product.productCode)
      throw new ProviderError('PRODUCT_IDENTITY_MISMATCH', 'ToptanTR üst ürün eşlemesi değişmiş.')
    const components = found.product.bundle?.components
    if (components && components.length !== 1)
      throw new ProviderError(
        'SHARED_PACKAGE_STOCK',
        'Adet/Paket/Koli eşlemesi tek fiziksel bileşenin farklı adetlerini kullanmalı.',
      )
    const source = components?.[0].variantId ?? found.variant.id,
      units = components?.[0].quantity ?? 1
    const physical = findVariant(context.state, source)
    if (
      !physical ||
      physical.product.bundle ||
      !Number.isInteger(units) ||
      units < 1 ||
      (sourceVariantId && sourceVariantId !== source)
    )
      throw new ProviderError(
        'SHARED_PACKAGE_STOCK',
        'Varyasyonlar aynı fiziksel stok kodundan tüketilmeli.',
      )
    sourceVariantId = source
    const itemPerPackage = integer(combination.itemPerPackage, 1)
    if (itemPerPackage < 1 || integer(listing.attributes?.itemPerPackage, 1) !== itemPerPackage)
      throw new ProviderError(
        'PACKAGE_SIZE_CHANGED',
        'Paket içi miktar değişmiş; eşlemeyi yenileyin.',
      )
    return {
      listingId: listing.id,
      externalId: text(combination.id),
      sku: listing.externalSku || text(combination.barcode),
      units,
      itemPerPackage,
      price: listingPrice(context.state, listing),
      quantity: 0,
      archived: listing.desiredStatus === 'archived' || !found.product.active,
    }
  })
  const baseMember = members.find((member) => member.externalId === text(base.id))!
  if (members.filter((member) => member.itemPerPackage === baseMember.itemPerPackage).length !== 1)
    throw new ProviderError(
      'SHARED_PACKAGE_STOCK',
      'Ortak stok için tek bir en küçük baz varyasyon gerekli.',
    )
  for (const member of members) {
    if (member.units * baseMember.itemPerPackage !== baseMember.units * member.itemPerPackage)
      throw new ProviderError(
        'SHARED_PACKAGE_STOCK',
        'Yerel paket adedi ToptanTR paket oranıyla uyuşmuyor.',
      )
    if (!Number.isSafeInteger(member.price) || member.price < 0 || member.price > 1_000_000_000)
      throw new ProviderError('INVALID_PRICE', 'Ortak stok grubunun fiyatlarını tamamlayın.')
    if (member.units % baseMember.units !== 0)
      throw new ProviderError(
        'SHARED_PACKAGE_STOCK',
        'Paket adetleri baz varyasyonun tam katı olmalı.',
      )
  }
  const sourceQuantity = Math.max(
    0,
    availableStock(context.state, sourceVariantId, undefined, warehouseIds[0]),
  )
  const baseQuantity = Math.max(0, Math.floor(sourceQuantity / baseMember.units))
  for (const member of members)
    member.quantity = member.archived
      ? 0
      : Math.floor((baseQuantity * baseMember.itemPerPackage) / member.itemPerPackage)
  return {
    productCode: text(product.productCode),
    baseId: baseMember.externalId,
    sourceVariantId,
    sourceQuantity,
    baseQuantity,
    members: members.sort((a, b) => a.externalId.localeCompare(b.externalId)),
  }
}

export async function synchronizeToptanSharedStock(
  api: ToptanTrApi,
  context: AdapterContext,
  payload: Record<string, unknown>,
  product: Record<string, unknown>,
): Promise<AdapterResult> {
  const plan = planToptanSharedStock(context, product)
  const target = plan.members.find((member) => member.listingId === payload.listingId)
  if (!target)
    throw new ProviderError('LISTING_REQUIRED', 'Ortak stok grubunda hedef ilan bulunamadı.')
  if (!target.archived && target.price <= 0)
    throw new ProviderError(
      'INVALID_PRICE',
      'Hedef varyasyonun satış fiyatı sıfırdan büyük olmalı.',
    )
  const inventory = record(payload.inventoryPlan)
  if (
    (typeof inventory.price === 'number' && inventory.price !== target.price) ||
    (typeof inventory.quantity === 'number' && inventory.quantity !== target.quantity)
  )
    throw new ProviderError(
      'INVENTORY_PLAN_STALE',
      'Ortak stok planı değişti. Güncel stok/fiyat eşitlemesini başlatın.',
    )
  if (payload.sharedPlan && canonicalJson(payload.sharedPlan) !== canonicalJson(plan))
    throw new ProviderError(
      'INVENTORY_PLAN_STALE',
      'Paket içeriği, rezervasyon veya grup fiyatı değişti. Eski ortak stok planı uygulanmadı.',
    )
  const next = (
    extra: Record<string, unknown>,
    message: string,
    delaySeconds = 15,
  ): AdapterResult => ({
    message,
    nextPayload: { ...payload, sharedPlan: plan, ...extra },
    delaySeconds,
  })
  const checkBatch = async (id: string, expectedRows: number) => {
    const result = await api.request(context, `/jobs?batchRequestId=${encodeURIComponent(id)}`)
    if (!Array.isArray(result.result))
      throw new ProviderError('INVALID_BATCH', 'Ortak stok parti sonucu okunamadı.')
    if (result.result.some((value) => record(value).success === false))
      throw new ProviderError(
        'BATCH_FAILED',
        text(record(result.result.find((value) => record(value).success === false)).msg) ||
          'Ortak stok/fiyat satırı başarısız.',
      )
    return (
      result.result.length === expectedRows &&
      result.result.every((value) => record(value).success === true)
    )
  }
  const combinations = array(product.productAttributeCombinations).map(record)
  // Closing any pending archived member first prevents the subsequent common stock write from reopening it.
  const prices = plan.members.filter(
    (member) => member.listingId === target.listingId || member.archived,
  )
  const priceMatches = () =>
    prices.every((member) => {
      const actual = combinations.find((value) => text(value.id) === member.externalId)
      const expected = member.archived ? 0 : member.price
      const sale = cents(actual?.overriddenPrice),
        old = cents(actual?.overriddenOldPrice)
      return sale === expected && (!Number.isSafeInteger(old) || old <= expected)
    })
  if (
    payload.sharedPriceBatch &&
    !(await checkBatch(text(payload.sharedPriceBatch), prices.length))
  )
    return next(
      { polls: integer(payload.polls) + 1 },
      'ToptanTR ortak grup fiyat sonucu bekleniyor.',
      30,
    )
  if (!priceMatches()) {
    if (payload.sharedPriceBatch)
      return next(
        { polls: integer(payload.polls) + 1 },
        'ToptanTR fiyatlarının kataloğa yansıması bekleniyor.',
        30,
      )
    const response = await api.request(context, '/combinations/price', {
      method: 'PUT',
      idempotent: true,
      json: {
        product: {
          combinations: prices.map((member) => ({
            id: Number(member.externalId),
            barcode: member.sku,
            sellingPrice: member.archived ? 0 : member.price / 100,
            originalPrice: member.archived ? 0 : member.price / 100,
          })),
        },
      },
    })
    const batch = text(response.batchRequestId)
    if (!batch)
      throw new ProviderError(
        'BATCH_REQUIRED',
        'Fiyat takip numarası dönmedi; sonraki kontrolde önce katalog okunacak.',
        true,
        30,
      )
    return next(
      { sharedPriceBatch: batch, polls: 0 },
      'Ortak stok grubunun fiyat/kapatma işlemi alındı.',
    )
  }
  if (payload.sharedStockBatch && !(await checkBatch(text(payload.sharedStockBatch), 1)))
    return next({ polls: integer(payload.polls) + 1 }, 'ToptanTR baz stok sonucu bekleniyor.', 30)
  const base = combinations.find((value) => text(value.id) === plan.baseId)
  if (remoteInteger(base?.stockQuantity) !== plan.baseQuantity) {
    if (payload.sharedStockBatch)
      return next(
        { polls: integer(payload.polls) + 1 },
        'ToptanTR baz stok yansıması bekleniyor.',
        30,
      )
    const response = await api.request(context, '/combinations/stock', {
      method: 'PUT',
      idempotent: true,
      json: {
        product: {
          combinations: [
            { id: Number(plan.baseId), barcode: text(base?.barcode), quantity: plan.baseQuantity },
          ],
        },
      },
    })
    const batch = text(response.batchRequestId)
    if (!batch)
      throw new ProviderError(
        'BATCH_REQUIRED',
        'Stok takip numarası dönmedi; sonraki kontrolde önce katalog okunacak.',
        true,
        30,
      )
    return next(
      { sharedStockBatch: batch, polls: 0 },
      'Ortak stok yalnız baz varyasyona gönderildi.',
    )
  }
  const baseMember = plan.members.find((member) => member.externalId === plan.baseId)!
  const matched = plan.members.every(
    (member) =>
      remoteInteger(
        combinations.find((value) => text(value.id) === member.externalId)?.stockQuantity,
      ) === Math.floor((plan.baseQuantity * baseMember.itemPerPackage) / member.itemPerPackage),
  )
  if (!matched)
    return next(
      { polls: integer(payload.polls) + 1 },
      'Paket/koli stoklarının baz stoktan hesaplanması bekleniyor.',
      30,
    )
  return {
    message: 'ToptanTR baz stok, paket/koli adetleri ve hedef fiyat katalogdan doğrulandı.',
    listingStatus: target.archived ? 'archived' : 'active',
  }
}
