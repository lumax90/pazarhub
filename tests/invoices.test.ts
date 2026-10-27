import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import type { InvoiceInput } from '../src/domain/types'
import { invoiceSource, invoiceTryTotal, invoicePayment } from '../src/domain/invoice-source'
import { invoiceNativeTotal } from '../src/domain/invoices'
import { customerBalance } from '../src/domain/selectors'
import { catalogParts, catalogBundle } from './catalog-workspace-fixture'

function fixture() {
  const state = createEmptyState('Fatura')
  state.products = [...catalogParts(), catalogBundle()]
  state.customers = [
    {
      id: 'customer',
      name: 'Müşteri',
      email: '',
      phone: '5551234567',
      city: 'İstanbul',
      district: 'Kadıköy',
      address: 'Test Mahallesi Sokak 1',
      taxId: '11111111111',
    },
  ]
  state.warehouses = [
    { id: 'main', name: 'Merkez', active: true },
    { id: 'shop', name: 'Mağaza', active: true },
  ]
  return state
}
const input: InvoiceInput = {
  customerId: 'customer',
  currency: 'TRY',
  issueDate: '2026-10-25',
  dueDate: '2026-11-01',
  title: 'Toptan satış',
  note: 'Ödeme koşulları',
  tags: ['bayi'],
  localOnly: true,
  warehouseId: 'main',
  items: [
    { kind: 'catalog', variantId: 'a', quantity: 2, unitPrice: 10000, taxRate: 20 },
    { kind: 'free', title: 'Paketleme hizmeti', quantity: 1, unitPrice: 1000, taxRate: 20 },
  ],
}
function create(state = fixture(), patch: Partial<InvoiceInput> = {}) {
  const result = executeCommand(state, {
    type: 'invoice.create',
    id: 'invoice',
    input: { ...input, ...patch },
  })
  expect(result.result.ok, result.result.message).toBe(true)
  return result.state
}

describe('standalone sales invoices', () => {
  it('retains the saved billing address unless the customer is explicitly selected again, and does not reuse an automatic number after deletion', () => {
    const state = create(),
      invoice = state.invoices[0],
      address = invoice.document!.billingAddress.address,
      number = invoice.number
    state.customers[0].address = 'Yeni müşteri adresi'
    const edited = executeCommand(state, {
      type: 'invoice.edit',
      id: 'invoice',
      expectedVersion: invoice.version!,
      input: { ...input, title: 'Not düzenleme' },
    })
    expect(edited.result.ok).toBe(true)
    expect(edited.state.invoices[0].document!.billingAddress.address).toBe(address)
    const explicit = executeCommand(edited.state, {
      type: 'invoice.edit',
      id: 'invoice',
      expectedVersion: edited.state.invoices[0].version!,
      input: {
        ...input,
        billingAddress: { ...invoice.document!.billingAddress, address: 'Yeni müşteri adresi' },
      },
    })
    expect(explicit.result.ok).toBe(true)
    expect(explicit.state.invoices[0].document!.billingAddress.address).toBe('Yeni müşteri adresi')
    const deleted = executeCommand(explicit.state, {
      type: 'invoice.delete',
      id: 'invoice',
      expectedVersion: explicit.state.invoices[0].version!,
    })
    const next = create(deleted.state)
    expect(next.invoices[0].number).not.toBe(number)
  })
  it('creates a document without a synthetic order and applies only catalogue stock and customer debt once', () => {
    const before = fixture().products[0].variants[0].stock,
      state = create(),
      invoice = state.invoices[0]
    expect(state.orders).toHaveLength(0)
    expect(invoice.orderId).toBeUndefined()
    expect(invoice.document?.lines[1].kind).toBe('free')
    expect(invoice.document?.lines[1].variantId).toBe('')
    expect(invoiceTryTotal(state, invoice)).toBe(25200)
    expect(invoiceNativeTotal(state, invoice)).toBe(25200)
    expect(state.products[0].variants[0].stock).toBe(before - 2)
    expect(customerBalance(state, 'customer')).toBe(25200)
    const repeated = executeCommand(state, { type: 'invoice.create', id: 'invoice', input })
    expect(repeated.result.ok).toBe(false)
    expect(repeated.state).toBe(state)
    expect(invoiceSource(state, invoice)?.lines).toBe(invoice.document?.lines)
  })
  it('pays to the selected cash method and warehouse, and reverses only the linked payment', () => {
    const state = create(),
      paid = executeCommand(state, {
        type: 'invoice.pay',
        id: 'invoice',
        expectedTotal: 25200,
        payment: { method: 'card', warehouseId: 'shop', at: '2026-10-25T10:00:00Z' },
      })
    expect(paid.result.ok).toBe(true)
    expect(paid.state.cash[0]).toMatchObject({
      amount: 25200,
      method: 'card',
      warehouseId: 'shop',
      reference: 'invoice',
    })
    expect(customerBalance(paid.state, 'customer')).toBe(0)
    paid.state.cash.push({
      id: 'unrelated',
      reference: 'other',
      kind: 'in',
      amount: 1000,
      method: 'cash',
      description: 'Diğer',
      createdAt: '2026-10-25T10:00:00Z',
    })
    const reversed = executeCommand(paid.state, {
      type: 'invoice.unpay',
      id: 'invoice',
      expectedPaymentId: paid.state.invoices[0].paymentCashId!,
    })
    expect(reversed.result.ok).toBe(true)
    expect(reversed.state.cash.map((entry) => entry.id)).toEqual(['unrelated'])
    expect(customerBalance(reversed.state, 'customer')).toBe(25200)
    expect(invoicePayment(reversed.state, reversed.state.invoices[0]).paid).toBe(false)
  })
  it('prevents editing paid or provider-committed documents and requires current versions', () => {
    const state = create(),
      version = state.invoices[0].version!,
      updated = executeCommand(state, {
        type: 'invoice.edit',
        id: 'invoice',
        expectedVersion: version,
        input: { ...input, title: 'Düzenlendi' },
      })
    expect(updated.result.ok, updated.result.message).toBe(true)
    expect(updated.state.products[0].variants[0].stock).toBe(state.products[0].variants[0].stock)
    expect(
      executeCommand(updated.state, {
        type: 'invoice.edit',
        id: 'invoice',
        expectedVersion: version,
        input,
      }).result.ok,
    ).toBe(false)
    updated.state.invoices[0].externalId = '123'
    expect(
      executeCommand(updated.state, {
        type: 'invoice.cancel',
        id: 'invoice',
        expectedVersion: updated.state.invoices[0].version!,
      }).result.ok,
    ).toBe(false)
  })
  it('uses a frozen bundle recipe and warehouse allocations after a catalogue recipe changes', () => {
    const state = create(fixture(), {
      items: [{ variantId: 'pack', quantity: 2, unitPrice: 10000, taxRate: 20 }],
    })
    const beforeA = state.products[0].variants[0].stock,
      beforeB = state.products[1].variants[0].stock
    state.products[2].bundle!.components = [{ variantId: 'a', quantity: 1000 }]
    const edited = executeCommand(state, {
      type: 'invoice.edit',
      id: 'invoice',
      expectedVersion: state.invoices[0].version!,
      input: {
        ...input,
        items: [{ variantId: 'pack', quantity: 1, unitPrice: 10000, taxRate: 20 }],
      },
    })
    expect(edited.result.ok, edited.result.message).toBe(true)
    expect(edited.state.products[0].variants[0].stock).toBe(beforeA + 2)
    expect(edited.state.products[1].variants[0].stock).toBe(beforeB + 1)
    const cancelled = executeCommand(edited.state, {
      type: 'invoice.cancel',
      id: 'invoice',
      expectedVersion: edited.state.invoices[0].version!,
    })
    expect(cancelled.result.ok).toBe(true)
    expect(cancelled.state.products[0].variants[0].stock).toBe(beforeA + 4)
    expect(cancelled.state.products[1].variants[0].stock).toBe(beforeB + 2)
    const deleted = executeCommand(cancelled.state, {
      type: 'invoice.delete',
      id: 'invoice',
      expectedVersion: cancelled.state.invoices[0].version!,
    })
    expect(deleted.result.ok).toBe(true)
    expect(deleted.state.products[0].variants[0].stock).toBe(beforeA + 4)
  })
  it('cancels, restores and deletes a local document without duplicating debt or stock', () => {
    let state = create()
    const stock = state.products[0].variants[0].stock
    const command = (type: 'invoice.cancel' | 'invoice.restore' | 'invoice.delete') => {
      const result = executeCommand(state, {
        type,
        id: 'invoice',
        expectedVersion: state.invoices[0].version!,
      })
      expect(result.result.ok, result.result.message).toBe(true)
      state = result.state
    }
    command('invoice.cancel')
    expect(customerBalance(state, 'customer')).toBe(0)
    expect(state.products[0].variants[0].stock).toBe(stock + 2)
    command('invoice.restore')
    expect(customerBalance(state, 'customer')).toBe(25200)
    expect(state.products[0].variants[0].stock).toBe(stock)
    command('invoice.delete')
    expect(customerBalance(state, 'customer')).toBe(0)
    expect(state.products[0].variants[0].stock).toBe(stock + 2)
  })
  it('keeps a manually entered currency rate separate from product cost rates and freezes native VAT-discount rounding', () => {
    const state = create(fixture(), {
      currency: 'USD',
      rateSource: 'manual',
      exchangeRate: '4012345678',
      items: [
        {
          kind: 'free',
          title: 'Hizmet',
          quantity: 3,
          unitPrice: 333,
          taxRate: 20,
          discount: { kind: 'percent', value: 1000 },
        },
      ],
      expectedTotal: 1079,
      expectedTryTotal: 43293,
      payment: { method: 'transfer', warehouseId: 'main', at: '2026-10-25T10:00:00Z' },
    })
    expect(state.invoices[0].document?.currencyRate).toMatchObject({
      value: '4012345678',
      source: 'manual',
    })
    expect(invoiceNativeTotal(state, state.invoices[0])).toBe(1079)
    expect(invoiceTryTotal(state, state.invoices[0])).toBe(43293)
    expect(state.cash[0].amount).toBe(43293)
    expect(customerBalance(state, 'customer')).toBe(0)
    expect(state.invoices[0].document?.lines[0].invoiceNetPrice).toBe(333)
  })
  it('rejects insufficient stock and stale totals atomically without recording a document or payment', () => {
    const state = fixture(),
      bad = executeCommand(state, {
        type: 'invoice.create',
        id: 'invoice',
        input: {
          ...input,
          expectedTotal: 1,
          payment: { method: 'cash', at: '2026-10-25T10:00:00Z', warehouseId: 'main' },
        },
      })
    expect(bad.result.ok).toBe(false)
    expect(bad.state).toBe(state)
    expect(state.invoices).toHaveLength(0)
    expect(state.cash).toHaveLength(0)
  })
  it('counts order-sourced invoices only once and records their payment against the real order', () => {
    const state = fixture(),
      created = executeCommand(state, {
        type: 'order.create',
        input: {
          customerId: 'customer',
          channel: 'manual',
          items: [{ variantId: 'a', quantity: 1 }],
          shipping: 0,
          note: '',
        },
      }),
      approved = executeCommand(created.state, {
        type: 'order.transition',
        id: created.result.id!,
        status: 'approved',
      }),
      invoice = approved.state.invoices[0]
    const total = invoiceTryTotal(approved.state, invoice)
    expect(customerBalance(approved.state, 'customer')).toBe(total)
    const paid = executeCommand(approved.state, {
      type: 'invoice.pay',
      id: invoice.id,
      expectedTotal: total,
      payment: { method: 'cash', at: '2026-10-25T10:00:00Z', warehouseId: 'main' },
    })
    expect(paid.result.ok).toBe(true)
    expect(paid.state.orders[0].paid).toBe(true)
    expect(customerBalance(paid.state, 'customer')).toBe(0)
    expect(
      executeCommand(paid.state, {
        type: 'invoice.delete',
        id: invoice.id,
        expectedVersion: invoice.version ?? 0,
      }).result.ok,
    ).toBe(false)
  })
})
