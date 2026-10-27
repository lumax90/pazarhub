import { findVariant, orderTotal, discountLines } from './selectors'
import { MAIN_WAREHOUSE, moveStock, stockAt, warehouses, warehouseReserved } from './inventory'
import { executeCommerceCommand } from './commerce'
import { executeInvoiceCommand } from './invoices'
import { currencySnapshot, exchangeRate, toTry } from './money'
import { orderCurrencies, orderLineCurrencyTotal } from './order-currency'
import { salesWarehouseIds, allocateOrderStock, reserveOrderWarehouses } from './stock-allocation'
import { orderPrintKey } from './orders'
import {
  bindProductDefinitions,
  deleteDefinition,
  moveDefinition,
  saveDefinition,
} from './definitions'
import {
  snapshotBundle,
  stockDemand,
  validateBundle,
  validateAffectedBundles,
  validateStockDemand,
  variantCost,
  variantCostKnown,
  variantPrice,
  withBundleDescription,
} from './bundles'
import {
  ensureOrderInvoice,
  ensureAutomaticOrderInvoice,
  inventoryLines,
  manualOrderLines,
  orderContentKey,
  orderLineKey,
  orderDueDate,
} from './orders'
import {
  invoiceLineMetadata,
  MAX_PRODUCT_VARIANTS,
  mergeProductPatch,
  validateProductStructure,
} from './products'
import type {
  AppState,
  BusinessProfile,
  Command,
  CommandResult,
  OrderLine,
  OrderStatus,
  StockMovement,
  CommerceCommand,
  StockAllocation,
} from './types'

export const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['approved', 'cancelled'],
  approved: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
}

export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  shipped: 'Kargoya verildi',
  delivered: 'Teslim edildi',
  cancelled: 'İptal edildi',
  returned: 'İade edildi',
}

type Outcome = { state: AppState; result: CommandResult }
const fail = (state: AppState, message: string): Outcome => ({
  state,
  result: { ok: false, message },
})

function aggregate(items: { variantId: string; quantity: number }[]) {
  const map = new Map<string, number>()
  for (const item of items) map.set(item.variantId, (map.get(item.variantId) ?? 0) + item.quantity)
  return [...map].map(([variantId, quantity]) => ({ variantId, quantity }))
}

function makeLines(
  state: AppState,
  items: { variantId: string; quantity: number; bundleVersion?: number }[],
  warehouseId = MAIN_WAREHOUSE,
): OrderLine[] | string {
  if (!items.length) return 'En az bir ürün ekleyin.'
  if (!warehouses(state).some((w) => w.id === warehouseId && w.active))
    return 'Etkin bir depo seçin.'
  if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0))
    return 'Miktar pozitif bir tam sayı olmalı.'
  for (const item of items) {
    const found = findVariant(state, item.variantId)
    if (
      found?.product.bundle &&
      item.bundleVersion !== undefined &&
      item.bundleVersion !== (found.product.version ?? 0)
    )
      return 'Paket kartı değişti. İçeriğini kontrol edip sepet satırını yeniden ekleyin.'
  }
  const lines: OrderLine[] = []
  for (const item of aggregate(items)) {
    const found = findVariant(state, item.variantId)
    if (!found || !found.product.active) return 'Ürün bulunamadı veya satışa kapalı.'
    if (
      !Number.isSafeInteger(variantPrice(state, item.variantId)) ||
      !Number.isSafeInteger(variantCost(state, item.variantId))
    )
      return 'Ürün dövizi için güncel kur gerekli.'
    lines.push({
      ...item,
      unitPrice: variantPrice(state, item.variantId),
      unitCost: variantCost(state, item.variantId),
      taxRate: found.product.taxRate,
      title: found.product.name,
      costKnown: variantCostKnown(state, item.variantId),
      ...(found.product.bundle ? { bundleComponents: snapshotBundle(state, item.variantId) } : {}),
      ...invoiceLineMetadata(found.product, found.variant),
      ...currencySnapshot(
        found.product.currency,
        state.exchangeRates,
        state.ecommerce?.exchangeRateType,
      ),
    })
  }
  const stockError = validateStockDemand(state, lines, warehouseId)
  if (stockError) return stockError
  return lines
}

function changeStock(
  state: AppState,
  lines: OrderLine[],
  direction: 1 | -1,
  type: StockMovement['type'],
  reference: string,
  now: string,
  id: () => string,
  warehouseId = MAIN_WAREHOUSE,
  allocations?: StockAllocation[],
) {
  for (const line of allocations ??
    stockDemand(state, lines, true).map((line) => ({ ...line, warehouseId })))
    moveStock(
      state,
      line.variantId,
      line.warehouseId,
      line.quantity * direction,
      type,
      reference,
      now,
      id,
    )
}

/** Shared transaction rules. The API executes these while holding the workspace database lock. */
export function executeCommand(
  original: AppState,
  command: Command,
  now = new Date().toISOString(),
  id: () => string = () => crypto.randomUUID(),
): Outcome {
  const state: AppState = structuredClone(original)
  if (command.type.startsWith('invoice.'))
    return executeInvoiceCommand(
      original,
      command as Extract<Command, { type: `invoice.${string}` }>,
      now,
      id,
    )
  switch (command.type) {
    case 'ecommerce.settings': {
      const settings = command.settings
      const ids = salesWarehouseIds({ ...state, ecommerce: settings })
      if (
        !ids.length ||
        ids.some(
          (id) => !warehouses(state).some((warehouse) => warehouse.id === id && warehouse.active),
        )
      )
        return fail(original, 'Etkin e-ticaret depolarını seçin.')
      if (settings.version !== (state.ecommerce?.version ?? 0))
        return fail(original, 'E-ticaret ayarları değişti. Güncel kaydı açın.')
      if (
        settings.criticalStock > settings.lowStock ||
        !exchangeRate(state.exchangeRates, settings.defaultCurrency, settings.exchangeRateType)
      )
        return fail(original, 'Stok eşiklerini ve varsayılan dövizin kurunu kontrol edin.')
      state.ecommerce = { ...settings, version: settings.version + 1 }
      return { state, result: { ok: true, message: 'E-ticaret ayarları kaydedildi.' } }
    }
    case 'business.update': {
      const business = Object.fromEntries(
        Object.entries(command.business)
          .map(([key, value]) => [key, value?.trim()])
          .filter(([, value]) => value),
      ) as BusinessProfile
      if (business.taxId && !/^(\d{10}|\d{11})$/.test(business.taxId))
        return fail(original, 'Vergi numarası 10, T.C. kimlik numarası 11 haneli olmalı.')
      if (business.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email))
        return fail(original, 'Geçerli bir e-posta adresi girin.')
      state.business = business
      return { state, result: { ok: true, message: 'İşletme bilgileri kaydedildi.' } }
    }
    case 'definition.move': {
      const error = moveDefinition(state, command, now)
      return error
        ? fail(original, error)
        : { state, result: { ok: true, message: 'Tanım sırası kaydedildi.', id: command.id } }
    }
    case 'definition.save': {
      const error = saveDefinition(state, structuredClone(command.definition), now)
      return error
        ? fail(original, error)
        : { state, result: { ok: true, message: 'Tanım kaydedildi.', id: command.definition.id } }
    }
    case 'definition.delete':
    case 'definition.value.delete': {
      const error = deleteDefinition(
        state,
        command.id,
        command.version,
        command.expectedUsage,
        now,
        command.type === 'definition.value.delete' ? command.valueId : undefined,
      )
      return error
        ? fail(original, error)
        : { state, result: { ok: true, message: 'Tanım/değer kaldırıldı.', id: command.id } }
    }
    case 'order.filter.save': {
      const current = state.orderFilters?.find((filter) => filter.id === command.filter.id)
      if ((current?.version ?? 0) !== command.filter.version)
        return fail(original, 'Kayıtlı filtre değişti. Güncel listeyi yükleyin.')
      if (
        !command.filter.name.trim() ||
        (state.orderFilters ?? []).some(
          (filter) =>
            filter.id !== command.filter.id &&
            filter.name.toLocaleLowerCase('tr-TR') ===
              command.filter.name.trim().toLocaleLowerCase('tr-TR'),
        )
      )
        return fail(original, 'Filtre adı dolu ve benzersiz olmalı.')
      if (!current && (state.orderFilters?.length ?? 0) >= 50)
        return fail(original, 'En fazla 50 sipariş filtresi kaydedilebilir.')
      state.orderFilters = [
        ...(state.orderFilters ?? []).filter((filter) => filter.id !== command.filter.id),
        {
          ...command.filter,
          name: command.filter.name.trim(),
          version: (current?.version ?? 0) + 1,
        },
      ]
      return {
        state,
        result: { ok: true, message: 'Sipariş filtresi kaydedildi.', id: command.filter.id },
      }
    }
    case 'order.filter.delete': {
      const current = state.orderFilters?.find((filter) => filter.id === command.id)
      if (!current || current.version !== command.version)
        return fail(original, 'Kayıtlı filtre değişti. Güncel listeyi yükleyin.')
      state.orderFilters = state.orderFilters?.filter((filter) => filter.id !== command.id)
      return { state, result: { ok: true, message: 'Kayıtlı filtre kaldırıldı.' } }
    }
    case 'order.note.add': {
      const order = state.orders.find((order) => order.id === command.id)
      if (!order || !command.text.trim()) return fail(original, 'Sipariş ve not metni gerekli.')
      const previous = order.notes?.find((note) => note.id === command.noteId)
      if (previous)
        return previous.text === command.text.trim()
          ? {
              state: original,
              result: { ok: true, message: 'Not zaten kaydedilmiş.', id: order.id },
            }
          : fail(original, 'Bu not kimliği başka metinle kullanılmış.')
      if ((order.notes?.length ?? 0) >= 200)
        return fail(original, 'Sipariş başına en fazla 200 not eklenebilir.')
      order.notes = [
        ...(order.notes ?? []),
        { id: command.noteId, text: command.text.trim(), createdAt: now },
      ]
      return { state, result: { ok: true, message: 'Sipariş notu eklendi.', id: order.id } }
    }
    case 'order.prepare': {
      const order = state.orders.find((order) => order.id === command.id)
      if (!order || !['pending', 'approved'].includes(order.status))
        return fail(original, 'Hazırlık yalnız bekleyen veya onaylı siparişte değiştirilebilir.')
      if (order.syncError || orderContentKey(order) !== command.expectedContent)
        return fail(original, 'Sipariş kalemleri değişti. Güncel siparişi kontrol edin.')
      const keys = new Set(command.lineKeys)
      if (
        !keys.size ||
        [...keys].some(
          (key) => !order.lines.some((line, index) => orderLineKey(line, index) === key),
        )
      )
        return fail(original, 'Hazırlanacak sipariş satırlarını kontrol edin.')
      let changed = false
      order.lines.forEach((line, index) => {
        if (keys.has(orderLineKey(line, index)) && !!line.prepared !== command.ready) {
          line.prepared = command.ready
          changed = true
        }
      })
      if (changed)
        order.events.push({
          id: id(),
          label: `${keys.size} kalem ${command.ready ? 'hazır' : 'hazırlanacak'} olarak işaretlendi.`,
          at: now,
        })
      return { state, result: { ok: true, message: 'Sipariş hazırlığı kaydedildi.', id: order.id } }
    }
    case 'order.invoice': {
      const order = state.orders.find((order) => order.id === command.id)
      if (!order || ['cancelled', 'returned'].includes(order.status) || order.syncError)
        return fail(original, 'Bu sipariş için fatura taslağı oluşturulamaz.')
      const invoice = ensureOrderInvoice(state, order, now, id)
      return {
        state,
        result: { ok: true, message: 'Siparişin fatura taslağı hazır.', id: invoice.id },
      }
    }
    case 'order.print': {
      const order = state.orders.find((order) => order.id === command.id)
      if (!order) return fail(original, 'Sipariş bulunamadı.')
      if (orderPrintKey(order) !== command.expectedContent)
        return fail(original, 'Sipariş çıktısı değişti. Güncel çıktıyı açın.')
      if (
        order.printStatus?.printed === command.printed &&
        order.printStatus.contentKey === command.expectedContent
      )
        return {
          state: original,
          result: { ok: true, message: 'Yazdırma durumu zaten kayıtlı.', id: order.id },
        }
      order.printStatus = { printed: command.printed, contentKey: command.expectedContent, at: now }
      order.events.push({
        id: id(),
        at: now,
        label: command.printed
          ? 'Sipariş çıktısı yazdırıldı olarak işaretlendi.'
          : 'Siparişin yazdırıldı işareti kaldırıldı.',
      })
      return { state, result: { ok: true, message: 'Yazdırma durumu kaydedildi.', id: order.id } }
    }
    case 'order.tax': {
      const order = state.orders.find((order) => order.id === command.id)
      if (
        !order ||
        !['pending', 'approved'].includes(order.status) ||
        state.invoices.some((invoice) => invoice.orderId === order.id)
      )
        return fail(
          original,
          'Yalnız faturası olmayan ve kargoya verilmemiş siparişin KDV oranı değiştirilebilir.',
        )
      if (order.syncError || orderContentKey(order) !== command.expectedContent)
        return fail(original, 'Sipariş kalemleri değişti. Güncel siparişi kontrol edin.')
      if (!Number.isInteger(command.taxRate) || command.taxRate < 0 || command.taxRate > 100)
        return fail(original, 'KDV oranını kontrol edin.')
      order.lines.forEach((line) => {
        line.taxRate = command.taxRate
        line.taxKnown = true
      })
      order.events.push({
        id: id(),
        label: `Kalemlerin KDV oranı %${command.taxRate} olarak güncellendi.`,
        at: now,
      })
      return {
        state,
        result: { ok: true, message: 'Sipariş KDV oranları kaydedildi.', id: order.id },
      }
    }
    case 'order.invoice.preference': {
      const order = state.orders.find((order) => order.id === command.id)
      if (!order || ['cancelled', 'returned'].includes(order.status))
        return fail(original, 'Bu siparişin fatura tercihi değiştirilemez.')
      const invoice = state.invoices.find((invoice) => invoice.orderId === order.id)
      if (invoice?.status === 'issued')
        return fail(original, 'Resmileşmiş faturanın tercihi değiştirilemez.')
      if (command.preference === 'immediate' && !command.connectionId && !invoice?.connectionId)
        return fail(original, 'Hemen resmileştirme için Paraşüt hesabı seçin.')
      order.invoicePreference = command.preference
      if (command.preference === 'immediate') ensureOrderInvoice(state, order, now, id)
      return { state, result: { ok: true, message: 'Fatura tercihi kaydedildi.', id: order.id } }
    }
    case 'order.create': {
      const customer = state.customers.find((customer) => customer.id === command.input.customerId)
      if (!customer) return fail(original, 'Bir müşteri seçin.')
      const shippingAddress = command.input.shippingAddress ?? {
        name: customer.name,
        address: customer.address,
        city: customer.city,
        phone: customer.phone,
      }
      if (
        !shippingAddress.name.trim() ||
        !shippingAddress.address.trim() ||
        !shippingAddress.city.trim()
      )
        return fail(original, 'Teslimat adresini tamamlayın.')
      if (!Number.isSafeInteger(command.input.shipping) || command.input.shipping < 0)
        return fail(original, 'Kargo tutarını kontrol edin.')
      if (command.input.invoicePreference === 'immediate' && !command.input.invoiceConnectionId)
        return fail(original, 'Hemen resmileştirme için Paraşüt hesabı seçin.')
      const currency = command.input.currency ?? 'TRY',
        rate = exchangeRate(state.exchangeRates, currency, state.ecommerce?.exchangeRateType)
      if (!orderCurrencies.some((value) => value === currency) || !rate)
        return fail(original, 'Sipariş para birimini ve TCMB kurunu kontrol edin.')
      if (currency !== 'TRY' && command.input.expectedExchangeRate !== rate)
        return fail(
          original,
          'Sipariş döviz kuru değişti. Güncel kur ve tutarı kontrol ederek yeniden kaydedin.',
        )
      const lines = manualOrderLines(state, command.input.items, command.input.warehouseId, id, {
        currency,
        includesVat: command.input.priceInputIncludesVat,
      })
      if (typeof lines === 'string') return fail(original, lines)
      const shipping = toTry(
        command.input.shipping,
        currency,
        state.exchangeRates,
        state.ecommerce?.exchangeRateType,
      )
      const total = orderTotal({ lines, shipping })
      const foreignTotal =
        lines.reduce((sum, line) => sum + orderLineCurrencyTotal({ currency }, line), 0) +
        command.input.shipping
      if (
        (command.input.expectedTotal !== undefined &&
          command.input.expectedTotal !== foreignTotal) ||
        (command.input.expectedTryTotal !== undefined && command.input.expectedTryTotal !== total)
      )
        return fail(original, 'Sipariş tutarı değişti. Güncel fiyat ve kuru kontrol edin.')
      if (!Number.isSafeInteger(total) || (command.input.paid && total <= 0))
        return fail(original, 'Sipariş ve tahsilat toplamını kontrol edin.')
      const orderId = id()
      const number = `SP-${String(state.orders.length + 1001).padStart(6, '0')}`
      const due = orderDueDate(now, state.ecommerce?.dueDays ?? 1)
      state.orders.unshift({
        id: orderId,
        number,
        customerId: command.input.customerId,
        externalNumber: command.input.externalNumber?.trim() || undefined,
        paymentMethod:
          command.input.paymentMethod ??
          (command.input.channel === 'manual' ? 'transfer' : 'marketplace'),
        shippingAddress: { ...shippingAddress },
        channel: command.input.channel,
        storeId: state.connections.find(
          (connection) => connection.channel === command.input.channel && connection.active,
        )?.id,
        status: 'pending',
        createdAt: now,
        dueAt: due,
        lines,
        shipping,
        currency,
        ...(currency !== 'TRY'
          ? {
              currencyRate: {
                value: rate,
                date: state.exchangeRates!.date,
                type: state.ecommerce?.exchangeRateType ?? 'forexSelling',
              },
              currencyShipping: command.input.shipping,
            }
          : {}),
        priceInputIncludesVat: command.input.priceInputIncludesVat !== false,
        note: command.input.note.trim(),
        ...(command.input.internalNote?.trim()
          ? { notes: [{ id: id(), text: command.input.internalNote.trim(), createdAt: now }] }
          : {}),
        invoicePreference: command.input.invoicePreference ?? 'default',
        invoiceTiming: state.ecommerce?.invoiceTiming ?? 'on_approval',
        warehouseId: command.input.warehouseId ?? MAIN_WAREHOUSE,
        billingAddress: command.input.billingAddress ?? {
          name: customer.company || customer.name,
          address: customer.address,
          city: customer.city,
          district: customer.district,
          phone: customer.phone,
          taxId: customer.taxId,
          taxOffice: customer.taxOffice,
        },
        paid: !!command.input.paid,
        inventoryApplied: false,
        events: [{ id: id(), label: 'Sipariş oluşturuldu, ürünler rezerve edildi.', at: now }],
      })
      const created = state.orders[0]
      reserveOrderWarehouses(state, created, salesWarehouseIds(state, command.input.warehouseId))
      if (command.input.paid)
        state.cash.unshift({
          id: id(),
          amount: total,
          kind: 'in',
          description: `${number} · sipariş tahsilatı`,
          method: created.paymentMethod!,
          reference: orderId,
          customerId: created.customerId,
          createdAt: now,
        })
      if (command.input.invoicePreference === 'immediate')
        ensureOrderInvoice(state, created, now, id)
      else ensureAutomaticOrderInvoice(state, created, now, id)
      return { state, result: { ok: true, message: `${number} oluşturuldu.`, id: orderId } }
    }
    case 'order.transition': {
      const order = state.orders.find((item) => item.id === command.id)
      if (!order) return fail(original, 'Sipariş bulunamadı.')
      if (order.status === command.status)
        return {
          state: original,
          result: { ok: true, message: 'Sipariş zaten bu durumda.', id: order.id },
        }
      if (!transitions[order.status].includes(command.status))
        return fail(original, 'Bu durum değişikliği uygulanamaz.')
      if (command.status === 'shipped') {
        const carrier = command.shipment?.carrier.trim() || order.cargoProvider
        const tracking = command.shipment?.trackingNumber.trim() || order.trackingNumber
        if (!carrier || !tracking) return fail(original, 'Kargo firması ve takip numarasını girin.')
        order.cargoProvider = carrier
        order.trackingNumber = tracking
      }
      if (
        command.status === 'returned' &&
        state.returns?.some((r) => r.source === 'order' && r.saleId === order.id)
      )
        return fail(
          original,
          'Kısmi iade kaydı olan siparişin kalan miktarını İade Yönetimi ekranından işleyin.',
        )
      if (command.status === 'approved') {
        if (order.syncError) return fail(original, order.syncError)
        if (inventoryLines(order.lines).some((line) => !findVariant(state, line.variantId)))
          return fail(
            original,
            'Önce siparişin tüm ürün satırlarını yerel varyantlarla eşleştirin.',
          )
        let allocations: StockAllocation[] | undefined
        if (order.warehouseIds?.length)
          try {
            allocations = allocateOrderStock(state, order.lines, order.warehouseIds, order.id)
          } catch (error) {
            return fail(original, (error as Error).message)
          }
        const stockError = allocations
          ? null
          : validateStockDemand(state, order.lines, order.warehouseId ?? MAIN_WAREHOUSE, order.id)
        if (stockError) return fail(original, stockError)
        if (!order.inventoryApplied) {
          changeStock(
            state,
            order.lines,
            -1,
            'order',
            order.number,
            now,
            id,
            order.warehouseId,
            allocations,
          )
          if (allocations) order.stockAllocations = allocations
          order.inventoryApplied = true
        }
      }
      if (
        (command.status === 'cancelled' || command.status === 'returned') &&
        order.inventoryApplied &&
        (command.status !== 'returned' || command.restock !== false)
      ) {
        try {
          stockDemand(state, order.lines, true)
        } catch (error) {
          return fail(original, (error as Error).message)
        }
        changeStock(
          state,
          order.lines,
          1,
          'return',
          order.number,
          now,
          id,
          order.warehouseId,
          order.stockAllocations,
        )
        order.inventoryApplied = false
      }
      if ((command.status === 'cancelled' || command.status === 'returned') && order.paid) {
        state.cash.unshift({
          id: id(),
          amount: orderTotal(order),
          kind: 'out',
          description: `${order.number} · iade kaydı`,
          method: order.paymentMethod ?? (order.channel === 'manual' ? 'transfer' : 'marketplace'),
          reference: order.id,
          createdAt: now,
        })
        order.paid = false
      }
      order.status = command.status
      ensureAutomaticOrderInvoice(state, order, now, id)
      if (command.status === 'returned') order.returnedAt = now
      if ((command.status === 'cancelled' || command.status === 'returned') && order.invoiceId) {
        const invoice = state.invoices.find((item) => item.id === order.invoiceId)
        if (
          invoice &&
          !invoice.externalId &&
          ['draft', 'queued', 'failed'].includes(invoice.status)
        )
          invoice.status = 'cancelled'
      }
      order.events.push({
        id: id(),
        label: `${statusLabels[command.status]}${command.reason?.trim() ? ` · ${command.reason.trim()}` : ''}`,
        at: now,
      })
      return {
        state,
        result: {
          ok: true,
          message: `${order.number}: ${statusLabels[command.status].toLocaleLowerCase('tr-TR')}.`,
          id: order.id,
        },
      }
    }
    case 'order.pay': {
      const order = state.orders.find((item) => item.id === command.id)
      if (!order || order.status === 'cancelled' || order.status === 'returned')
        return fail(original, 'Bu siparişe tahsilat eklenemez.')
      if (order.paid)
        return { state: original, result: { ok: true, message: 'Tahsilat zaten kaydedilmiş.' } }
      if (!Number.isSafeInteger(orderTotal(order)) || orderTotal(order) <= 0)
        return fail(original, 'Tahsilat için pozitif sipariş tutarı gerekli.')
      state.cash.unshift({
        id: id(),
        amount: orderTotal(order),
        kind: 'in',
        description: `${order.number} · sipariş tahsilatı`,
        method:
          command.method ??
          order.paymentMethod ??
          (order.channel === 'manual' ? 'transfer' : 'marketplace'),
        reference: order.id,
        createdAt: now,
      })
      order.paid = true
      order.paymentMethod =
        command.method ??
        order.paymentMethod ??
        (order.channel === 'manual' ? 'transfer' : 'marketplace')
      order.events.push({ id: id(), label: 'Tahsilat kaydedildi.', at: now })
      return { state, result: { ok: true, message: 'Tahsilat kasa hareketlerine işlendi.' } }
    }
    case 'retail.sale': {
      if (
        command.input.customerId &&
        !state.customers.some((customer) => customer.id === command.input.customerId)
      )
        return fail(original, 'Müşteri bulunamadı.')
      const lines = makeLines(state, command.input.items, command.input.warehouseId)
      if (typeof lines === 'string') return fail(original, lines)
      const saleId = id()
      const number = `PS-${String(state.retailSales.length + 1).padStart(6, '0')}`
      const gross = orderTotal({ lines, shipping: 0 })
      const discount = command.input.discount ?? 0
      if (!Number.isSafeInteger(discount) || discount < 0 || discount >= gross)
        return fail(original, 'İndirim, satış toplamından küçük olmalı.')
      const discounted = discountLines(lines, discount)
      lines.splice(0, lines.length, ...discounted)
      const total = gross - discount
      if (command.input.expectedTotal !== undefined && command.input.expectedTotal !== total)
        return fail(
          original,
          'Sepet fiyatı veya döviz kuru değişti. Güncel toplamı kontrol edip tekrar tamamlayın.',
        )
      const payments = command.input.payments ?? [{ method: command.input.method, amount: total }]
      if (
        payments.some((p) => !Number.isSafeInteger(p.amount) || p.amount <= 0) ||
        payments.reduce((sum, p) => sum + p.amount, 0) > total
      )
        return fail(original, 'Tahsilat tutarları satış toplamını aşamaz.')
      const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0)
      if (paidAmount < total && !command.input.customerId)
        return fail(original, 'Veresiye veya kısmi tahsilat için müşteri seçin.')
      changeStock(state, lines, -1, 'retail', number, now, id, command.input.warehouseId)
      state.retailSales.unshift({
        id: saleId,
        number,
        customerId: command.input.customerId,
        lines,
        total,
        method: command.input.method,
        createdAt: now,
        warehouseId: command.input.warehouseId ?? MAIN_WAREHOUSE,
        paidAmount,
        payments,
        discount,
      })
      for (const payment of payments)
        state.cash.unshift({
          id: id(),
          amount: payment.amount,
          kind: 'in',
          description: `${number} · perakende satışı`,
          method: payment.method,
          reference: saleId,
          createdAt: now,
        })
      return {
        state,
        result: {
          ok: true,
          message: `${number} tamamlandı. Stok ve kasa güncellendi.`,
          id: saleId,
        },
      }
    }
    case 'stock.adjust': {
      const found = findVariant(state, command.variantId)
      if (!found) return fail(original, 'Varyant bulunamadı.')
      if (found.product.bundle)
        return fail(
          original,
          'Paket stoğu bileşenlerden hesaplanır; bileşenin stok kaydını düzenleyin.',
        )
      if (
        !Number.isInteger(command.quantity) ||
        Math.abs(command.quantity) > 100000000 ||
        (!state.ecommerce?.allowNegativeStock && command.quantity < 0)
      )
        return fail(original, 'Stok sıfır veya pozitif bir tam sayı olmalı.')
      const warehouseId = command.warehouseId ?? MAIN_WAREHOUSE
      if (!warehouses(state).some((w) => w.id === warehouseId && w.active))
        return fail(original, 'Etkin depo seçin.')
      if (
        command.expectedQuantity !== undefined &&
        stockAt(found.variant, warehouseId) !== command.expectedQuantity
      )
        return fail(
          original,
          'Stok bakiyesi değişti. Güncel miktarı açıp düzeltmeyi yeniden yapın.',
        )
      if (
        !state.ecommerce?.allowNegativeStock &&
        command.quantity < warehouseReserved(state, command.variantId, warehouseId)
      )
        return fail(original, 'Yeni stok, siparişlere ayrılan miktardan düşük olamaz.')
      if (!command.note.trim()) return fail(original, 'Düzeltmenin nedenini yazın.')
      const difference = command.quantity - stockAt(found.variant, warehouseId)
      moveStock(
        state,
        command.variantId,
        warehouseId,
        difference,
        'adjustment',
        command.note.trim(),
        now,
        id,
      )
      return { state, result: { ok: true, message: 'Stok düzeltmesi hareket defterine işlendi.' } }
    }
    case 'product.patch': {
      const current = state.products.find((product) => product.id === command.id)
      if (!current) return fail(original, 'Ürün bulunamadı.')
      if ((current.version ?? 0) !== command.expectedVersion)
        return fail(
          original,
          'Ürün başka bir işlemle değişti. Güncel kartı yükleyip tekrar kaydedin.',
        )
      const patches = command.patch.variants ?? []
      if (
        new Set(patches.map((v) => v.id)).size !== patches.length ||
        patches.some((v) => !current.variants.some((old) => old.id === v.id))
      )
        return fail(original, 'Düzenlenecek varyant kimlikleri bu ürüne ait ve benzersiz olmalı.')
      if (command.patch.newVariants?.some((v) => current.variants.some((old) => old.id === v.id)))
        return fail(original, 'Yeni varyant mevcut bir kimlikle eklenemez.')
      const product = mergeProductPatch(current, command.patch)
      product.version = (current.version ?? 0) + 1
      const result = executeCommand(state, { type: 'product.save', product }, now, id)
      return result.result.ok
        ? { state: result.state, result: { ...result.result, entityVersion: product.version } }
        : fail(original, result.result.message)
    }
    case 'product.save': {
      const product = structuredClone(command.product)
      if (!exchangeRate(state.exchangeRates, product.currency, state.ecommerce?.exchangeRateType))
        return fail(original, 'Ürün dövizi için TCMB kurlarını güncelleyin.')
      if (!product.name.trim() || !product.category.trim() || !product.variants.length)
        return fail(original, 'Ürün adı, kategori ve en az bir varyant gerekli.')
      const referenceError = bindProductDefinitions(
        state,
        product,
        state.products.find((p) => p.id === product.id),
        id,
      )
      if (referenceError) return fail(original, referenceError)
      if (product.variants.length > MAX_PRODUCT_VARIANTS)
        return fail(original, `Bir üründe en fazla ${MAX_PRODUCT_VARIANTS} varyant olabilir.`)
      const structureError = validateProductStructure(product)
      if (structureError) return fail(original, structureError)
      const bundleError = validateBundle(
        state,
        product,
        state.products.find((item) => item.id === product.id),
      )
      if (bundleError) return fail(original, bundleError)
      if (product.bundle) {
        product.description = withBundleDescription(state, product)
        if (product.description.length > 30000)
          return fail(original, 'Paket içeriği eklendiğinde açıklama 30.000 karakteri aşıyor.')
      }
      if (
        !Number.isFinite(product.taxRate) ||
        product.taxRate < 0 ||
        product.taxRate > 100 ||
        !Number.isInteger(product.lowStock) ||
        product.lowStock < 0
      )
        return fail(original, 'KDV oranını ve kritik stok miktarını kontrol edin.')
      const otherVariants = state.products
        .filter((item) => item.id !== product.id)
        .flatMap((item) => item.variants)
      const skus = new Set<string>()
      const barcodes = new Set<string>()
      const variantIds = new Set<string>()
      for (const variant of product.variants) {
        const oldVariant = state.products
          .find((item) => item.id === product.id)
          ?.variants.find((item) => item.id === variant.id)
        if (
          variant.stockByWarehouse &&
          (Object.entries(variant.stockByWarehouse).some(
            ([warehouse, q]) =>
              !warehouses(state).some((w) => w.id === warehouse) ||
              !Number.isInteger(q) ||
              (!state.ecommerce?.allowNegativeStock &&
                q < 0 &&
                (!oldVariant || stockAt(oldVariant, warehouse) !== q)),
          ) ||
            Object.values(variant.stockByWarehouse).reduce((sum, q) => sum + q, 0) !==
              variant.stock)
        )
          return fail(original, 'Depo bakiyeleri toplam stokla uyuşmalı.')
        if (
          !variant.id ||
          variantIds.has(variant.id) ||
          otherVariants.some((item) => item.id === variant.id)
        )
          return fail(original, 'Varyant kimlikleri benzersiz olmalı.')
        variantIds.add(variant.id)
        if (
          !variant.sku.trim() ||
          skus.has(variant.sku) ||
          otherVariants.some((item) => item.sku === variant.sku)
        )
          return fail(original, 'Stok kodları benzersiz olmalı.')
        if (
          variant.barcode &&
          (barcodes.has(variant.barcode) ||
            otherVariants.some((item) => item.barcode === variant.barcode))
        )
          return fail(original, 'Bu barkod başka bir varyantta kullanılıyor.')
        if (
          ![variant.price, variant.cost].every((value) => Number.isSafeInteger(value) && value >= 0)
        )
          return fail(original, 'Fiyatları kontrol edin.')
        if (
          !Number.isInteger(variant.stock) ||
          (!state.ecommerce?.allowNegativeStock &&
            variant.stock < 0 &&
            oldVariant?.stock !== variant.stock)
        )
          return fail(original, 'Stok miktarını kontrol edin.')
        skus.add(variant.sku)
        if (variant.barcode) barcodes.add(variant.barcode)
      }
      const index = state.products.findIndex((item) => item.id === product.id)
      if (index >= 0) {
        const previous = state.products[index]
        if (
          previous.variants.some(
            (variant) => !product.variants.some((next) => next.id === variant.id),
          )
        )
          return fail(original, 'Mevcut varyantlar bu formdan kaldırılamaz.')
        state.products[index] = {
          ...product,
          updatedAt: now,
          name: product.name.trim(),
          variants: product.variants.map((variant) => ({
            ...variant,
            stock: previous.variants.find((old) => old.id === variant.id)?.stock ?? variant.stock,
            lowStockByWarehouse: previous.variants.some((old) => old.id === variant.id)
              ? previous.variants.find((old) => old.id === variant.id)?.lowStockByWarehouse
              : variant.lowStockByWarehouse,
            stockByWarehouse: previous.variants.some((old) => old.id === variant.id)
              ? previous.variants.find((old) => old.id === variant.id)?.stockByWarehouse
              : variant.stockByWarehouse,
          })),
        }
        for (const variant of product.variants.filter(
          (variant) => !previous.variants.some((old) => old.id === variant.id),
        )) {
          for (const [warehouseId, quantity] of Object.entries(
            variant.stockByWarehouse ?? { [MAIN_WAREHOUSE]: variant.stock },
          ))
            if (quantity)
              state.movements.unshift({
                id: id(),
                variantId: variant.id,
                warehouseId,
                quantity,
                type: 'adjustment',
                reference: 'Yeni varyant açılış stoğu',
                createdAt: now,
                balance: quantity,
              })
        }
      } else {
        state.products.unshift({ ...product, name: product.name.trim(), updatedAt: now })
        for (const variant of product.variants) {
          for (const [warehouseId, quantity] of Object.entries(
            variant.stockByWarehouse ?? { [MAIN_WAREHOUSE]: variant.stock },
          ))
            if (quantity)
              state.movements.unshift({
                id: id(),
                variantId: variant.id,
                quantity,
                warehouseId,
                type: 'adjustment',
                reference: 'Açılış stoğu',
                createdAt: now,
                balance: quantity,
              })
        }
      }
      const derivedError = validateAffectedBundles(
        state,
        product.variants.map((variant) => variant.id),
      )
      if (derivedError) return fail(original, derivedError)
      return { state, result: { ok: true, message: 'Ürün bilgileri kaydedildi.', id: product.id } }
    }
    case 'customer.save': {
      if (!command.customer.name.trim()) return fail(original, 'Müşteri adı gerekli.')
      const index = state.customers.findIndex((item) => item.id === command.customer.id)
      if (index >= 0) state.customers[index] = command.customer
      else state.customers.unshift(command.customer)
      return {
        state,
        result: { ok: true, message: 'Müşteri kaydedildi.', id: command.customer.id },
      }
    }
    case 'listing.update': {
      const listing = state.listings.find((item) => item.id === command.id)
      if (!listing) return fail(original, 'İlan bulunamadı.')
      const product = state.products.find((item) => item.id === listing.productId)
      const variant = product?.variants.find((item) => item.id === listing.variantId)
      if (
        command.status === 'active' &&
        !state.connections.some(
          (connection) => connection.id === listing.storeId && connection.active,
        )
      )
        return fail(original, 'Önce mağaza bağlantısını etkinleştirin.')
      if (
        command.priceOverride !== undefined &&
        command.priceOverride !== null &&
        (!Number.isSafeInteger(command.priceOverride) || command.priceOverride <= 0)
      )
        return fail(original, 'İlan fiyatı sıfırdan büyük olmalı.')
      if (command.priceOverride !== undefined)
        listing.priceOverride = command.priceOverride ?? undefined
      if (command.listPriceOverride !== undefined) {
        if (
          command.listPriceOverride !== null &&
          (!Number.isSafeInteger(command.listPriceOverride) || command.listPriceOverride <= 0)
        )
          return fail(original, 'Liste fiyatı sıfırdan büyük olmalı.')
        listing.listPriceOverride = command.listPriceOverride ?? undefined
      }
      if (command.marginExcluded !== undefined) listing.marginExcluded = command.marginExcluded
      if (command.titleOverride !== undefined)
        listing.titleOverride = command.titleOverride?.trim() || undefined
      if (
        command.status === 'active' &&
        (!product?.active ||
          !product.category ||
          !variant?.barcode ||
          (listing.priceOverride ?? variantPrice(state, variant.id)) <= 0)
      )
        return fail(original, 'Ürünün kategori, barkod, fiyat ve aktiflik bilgilerini tamamlayın.')
      if (command.status) {
        listing.status = command.status
        listing.error = undefined
      }
      listing.updatedAt = now
      return {
        state,
        result: {
          ok: true,
          message: command.status
            ? 'Demo ilanının durumu güncellendi.'
            : 'Mağazaya özel ilan bilgileri kaydedildi.',
        },
      }
    }
    case 'connection.update':
      if (!command.connection.name.trim())
        return fail(original, 'Mağaza bağlantısına bir ad verin.')
      if (state.connections.some((item) => item.id === command.connection.id))
        state.connections = state.connections.map((item) =>
          item.id === command.connection.id ? command.connection : item,
        )
      else state.connections.push(command.connection)
      return { state, result: { ok: true, message: 'Demo bağlantı tercihi kaydedildi.' } }
    case 'preferences.update':
      if (!command.preferences.businessName.trim()) return fail(original, 'İşletme adı gerekli.')
      state.preferences = command.preferences
      return { state, result: { ok: true, message: 'Çalışma alanı tercihleri kaydedildi.' } }
  }
  return executeCommerceCommand(original, command as CommerceCommand, now, id)
}
