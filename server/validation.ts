import { z } from 'zod'
import { defaultIntegrationSettings, providers } from '../src/domain/integrations'
import { MIN_PASSWORD_LENGTH } from '../src/domain/auth-policy'
import { MAX_PRODUCT_VARIANTS, MAX_VARIANT_AXES } from '../src/domain/products'
import { MAX_BUNDLE_COMPONENTS } from '../src/domain/bundles'
import { orderColumnIds } from '../src/domain/orders'

export const identifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) => !['__proto__', 'constructor', 'prototype'].includes(value),
    'Geçersiz kayıt kimliği.',
  )
export const uuid = z.string().uuid()
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`)
  .max(128)
const text = (max = 500) => z.string().trim().max(max)
const money = z.number().int().min(0).max(1_000_000_000)
const quantity = z.number().int().min(1).max(10_000)
export const channelSchema = z.enum([
  'trendyol',
  'hepsiburada',
  'amazon',
  'n11',
  'ciceksepeti',
  'pazarama',
  'pttavm',
  'toptantr',
  'manual',
])
const address = z.strictObject({
  name: text(200).min(1),
  address: text(1000).min(1),
  city: text(100).min(1),
  phone: text(50),
  district: text(100).optional(),
  postalCode: text(20).optional(),
  country: z.union([z.string().regex(/^[A-Z]{2}$/), z.literal('')]).optional(),
})
const billingAddress = address.extend({
  taxId: z
    .string()
    .regex(/^(\d{10}|\d{11})?$/)
    .optional(),
  taxOffice: text(200).optional(),
})
const orderDiscount = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('percent'), value: z.number().int().min(0).max(10000) }),
  z.strictObject({ kind: z.literal('amount'), value: money }),
])
const orderItems = z
  .array(
    z.union([
      z.strictObject({
        kind: z.literal('catalog').optional(),
        variantId: identifier,
        bundleVersion: z.number().int().nonnegative().optional(),
        quantity,
        unitPrice: money.optional(),
        taxRate: z.number().int().min(0).max(100).optional(),
        discount: orderDiscount.optional(),
      }),
      z.strictObject({
        kind: z.literal('free'),
        title: text(300).min(1),
        unit: text(40).min(1).optional(),
        quantity,
        unitPrice: money,
        taxRate: z.number().int().min(0).max(100),
        discount: orderDiscount.optional(),
      }),
    ]),
  )
  .min(1)
  .max(200)
const orderStatus = z.enum(['pending', 'approved', 'shipped', 'delivered', 'cancelled', 'returned'])
const paymentMethod = z.enum(['cash', 'card', 'transfer', 'marketplace'])
const invoicePreference = z.enum(['default', 'draft', 'immediate'])
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Geçerli tarih girin.')
const invoicePaymentSchema = z.strictObject({
  method: paymentMethod,
  at: z.string().datetime({ offset: true }),
  warehouseId: identifier,
})
const invoiceInputSchema = z.strictObject({
  customerId: identifier,
  number: text(100).optional(),
  sourceNumber: text(200).optional(),
  title: text(300),
  note: text(5000),
  tags: z.array(text(80).min(1)).max(20).optional(),
  categoryId: identifier.optional(),
  issueDate: day,
  dueDate: day.optional(),
  currency: z.enum(['TRY', 'USD', 'EUR', 'GBP']),
  exchangeRate: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  rateSource: z.enum(['TCMB', 'manual']).optional(),
  expectedExchangeRate: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  items: orderItems,
  warehouseId: identifier.optional(),
  billingAddress: billingAddress.optional(),
  localOnly: z.boolean(),
  expectedTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  expectedTryTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  payment: invoicePaymentSchema.optional(),
})
export const orderFiltersSchema = z
  .strictObject({
    from: day.optional(),
    to: day.optional(),
    query: text(500).optional(),
    statuses: z.array(orderStatus).max(6).optional(),
    channel: channelSchema.optional(),
    storeId: identifier.optional(),
    cargoProvider: text(200).optional(),
    paid: z.boolean().optional(),
    invoiced: z.boolean().optional(),
    unmapped: z.boolean().optional(),
    ownShipment: z.boolean().optional(),
    printed: z.boolean().optional(),
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    'Başlangıç tarihi bitişten sonra olamaz.',
  )
const variant = z.strictObject({
  id: identifier,
  name: text(150),
  sku: identifier,
  barcode: text(80),
  price: money,
  cost: money,
  stock: z.number().int().min(-100_000_000).max(100_000_000),
  stockByWarehouse: z
    .record(identifier, z.number().int().min(-100_000_000).max(100_000_000))
    .optional(),
  shelf: text(100).optional(),
  lowStockByWarehouse: z.record(identifier, z.number().int().min(0).max(100_000_000)).optional(),
  options: z.record(identifier, identifier).optional(),
})
const product = z.strictObject({
  id: identifier,
  name: text(300).min(1),
  category: text(300).min(1),
  brand: text(200),
  description: text(30_000),
  art: z.enum(['vase', 'cup', 'lamp', 'bag', 'candle', 'bowl', 'towel', 'tray']),
  color: z.string().regex(/^#[\da-f]{6}$/i),
  taxRate: z.number().int().min(0).max(100),
  currency: z
    .enum(['TRY', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD', 'SEK', 'NOK'])
    .optional(),
  active: z.boolean(),
  lowStock: z.number().int().min(0).max(100_000),
  variants: z.array(variant).min(1).max(MAX_PRODUCT_VARIANTS),
  images: z.array(z.string().url().max(2048)).max(12).optional(),
  imageMetadata: z
    .record(
      z.string().url().max(2048),
      z.strictObject({
        alt: text(300).optional(),
        axisId: identifier.optional(),
        valueId: identifier.optional(),
      }),
    )
    .refine((value) => Object.keys(value).length <= 12)
    .optional(),
  modelCode: z.union([identifier, z.literal('')]).optional(),
  subtitle: text(300).optional(),
  invoiceName: text(300).optional(),
  supplier: text(200).optional(),
  unit: text(40).min(1).optional(),
  origin: z.union([z.string().regex(/^[A-Z]{2}$/), z.literal('')]).optional(),
  gtip: z.union([z.string().regex(/^\d{12}$/), z.literal('')]).optional(),
  shortDescription: text(2000).optional(),
  note: text(5000).optional(),
  dimensions: z
    .strictObject({
      lengthCm: z.number().min(0).max(100000).optional(),
      widthCm: z.number().min(0).max(100000).optional(),
      heightCm: z.number().min(0).max(100000).optional(),
      weightGr: z.number().min(0).max(100000000).optional(),
      desi: z.number().min(0).max(100000).optional(),
    })
    .optional(),
  variantAxes: z
    .array(
      z.strictObject({
        id: identifier,
        name: text(100).min(1),
        definitionId: identifier.optional(),
        values: z
          .array(
            z.strictObject({
              id: identifier,
              name: text(100).min(1),
              definitionValueId: identifier.optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .max(MAX_VARIANT_AXES)
    .optional(),
  technicalAttributes: z
    .array(
      z.strictObject({
        id: identifier,
        name: text(100).min(1),
        value: text(1000).min(1),
        definitionId: identifier.optional(),
        valueIds: z.array(identifier).max(100).optional(),
        valueLabels: z.array(text(1000)).max(100).optional(),
      }),
    )
    .max(100)
    .optional(),
  updatedAt: z.string().datetime().optional(),
  version: z.number().int().nonnegative().optional(),
  categoryId: identifier.optional(),
  brandId: identifier.optional(),
  supplierId: identifier.optional(),
  bundle: z
    .strictObject({
      components: z
        .array(
          z.strictObject({ variantId: identifier, quantity: z.number().int().min(1).max(10000) }),
        )
        .min(1)
        .max(MAX_BUNDLE_COMPONENTS),
      priceMode: z.enum(['linked', 'fixed']),
      discountBps: z.number().int().min(0).max(10000),
      includeContents: z.boolean().optional(),
    })
    .optional(),
})
const customer = z.strictObject({
  id: identifier,
  name: text(200).min(1),
  email: z.union([z.literal(''), z.string().email().max(254)]),
  phone: text(50),
  city: text(100),
  address: text(1000),
  company: text(300).optional(),
  district: text(100).optional(),
  country: z.string().length(2).optional(),
  taxId: text(20).optional(),
  taxOffice: text(200).optional(),
  version: z.number().int().nonnegative().optional(),
})
const preferences = z.strictObject({
  businessName: text(160).min(1),
  theme: z.enum(['light', 'dark', 'system']),
  density: z.enum(['comfortable', 'compact']),
  orderColumns: z.array(z.enum(orderColumnIds)).max(orderColumnIds.length).optional(),
  notifications: z
    .strictObject({ orders: z.boolean(), listings: z.boolean(), stock: z.boolean() })
    .optional(),
})
const business = z.strictObject({
  legalName: text(200).optional(),
  taxOffice: text(120).optional(),
  taxId: text(11).optional(),
  phone: text(40).optional(),
  email: text(254).optional(),
  city: text(100).optional(),
  district: text(100).optional(),
  address: text(1000).optional(),
})
const items = z
  .array(
    z.strictObject({
      variantId: identifier,
      quantity,
      bundleVersion: z.number().int().nonnegative().optional(),
    }),
  )
  .min(1)
  .max(200)

const definitionSchema = z
  .strictObject({
    id: identifier,
    kind: z.enum(['category', 'brand', 'supplier', 'color', 'variant', 'attribute']),
    name: text(300).min(1),
    active: z.boolean(),
    sortOrder: z.number().int().min(-100000).max(100000),
    version: z.number().int().nonnegative(),
    parentId: identifier.optional(),
    description: text(5000).optional(),
    colorHex: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional(),
    gradientEnd: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional(),
    gradientAngle: z.number().min(0).max(360).optional(),
    contactName: text(200).optional(),
    phone: text(50).optional(),
    email: z.union([z.string().email().max(254), z.literal('')]).optional(),
    taxId: text(20).optional(),
    taxOffice: text(200).optional(),
    address: text(1000).optional(),
    note: text(5000).optional(),
    values: z
      .array(
        z.strictObject({
          id: identifier,
          name: text(1000).min(1),
          active: z.boolean(),
          sortOrder: z.number().int().min(-100000).max(100000),
        }),
      )
      .max(1000)
      .optional(),
  })
  .refine(
    (definition) =>
      definition.name.length <=
      (definition.kind === 'category'
        ? 300
        : ['brand', 'supplier'].includes(definition.kind)
          ? 200
          : 100),
    'Tanım adı bu alan için çok uzun.',
  )

export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('stock.thresholds'),
    variantId: identifier,
    expected: z.record(identifier, z.number().int().min(0).max(100000000)),
    thresholds: z.record(identifier, z.number().int().min(0).max(100000000)),
  }),
  z.strictObject({
    type: z.literal('ecommerce.settings'),
    settings: z.strictObject({
      version: z.number().int().nonnegative(),
      pricesIncludeVat: z.boolean(),
      exchangeRateType: z.enum([
        'forexBuying',
        'forexSelling',
        'banknoteBuying',
        'banknoteSelling',
      ]),
      defaultCurrency: z.enum([
        'TRY',
        'USD',
        'EUR',
        'GBP',
        'CHF',
        'JPY',
        'AUD',
        'CAD',
        'SEK',
        'NOK',
      ]),
      defaultTaxRate: z.number().int().min(0).max(100),
      defaultOrigin: z.string().regex(/^[A-Z]{2}$/),
      lowStock: z.number().int().min(0).max(100000000),
      criticalStock: z.number().int().min(0).max(100000000),
      allowNegativeStock: z.boolean(),
      orderDays: z.number().int().min(1).max(15),
      dueDays: z.number().int().min(0).max(90),
      stockScope: z.enum(['all', 'selected']).optional(),
      warehouseIds: z.array(identifier).min(1).max(100).optional(),
      invoiceTiming: z
        .enum(['manual', 'on_created', 'on_approval', 'on_shipped', 'on_delivered'])
        .optional(),
      // Formats are checked in the domain, which explains them in Turkish.
      gs1Prefix: z.string().max(20).optional(),
      barcodePrefix: z.string().max(20).optional(),
    }),
  }),
  z.strictObject({
    type: z.literal('definition.move'),
    id: identifier,
    parentId: identifier.optional(),
    beforeId: identifier.optional(),
    expectedOrder: z.string().max(1000000),
  }),
  z.strictObject({ type: z.literal('definition.save'), definition: definitionSchema }),
  z.strictObject({
    type: z.literal('definition.delete'),
    id: identifier,
    version: z.number().int().positive(),
    expectedUsage: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('definition.value.delete'),
    id: identifier,
    valueId: identifier,
    version: z.number().int().positive(),
    expectedUsage: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('product.patch'),
    id: identifier,
    expectedVersion: z.number().int().nonnegative(),
    patch: z.strictObject({
      changes: product
        .omit({ id: true, variants: true, version: true, updatedAt: true })
        .partial()
        .optional(),
      variants: z
        .array(
          variant
            .omit({ stock: true, stockByWarehouse: true, lowStockByWarehouse: true })
            .partial()
            .required({ id: true }),
        )
        .max(MAX_PRODUCT_VARIANTS)
        .optional(),
      newVariants: z.array(variant).max(MAX_PRODUCT_VARIANTS).optional(),
    }),
  }),
  z.strictObject({
    type: z.literal('order.create'),
    input: z.strictObject({
      customerId: identifier,
      channel: channelSchema,
      items: orderItems,
      shipping: money,
      note: text(5000),
      shippingAddress: address.optional(),
      billingAddress: billingAddress.optional(),
      invoicePreference: invoicePreference.optional(),
      invoiceConnectionId: uuid.optional(),
      externalNumber: text(200).optional(),
      paymentMethod: paymentMethod.optional(),
      paid: z.boolean().optional(),
      internalNote: text(5000).optional(),
      warehouseId: identifier.optional(),
      currency: z.enum(['TRY', 'USD', 'EUR', 'GBP']).optional(),
      expectedExchangeRate: z
        .string()
        .regex(/^\d{1,20}$/)
        .optional(),
      expectedTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      expectedTryTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      priceInputIncludesVat: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    type: z.literal('order.transition'),
    id: identifier,
    status: orderStatus,
    reason: text(2000).optional(),
    restock: z.boolean().optional(),
    shipment: z
      .strictObject({ carrier: text(200).min(1), trackingNumber: text(100).min(1) })
      .optional(),
  }),
  z.strictObject({
    type: z.literal('order.pay'),
    id: identifier,
    method: paymentMethod.optional(),
  }),
  z.strictObject({
    type: z.literal('order.prepare'),
    id: identifier,
    lineKeys: z.array(identifier).min(1).max(500),
    ready: z.boolean(),
    expectedContent: z.string().max(300000),
  }),
  z.strictObject({
    type: z.literal('order.note.add'),
    id: identifier,
    noteId: identifier,
    text: text(5000).min(1),
  }),
  z.strictObject({ type: z.literal('order.invoice'), id: identifier }),
  z.strictObject({ type: z.literal('invoice.create'), id: identifier, input: invoiceInputSchema }),
  z.strictObject({
    type: z.literal('invoice.document.link'),
    id: identifier,
    expectedVersion: z.number().int().nonnegative(),
    expectedSource: text(1000000).min(1),
    url: text(2048).min(1),
    number: text(64).optional(),
  }),
  z.strictObject({
    type: z.literal('invoice.document.unlink'),
    id: identifier,
    expectedVersion: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('invoice.category.save'),
    id: identifier,
    name: text(160).min(1),
    active: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('invoice.category.delete'),
    id: identifier,
    expectedVersion: z.number().int().nonnegative(),
    expectedUsage: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('invoice.category.set'),
    id: identifier,
    categoryId: identifier.nullable(),
    expectedVersion: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('invoice.pay.bulk'),
    items: z
      .array(
        z.strictObject({
          id: identifier,
          expectedTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          expectedVersion: z.number().int().nonnegative(),
          expectedPaymentId: identifier.optional(),
        }),
      )
      .min(1)
      .max(100),
    payment: invoicePaymentSchema,
  }),
  z.strictObject({
    type: z.literal('invoice.edit'),
    id: identifier,
    expectedVersion: z.number().int().nonnegative(),
    input: invoiceInputSchema,
  }),
  z.strictObject({
    type: z.literal('invoice.pay'),
    id: identifier,
    expectedTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    expectedPaymentId: identifier.optional(),
    payment: invoicePaymentSchema,
  }),
  z.strictObject({
    type: z.literal('invoice.unpay'),
    id: identifier,
    expectedPaymentId: identifier,
  }),
  z.strictObject({
    type: z.enum(['invoice.cancel', 'invoice.restore', 'invoice.delete']),
    id: identifier,
    expectedVersion: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('order.print'),
    id: identifier,
    printed: z.boolean(),
    expectedContent: z.string().max(300000),
  }),
  z.strictObject({
    type: z.literal('order.tax'),
    id: identifier,
    taxRate: z.number().int().min(0).max(100),
    expectedContent: z.string().max(300000),
  }),
  z.strictObject({
    type: z.literal('order.invoice.preference'),
    id: identifier,
    preference: invoicePreference,
    connectionId: uuid.optional(),
  }),
  z.strictObject({
    type: z.literal('order.filter.save'),
    filter: z.strictObject({
      id: identifier,
      name: text(100).min(1),
      filters: orderFiltersSchema,
      version: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    type: z.literal('order.filter.delete'),
    id: identifier,
    version: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal('retail.sale'),
    input: z.strictObject({
      expectedTotal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      customerId: identifier.optional(),
      items,
      method: z.enum(['cash', 'card', 'transfer']),
      warehouseId: identifier.optional(),
      payments: z
        .array(
          z.strictObject({
            method: z.enum(['cash', 'card', 'transfer']),
            amount: money.positive(),
          }),
        )
        .max(10)
        .optional(),
      discount: money.optional(),
    }),
  }),
  z.strictObject({ type: z.literal('product.save'), product }),
  z.strictObject({
    type: z.literal('stock.adjust'),
    variantId: identifier,
    quantity: z.number().int().min(-100_000_000).max(100_000_000),
    note: text(1000).min(1),
    warehouseId: identifier.optional(),
    expectedQuantity: z.number().int().min(-100_000_000).max(100_000_000).optional(),
  }),
  z.strictObject({ type: z.literal('customer.save'), customer }),
  z.strictObject({
    type: z.literal('listing.update'),
    id: identifier,
    status: z.enum(['active', 'pending', 'rejected', 'archived']).optional(),
    priceOverride: money.nullable().optional(),
    listPriceOverride: money.nullable().optional(),
    marginExcluded: z.boolean().optional(),
    titleOverride: text(300).nullable().optional(),
  }),
  z.strictObject({
    type: z.literal('connection.update'),
    connection: z.strictObject({
      id: identifier,
      channel: channelSchema.exclude(['manual']),
      name: text(200).min(1),
      active: z.boolean(),
    }),
  }),
  z.strictObject({ type: z.literal('preferences.update'), preferences }),
  z.strictObject({ type: z.literal('business.update'), business }),
  z.strictObject({
    type: z.literal('warehouse.save'),
    warehouse: z.strictObject({
      id: identifier,
      name: text(160).min(1),
      active: z.boolean(),
      code: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,40}$/)
        .optional(),
      city: text(100).optional(),
      district: text(100).optional(),
      address: text(1000).optional(),
      phone: text(50).optional(),
      sortOrder: z.number().int().min(-100000).max(100000).optional(),
      version: z.number().int().nonnegative().optional(),
    }),
  }),
  z.strictObject({
    type: z.literal('warehouse.delete'),
    id: identifier,
    version: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('stock.record'),
    variantId: identifier,
    warehouseId: identifier,
    direction: z.enum(['in', 'out']),
    quantity,
    reason: text(80).min(1),
    note: text(1000),
    expectedQuantity: z.number().int().min(-100000000).max(100000000),
  }),
  z.strictObject({
    type: z.literal('stock.transfer'),
    variantId: identifier,
    from: identifier,
    to: identifier,
    quantity,
    note: text(1000).min(1),
  }),
  z.strictObject({
    type: z.literal('stock.count.create'),
    id: identifier,
    name: text(200).min(1),
    warehouseId: identifier,
    variantIds: z.array(identifier).min(1).max(1000),
  }),
  z.strictObject({
    type: z.literal('stock.count.complete'),
    id: identifier,
    counts: z.record(identifier, z.number().int().min(-100_000_000).max(100_000_000)),
  }),
  z.strictObject({
    type: z.literal('sale.return'),
    id: identifier,
    source: z.enum(['retail', 'order']),
    saleId: identifier,
    items: z
      .array(
        z.strictObject({
          lineIndex: z.number().int().nonnegative().max(500),
          quantity,
          restock: z.boolean(),
        }),
      )
      .min(1)
      .max(200),
    refund: z.boolean(),
    method: z.enum(['cash', 'card', 'transfer']),
    note: text(1000).min(1),
  }),
  z.strictObject({
    type: z.literal('cash.record'),
    id: identifier,
    amount: money.positive(),
    kind: z.enum(['in', 'out']),
    method: z.enum(['cash', 'card', 'transfer']),
    description: text(1000).min(1),
    customerId: identifier.optional(),
  }),
  z.strictObject({
    type: z.literal('cash.transfer'),
    id: identifier,
    amount: money.positive(),
    from: z.enum(['cash', 'card', 'transfer']),
    to: z.enum(['cash', 'card', 'transfer']),
    description: text(1000).min(1),
  }),
  z.strictObject({
    type: z.literal('customer.entry'),
    id: identifier,
    customerId: identifier,
    kind: z.enum(['debit', 'credit']),
    amount: money.positive(),
    description: text(1000).min(1),
  }),
  z.strictObject({
    type: z.literal('expense.create'),
    warehouseId: identifier.optional(),
    expense: z.strictObject({
      id: identifier,
      number: text(100),
      supplier: text(200).min(1),
      category: text(200),
      description: text(2000).min(1),
      amount: money.positive(),
      paid: z.boolean(),
      method: z.enum(['cash', 'card', 'transfer']),
      dueAt: z.string().datetime(),
      purchaseLines: z
        .array(z.strictObject({ variantId: identifier, quantity, unitCost: money.positive() }))
        .min(1)
        .max(200)
        .optional(),
    }),
  }),
  z.strictObject({ type: z.literal('expense.pay'), id: identifier }),
  z.strictObject({
    type: z.literal('margin.save'),
    rule: z.strictObject({
      id: identifier,
      storeId: identifier,
      scope: z.enum(['product', 'desi', 'priceRange', 'brand', 'category', 'all']),
      value: text(300),
      base: z.enum(['cost', 'price']),
      markupBps: z.number().int().min(-9900).max(100000),
      commissionBps: z.number().int().min(0).max(9999).optional(),
      fixedCost: money,
      active: z.boolean(),
      version: z.number().int().nonnegative().optional(),
      kind: z.enum(['percent', 'amount', 'fixed']).optional(),
      direction: z.enum(['increase', 'decrease']).optional(),
      amount: money.optional(),
      shippingCost: money.optional(),
      excluded: z.boolean().optional(),
      minimum: z.number().min(0).max(1_000_000_000).optional(),
      maximum: z.number().min(0).max(1_000_000_000).optional(),
      formula: z.enum(['legacy', 'costsBefore', 'costsAfter']).optional(),
    }),
  }),
  z.strictObject({
    type: z.literal('margin.delete'),
    id: identifier,
    version: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal('margin.apply'), storeId: identifier }),
  z.strictObject({
    type: z.literal('margin.settings'),
    settings: z.strictObject({
      storeId: identifier,
      version: z.number().int().nonnegative(),
      enabled: z.boolean(),
      base: z.enum(['cost', 'price']),
      formula: z.enum(['costsBefore', 'costsAfter']),
      commissionMode: z.enum(['inside', 'add']),
      rounding: z.enum(['none', 'up99', 'up95', 'ceil', 'nearest']),
      listPriceMode: z.enum(['same', 'markup', 'keep']),
      listMarkupBps: z.number().int().min(0).max(100000),
    }),
  }),
  z.strictObject({
    type: z.literal('product.bulk'),
    ids: z.array(identifier).min(1).max(200),
    expectedVersions: z.record(identifier, z.number().int().nonnegative()),
    change: z.strictObject({
      pricePercent: z.number().min(-99).max(1000).optional(),
      category: text(200).min(1).optional(),
      brand: text(200).optional(),
      active: z.boolean().optional(),
    }),
  }),
])

export const registrationSchema = z.strictObject({
  name: text(160).min(2),
  workspaceName: text(160).min(2),
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase().trim()),
  password: passwordSchema,
})
export const loginSchema = z.strictObject({
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase().trim()),
  password: z.string().min(1).max(128),
})
export const integrationSettingsSchema = z.strictObject({
  warehouseId: identifier.optional(),
  environment: z.enum(['production', 'sandbox']).default('production'),
  pullOrders: z.boolean().default(false),
  pullCatalog: z.boolean().default(false),
  pushInventory: z.boolean().default(false),
  pullQuestions: z.boolean().default(false),
  pullClaims: z.boolean().default(false),
  pullSettlements: z.boolean().default(false),
  invoiceConnectionId: uuid.optional(),
  cargoConnectionId: uuid.optional(),
  invoiceMode: z.enum(['workspace', 'manual', 'on_approval']).default('manual'),
  sendInvoiceLink: z.boolean().default(true),
  finalizeInvoices: z.boolean().default(false),
  finalizeDelayMinutes: z.number().int().min(0).max(1440).default(60),
  stockBuffer: z.number().int().min(0).max(100_000).default(0),
  autoApproveOrders: z.boolean().default(false),
  senderName: text(200).optional(),
  senderPhone: text(50).optional(),
  senderAddress: text(1000).optional(),
  senderCity: text(100).optional(),
  senderDistrict: text(100).optional(),
})
export const connectionInputSchema = z.strictObject({
  provider: z
    .string()
    .refine(
      (value) => providers.some((provider) => provider.id === value),
      'Sağlayıcı tanınmıyor.',
    ),
  name: text(160).min(1),
  enabled: z.boolean().default(false),
  isDefault: z.boolean().optional(),
  credentials: z.record(z.string().max(50), z.string().max(10_000)),
  settings: integrationSettingsSchema.default({
    ...defaultIntegrationSettings,
    sendInvoiceLink: true,
  }),
})
