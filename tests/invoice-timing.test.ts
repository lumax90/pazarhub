import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import { defaultEcommerceSettings } from '../src/domain/ecommerce'
import type { InvoiceTiming, OrderStatus } from '../src/domain/types'
import { catalogParts } from './catalog-workspace-fixture'
import { ensureAutomaticOrderInvoice } from '../src/domain/orders'

function fixture(timing: InvoiceTiming) {
  const state = createEmptyState('Fatura zamanı')
  state.ecommerce = { ...defaultEcommerceSettings, invoiceTiming: timing }
  state.products = catalogParts()
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
  return state
}
describe('frozen order invoice timing', () => {
  it('does not create fiscal documents for historical or unreconciled-stock shipments', () => {
    const created = executeCommand(fixture('on_shipped'), {
        type: 'order.create',
        input: {
          customerId: 'customer',
          channel: 'manual',
          items: [{ variantId: 'a', quantity: 1 }],
          shipping: 0,
          note: '',
        },
      }),
      state = created.state,
      order = state.orders[0]
    order.status = 'shipped'
    order.historical = true
    expect(
      ensureAutomaticOrderInvoice(state, order, new Date().toISOString(), () =>
        crypto.randomUUID(),
      ),
    ).toBeUndefined()
    order.historical = false
    order.syncStatus = 'error'
    expect(
      ensureAutomaticOrderInvoice(state, order, new Date().toISOString(), () =>
        crypto.randomUUID(),
      ),
    ).toBeUndefined()
    order.syncStatus = 'synced'
    expect(
      ensureAutomaticOrderInvoice(state, order, new Date().toISOString(), () =>
        crypto.randomUUID(),
      ),
    ).toBeUndefined()
    expect(state.invoices).toHaveLength(0)
    expect(state.products[0].variants[0].stock).toBe(15)
  })
  it.each(['manual', 'on_created', 'on_approval', 'on_shipped', 'on_delivered'] as const)(
    'creates one invoice at %s without applying stock twice',
    (timing) => {
      const created = executeCommand(fixture(timing), {
        type: 'order.create',
        input: {
          customerId: 'customer',
          channel: 'manual',
          items: [{ variantId: 'a', quantity: 1 }],
          shipping: 0,
          note: '',
        },
      })
      expect(created.result.ok).toBe(true)
      let state = created.state
      expect(state.orders[0].invoiceTiming).toBe(timing)
      expect(state.invoices).toHaveLength(timing === 'on_created' ? 1 : 0)
      expect(state.products[0].variants[0].stock).toBe(15)
      for (const [index, status] of ['approved', 'shipped', 'delivered'].entries()) {
        const result = executeCommand(state, {
          type: 'order.transition',
          id: state.orders[0].id,
          status: status as OrderStatus,
          ...(status === 'shipped'
            ? { shipment: { carrier: 'PTT', trackingNumber: 'TRACK' } }
            : {}),
        })
        expect(result.result.ok, result.result.message).toBe(true)
        state = result.state
        const threshold = {
          manual: 99,
          on_created: 0,
          on_approval: 1,
          on_shipped: 2,
          on_delivered: 3,
        }[timing]
        expect(state.invoices).toHaveLength(index + 1 >= threshold ? 1 : 0)
        expect(state.products[0].variants[0].stock).toBe(14)
      }
      expect(state.movements.filter((m) => m.type === 'order')).toHaveLength(1)
      if (state.invoices.length) expect(state.invoices[0].automatic).toBe(true)
    },
  )
  it('does not backfill invoices or change existing order timing when the company default changes', () => {
    const created = executeCommand(fixture('on_shipped'), {
      type: 'order.create',
      input: {
        customerId: 'customer',
        channel: 'manual',
        items: [{ variantId: 'a', quantity: 1 }],
        shipping: 0,
        note: '',
      },
    })
    const configured = executeCommand(created.state, {
      type: 'ecommerce.settings',
      settings: { ...created.state.ecommerce!, invoiceTiming: 'on_created' },
    })
    expect(configured.result.ok).toBe(true)
    expect(configured.state.invoices).toHaveLength(0)
    expect(configured.state.orders[0].invoiceTiming).toBe('on_shipped')
    const approved = executeCommand(configured.state, {
      type: 'order.transition',
      id: created.result.id!,
      status: 'approved',
    })
    expect(approved.state.invoices).toHaveLength(0)
    const next = executeCommand(approved.state, {
      type: 'order.create',
      input: {
        customerId: 'customer',
        channel: 'manual',
        items: [{ variantId: 'a', quantity: 1 }],
        shipping: 0,
        note: '',
      },
    })
    expect(next.state.invoices).toHaveLength(1)
    expect(next.state.orders[0].invoiceTiming).toBe('on_created')
  })
  it('keeps explicit local invoice creation available when automatic timing is disabled', () => {
    const created = executeCommand(fixture('manual'), {
      type: 'order.create',
      input: {
        customerId: 'customer',
        channel: 'manual',
        items: [{ variantId: 'a', quantity: 1 }],
        shipping: 0,
        note: '',
      },
    })
    const manual = executeCommand(created.state, { type: 'order.invoice', id: created.result.id! })
    expect(manual.result.ok).toBe(true)
    expect(manual.state.invoices).toHaveLength(1)
    expect(manual.state.products[0].variants[0].stock).toBe(15)
  })
})
