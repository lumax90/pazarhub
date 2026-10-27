import { randomUUID } from 'node:crypto'
import type { IntegrationOperation, RemoteOrder } from '../../src/domain/integrations'
import { ProviderError } from '../errors'
import { array, cents, integer, iso, pathPart, record, text } from './contracts'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import { ProviderHttp, requireCredential } from './http'
import { PttAvmApi } from './pttavm-api'
import { normalizePttAvmProducts } from './pttavm-catalog'
import { synchronizePttInventory } from './pttavm-stock'

export class PttAvmAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'catalog.pull',
    'orders.pull',
    'inventory.push',
    'invoice.link',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    if (context.settings.environment === 'sandbox')
      throw new ProviderError(
        'SANDBOX_UNAVAILABLE',
        'PttAVM için ayrı test adresi tanımlı değil; sağlayıcının test hesabını kullanın.',
      )
    const base = 'https://integration-api.pttavm.com/api/v1'
    const headers = {
      'Api-Key': requireCredential(context.credentials, 'apiKey'),
      'Access-Token': requireCredential(context.credentials, 'accessToken'),
      'X-Correlation-Id': randomUUID(),
    }
    if (operation === 'test' || operation === 'orders.pull') {
      const to = Number(payload.to ?? Date.now()),
        from = Number(payload.from ?? to - (operation === 'test' ? 60000 : 7 * 86400000))
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 40 * 86400000)
        throw new ProviderError(
          'INVALID_WINDOW',
          'PttAVM sipariş aralığı en fazla 40 gün olabilir.',
        )
      const query = new URLSearchParams({
        startDate: new Date(from).toISOString(),
        endDate: new Date(to).toISOString(),
        isActiveOrders: 'false',
      })
      const response = await this.http.request(`${base}/orders/search?${query}`, { headers })
      if (!Array.isArray(response))
        throw new ProviderError('INVALID_RESPONSE', 'PttAVM sipariş listesi okunamadı.')
      if (operation === 'test')
        return { message: 'PttAVM API anahtarı ve sipariş okuma erişimi doğrulandı.' }
      const orders = response
        .filter((item) =>
          array(record(item).siparisUrunler).some(
            (line) =>
              !['havale_onayi_bekleniyor', 'odeme_gecersiz', 'onay_surecinde'].includes(
                text(record(line).siparisDurumu),
              ),
          ),
        )
        .map(normalizePttAvmOrder)
      const merged = new Map<string, RemoteOrder>()
      for (const order of orders) {
        const previous = merged.get(order.externalId)
        if (previous) {
          for (const line of order.lines)
            if (!previous.lines.some((item) => item.externalId === line.externalId))
              previous.lines.push(line)
          previous.total =
            previous.lines.reduce(
              (sum, line) => sum + (line.total ?? line.quantity * line.unitPrice),
              0,
            ) + previous.shipping
        } else merged.set(order.externalId, order)
      }
      return { message: `${merged.size} PttAVM siparişi alındı.`, orders: [...merged.values()] }
    }
    if (operation === 'catalog.pull') {
      const page = integer(payload.page, 1),
        filter = integer(payload.filter)
      if (filter > 3) return { message: 'PttAVM katalog taraması tamamlandı.' }
      const query = new URLSearchParams({
        categoryId: '0',
        subCategoryId: '0',
        isActive: String(filter < 2),
        isInStock: String(filter % 2 === 0),
        merchantCategoryId: '0',
        searchPage: String(page),
      })
      const response = await this.http.request(`${base}/products/search?${query}`, { headers })
      if (!Array.isArray(response))
        throw new ProviderError('INVALID_RESPONSE', 'PttAVM katalog listesi okunamadı.')
      const signature = response.map((item) => text(record(item).urunId)).join('|')
      if (signature && signature === payload.previousPage)
        throw new ProviderError(
          'PAGINATION_NOT_ADVANCING',
          'PttAVM aynı katalog sayfasını döndürdü. Sayfalama sözleşmesi hesapla doğrulanmalı.',
        )
      const products = response.flatMap(normalizePttAvmProducts)
      const total = integer(record(response[0]).rowCount)
      const hasMore = response.length > 0 && (total === 0 || page * response.length < total)
      return {
        message: `${products.length} PttAVM ürünü okundu.`,
        products,
        nextPayload: hasMore
          ? { ...payload, page: page + 1, filter, previousPage: signature }
          : { page: 1, filter: filter + 1 },
        delaySeconds: 3,
      }
    }
    if (operation === 'inventory.push')
      return synchronizePttInventory(new PttAvmApi(this.http), context, payload)
    if (operation === 'invoice.link') {
      const order = context.state.orders.find(
          (item) => item.id === payload.orderId && item.storeId === context.connectionId,
        ),
        invoice = context.state.invoices.find((item) => item.id === order?.invoiceId)
      if (!order?.externalId || invoice?.status !== 'issued' || !invoice.url)
        throw new ProviderError('INVOICE_REQUIRED', 'Resmî PDF ve PttAVM sipariş kimliği gerekli.')
      const response = record(
        await this.http.request(`${base}/orders/${pathPart(order.externalId)}/invoice`, {
          method: 'POST',
          headers,
          json: {
            lineItemId: order.lines.map((line) => Number(line.externalId)),
            url: invoice.url,
          },
          idempotent: true,
        }),
      )
      if (response.success !== true)
        throw new ProviderError('INVOICE_REJECTED', 'PttAVM fatura bağlantısını kabul etmedi.')
      return { message: 'Fatura PttAVM sipariş kalemlerine iletildi.' }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu PttAVM işlemi kullanıma açık değil.')
  }
}
export function normalizePttAvmOrder(raw: unknown): RemoteOrder {
  const item = record(raw),
    rawLines = array(item.siparisUrunler).map(record)
  const lines = rawLines.map((line) => {
    const quantity = integer(line.toplamIslemAdedi),
      total = cents(line.kdvDahilToplamTutar)
    if (quantity < 1 || !Number.isFinite(total) || !text(line.lineItemId))
      throw new ProviderError('INVALID_LINE', 'PttAVM kalem miktarı veya tutarı eksik.')
    return {
      externalId: text(line.lineItemId),
      sku: text(line.variantBarkod) || text(line.urunBarkod) || text(item.urunKodu),
      barcode: text(line.variantBarkod) || text(line.urunBarkod),
      title: text(item.urunAdi) || text(line.urun),
      quantity,
      unitPrice: Math.round(total / quantity),
      total,
      taxRate: integer(line.kdvOrani),
      status:
        line.siparisDurumu === 'iptal'
          ? ('cancelled' as const)
          : ['iade', 'gondericisine_teslim_edildi'].includes(text(line.siparisDurumu))
            ? ('returned' as const)
            : line.siparisDurumu === 'tamamlandi'
              ? ('delivered' as const)
              : ['gonderilmiş', 'gonderilmis'].includes(text(line.siparisDurumu))
                ? ('shipped' as const)
                : ('pending' as const),
    }
  })
  if (!text(item.siparisNo) || !lines.length)
    throw new ProviderError('INVALID_ORDER', 'PttAVM siparişi eksik.')
  const statuses = rawLines.map((line) => text(line.siparisDurumu)),
    status = statuses.every((s) => s === 'iptal')
      ? 'cancelled'
      : statuses.every((s) => ['iade', 'gondericisine_teslim_edildi'].includes(s))
        ? 'returned'
        : statuses.every((s) => s === 'tamamlandi')
          ? 'delivered'
          : statuses.every((s) => ['gonderilmiş', 'gonderilmis', 'tamamlandi'].includes(s))
            ? 'shipped'
            : 'pending'
  const shipping = cents(item.kargoTutari ?? 0)
  return {
    externalId: text(item.siparisNo),
    number: text(item.siparisNo),
    createdAt: iso(item.islemTarihi),
    modifiedAt: iso(item.islemTarihi),
    status,
    normalizedStatus: status,
    requiresReconciliation:
      new Set(lines.map((line) => line.status)).size > 1 &&
      lines.some((line) => ['cancelled', 'returned'].includes(line.status))
        ? 'PttAVM siparişinde iptal/iade ve açık kalemler birlikte var; kalem uzlaştırması gerekli.'
        : undefined,
    total: lines.reduce((sum, line) => sum + line.total, 0) + shipping,
    shipping,
    recipient: {
      name: `${text(item.musteriAdi)} ${text(item.musteriSoyadi)}`.trim(),
      address: text(item.siparisAdresi),
      city: text(item.siparisIli),
      district: text(item.siparisIlce),
      phone: text(item.telefonNo),
      country: 'TR',
      email: text(item.eposta),
    },
    billing: {
      name:
        text(item.firmaUnvani) ||
        `${text(item.faturaMusteriAdi)} ${text(item.faturaMusteriSoyadi)}`.trim(),
      address: text(item.faturaAdresi),
      city: text(item.faturaIli),
      district: text(item.faturaIlce),
      phone: text(item.telefonNo),
      taxId: text(item.vergiNo) || text(item.tckn),
      taxOffice: text(item.vergiDaire),
    },
    lines,
    trackingNumber: text(item.kargoBarkod),
    cargoProvider: 'PTT Kargo',
  }
}
