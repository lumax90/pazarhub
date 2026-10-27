import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import { invoiceAmountDue, invoicePayment } from '../src/domain/invoice-source'
import {
  invoiceCategoryName,
  invoiceCategoryUsage,
  defaultInvoiceCategory,
} from '../src/domain/invoice-categories'
import { customerBalance } from '../src/domain/selectors'
import type { InvoiceInput, Command } from '../src/domain/types'
import { catalogParts } from './catalog-workspace-fixture'

function fixture() {
  const state = createEmptyState('Tahsilat')
  state.customers = [
    {
      id: 'customer',
      name: 'Müşteri',
      email: '',
      phone: '5551234567',
      city: 'İstanbul',
      address: 'Test Mahallesi Sokak 1',
    },
  ]
  state.products = catalogParts()
  return state
}
const input: InvoiceInput = {
  customerId: 'customer',
  title: 'Satış',
  note: '',
  issueDate: '2026-10-25',
  currency: 'TRY',
  localOnly: true,
  items: [{ kind: 'free', title: 'Hizmet', quantity: 1, unitPrice: 10000, taxRate: 0 }],
}
const payment = { method: 'transfer' as const, warehouseId: 'main', at: '2026-10-25T10:00:00Z' }
function invoices() {
  let state = fixture()
  for (const id of ['first', 'second']) {
    const result = executeCommand(state, { type: 'invoice.create', id, input })
    expect(result.result.ok).toBe(true)
    state = result.state
  }
  return state
}
describe('invoice categories and verified bulk payments', () => {
  it('collects only the unpaid part of an order invoice and reverses only its latest linked receipt', () => {
    const created = executeCommand(fixture(), {
      type: 'order.create',
      input: {
        customerId: 'customer',
        channel: 'manual',
        items: input.items,
        shipping: 0,
        note: '',
      },
    })
    const approved = executeCommand(created.state, {
      type: 'order.transition',
      id: created.result.id!,
      status: 'approved',
    })
    expect(approved.result.ok, approved.result.message).toBe(true)
    const state = approved.state,
      invoice = state.invoices[0],
      order = state.orders[0]
    state.cash.push({
      id: 'initial',
      reference: order.id,
      kind: 'in',
      amount: 4000,
      method: 'cash',
      description: 'Sipariş ön tahsilatı',
      createdAt: payment.at,
    })
    expect(invoiceAmountDue(state, invoice)).toBe(6000)
    const result = executeCommand(state, {
      type: 'invoice.pay.bulk',
      items: [{ id: invoice.id, expectedVersion: invoice.version ?? 0, expectedTotal: 6000 }],
      payment,
    })
    expect(result.result.ok, result.result.message).toBe(true)
    expect(result.state.orders[0].paid).toBe(true)
    expect(result.state.cash[0]).toMatchObject({ amount: 6000, reference: order.id })
    expect(invoicePayment(result.state, result.state.invoices[0]).cash?.id).toBe(
      result.state.cash[0].id,
    )
    expect(customerBalance(result.state, 'customer')).toBe(0)
    const reversed = executeCommand(result.state, {
      type: 'invoice.unpay',
      id: invoice.id,
      expectedPaymentId: result.state.cash[0].id,
    })
    expect(reversed.result.ok).toBe(true)
    expect(reversed.state.cash.map((entry) => entry.id)).toEqual(['initial'])
    expect(invoiceAmountDue(reversed.state, reversed.state.invoices[0])).toBe(6000)
    expect(customerBalance(reversed.state, 'customer')).toBe(6000)
  })
  it('does not duplicate the marketplace category identity after renaming or deactivation', () => {
    const state = fixture(),
      category = defaultInvoiceCategory(state, 'trendyol')!
    const renamed = executeCommand(state, {
      type: 'invoice.category.save',
      id: category.id,
      name: 'Online satış',
      active: true,
      expectedVersion: 1,
    })
    expect(defaultInvoiceCategory(renamed.state, 'n11')?.id).toBe(category.id)
    expect(renamed.state.invoiceCategories).toHaveLength(1)
    const inactive = executeCommand(renamed.state, {
      type: 'invoice.category.save',
      id: category.id,
      name: 'Online satış',
      active: false,
      expectedVersion: 2,
    })
    expect(defaultInvoiceCategory(inactive.state, 'trendyol')).toBeUndefined()
    expect(inactive.state.invoiceCategories).toHaveLength(1)
  })
  it('attributes legacy document-linked receipts to the customer and does not orphan them on deletion', () => {
    const state = invoices(),
      invoice = state.invoices.find((invoice) => invoice.id === 'first')!
    state.cash.push({
      id: 'partial',
      reference: 'first',
      kind: 'in',
      amount: 4000,
      method: 'cash',
      description: 'Önceki kısmi tahsilat',
      createdAt: payment.at,
    })
    expect(customerBalance(state, 'customer')).toBe(16000)
    expect(
      executeCommand(state, {
        type: 'invoice.delete',
        id: invoice.id,
        expectedVersion: invoice.version!,
      }).result.ok,
    ).toBe(false)
    expect(
      executeCommand(state, {
        type: 'invoice.edit',
        id: invoice.id,
        expectedVersion: invoice.version!,
        input,
      }).result.ok,
    ).toBe(false)
  })
  it('retains category identity through rename/deactivation and blocks deletion while any invoice uses it', () => {
    let state = invoices()
    const run = (command: Command) => {
      const result = executeCommand(state, command)
      expect(result.result.ok, result.result.message).toBe(true)
      state = result.state
    }
    run({
      type: 'invoice.category.save',
      id: 'category',
      name: 'Bayi',
      active: true,
      expectedVersion: 0,
    })
    run({
      type: 'invoice.category.set',
      id: 'first',
      categoryId: 'category',
      expectedVersion: state.invoices.find((invoice) => invoice.id === 'first')!.version!,
    })
    run({
      type: 'invoice.category.save',
      id: 'category',
      name: 'Toptan',
      active: false,
      expectedVersion: 1,
    })
    const invoice = state.invoices.find((invoice) => invoice.id === 'first')!
    expect(invoiceCategoryName(state, invoice)).toBe('Toptan')
    expect(invoiceCategoryUsage(state, 'category')).toBe(1)
    expect(
      executeCommand(state, {
        type: 'invoice.category.delete',
        id: 'category',
        expectedVersion: 2,
        expectedUsage: 1,
      }).result.ok,
    ).toBe(false)
    expect(
      executeCommand(state, {
        type: 'invoice.create',
        id: 'third',
        input: { ...input, categoryId: 'category' },
      }).result.ok,
    ).toBe(false)
    run({
      type: 'invoice.edit',
      id: 'first',
      expectedVersion: invoice.version!,
      input: { ...input, categoryId: 'category' },
    })
    expect(state.invoices.find((invoice) => invoice.id === 'first')!.categoryId).toBe('category')
  })
  it('rejects duplicate names and stale category versions without rewriting invoice amounts', () => {
    const state = invoices(),
      created = executeCommand(state, {
        type: 'invoice.category.save',
        id: 'one',
        name: 'Bayi',
        active: true,
        expectedVersion: 0,
      })
    expect(
      executeCommand(created.state, {
        type: 'invoice.category.save',
        id: 'two',
        name: ' bayi ',
        active: true,
        expectedVersion: 0,
      }).result.ok,
    ).toBe(false)
    expect(
      executeCommand(created.state, {
        type: 'invoice.category.save',
        id: 'one',
        name: 'Toptan',
        active: true,
        expectedVersion: 0,
      }).result.ok,
    ).toBe(false)
    expect(created.state.invoices.map((invoice) => invoice.document!.lines[0].unitPrice)).toEqual([
      10000, 10000,
    ])
  })
  it('adds the marketplace category only for newly created marketplace invoices', () => {
    const state = fixture(),
      order = executeCommand(state, {
        type: 'order.create',
        input: {
          customerId: 'customer',
          channel: 'trendyol',
          items: [{ variantId: 'a', quantity: 1 }],
          shipping: 0,
          note: '',
        },
      })
    const approved = executeCommand(order.state, {
      type: 'order.transition',
      id: order.result.id!,
      status: 'approved',
    })
    expect(approved.result.ok, approved.result.message).toBe(true)
    expect(invoiceCategoryName(approved.state, approved.state.invoices[0])).toBe('Pazaryeri')
    expect(approved.state.invoiceCategories).toHaveLength(1)
  })
  it('collects only the remaining balance and preserves earlier receipts when undoing the latest payment', () => {
    const state = invoices(),
      invoice = state.invoices.find((invoice) => invoice.id === 'first')!
    state.cash.push({
      id: 'earlier',
      reference: 'first',
      customerId: 'customer',
      kind: 'in',
      method: 'cash',
      amount: 4000,
      description: 'Önceki tahsilat',
      createdAt: payment.at,
    })
    state.cash.push({
      id: 'transfer',
      reference: 'first',
      kind: 'in',
      method: 'transfer',
      transferId: 'pair',
      amount: 9999,
      description: 'Virman',
      createdAt: payment.at,
    })
    expect(invoiceAmountDue(state, invoice)).toBe(6000)
    const paid = executeCommand(state, {
      type: 'invoice.pay',
      id: 'first',
      expectedTotal: 6000,
      payment,
    })
    expect(paid.result.ok).toBe(true)
    expect(paid.state.cash[0].amount).toBe(6000)
    const current = paid.state.invoices.find((invoice) => invoice.id === 'first')!
    const undone = executeCommand(paid.state, {
      type: 'invoice.unpay',
      id: 'first',
      expectedPaymentId: current.paymentCashId!,
    })
    expect(undone.result.ok).toBe(true)
    expect(undone.state.cash.some((entry) => entry.id === 'earlier')).toBe(true)
    expect(
      invoiceAmountDue(
        undone.state,
        undone.state.invoices.find((invoice) => invoice.id === 'first')!,
      ),
    ).toBe(6000)
  })
  it('marks previously fully collected documents paid without creating a zero or second receipt', () => {
    const state = invoices()
    state.cash.push({
      id: 'existing',
      reference: 'first',
      kind: 'in',
      amount: 10000,
      method: 'cash',
      description: 'Tam tahsilat',
      createdAt: payment.at,
    })
    const result = executeCommand(state, {
      type: 'invoice.pay',
      id: 'first',
      expectedTotal: 0,
      payment,
    })
    expect(result.result.ok).toBe(true)
    expect(result.state.cash).toHaveLength(1)
    expect(
      invoicePayment(
        result.state,
        result.state.invoices.find((invoice) => invoice.id === 'first')!,
      ).paid,
    ).toBe(true)
  })
  it('records a bulk payment atomically and rejects a stale member without partially collecting another invoice', () => {
    const state = invoices(),
      items = state.invoices.map((invoice) => ({
        id: invoice.id,
        expectedTotal: invoiceAmountDue(state, invoice),
        expectedVersion: invoice.version!,
      }))
    const stale = executeCommand(state, {
      type: 'invoice.pay.bulk',
      items: [items[0], { ...items[1], expectedTotal: 9999 }],
      payment,
    })
    expect(stale.result.ok).toBe(false)
    expect(stale.state).toBe(state)
    expect(state.cash).toHaveLength(0)
    const result = executeCommand(state, { type: 'invoice.pay.bulk', items, payment })
    expect(result.result.ok).toBe(true)
    expect(result.state.cash).toHaveLength(2)
    expect(customerBalance(result.state, 'customer')).toBe(0)
    expect(
      executeCommand(result.state, { type: 'invoice.pay.bulk', items, payment }).result.ok,
    ).toBe(false)
  })
  it('does not guess a customer-level receipt as payment for an unrelated invoice', () => {
    const state = invoices(),
      invoice = state.invoices[0]
    state.cash.push({
      id: 'general',
      reference: 'general',
      customerId: 'customer',
      kind: 'in',
      method: 'transfer',
      amount: 10000,
      description: 'Cari tahsilat',
      createdAt: payment.at,
    })
    expect(invoiceAmountDue(state, invoice)).toBe(10000)
  })
})
