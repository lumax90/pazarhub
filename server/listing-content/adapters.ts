import type { Listing } from '../../src/domain/types'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { array, record, text, urls } from '../integrations/contracts'
import { basicAuth, ProviderHttp, requireCredential } from '../integrations/http'
import { PttAvmApi } from '../integrations/pttavm-api'
import { pttVariantAttributes, pttVariantValuesMatch } from '../integrations/pttavm-catalog'
import { ToptanTrApi } from '../integrations/toptantr'
import { ProviderError } from '../errors'
import { n11Headers } from '../integrations/n11-api'
import { contentDefinitions } from '../../src/domain/listing-content'
import { contentSource, contentMatches } from './contracts'
import type { ContentPlan, ContentSource } from './contracts'
import { findVariant } from '../../src/domain/selectors'

export class ListingContentAdapter {
  constructor(private readonly http: ProviderHttp) {}
  private api(context: AdapterContext): { base: string; headers: Record<string, string> } {
    const sandbox = context.settings.environment === 'sandbox'
    if (context.provider === 'trendyol') {
      const seller = requireCredential(context.credentials, 'sellerId')
      return {
        base: `https://${sandbox ? 'stageapigw' : 'apigw'}.trendyol.com/integration/product/sellers/${encodeURIComponent(seller)}`,
        headers: {
          authorization: basicAuth(
            requireCredential(context.credentials, 'apiKey'),
            requireCredential(context.credentials, 'apiSecret'),
          ),
          'user-agent': `${seller} - ${context.integrationName}`,
        },
      }
    }
    if (context.provider === 'hepsiburada')
      return {
        base: `https://mpop${sandbox ? '-sit' : ''}.hepsiburada.com`,
        headers: {
          authorization: basicAuth(
            requireCredential(context.credentials, 'username'),
            requireCredential(context.credentials, 'password'),
          ),
          'user-agent': context.credentials.username,
        },
      }
    if (context.provider === 'n11')
      return {
        base: 'https://api.n11.com',
        headers: n11Headers(context),
      }
    return {
      base: `https://${sandbox ? 'sandbox-apis' : 'apis'}.ciceksepeti.com/api/v1`,
      headers: {
        'x-api-key': requireCredential(context.credentials, 'apiKey'),
        'user-agent': `${requireCredential(context.credentials, 'sellerId')}-${context.integrationName}`,
      },
    }
  }
  async read(context: AdapterContext, listing: Listing): Promise<ContentSource> {
    const found = findVariant(context.state, listing.variantId),
      sku = listing.externalSku || found?.variant.sku,
      barcode = listing.externalBarcode || found?.variant.barcode
    if (!listing.externalId || !sku)
      throw new ProviderError(
        'LISTING_REQUIRED',
        'İçerik güncellemesi için mevcut ilan eşlemesi gerekli.',
      )
    if (context.provider === 'pttavm') {
      const parentSku = text(listing.attributes?.pttParentSku) || listing.externalBarcode
      if (!parentSku) throw new ProviderError('MAPPING_REQUIRED', 'PttAVM üst ürün kodunu eşleyin.')
      const raw = await new PttAvmApi(this.http).parent(context, parentSku)
      if (
        !raw ||
        text(raw.urunId) !== listing.externalId.split(':')[0] ||
        text(raw.barkod) !== parentSku
      )
        throw new ProviderError('IDENTITY_MISMATCH', 'PttAVM üst ürün kimliği değişti.')
      const variants = array(raw.variantListesi)
        .map(record)
        .map((variant) => {
          const member = context.state.listings.find(
            (item) =>
              item.storeId === context.connectionId &&
              item.externalId ===
                `${text(raw.urunId)}:${encodeURIComponent(text(variant.variantBarkod))}`,
          )
          const local = member && findVariant(context.state, member.variantId)
          let attributes = pttVariantAttributes(member?.attributes?.pttAttributes)
          if (!attributes.length && local)
            attributes = (local.product.variantAxes ?? []).map((axis) => ({
              definition: axis.name,
              value:
                axis.values.find((value) => value.id === local.variant.options?.[axis.id])?.name ??
                '',
            }))
          if (!pttVariantValuesMatch(variant, attributes))
            throw new ProviderError(
              'GROUP_MAPPING_REQUIRED',
              'PttAVM güncellemesinden önce üst ürünün tüm varyant tip/değerlerini eşleyin.',
            )
          return { variantBarcode: text(variant.variantBarkod), attributes }
        })
      return contentSource(
        `pttavm:${text(raw.urunId)}`,
        {
          title: text(raw.urunAdi),
          description: text(raw.uzunAciklama),
          images: urls(raw.resimListesi),
        },
        variants.length ? variants.map((item) => item.variantBarcode) : [parentSku],
        { barcode: parentSku, variants },
      )
    }
    if (context.provider === 'toptantr') {
      const { product, combination } = await new ToptanTrApi(this.http).combination(
        context,
        sku,
        listing.externalId,
      )
      if (barcode && text(combination.gtin) && text(combination.gtin) !== barcode)
        throw new ProviderError('IDENTITY_MISMATCH', 'ToptanTR GTIN eşlemesi değişti.')
      return contentSource(
        `toptantr:${text(product.productCode)}`,
        {
          title: text(product.title),
          description: text(product.fullDescription),
          images: urls(product.images),
        },
        array(product.productAttributeCombinations).map((item) => text(record(item).barcode)),
        {
          productCode: text(product.productCode),
          stockCode: text(product.stock_code),
          images: array(product.images).map((item) => ({
            id: record(item).id,
            url: record(item).url,
          })),
          approved: product.approvalStatusId === 0,
        },
      )
    }
    const { base, headers } = this.api(context)
    if (context.provider === 'trendyol') {
      const response = record(
        await this.http.request(
          `${base}/products/approved?${new URLSearchParams({ barcode: barcode ?? '', page: '0', size: '100' })}`,
          { headers },
        ),
      )
      const raw = array(response.content)
        .map(record)
        .find((item) =>
          array(item.variants).some((variant) => text(record(variant).barcode) === barcode),
        )
      if (!raw || !text(raw.contentId))
        throw new ProviderError(
          'APPROVED_CONTENT_REQUIRED',
          'Trendyol onaylı içerik kimliği doğrulanamadı.',
        )
      return contentSource(
        `trendyol:${text(raw.contentId)}`,
        { title: text(raw.title), description: text(raw.description), images: urls(raw.images) },
        array(raw.variants).map(
          (item) => text(record(item).stockCode) || text(record(item).barcode),
        ),
        { contentId: text(raw.contentId), barcode },
      )
    }
    if (context.provider === 'hepsiburada') {
      const response = record(
          await this.http.request(
            `${base}/product/api/products/all-products-of-merchant/${encodeURIComponent(requireCredential(context.credentials, 'merchantId'))}?${new URLSearchParams({ merchantSku: sku, page: '0', size: '100' })}`,
            { headers },
          ),
        ),
        raw = array(response.data)
          .map(record)
          .find((item) => text(item.merchantSku) === sku)
      if (
        response.success !== true ||
        !raw ||
        !text(raw.hbSku) ||
        (barcode && text(raw.barcode) !== barcode)
      )
        throw new ProviderError('IDENTITY_MISMATCH', 'Hepsiburada ürün kimliği doğrulanamadı.')
      return contentSource(
        `hepsiburada:${text(raw.hbSku)}`,
        {
          title: text(raw.productName),
          description: text(raw.productDescription ?? raw.description),
          images: urls(raw.images),
        },
        [sku],
        { hbSku: text(raw.hbSku), merchantId: context.credentials.merchantId },
      )
    }
    if (context.provider === 'n11') {
      const response = record(
          await this.http.request(
            `${base}/ms/product-query?${new URLSearchParams({ stockCode: sku, page: '0', size: '20', sender: 'SELLER' })}`,
            { headers },
          ),
        ),
        raw = array(response.content)
          .map(record)
          .find((item) => text(item.stockCode) === sku)
      if (!raw || text(raw.n11ProductId) !== listing.externalId)
        throw new ProviderError('IDENTITY_MISMATCH', 'n11 stok kodu ve ürün kimliği değişmiş.')
      return contentSource(
        `n11:${listing.externalId}:${sku}`,
        { title: text(raw.title), description: text(raw.description), images: urls(raw.images) },
        [sku],
        { stockCode: sku },
      )
    }
    const response = record(
        await this.http.request(
          `${base}/Products?${new URLSearchParams({ StockCode: sku, Page: '1', PageSize: '60' })}`,
          { headers },
        ),
      ),
      raw = array(response.products)
        .map(record)
        .find((item) => text(item.stockCode) === sku)
    if (!raw || text(raw.productCode) !== listing.externalId)
      throw new ProviderError(
        'IDENTITY_MISMATCH',
        'Çiçeksepeti stok kodu ve ürün kimliği doğrulanamadı.',
      )
    if (
      !Object.hasOwn(raw, 'operatorContacts') ||
      !Object.hasOwn(raw, 'safetyInfo') ||
      !Array.isArray(raw.attributes) ||
      typeof raw.isActive !== 'boolean'
    )
      throw new ProviderError(
        'FULL_PRODUCT_DETAILS_REQUIRED',
        'Çiçeksepeti mevcut işletmeci/güvenlik, özellik ve aktiflik bilgilerini dönmeli; eksik alanlarla güncelleme yapılmadı.',
      )
    const deliveryType = raw.deliveryType ?? listing.publishConfig?.deliveryType,
      deliveryMessageType = raw.deliveryMessageType ?? listing.publishConfig?.deliveryMessageType
    if (!deliveryType || !deliveryMessageType || !text(raw.mainProductCode))
      throw new ProviderError(
        'DELIVERY_FIELDS_REQUIRED',
        'Çiçeksepeti üst ürün ve teslimat alanlarını eşleyin.',
      )
    return contentSource(
      `ciceksepeti:${listing.externalId}`,
      {
        title: text(raw.productName),
        description: text(raw.description),
        images: urls(raw.images),
      },
      [sku],
      {
        mainProductCode: raw.mainProductCode,
        stockCode: sku,
        isActive: raw.isActive,
        deliveryType,
        deliveryMessageType,
        attributes: raw.attributes,
        operatorContacts: raw.operatorContacts,
        safetyInfo: raw.safetyInfo,
      },
    )
  }
  async send(context: AdapterContext, plan: ContentPlan): Promise<string> {
    const { changes, source } = plan,
      p = source.preserve
    if (context.provider === 'pttavm') {
      const response = record(
        await new PttAvmApi(this.http).request(context, '/products/upsert', {
          method: 'POST',
          json: {
            items: [
              {
                barcode: p.barcode,
                variants: p.variants,
                ...(changes.title !== undefined ? { name: changes.title } : {}),
                ...(changes.description !== undefined
                  ? { longDescription: changes.description }
                  : {}),
                ...(changes.images ? { images: changes.images.map((url) => ({ url })) } : {}),
              },
            ],
          },
        }),
      )
      if (response.success === false)
        throw new ProviderError(
          'CONTENT_REJECTED',
          text(response.message) || 'PttAVM içerik isteğini reddetti.',
        )
      if (response.success === true && text(response.trackingId)) return text(response.trackingId)
    } else if (context.provider === 'toptantr') {
      const images = changes.images?.map((url, index) => ({
        id: record(array(p.images).find((item) => record(item).url === url)).id ?? 0,
        position: index + 1,
        url,
      }))
      const response = await new ToptanTrApi(this.http).request(context, '/products', {
        method: 'PUT',
        json: {
          product: {
            productCode: p.productCode,
            stock_code: p.stockCode,
            ...(changes.title !== undefined ? { title: changes.title } : {}),
            ...(changes.description !== undefined ? { fullDescription: changes.description } : {}),
            ...(images ? { images } : {}),
          },
        },
      })
      if (
        response.success === true ||
        array(response.content).some(
          (item) => text(record(item).productCode) === text(p.productCode),
        )
      )
        return text(p.productCode)
    } else {
      const { base, headers } = this.api(context)
      let raw: unknown
      if (context.provider === 'trendyol')
        raw = await this.http.request(`${base}/products/content-bulk-update`, {
          method: 'POST',
          headers,
          json: {
            items: [
              {
                contentId: Number(p.contentId),
                ...changes,
                ...(changes.images ? { images: changes.images.map((url) => ({ url })) } : {}),
              },
            ],
          },
        })
      else if (context.provider === 'hepsiburada') {
        const file = new FormData()
        file.append(
          'file',
          new Blob(
            [
              JSON.stringify({
                merchantId: p.merchantId,
                items: [
                  {
                    hbSku: p.hbSku,
                    ...(changes.title !== undefined ? { productName: changes.title } : {}),
                    ...(changes.description !== undefined
                      ? { productDescription: changes.description }
                      : {}),
                    ...Object.fromEntries(
                      (changes.images ?? []).map((url, index) => [`image${index + 1}`, url]),
                    ),
                  },
                ],
              }),
            ],
            { type: 'application/json' },
          ),
          'content.json',
        )
        raw = await this.http.request(`${base}/ticket-api/api/integrator/import?version=1`, {
          method: 'POST',
          headers,
          body: file,
        })
      } else if (context.provider === 'n11')
        raw = await this.http.request(`${base}/ms/product/tasks/product-update`, {
          method: 'POST',
          headers,
          json: {
            payload: {
              integrator: context.integrationName,
              skus: [{ stockCode: p.stockCode, description: changes.description }],
            },
          },
        })
      else
        raw = await this.http.request(`${base}/Products`, {
          method: 'PUT',
          headers,
          json: {
            products: [
              {
                ...p,
                productName: changes.title ?? source.fields.title,
                description: changes.description ?? source.fields.description,
                images: changes.images ?? source.fields.images,
              },
            ],
          },
        })
      const response = record(raw)
      if (response.success === false || response.status === 'REJECT')
        throw new ProviderError(
          'CONTENT_REJECTED',
          text(response.message) || 'Sağlayıcı içerik güncellemesini reddetti.',
        )
      const reference =
        text(response.batchRequestId) ||
        text(response.batchId) ||
        text(response.trackingId) ||
        text(record(response.data).trackingId) ||
        (context.provider === 'n11' ? text(response.id) : '')
      if (reference) return reference
    }
    throw new ProviderError(
      'CONTENT_UNCERTAIN',
      'İçerik yazma yanıtı doğrulanamadı; yeniden yazılmadan mevcut kayıt sorgulanmalı.',
      false,
      undefined,
      true,
    )
  }
  async inspect(
    context: AdapterContext,
    listing: Listing,
    plan: ContentPlan,
    reference: string,
  ): Promise<AdapterResult['contentUpdate']> {
    const result = (
      state: 'pending' | 'applied' | 'rejected',
      message: string,
    ): NonNullable<AdapterResult['contentUpdate']> => ({
      listingId: listing.id,
      state,
      message,
      resourceKey: plan.source.key,
      changes: plan.changes,
    })
    const provider = context.provider
    if (reference && provider === 'hepsiburada') {
      const { base, headers } = this.api(context),
        response = record(
          await this.http.request(
            `${base}/ticket-api/api/integrator/status/${encodeURIComponent(reference)}?version=1&page=0&size=1000`,
            { headers },
          ),
        )
      const item = array(response.data)
        .map(record)
        .filter((row) => text(row.merchantId) === context.credentials.merchantId)
        .flatMap((row) => array(row.items))
        .map(record)
        .find((item) => text(item.hbSku) === text(plan.source.preserve.hbSku))
      const fields: string[] = Object.keys(plan.changes).map((key) =>
          key === 'title' ? 'NAME' : key === 'description' ? 'DESCRIPTION' : 'MEDIA',
        ),
        updates = array(item?.updateResults)
          .map(record)
          .filter((field) => fields.includes(text(field.fieldName)))
      if (
        updates.some(
          (field) => field.fieldResult === 'REJECTED' || field.fieldResult === 'PARTIAL_APPROVED',
        )
      )
        return result(
          'rejected',
          updates
            .map((field) => text(field.rejectReason))
            .filter(Boolean)
            .join(' · ') || 'Hepsiburada içeriğin bir bölümünü reddetti.',
        )
      if (
        item?.productStatus === 'COMPLETED' &&
        fields.every((name) =>
          updates.some((field) => field.fieldName === name && field.fieldResult === 'APPROVED'),
        )
      )
        return result('applied', 'Hepsiburada içerik alanlarının onayını doğruladı.')
      return result('pending', 'Hepsiburada içerik onayı bekleniyor.')
    }
    if (reference && provider === 'trendyol') {
      const { base, headers } = this.api(context),
        response = record(
          await this.http.request(
            `${base}/products/${encodeURIComponent(text(plan.source.preserve.contentId))}/update-audits?page=0&size=100`,
            { headers },
          ),
        )
      const audit = array(response.content)
          .map(record)
          .find(
            (item) =>
              item.batchRequestId === reference &&
              text(item.contentId) === text(plan.source.preserve.contentId),
          ),
        updates = array(audit?.updates).map(record),
        fields: string[] = Object.keys(plan.changes).map((key) =>
          key === 'title' ? 'TITLE' : key === 'description' ? 'DESCRIPTION' : 'MEDIA',
        )
      if (updates.some((field) => fields.includes(text(field.type)) && field.status === 'FAIL'))
        return result(
          'rejected',
          updates
            .flatMap((field) => array(field.rejectReasons))
            .map((reason) => text(record(reason).reason))
            .join(' · ') || 'Trendyol içerik güncellemesini reddetti.',
        )
      if (
        fields.every((type) =>
          updates.some((field) => field.type === type && field.status === 'SUCCESS'),
        )
      )
        return result('applied', 'Trendyol içerik kontrolü güncellenen alanları onayladı.')
    }
    if (reference && provider === 'n11') {
      const { base, headers } = this.api(context),
        response = record(
          await this.http.request(`${base}/ms/product/task-details/page-query`, {
            method: 'POST',
            headers,
            json: { taskId: Number(reference), pageable: { page: 0, size: 1000 } },
            idempotent: true,
          }),
        )
      if (response.status === 'REJECT') return result('rejected', 'n11 içerik işini reddetti.')
      if (response.status === 'PROCESSED') {
        const line = array(record(response.skus).content)
          .map(record)
          .find((item) => text(item.itemCode) === text(plan.source.preserve.stockCode))
        if (line?.status === 'SUCCESS')
          return result('applied', 'n11 açıklama güncellemesini doğruladı.')
        if (line)
          return result(
            'rejected',
            array(line.reasons).map(text).join(' · ') || 'n11 açıklamayı reddetti.',
          )
      }
      return result('pending', 'n11 açıklama güncellemesi işleniyor.')
    }
    if (reference && provider === 'pttavm') {
      try {
        if (
          !(await new PttAvmApi(this.http).tracking(
            context,
            reference,
            text(plan.source.preserve.barcode),
          ))
        )
          return result('pending', 'PttAVM içerik işi işleniyor.')
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'BATCH_FAILED')
          return result('rejected', error.message)
        throw error
      }
    }
    if (reference && provider === 'ciceksepeti') {
      const { base, headers } = this.api(context),
        response = record(
          await this.http.request(
            `${base}/Products/batch-status/${encodeURIComponent(reference)}`,
            { headers },
          ),
        ),
        items = array(response.items).map(record),
        sku = text(plan.source.preserve.stockCode),
        item = items.find(
          (item) => text(item.stockCode) === sku || text(record(item.request).stockCode) === sku,
        )
      if (item && ['Failed', 'Rejected'].includes(text(item.status)))
        return result('rejected', 'Çiçeksepeti içerik güncellemesini reddetti.')
      if (!item || ['Pending', 'Processing'].includes(text(item.status)))
        return result('pending', 'Çiçeksepeti içerik güncellemesi işleniyor.')
    }
    const actual = await this.read(context, listing)
    if (actual.key !== plan.source.key)
      throw new ProviderError('CONTENT_IDENTITY_CHANGED', 'İlanın uzak içerik kimliği değişti.')
    if (
      contentMatches(actual, plan.changes, contentDefinitions[listing.channel]?.imageSlots) &&
      !(provider === 'toptantr' && actual.preserve.approved === false)
    )
      return result('applied', 'Güncellenen içerik sağlayıcı kaydından doğrulandı.')
    return result('pending', 'İçerik değişikliğinin onayı/yansıması bekleniyor.')
  }
}
