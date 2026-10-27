import type { AppState, Invoice, InvoiceInput, Command, CommandResult } from './types'
import { manualOrderLines } from './orders'
import { exchangeRate } from './money'
import {
  allocateOrderStock,
  salesWarehouseIds,
  aggregateStockAllocations,
} from './stock-allocation'
import { moveStock, warehouses } from './inventory'
import {
  invoiceSource,
  invoiceTryTotal,
  invoicePayment,
  nextInvoiceNumber,
  invoiceAmountDue,
} from './invoice-source'
import { invoiceCategoryUsage } from './invoice-categories'
import { invoiceManualSourceKey, manualInvoiceUrl } from './invoice-document'
import { orderCurrencyTotal } from './order-currency'

export function invoiceInputDocument(
  state: AppState,
  input: InvoiceInput,
  id: () => string,
  previous?: Invoice['document'],
) {
  if (!state.customers.some((customer) => customer.id === input.customerId))
    throw new Error('Faturanın müşterisini seçin.')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) ||
    !Number.isFinite(Date.parse(input.issueDate)) ||
    (input.dueDate && input.dueDate < input.issueDate)
  )
    throw new Error('Düzenleme ve vade tarihlerini kontrol edin.')
  const currency = input.currency,
    source = input.rateSource ?? 'TCMB',
    tcmb = exchangeRate(state.exchangeRates, currency, state.ecommerce?.exchangeRateType)
  const rate = currency === 'TRY' ? '100000000' : source === 'manual' ? input.exchangeRate : tcmb
  if (!rate || !/^\d{1,20}$/.test(rate) || BigInt(rate) <= 0n || BigInt(rate) > 1000000000000000n)
    throw new Error('Fatura döviz kurunu kontrol edin.')
  if (currency !== 'TRY' && source === 'TCMB' && input.expectedExchangeRate !== rate)
    throw new Error('TCMB kuru değişti. Güncel kuru ve fatura karşılığını kontrol edin.')
  const lines = manualOrderLines(state, input.items, input.warehouseId, id, {
    currency,
    includesVat: false,
    rate,
    preservedLines: previous?.lines,
  })
  if (typeof lines === 'string') throw new Error(lines)
  lines.forEach((line, index) => {
    line.invoiceNetPrice = input.items[index].unitPrice
    line.invoiceNetDiscount = input.items[index].discount
  })
  const customer = state.customers.find((customer) => customer.id === input.customerId)!
  const billing =
    input.billingAddress ??
    (previous?.customerId === input.customerId
      ? previous.billingAddress
      : {
          name: customer.company || customer.name,
          address: customer.address,
          city: customer.city,
          district: customer.district,
          phone: customer.phone,
          taxId: customer.taxId,
          taxOffice: customer.taxOffice,
          country: customer.country,
        })
  const total = lines.reduce(
      (sum, line) => sum + (line.lineTotalOverride ?? line.quantity * line.unitPrice),
      0,
    ),
    native = lines.reduce(
      (sum, line) =>
        sum +
        (currency === 'TRY'
          ? (line.lineTotalOverride ?? line.quantity * line.unitPrice)
          : (line.currencyTotal ?? NaN)),
      0,
    )
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(native) ||
    total <= 0 ||
    native <= 0 ||
    (input.expectedTotal !== undefined && input.expectedTotal !== native) ||
    (input.expectedTryTotal !== undefined && input.expectedTryTotal !== total)
  )
    throw new Error('Fatura toplamı değişti veya geçersiz. Tutarları tekrar kontrol edin.')
  const ids = salesWarehouseIds(state, input.warehouseId),
    stockAllocations = allocateOrderStock(state, lines, ids)
  return {
    customerId: input.customerId,
    billingAddress: billing,
    sourceNumber: input.sourceNumber?.trim() || undefined,
    lines,
    currency,
    warehouseIds: ids,
    stockAllocations,
    ...(currency !== 'TRY'
      ? {
          currencyRate: {
            value: rate,
            date: source === 'manual' ? input.issueDate : state.exchangeRates!.date,
            type: state.ecommerce?.exchangeRateType ?? 'forexSelling',
            source,
          },
        }
      : {}),
  }
}
type InvoiceCommand = Extract<Command, { type: `invoice.${string}` }>
export function executeInvoiceCommand(
  original: AppState,
  command: InvoiceCommand,
  now: string,
  id: () => string,
): { state: AppState; result: CommandResult } {
  const state = structuredClone(original),
    fail = (message: string) => ({ state: original, result: { ok: false, message } }),
    done = (message: string, invoice: Invoice) => ({
      state,
      result: { ok: true, message, id: invoice.id, entityVersion: invoice.version ?? 0 },
    })
  if (command.type === 'invoice.category.save') {
    const old = state.invoiceCategories?.find((category) => category.id === command.id),
      name = command.name.trim()
    if ((old?.version ?? 0) !== command.expectedVersion)
      return fail('Fatura kategorisi değişti. Güncel listeyi açın.')
    if (
      !name ||
      name.length > 160 ||
      state.invoiceCategories?.some(
        (category) =>
          category.id !== command.id &&
          category.name.trim().toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'),
      )
    )
      return fail('Kategori adı dolu ve benzersiz olmalı.')
    const next = { id: command.id, name, active: command.active, version: (old?.version ?? 0) + 1 }
    state.invoiceCategories = [
      ...(state.invoiceCategories ?? []).filter((category) => category.id !== command.id),
      next,
    ]
    return {
      state,
      result: {
        ok: true,
        id: command.id,
        message: 'Fatura kategorisi kaydedildi.',
        entityVersion: next.version,
      },
    }
  }
  if (command.type === 'invoice.category.delete') {
    const category = state.invoiceCategories?.find((category) => category.id === command.id)
    if (!category || (category.version ?? 0) !== command.expectedVersion)
      return fail('Fatura kategorisi değişti veya silinmiş.')
    const usage = invoiceCategoryUsage(state, command.id)
    if (usage !== command.expectedUsage || usage > 0)
      return fail('Faturası bulunan kategori silinemez; pasife alabilirsiniz.')
    state.invoiceCategories = state.invoiceCategories!.filter(
      (category) => category.id !== command.id,
    )
    return { state, result: { ok: true, id: command.id, message: 'Fatura kategorisi silindi.' } }
  }
  if (command.type === 'invoice.pay.bulk') {
    if (
      !command.items.length ||
      command.items.length > 100 ||
      new Set(command.items.map((item) => item.id)).size !== command.items.length
    )
      return fail('Toplu tahsilat için benzersiz fatura kayıtları seçin.')
    if (!Number.isSafeInteger(command.items.reduce((sum, item) => sum + item.expectedTotal, 0)))
      return fail('Toplu tahsilat toplamı sınırın dışında.')
    let next = state
    for (const item of command.items) {
      const invoice = next.invoices.find((invoice) => invoice.id === item.id)
      if (!invoice || (invoice.version ?? 0) !== item.expectedVersion)
        return fail('Seçilen faturalar değişti. Güncel kayıtları yeniden seçin.')
      const outcome = executeInvoiceCommand(
        next,
        {
          type: 'invoice.pay',
          id: item.id,
          expectedTotal: item.expectedTotal,
          expectedPaymentId: item.expectedPaymentId,
          payment: command.payment,
        },
        now,
        id,
      )
      if (!outcome.result.ok) return fail(`${invoice.number}: ${outcome.result.message}`)
      next = outcome.state
    }
    return {
      state: next,
      result: {
        ok: true,
        message: `${command.items.length} fatura ödendi işaretlendi; yalnız kalan tahsilatlar kasaya yazıldı.`,
      },
    }
  }
  let invoice = state.invoices.find((invoice) => invoice.id === command.id)
  const event = (invoice: Invoice, label: string) => {
    invoice.events = [...(invoice.events ?? []), { id: id(), at: now, label }]
    invoice.updatedAt = now
    invoice.version = (invoice.version ?? 0) + 1
  }
  const stock = (invoice: Invoice, direction: 1 | -1) => {
    for (const allocation of invoice.document!.stockAllocations)
      moveStock(
        state,
        allocation.variantId,
        allocation.warehouseId,
        direction * allocation.quantity,
        'adjustment',
        `${invoice.number} · bağımsız fatura ${direction < 0 ? 'stok çıkışı' : 'stok dönüşü'}`,
        now,
        id,
      )
  }
  const protectedRecord = (invoice: Invoice) =>
    invoice.manualDocument ||
    invoice.externalId ||
    invoice.status === 'issued' ||
    invoice.uncertainJobId ||
    ['queued', 'processing'].includes(invoice.status)
  if (command.type === 'invoice.document.link') {
    if (
      !invoice ||
      (invoice.version ?? 0) !== command.expectedVersion ||
      invoiceManualSourceKey(state, invoice) !== command.expectedSource
    )
      return fail('Fatura veya sipariş kaynağı değişti. Güncel bilgileri kontrol edin.')
    const source = invoiceSource(state, invoice),
      url = manualInvoiceUrl(command.url),
      number = command.number?.trim()
    if (
      invoice.manualDocument ||
      protectedRecord(invoice) ||
      invoice.connectionId ||
      invoice.documentId ||
      invoice.url ||
      invoice.status === 'cancelled'
    )
      return fail('Sağlayıcıya bağlanmış veya kapalı belgeye ikinci bir dış fatura bağlanamaz.')
    if (invoice.localOnly || source?.invoicePreference === 'draft')
      return fail('Yalnız iç kayıt seçili. Önce faturanın resmileştirme tercihini değiştirin.')
    if (
      !source ||
      source.syncError ||
      ['cancelled', 'returned'].includes(source.status) ||
      state.returns?.some(
        (record) => record.source === 'order' && record.saleId === invoice!.orderId,
      )
    )
      return fail('Kapalı veya uzlaştırma bekleyen kayda belge bağlanamaz.')
    if (!url || (number && number.length > 64))
      return fail(
        'Genel erişimli HTTPS fatura linki ve en fazla 64 karakterlik belge numarası girin.',
      )
    invoice.manualDocument = {
      url,
      number: number || undefined,
      linkedAt: now,
      previousStatus: invoice.status === 'failed' ? 'failed' : 'draft',
    }
    invoice.url = url
    invoice.documentNumber = number || undefined
    invoice.status = 'issued'
    delete invoice.error
    event(
      invoice,
      'Dışarıda kesilmiş fatura elle bağlandı; yeni fatura, stok veya tahsilat oluşturulmadı.',
    )
    return done('Dış fatura bağlantısı kaydedildi.', invoice)
  }
  if (command.type === 'invoice.document.unlink') {
    if (
      !invoice ||
      (invoice.version ?? 0) !== command.expectedVersion ||
      !invoice.manualDocument ||
      invoice.status !== 'issued' ||
      invoice.externalId ||
      invoice.connectionId ||
      invoice.uncertainJobId
    )
      return fail('Elle bağlanan belge değişti veya bağlantısı kaldırılamaz.')
    invoice.status = invoice.manualDocument.previousStatus
    delete invoice.manualDocument
    delete invoice.url
    delete invoice.documentNumber
    event(invoice, 'Dış belge bağlantısı kaldırıldı; dışarıda kesilen resmî belge iptal edilmedi.')
    return done('Yalnız dış belge bağlantısı kaldırıldı.', invoice)
  }
  if (command.type === 'invoice.category.set') {
    if (!invoice || (invoice.version ?? 0) !== command.expectedVersion)
      return fail('Fatura değişti. Güncel kaydı açın.')
    if (
      protectedRecord(invoice) ||
      invoice.status === 'cancelled' ||
      invoicePayment(state, invoice).paid
    )
      return fail(
        'Ödenmiş veya sağlayıcıya aktarılmış faturanın kategorisi buradan değiştirilemez.',
      )
    const category = command.categoryId
      ? state.invoiceCategories?.find((category) => category.id === command.categoryId)
      : undefined
    if (
      command.categoryId &&
      (!category || (!category.active && invoice.categoryId !== category.id))
    )
      return fail('Etkin bir fatura kategorisi seçin.')
    invoice.categoryId = category?.id
    invoice.categoryName = category?.name
    event(invoice, 'Fatura kategorisi güncellendi.')
    return done('Fatura kategorisi kaydedildi.', invoice)
  }
  if (command.type === 'invoice.create' || command.type === 'invoice.edit') {
    const input = command.input
    const category = input.categoryId
      ? state.invoiceCategories?.find((category) => category.id === input.categoryId)
      : undefined
    if (
      input.categoryId &&
      (!category || (!category.active && invoice?.categoryId !== category.id))
    )
      return fail('Etkin bir fatura kategorisi seçin.')
    if (command.type === 'invoice.create' && invoice)
      return fail('Bu fatura kimliği zaten kullanılıyor. Güncel kaydı açın.')
    if (command.type === 'invoice.edit') {
      if (!invoice?.document || invoice.orderId)
        return fail('Sipariş kaynaklı faturanın kalemleri sipariş akışından yönetilir.')
      if ((invoice.version ?? 0) !== command.expectedVersion)
        return fail('Fatura değişti. Güncel kaydı açın.')
      if (state.cash.some((entry) => !entry.transferId && entry.reference === invoice!.id))
        return fail(
          'Faturaya bağlı kısmi tahsilat var. Düzenlemeden önce ilgili kasa kaydını uzlaştırın.',
        )
      if (
        protectedRecord(invoice) ||
        invoicePayment(state, invoice).paid ||
        invoice.status === 'cancelled'
      )
        return fail('Ödenmiş, iptal veya sağlayıcıya aktarılmış fatura düzenlenemez.')
    }
    const number = input.number?.trim() || invoice?.number || nextInvoiceNumber(state)
    if (state.invoices.some((other) => other.id !== command.id && other.number === number))
      return fail('Fatura numarası başka bir belgede kullanılıyor.')
    const snapshot = invoice ? structuredClone(invoice) : undefined
    if (invoice) stock(invoice, 1)
    let document: NonNullable<Invoice['document']>
    try {
      document = invoiceInputDocument(state, input, id, snapshot?.document)
    } catch (error) {
      return fail((error as Error).message)
    }
    if (snapshot) {
      const costs = new Map(
        snapshot
          .document!.lines.filter((line) => line.kind !== 'free')
          .map((line) => [line.variantId, line]),
      )
      document.lines = document.lines.map((line) => {
        const old = costs.get(line.variantId)
        return old
          ? {
              ...line,
              unitCost: old.unitCost,
              costKnown: old.costKnown,
              bundleComponents: old.bundleComponents,
              catalogCurrency: old.catalogCurrency,
              catalogExchangeRate: old.catalogExchangeRate,
              exchangeRateDate: old.exchangeRateDate,
            }
          : line
      })
      try {
        document.stockAllocations = allocateOrderStock(
          state,
          document.lines,
          document.warehouseIds,
          undefined,
          false,
          aggregateStockAllocations(snapshot.document!.stockAllocations),
        )
      } catch (error) {
        return fail((error as Error).message)
      }
    }
    invoice = {
      ...invoice,
      id: command.id,
      number,
      document,
      createdAt: invoice?.createdAt ?? now,
      issueDate: input.issueDate,
      dueDate: input.dueDate || undefined,
      title: input.title.trim(),
      note: input.note.trim(),
      categoryId: category?.id,
      categoryName: category?.name,
      tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
      status: 'draft',
      localOnly: input.localOnly,
    }
    state.invoices = [invoice, ...state.invoices.filter((other) => other.id !== command.id)]
    try {
      stock(invoice, -1)
    } catch (error) {
      return fail((error as Error).message)
    }
    event(
      invoice,
      snapshot
        ? 'Fatura bilgileri ve stok farkları güncellendi.'
        : 'Bağımsız fatura oluşturuldu; katalog kalemleri stoktan düşüldü.',
    )
    if (input.payment) {
      if (
        !warehouses(state).some(
          (warehouse) => warehouse.id === input.payment!.warehouseId && warehouse.active,
        ) ||
        !Number.isFinite(Date.parse(input.payment.at))
      )
        return fail('Ödeme deposunu ve tarihini kontrol edin.')
      const cashId = id()
      state.cash.unshift({
        id: cashId,
        amount: invoiceTryTotal(state, invoice),
        kind: 'in',
        method: input.payment.method,
        reference: invoice.id,
        description: `${invoice.number} · fatura tahsilatı`,
        customerId: document.customerId,
        warehouseId: input.payment.warehouseId,
        createdAt: input.payment.at,
      })
      invoice.paymentCashId = cashId
      event(invoice, 'Fatura tahsilatı kasaya kaydedildi.')
    }
    return done('Fatura kaydedildi.', invoice)
  }
  if (!invoice) return fail('Fatura bulunamadı.')
  if (command.type === 'invoice.pay') {
    if (invoicePayment(state, invoice).paid || invoice.status === 'cancelled')
      return fail('Bu fatura ödenmiş veya iptal edilmiş.')
    if (
      invoiceAmountDue(state, invoice) !== command.expectedTotal ||
      invoice.paymentCashId !== command.expectedPaymentId
    )
      return fail('Fatura tutarı veya tahsilat değişti. Güncel kaydı açın.')
    if (
      !warehouses(state).some(
        (warehouse) => warehouse.id === command.payment.warehouseId && warehouse.active,
      ) ||
      !Number.isFinite(Date.parse(command.payment.at))
    )
      return fail('Ödeme deposunu ve tarihini kontrol edin.')
    const source = invoiceSource(state, invoice)!,
      cashId = id()
    if (!source || source.syncError || ['cancelled', 'returned'].includes(source.status))
      return fail('İptal/iade edilmiş kaydın tahsilatı bu işlemle alınamaz.')
    if (
      invoice.orderId &&
      state.returns?.some(
        (record) => record.source === 'order' && record.saleId === invoice!.orderId,
      )
    )
      return fail('İade kayıtları olan siparişin fatura tutarını önce uzlaştırın.')
    if (command.expectedTotal === 0) {
      const existing = state.cash.find(
        (entry) =>
          entry.kind === 'in' &&
          !entry.transferId &&
          (entry.reference === invoice!.id ||
            (invoice!.orderId && entry.reference === invoice!.orderId)),
      )
      if (!existing) return fail('Önceki tahsilat kaydı doğrulanamadı.')
      invoice.paymentCashId = existing.id
      if (invoice.orderId) state.orders.find((order) => order.id === invoice!.orderId)!.paid = true
      event(
        invoice,
        'Mevcut tahsilat doğrulandı; ikinci kasa girişi oluşturulmadan ödendi işaretlendi.',
      )
      return done('Fatura önceki tahsilatıyla ödendi işaretlendi.', invoice)
    }
    state.cash.unshift({
      id: cashId,
      amount: command.expectedTotal,
      kind: 'in',
      method: command.payment.method,
      reference: invoice.orderId ?? invoice.id,
      description: `${invoice.number} · fatura tahsilatı`,
      customerId: source.customerId,
      warehouseId: command.payment.warehouseId,
      createdAt: command.payment.at,
    })
    invoice.paymentCashId = cashId
    if (invoice.orderId) state.orders.find((order) => order.id === invoice!.orderId)!.paid = true
    event(invoice, 'Fatura tahsilatı kasaya kaydedildi.')
    return done('Fatura ödendi olarak kaydedildi.', invoice)
  }
  if (command.type === 'invoice.unpay') {
    const payment = invoicePayment(state, invoice)
    if (!payment.paid || !payment.cash || payment.cash.id !== command.expectedPaymentId)
      return fail('Bağlı ödeme değişti veya bulunamadı. Güncel kaydı açın.')
    if (state.settlementMatches?.some((match) => match.cashEntryId === payment.cash!.id))
      return fail('Önce hakedişin banka eşlemesini kaldırın.')
    if (
      invoice.orderId &&
      state.returns?.some(
        (record) =>
          record.source === 'order' && record.saleId === invoice!.orderId && record.refund > 0,
      )
    )
      return fail('Geri ödemeli iade bulunan siparişin tahsilatı geri alınamaz.')
    state.cash = state.cash.filter((entry) => entry.id !== payment.cash!.id)
    delete invoice.paymentCashId
    if (invoice.orderId) state.orders.find((order) => order.id === invoice!.orderId)!.paid = false
    event(invoice, 'Bağlı kasa tahsilatı geri alındı; fatura ödeme bekliyor.')
    return done('Fatura ödemesi geri alındı.', invoice)
  }
  if (!invoice.document || invoice.orderId)
    return fail('Sipariş kaynaklı belgenin iptal/geri alma işlemi siparişten yürütülür.')
  if ((invoice.version ?? 0) !== command.expectedVersion)
    return fail('Fatura değişti. Güncel kaydı açın.')
  const manualLocalLifecycle =
    !!invoice.manualDocument &&
    ['invoice.cancel', 'invoice.restore'].includes(command.type) &&
    !invoice.externalId &&
    !invoice.connectionId &&
    !invoice.uncertainJobId &&
    !['queued', 'processing'].includes(invoice.status)
  if (
    (protectedRecord(invoice) && !manualLocalLifecycle) ||
    invoicePayment(state, invoice).paid ||
    (command.type === 'invoice.delete' && invoice.manualDocument)
  )
    return fail('Sağlayıcıya aktarılmış veya ödenmiş belge bu yerel işlemle değiştirilemez.')
  if (
    command.type === 'invoice.delete' &&
    state.cash.some((entry) => !entry.transferId && entry.reference === invoice!.id)
  )
    return fail('Faturaya bağlı tahsilat kaydı var. Silmeden önce ilgili kasa kaydını uzlaştırın.')
  if (command.type === 'invoice.restore') {
    if (invoice.status !== 'cancelled') return fail('Yalnız iptal edilmiş fatura geri alınabilir.')
    try {
      invoice.document.stockAllocations = allocateOrderStock(
        state,
        invoice.document.lines,
        invoice.document.warehouseIds,
      )
      stock(invoice, -1)
    } catch (error) {
      return fail((error as Error).message)
    }
    invoice.status = invoice.manualDocument ? 'issued' : 'draft'
    event(invoice, 'Fatura geri alındı; kayıtlı kalemlerin stok çıkışı yeniden uygulandı.')
    return done('Fatura geri alındı.', invoice)
  }
  if (invoice.status !== 'cancelled')
    try {
      stock(invoice, 1)
    } catch (error) {
      return fail((error as Error).message)
    }
  if (command.type === 'invoice.delete') {
    state.invoices = state.invoices.filter((other) => other.id !== invoice!.id)
    return done('Bağımsız fatura silindi; uygulanmış stok çıkışı geri alındı.', invoice)
  }
  invoice.status = 'cancelled'
  event(
    invoice,
    invoice.manualDocument
      ? 'Yerel fatura iptal edildi; stok geri yazıldı. Dışarıda kesilen resmî belge iptal edilmedi.'
      : 'Yerel fatura iptal edildi; kayıtlı stok çıkışı geri alındı.',
  )
  return done('Yerel fatura iptal edildi.', invoice)
}

export function invoiceNativeTotal(state: AppState, invoice: Invoice) {
  const source = invoiceSource(state, invoice)
  return source ? orderCurrencyTotal(source) : NaN
}
