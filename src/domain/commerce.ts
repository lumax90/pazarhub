import type { AppState, CommandResult, CommerceCommand, SalesReturn } from './types'
import { findVariant, lineTotal, orderTotal } from './selectors'
import { MAIN_WAREHOUSE, moveStock, stockAt, warehouses, warehouseReserved } from './inventory'
import { lineStockParts, validateAffectedBundles } from './bundles'
import { bindProductDefinitions } from './definitions'
import { stockReasons } from './inventory-base'
import { listingPricing, validateMarginRule } from './margins'
import { fromTry } from './money'
import { returnedOrderAllocations } from './stock-allocation'

export function executeCommerceCommand(
  original: AppState,
  command: CommerceCommand,
  now: string,
  id: () => string,
): { state: AppState; result: CommandResult } {
  const state = structuredClone(original)
  const fail = (message: string) => ({ state: original, result: { ok: false, message } })
  const ok = (message: string, recordId?: string) => ({
    state,
    result: { ok: true, message, id: recordId },
  })
  const money = (value: number) =>
    Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000
  const quantity = (value: number) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000
  const validWarehouse = (warehouseId: string) =>
    warehouses(state).some((w) => w.id === warehouseId && w.active)
  switch (command.type) {
    case 'stock.thresholds': {
      const found = findVariant(state, command.variantId)
      if (!found) return fail('Stok kodu bulunamadı.')
      const before = found.variant.lowStockByWarehouse ?? {}
      if (
        Object.keys(before).length !== Object.keys(command.expected).length ||
        Object.entries(before).some(([id, value]) => command.expected[id] !== value)
      )
        return fail('Kritik seviyeler değişti. Güncel kaydı açın.')
      if (
        Object.entries(command.thresholds).some(
          ([id, value]) =>
            !warehouses(state).some((warehouse) => warehouse.id === id) || !quantity(value),
        )
      )
        return fail('Depo ve kritik seviyeleri kontrol edin.')
      found.variant.lowStockByWarehouse = { ...command.thresholds }
      return ok('Depo kritik seviyeleri kaydedildi.', command.variantId)
    }
    case 'warehouse.save': {
      if (!command.warehouse.name.trim()) return fail('Depo adı gerekli.')
      const all = warehouses(state)
      const old = all.find((warehouse) => warehouse.id === command.warehouse.id)
      if (
        command.warehouse.version !== undefined &&
        command.warehouse.version !== (old?.version ?? 0)
      )
        return fail('Depo başka bir işlemle değişti. Güncel kaydı açın.')
      const code = command.warehouse.code?.trim() || old?.code || command.warehouse.id
      if (
        !/^[A-Za-z0-9_-]{1,40}$/.test(code) ||
        all.some(
          (warehouse) =>
            warehouse.id !== command.warehouse.id &&
            (warehouse.code || warehouse.id).toLowerCase() === code.toLowerCase(),
        )
      )
        return fail('Depo kodu benzersiz olmalı; harf, rakam, - ve _ kullanılabilir.')
      if (command.warehouse.id === MAIN_WAREHOUSE && code !== (old?.code || MAIN_WAREHOUSE))
        return fail('Merkez depo kodu değiştirilemez.')
      if (command.warehouse.id === MAIN_WAREHOUSE && !command.warehouse.active)
        return fail('Merkez depo etkin kalmalı.')
      if (
        !command.warehouse.active &&
        state.invoices.some(
          (invoice) =>
            invoice.status !== 'cancelled' &&
            invoice.document?.warehouseIds.includes(command.warehouse.id),
        )
      )
        return fail(
          'Bağımsız faturanın stok kaynağı olan depo kapatılamaz; önce fatura kaydını kontrol edin.',
        )
      if (
        !command.warehouse.active &&
        state.ecommerce?.stockScope === 'selected' &&
        state.ecommerce.warehouseIds?.includes(command.warehouse.id)
      )
        return fail('Depoyu önce e-ticaret depo seçiminden çıkarın.')
      if (
        !command.warehouse.active &&
        state.products.some((product) =>
          product.variants.some((variant) => stockAt(variant, command.warehouse.id) !== 0),
        )
      )
        return fail('Stok bulunan depo kapatılamaz.')
      if (
        !command.warehouse.active &&
        (state.stockCounts?.some(
          (count) => count.warehouseId === command.warehouse.id && count.status === 'open',
        ) ||
          state.orders.some(
            (order) =>
              (order.warehouseId === command.warehouse.id ||
                order.warehouseIds?.includes(command.warehouse.id)) &&
              !order.historical &&
              !order.inventoryApplied &&
              !['cancelled', 'returned'].includes(order.status),
          ))
      )
        return fail('Açık sayım veya bekleyen sipariş bulunan depo kapatılamaz.')
      const saved = {
        ...old,
        ...command.warehouse,
        code,
        name: command.warehouse.name.trim(),
        version: (old?.version ?? 0) + 1,
      }
      state.warehouses = all.some((w) => w.id === saved.id)
        ? all.map((w) => (w.id === saved.id ? saved : w))
        : [...all, saved]
      return ok('Depo kaydedildi.', command.warehouse.id)
    }
    case 'warehouse.delete': {
      const warehouse = warehouses(state).find((warehouse) => warehouse.id === command.id)
      if (!warehouse || (warehouse.version ?? 0) !== command.version)
        return fail('Depo değişti veya bulunamadı.')
      if (warehouse.id === MAIN_WAREHOUSE) return fail('Merkez depo silinemez.')
      if (state.invoices.some((invoice) => invoice.document?.warehouseIds.includes(warehouse.id)))
        return fail('Depo bağımsız faturanın stok geçmişinde kullanılıyor.')
      if (
        state.ecommerce?.stockScope === 'selected' &&
        state.ecommerce.warehouseIds?.includes(warehouse.id)
      )
        return fail('Depo e-ticaret ayarlarında kullanılıyor.')
      if (
        state.products.some((product) =>
          product.variants.some((variant) => stockAt(variant, warehouse.id) !== 0),
        ) ||
        state.orders.some(
          (order) =>
            order.warehouseId === warehouse.id || order.warehouseIds?.includes(warehouse.id),
        ) ||
        state.retailSales.some((sale) => sale.warehouseId === warehouse.id) ||
        state.movements.some((movement) => movement.warehouseId === warehouse.id) ||
        state.stockCounts?.some((count) => count.warehouseId === warehouse.id)
      )
        return fail('Stok veya hareket kaydı bulunan depo silinemez; pasife alabilirsiniz.')
      state.warehouses = warehouses(state).filter((item) => item.id !== warehouse.id)
      for (const product of state.products)
        for (const variant of product.variants) {
          if (variant.stockByWarehouse) delete variant.stockByWarehouse[warehouse.id]
          if (variant.lowStockByWarehouse) delete variant.lowStockByWarehouse[warehouse.id]
        }
      return ok('Depo kaldırıldı.', warehouse.id)
    }
    case 'stock.record': {
      const found = findVariant(state, command.variantId)
      const reason = stockReasons[command.direction]?.find((reason) => reason.id === command.reason)
      if (
        !found ||
        found.product.bundle ||
        !validWarehouse(command.warehouseId) ||
        !reason ||
        !quantity(command.quantity) ||
        command.quantity < 1
      )
        return fail('Fiziksel ürün, aktif depo, miktar ve sebep seçin.')
      if (stockAt(found.variant, command.warehouseId) !== command.expectedQuantity)
        return fail('Depo bakiyesi değişti. Güncel miktarla işlemi yeniden açın.')
      const difference = command.quantity * (command.direction === 'in' ? 1 : -1)
      const balance = stockAt(found.variant, command.warehouseId) + difference
      if (
        !Number.isSafeInteger(balance) ||
        Math.abs(balance) > 100000000 ||
        (!state.ecommerce?.allowNegativeStock &&
          balance < warehouseReserved(state, command.variantId, command.warehouseId))
      )
        return fail('Yeni bakiye sıfırın veya siparişlere ayrılan miktarın altına inemez.')
      const movement = moveStock(
        state,
        command.variantId,
        command.warehouseId,
        difference,
        command.direction === 'in' ? 'entry' : 'exit',
        `${reason.label}${command.note.trim() ? ` · ${command.note.trim()}` : ''}`,
        now,
        id,
      )
      if (movement) movement.reason = reason.label
      return ok('Stok hareketi kaydedildi.', movement?.id)
    }
    case 'stock.transfer': {
      const found = findVariant(state, command.variantId)
      if (
        !found ||
        found.product.bundle ||
        !validWarehouse(command.from) ||
        !validWarehouse(command.to) ||
        command.from === command.to
      )
        return fail('Ürün, kaynak ve hedef depoyu kontrol edin.')
      if (!quantity(command.quantity) || command.quantity < 1 || !command.note.trim())
        return fail('Pozitif miktar ve açıklama gerekli.')
      if (
        !state.ecommerce?.allowNegativeStock &&
        stockAt(found.variant, command.from) -
          warehouseReserved(state, command.variantId, command.from) <
          command.quantity
      )
        return fail('Kaynak depoda yeterli satılabilir stok yok.')
      const reference = `Transfer · ${command.note.trim()}`
      const transferId = id()
      const outgoing = moveStock(
        state,
        command.variantId,
        command.from,
        -command.quantity,
        'transfer',
        reference,
        now,
        id,
      )
      const incoming = moveStock(
        state,
        command.variantId,
        command.to,
        command.quantity,
        'transfer',
        reference,
        now,
        id,
      )
      if (outgoing) outgoing.transferId = transferId
      if (incoming) incoming.transferId = transferId
      state.stockTransfers = [
        {
          id: transferId,
          variantId: command.variantId,
          from: command.from,
          to: command.to,
          quantity: command.quantity,
          note: command.note.trim(),
          createdAt: now,
        },
        ...(state.stockTransfers ?? []),
      ]
      return ok('Transfer iki deponun hareket defterine işlendi.', transferId)
    }
    case 'stock.count.create': {
      if (state.stockCounts?.some((count) => count.id === command.id))
        return ok('Sayım zaten oluşturulmuş.', command.id)
      if (
        !validWarehouse(command.warehouseId) ||
        !command.name.trim() ||
        !command.variantIds.length
      )
        return fail('Sayım adı, depo ve ürünler gerekli.')
      const baseline: Record<string, number> = {}
      for (const variantId of new Set(command.variantIds)) {
        const found = findVariant(state, variantId)
        if (!found || found.product.bundle)
          return fail('Sayım için fiziksel stok kodu seçin; paket stoğu içerikten hesaplanır.')
        baseline[variantId] = stockAt(found.variant, command.warehouseId)
      }
      state.stockCounts = [
        {
          id: command.id,
          name: command.name,
          warehouseId: command.warehouseId,
          status: 'open',
          baseline,
          counts: { ...baseline },
          createdAt: now,
        },
        ...(state.stockCounts ?? []),
      ]
      return ok('Sayım açıldı. Tamamlanana kadar stok değişmez.', command.id)
    }
    case 'stock.count.complete': {
      const count = state.stockCounts?.find((item) => item.id === command.id)
      if (!count) return fail('Sayım bulunamadı.')
      if (count.status === 'completed') return ok('Sayım zaten tamamlanmış.', count.id)
      if (!validWarehouse(count.warehouseId)) return fail('Sayımın deposu aktif olmalı.')
      if (Object.keys(command.counts).length !== Object.keys(count.baseline).length)
        return fail('Tüm sayım satırlarını doldurun.')
      for (const [variantId, baseline] of Object.entries(count.baseline)) {
        const found = findVariant(state, variantId),
          next = command.counts[variantId]
        if (!found || stockAt(found.variant, count.warehouseId) !== baseline)
          return fail('Sayım açıldıktan sonra stok değişti. Güncel stokla yeni sayım açın.')
        if (
          !Number.isSafeInteger(next) ||
          Math.abs(next) > 100000000 ||
          (!state.ecommerce?.allowNegativeStock &&
            next < warehouseReserved(state, variantId, count.warehouseId))
        )
          return fail('Sayılan miktar geçersiz veya rezerve stoktan düşük.')
      }
      for (const [variantId, baseline] of Object.entries(count.baseline))
        moveStock(
          state,
          variantId,
          count.warehouseId,
          command.counts[variantId] - baseline,
          'count',
          count.name,
          now,
          id,
        )
      count.counts = command.counts
      count.status = 'completed'
      count.completedAt = now
      return ok('Sayım farkları stok defterine işlendi.', count.id)
    }
    case 'sale.return': {
      if (state.returns?.some((r) => r.id === command.id))
        return ok('İade zaten kaydedilmiş.', command.id)
      const sale =
        command.source === 'retail'
          ? state.retailSales.find((s) => s.id === command.saleId)
          : state.orders.find((s) => s.id === command.saleId)
      if (!sale || !command.items.length || !command.note.trim())
        return fail('Satış, iade kalemi ve açıklama gerekli.')
      if ('status' in sale && !['shipped', 'delivered', 'returned'].includes(sale.status))
        return fail('Yalnız sevk edilmiş siparişe iade girilebilir.')
      if ('returnedAt' in sale && sale.returnedAt)
        return fail('Siparişin tam iadesi daha önce işlendi.')
      if (
        command.items.some(
          (entry, index) =>
            command.items.findIndex((other) => other.lineIndex === entry.lineIndex) !== index,
        )
      )
        return fail('Aynı satır bir kez seçilmeli.')
      const previous =
        state.returns?.filter((r) => r.source === command.source && r.saleId === command.saleId) ??
        []
      const items: SalesReturn['items'] = []
      for (const entry of command.items) {
        const line = sale.lines[entry.lineIndex]
        const returned = previous
          .flatMap((r) => r.items)
          .filter((item) => item.lineIndex === entry.lineIndex)
          .reduce((sum, item) => sum + item.quantity, 0)
        if (
          !line ||
          !quantity(entry.quantity) ||
          entry.quantity < 1 ||
          entry.quantity + returned > line.quantity
        )
          return fail('İade miktarı satılan / kalan miktarı aşamaz.')
        if (
          entry.restock &&
          (line.kind === 'free' ||
            !findVariant(state, line.variantId) ||
            ('status' in sale && (sale.historical || !sale.inventoryApplied)))
        )
          return fail('Eşleşmeyen, geçmiş veya stok çıkışı işlenmemiş satışın stoğu artırılamaz.')
        if (entry.restock) {
          try {
            lineStockParts(state, { ...line, quantity: entry.quantity }, true)
            if ('status' in sale)
              returnedOrderAllocations(state, sale, entry.lineIndex, returned, entry.quantity)
          } catch (error) {
            return fail((error as Error).message)
          }
        }
        const amount =
          Math.round((lineTotal(line) * (returned + entry.quantity)) / line.quantity) -
          Math.round((lineTotal(line) * returned) / line.quantity)
        items.push({ ...entry, amount })
      }
      const total = items.reduce((sum, item) => sum + item.amount, 0)
      const paid =
        'paid' in sale ? (sale.paid ? orderTotal(sale) : 0) : (sale.paidAmount ?? sale.total)
      const availableRefund = Math.max(0, paid - previous.reduce((sum, r) => sum + r.refund, 0))
      const refund = command.refund ? Math.min(total, availableRefund) : 0
      for (const entry of items)
        if (entry.restock)
          for (const part of 'status' in sale
            ? returnedOrderAllocations(
                state,
                sale,
                entry.lineIndex,
                previous
                  .flatMap((record) => record.items)
                  .filter((item) => item.lineIndex === entry.lineIndex)
                  .reduce((sum, item) => sum + item.quantity, 0),
                entry.quantity,
              )
            : lineStockParts(
                state,
                { ...sale.lines[entry.lineIndex], quantity: entry.quantity },
                true,
              ).map((part) => ({ ...part, warehouseId: sale.warehouseId ?? MAIN_WAREHOUSE })))
            moveStock(
              state,
              part.variantId,
              part.warehouseId,
              part.quantity,
              'return',
              `${sale.number} · ${command.note}`,
              now,
              id,
            )
      state.returns = [
        {
          id: command.id,
          source: command.source,
          saleId: command.saleId,
          items,
          refund,
          note: command.note,
          createdAt: now,
        },
        ...(state.returns ?? []),
      ]
      if (refund)
        state.cash.unshift({
          id: id(),
          kind: 'out',
          amount: refund,
          method: command.method,
          reference: sale.id,
          description: `${sale.number} · iade geri ödemesi`,
          createdAt: now,
          customerId: sale.customerId,
        })
      return ok('İade, seçilen stok dönüşü ve geri ödeme kaydedildi.', command.id)
    }
    case 'cash.record': {
      if (state.cash.some((entry) => entry.id === command.id))
        return ok('Kasa kaydı zaten var.', command.id)
      if (!money(command.amount) || !command.description.trim())
        return fail('Geçerli tutar ve açıklama gerekli.')
      if (command.customerId && !state.customers.some((c) => c.id === command.customerId))
        return fail('Müşteri bulunamadı.')
      state.cash.unshift({
        id: command.id,
        amount: command.amount,
        kind: command.kind,
        method: command.method,
        description: command.description,
        customerId: command.customerId,
        reference: command.id,
        createdAt: now,
      })
      return ok('Kasa hareketi kaydedildi.', command.id)
    }
    case 'cash.transfer': {
      if (state.cash.some((entry) => entry.transferId === command.id))
        return ok('Virman zaten kaydedilmiş.', command.id)
      if (command.from === command.to || !money(command.amount) || !command.description.trim())
        return fail('Farklı hesaplar, tutar ve açıklama gerekli.')
      for (const [kind, method] of [
        ['out', command.from],
        ['in', command.to],
      ] as const)
        state.cash.unshift({
          id: id(),
          kind,
          method,
          amount: command.amount,
          description: command.description,
          reference: command.id,
          transferId: command.id,
          createdAt: now,
        })
      return ok('Hesaplar arası virman kaydedildi.', command.id)
    }
    case 'customer.entry': {
      if (state.customerEntries?.some((entry) => entry.id === command.id))
        return ok('Cari kayıt zaten var.', command.id)
      if (
        !state.customers.some((c) => c.id === command.customerId) ||
        !money(command.amount) ||
        !command.description.trim()
      )
        return fail('Müşteri, tutar ve açıklama gerekli.')
      state.customerEntries = [
        {
          id: command.id,
          customerId: command.customerId,
          kind: command.kind,
          amount: command.amount,
          description: command.description,
          createdAt: now,
        },
        ...(state.customerEntries ?? []),
      ]
      return ok('Cari fiş kaydedildi.', command.id)
    }
    case 'expense.create': {
      const expense = command.expense
      if (state.expenses?.some((e) => e.id === expense.id))
        return ok('Gider zaten kaydedilmiş.', expense.id)
      if (!money(expense.amount) || !expense.supplier.trim() || !expense.description.trim())
        return fail('Tedarikçi, açıklama ve tutar gerekli.')
      if (expense.purchaseLines?.length) {
        const warehouse = command.warehouseId ?? MAIN_WAREHOUSE
        if (
          !validWarehouse(warehouse) ||
          expense.purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) !==
            expense.amount
        )
          return fail('Alış satırları toplamı veya depo geçersiz.')
        for (const line of expense.purchaseLines) {
          const found = findVariant(state, line.variantId)
          if (
            !found ||
            found.product.bundle ||
            !quantity(line.quantity) ||
            line.quantity < 1 ||
            !money(line.unitCost)
          )
            return fail('Alış satırlarını kontrol edin.')
          const catalogCost = fromTry(
            line.unitCost,
            found.product.currency,
            state.exchangeRates,
            state.ecommerce?.exchangeRateType,
          )
          if (!Number.isSafeInteger(catalogCost)) return fail('Alış için ürün döviz kuru gerekli.')
          found.variant.cost = Math.round(
            (found.variant.cost * Math.max(0, found.variant.stock) + line.quantity * catalogCost) /
              (Math.max(0, found.variant.stock) + line.quantity),
          )
          found.product.version = (found.product.version ?? 0) + 1
          moveStock(
            state,
            line.variantId,
            warehouse,
            line.quantity,
            'purchase',
            expense.number,
            now,
            id,
          )
        }
      }
      const derivedError = validateAffectedBundles(
        state,
        expense.purchaseLines?.map((line) => line.variantId) ?? [],
      )
      if (derivedError) return fail(derivedError)
      state.expenses = [{ ...expense, createdAt: now }, ...(state.expenses ?? [])]
      if (expense.paid)
        state.cash.unshift({
          id: id(),
          kind: 'out',
          method: expense.method,
          amount: expense.amount,
          description: `${expense.supplier} · ${expense.description}`,
          reference: expense.id,
          createdAt: now,
        })
      return ok('Gider belgesi kaydedildi.', expense.id)
    }
    case 'expense.pay': {
      const expense = state.expenses?.find((e) => e.id === command.id)
      if (!expense) return fail('Gider bulunamadı.')
      if (expense.paid) return ok('Gider zaten ödenmiş.', expense.id)
      state.cash.unshift({
        id: id(),
        kind: 'out',
        method: expense.method,
        amount: expense.amount,
        description: `${expense.supplier} · ${expense.description}`,
        reference: expense.id,
        createdAt: now,
      })
      expense.paid = true
      return ok('Gider ödemesi kasaya işlendi.', expense.id)
    }
    case 'margin.save': {
      const rule = command.rule
      const error = validateMarginRule(state, rule)
      if (error) return fail(error)
      const old = state.marginRules?.find((item) => item.id === rule.id)
      state.marginRules = (state.marginRules ?? [])
        .filter((r) => r.id !== rule.id)
        .concat({ ...rule, version: (old?.version ?? 0) + 1 })
      return ok('Mağaza marj kuralı kaydedildi.', rule.id)
    }
    case 'margin.delete': {
      const rule = state.marginRules?.find((item) => item.id === command.id)
      if (!rule || (rule.version ?? 0) !== command.version)
        return fail('Marj kuralı değişti veya bulunamadı.')
      state.marginRules = state.marginRules?.filter((item) => item.id !== command.id)
      return ok('Marj kuralı kaldırıldı.', command.id)
    }
    case 'margin.settings': {
      const settings = command.settings,
        old = state.marginSettings?.find((item) => item.storeId === settings.storeId)
      if (
        !state.connections.some((item) => item.id === settings.storeId) ||
        (old?.version ?? 0) !== settings.version
      )
        return fail('Mağaza veya fiyat şablonu değişti. Güncel kaydı açın.')
      if (
        !Number.isInteger(settings.listMarkupBps) ||
        settings.listMarkupBps < 0 ||
        settings.listMarkupBps > 100000
      )
        return fail('Liste fiyatı artış oranını kontrol edin.')
      for (const listing of state.listings.filter(
        (listing) => listing.storeId === settings.storeId,
      )) {
        if (!settings.enabled && old?.enabled !== false) {
          const price = listingPricing(state, listing)
          if (Number.isSafeInteger(price.price))
            listing.marginPriceSnapshot = {
              price: price.price,
              listPrice: Number.isSafeInteger(price.listPrice) ? price.listPrice : undefined,
            }
        } else if (settings.enabled) delete listing.marginPriceSnapshot
      }
      state.marginSettings = (state.marginSettings ?? [])
        .filter((item) => item.storeId !== settings.storeId)
        .concat({ ...settings, version: settings.version + 1 })
      for (const rule of state.marginRules ?? [])
        if (rule.storeId === settings.storeId) {
          rule.formula = settings.formula
          rule.version = (rule.version ?? 0) + 1
        }
      return ok('Mağaza fiyat şablonu kaydedildi.', settings.storeId)
    }
    case 'margin.apply': {
      if (!state.connections.some((item) => item.id === command.storeId))
        return fail('Mağaza bulunamadı.')
      const settings = state.marginSettings?.find((item) => item.storeId === command.storeId)
      if (settings?.enabled === false) {
        const force = {
          ...state,
          marginSettings: state.marginSettings?.map((item) =>
            item.storeId === command.storeId ? { ...item, enabled: true } : item,
          ),
        }
        for (const listing of state.listings.filter((item) => item.storeId === command.storeId)) {
          const price = listingPricing(force, listing)
          if (!Number.isSafeInteger(price.price) || !Number.isSafeInteger(price.listPrice))
            return fail(
              'Mağaza fiyatları için ürün fiyatını, liste fiyatını ve döviz kurlarını kontrol edin.',
            )
          listing.marginPriceSnapshot = { price: price.price, listPrice: price.listPrice }
        }
      }
      return ok(
        'Güncel mağaza fiyatları hesaplandı; etkin gönderim tercihi varsa eşitleme sıraya alındı.',
        command.storeId,
      )
    }
    case 'product.bulk': {
      if (!command.ids.length || !Object.keys(command.change).length)
        return fail('Ürün ve uygulanacak değişiklik seçin.')
      if (
        command.change.pricePercent !== undefined &&
        (!Number.isFinite(command.change.pricePercent) ||
          command.change.pricePercent <= -100 ||
          command.change.pricePercent > 1000)
      )
        return fail('Fiyat değişim oranını kontrol edin.')
      for (const productId of new Set(command.ids)) {
        const product = state.products.find((p) => p.id === productId)
        if (!product || (product.version ?? 0) !== command.expectedVersions[productId])
          return fail('Önizlemeden sonra bir ürün değişti. Güncel önizlemeyi tekrar açın.')
        const previous = structuredClone(product)
        if (command.change.category !== undefined) {
          if (!command.change.category.trim()) return fail('Kategori boş olamaz.')
          product.category = command.change.category
          delete product.categoryId
        }
        if (command.change.brand !== undefined) {
          product.brand = command.change.brand
          delete product.brandId
        }
        if (command.change.active !== undefined) product.active = command.change.active
        if (command.change.pricePercent !== undefined)
          if (product.bundle?.priceMode === 'linked')
            return fail(
              'Bağlı paket fiyatı bileşenlerden hesaplanır; bileşen fiyatlarını düzenleyin.',
            )
        if (command.change.pricePercent !== undefined)
          for (const variant of product.variants) {
            variant.price = Math.round(variant.price * (1 + command.change.pricePercent / 100))
            if (!money(variant.price)) return fail('Hesaplanan fiyat sınırların dışında.')
          }
        const definitionError = bindProductDefinitions(state, product, previous, id)
        if (definitionError) return fail(definitionError)
        product.version = (product.version ?? 0) + 1
        product.updatedAt = now
      }
      const derivedError = validateAffectedBundles(
        state,
        state.products
          .filter((product) => command.ids.includes(product.id))
          .flatMap((product) => product.variants.map((variant) => variant.id)),
      )
      if (derivedError) return fail(derivedError)
      return ok(`${command.ids.length} ürün atomik olarak güncellendi.`)
    }
  }
}
