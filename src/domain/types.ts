import type {
  CatalogValueMapping,
  CategoryMapping,
  PublishConfig,
  PublicationState,
} from './publishing'
import type { SettlementMatch } from './marketplace'
import type { CurrencyCode, ExchangeRates, ExchangeRateType } from './money'
import type { MarketplacePackage, OrderFulfillmentWorkflow } from './order-fulfillment'
import type { ListingContentWorkflow } from './listing-content'

export type Channel =
  | 'trendyol'
  | 'hepsiburada'
  | 'amazon'
  | 'n11'
  | 'ciceksepeti'
  | 'pazarama'
  | 'pttavm'
  | 'toptantr'
  | 'manual'
export type OrderStatus =
  'pending' | 'approved' | 'shipped' | 'delivered' | 'cancelled' | 'returned'
export type ProductArt = 'vase' | 'cup' | 'lamp' | 'bag' | 'candle' | 'bowl' | 'towel' | 'tray'
export type ListingStatus = 'active' | 'pending' | 'rejected' | 'archived'

/** Catalog amounts are VAT-inclusive minor units of Product.currency (TRY for older records). */
export interface Variant {
  id: string
  name: string
  sku: string
  barcode: string
  price: number
  cost: number
  stock: number
  stockByWarehouse?: Record<string, number>
  lowStockByWarehouse?: Record<string, number>
  shelf?: string
  options?: Record<string, string>
}

export interface VariantAxis {
  id: string
  name: string
  definitionId?: string
  values: { id: string; name: string; definitionValueId?: string }[]
}
export interface ProductDimensions {
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  weightGr?: number
  desi?: number
}
export interface ProductAttribute {
  id: string
  name: string
  value: string
  definitionId?: string
  valueIds?: string[]
  valueLabels?: string[]
}

export type DefinitionKind = 'category' | 'brand' | 'supplier' | 'color' | 'variant' | 'attribute'
export interface DefinitionValue {
  id: string
  name: string
  active: boolean
  sortOrder: number
}
export interface CatalogDefinition {
  id: string
  kind: DefinitionKind
  name: string
  active: boolean
  sortOrder: number
  version: number
  parentId?: string
  description?: string
  colorHex?: string
  gradientEnd?: string
  gradientAngle?: number
  contactName?: string
  phone?: string
  email?: string
  taxId?: string
  taxOffice?: string
  address?: string
  note?: string
  values?: DefinitionValue[]
}

export interface BundleDefinition {
  components: { variantId: string; quantity: number }[]
  priceMode: 'linked' | 'fixed'
  discountBps: number
  includeContents?: boolean
}

export interface BundleComponentSnapshot {
  variantId: string
  quantity: number
  title: string
  sku: string
  variantName: string
  unitCost: number
  taxRate: number
  costKnown: boolean
  catalogCurrency?: CurrencyCode
  catalogExchangeRate?: string
  exchangeRateDate?: string
}

export interface Product {
  id: string
  name: string
  category: string
  brand: string
  description: string
  art: ProductArt
  color: string
  taxRate: number
  currency?: CurrencyCode
  active: boolean
  lowStock: number
  variants: Variant[]
  images?: string[]
  imageMetadata?: Record<string, { alt?: string; axisId?: string; valueId?: string }>
  version?: number
  modelCode?: string
  subtitle?: string
  invoiceName?: string
  supplier?: string
  unit?: string
  origin?: string
  gtip?: string
  shortDescription?: string
  note?: string
  dimensions?: ProductDimensions
  variantAxes?: VariantAxis[]
  technicalAttributes?: ProductAttribute[]
  updatedAt?: string
  bundle?: BundleDefinition
  categoryId?: string
  brandId?: string
  supplierId?: string
}

export interface ProductPatch {
  changes?: Partial<Omit<Product, 'id' | 'variants' | 'version' | 'updatedAt'>>
  variants?: (Pick<Variant, 'id'> &
    Partial<Omit<Variant, 'id' | 'stock' | 'stockByWarehouse' | 'lowStockByWarehouse'>>)[]
  newVariants?: Variant[]
}

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  city: string
  address: string
  company?: string
  district?: string
  country?: string
  taxId?: string
  taxOffice?: string
  version?: number
}

export interface OrderLine {
  id?: string
  kind?: 'catalog' | 'free'
  variantId: string
  quantity: number
  unitPrice: number
  invoiceNetPrice?: number
  invoiceNetDiscount?: OrderDiscount
  currencyUnitPrice?: number
  currencyTotal?: number
  currencyDiscount?: OrderDiscount
  unitCost: number
  catalogCurrency?: CurrencyCode
  catalogExchangeRate?: string
  exchangeRateDate?: string
  taxRate: number
  externalId?: string
  externalSku?: string
  title?: string
  costKnown?: boolean
  taxKnown?: boolean
  externalBarcode?: string
  lineTotalOverride?: number
  invoiceTitle?: string
  unit?: string
  sku?: string
  barcode?: string
  variantName?: string
  discount?: OrderDiscount
  prepared?: boolean
  bundleComponents?: BundleComponentSnapshot[]
}

export interface OrderDiscount {
  kind: 'percent' | 'amount'
  /** Percent values use basis points; amount values use integer kuruş. */
  value: number
}
export interface OrderAddress {
  name: string
  address: string
  city: string
  phone: string
  district?: string
  postalCode?: string
  country?: string
}
export interface OrderNote {
  id: string
  text: string
  createdAt: string
  author?: string
}
export interface OrderFilters {
  from?: string
  to?: string
  query?: string
  statuses?: OrderStatus[]
  channel?: Channel
  storeId?: string
  cargoProvider?: string
  paid?: boolean
  invoiced?: boolean
  unmapped?: boolean
  ownShipment?: boolean
  printed?: boolean
}
export interface SavedOrderFilter {
  id: string
  name: string
  filters: OrderFilters
  version: number
}

export interface Order {
  id: string
  invoiceTiming?: InvoiceTiming
  marketplacePackages?: MarketplacePackage[]
  fulfillmentWorkflow?: OrderFulfillmentWorkflow
  reconciledRemoteHash?: string
  warehouseIds?: string[]
  stockAllocations?: StockAllocation[]
  currency?: CurrencyCode
  currencyRate?: { value: string; date: string; type: ExchangeRateType; source?: 'TCMB' | 'manual' }
  currencyShipping?: number
  priceInputIncludesVat?: boolean
  printStatus?: { printed: boolean; contentKey: string; at: string; author?: string }
  attachments?: {
    id: string
    name: string
    mime: string
    size: number
    author: string
    createdAt: string
  }[]
  number: string
  customerId: string
  shippingAddress?: OrderAddress
  channel: Channel
  storeId?: string
  status: OrderStatus
  createdAt: string
  dueAt: string
  lines: OrderLine[]
  shipping: number
  note: string
  notes?: OrderNote[]
  paymentMethod?: CashEntry['method']
  returnedAt?: string
  paid: boolean
  inventoryApplied: boolean
  invoiceId?: string
  events: { id: string; label: string; at: string }[]
  externalId?: string
  externalNumber?: string
  remoteStatus?: string
  historical?: boolean
  trackingNumber?: string
  cargoProvider?: string
  syncStatus?: 'pending' | 'synced' | 'error'
  remoteUpdatedAt?: string
  packageNumbers?: string[]
  syncError?: string
  shipmentMetadata?: { carrierName: string; carrierTaxId: string; date: string }
  totalOverride?: number
  invoicePreference?: 'default' | 'draft' | 'immediate'
  warehouseId?: string
  billingAddress?: {
    name: string
    address: string
    city: string
    district?: string
    phone: string
    taxId?: string
    taxOffice?: string
    postalCode?: string
    country?: string
  }
}

export interface Listing {
  id: string
  contentWorkflow?: ListingContentWorkflow
  productId: string
  variantId: string
  storeId: string
  channel: Exclude<Channel, 'manual'>
  status: ListingStatus
  error?: string
  priceOverride?: number
  listPriceOverride?: number
  remoteListPrice?: number
  marginExcluded?: boolean
  marginPriceSnapshot?: { price: number; listPrice?: number }
  titleOverride?: string
  updatedAt: string
  externalId?: string
  externalSku?: string
  asin?: string
  attributes?: Record<string, string | number>
  remoteCategoryId?: string
  externalBarcode?: string
  desiredStatus?: 'active' | 'archived'
  syncStatus?: 'idle' | 'queued' | 'syncing' | 'synced' | 'failed'
  lastSyncedAt?: string
  lastSent?: { price: number; listPrice?: number; quantity: number; archive: boolean }
  version?: number
  publishConfig?: PublishConfig
  publication?: PublicationState
}

export interface StockMovement {
  id: string
  variantId: string
  quantity: number
  type:
    | 'order'
    | 'retail'
    | 'return'
    | 'adjustment'
    | 'transfer'
    | 'purchase'
    | 'count'
    | 'entry'
    | 'exit'
  reference: string
  createdAt: string
  warehouseId?: string
  balance?: number
  author?: string
  transferId?: string
  reason?: string
}

export interface CashEntry {
  id: string
  amount: number
  kind: 'in' | 'out'
  description: string
  method: 'cash' | 'card' | 'transfer' | 'marketplace'
  reference: string
  createdAt: string
  customerId?: string
  transferId?: string
  warehouseId?: string
}

export interface Invoice {
  id: string
  number: string
  orderId?: string
  document?: InvoiceDocument
  issueDate?: string
  dueDate?: string
  title?: string
  note?: string
  categoryId?: string
  categoryName?: string
  remoteCategoryId?: string
  remoteCategoryName?: string
  tags?: string[]
  version?: number
  updatedAt?: string
  paymentCashId?: string
  localOnly?: boolean
  automatic?: boolean
  manualDocument?: {
    url: string
    number?: string
    linkedAt: string
    linkedBy?: string
    previousStatus: 'draft' | 'failed'
  }
  events?: { id: string; at: string; label: string }[]
  createdAt: string
  status: 'draft' | 'queued' | 'processing' | 'issued' | 'failed' | 'cancelled'
  externalId?: string
  documentNumber?: string
  url?: string
  error?: string
  connectionId?: string
  documentType?: 'e_archives' | 'e_invoices'
  documentId?: string
  issuedAt?: string
  uncertainJobId?: string
}

export interface InvoiceDocument {
  customerId: string
  billingAddress: NonNullable<Order['billingAddress']>
  sourceNumber?: string
  lines: OrderLine[]
  currency: CurrencyCode
  currencyRate?: Order['currencyRate']
  warehouseIds: string[]
  stockAllocations: StockAllocation[]
}
export interface InvoiceCategory {
  id: string
  name: string
  active: boolean
  version: number
}
export interface InvoiceInput {
  customerId: string
  number?: string
  sourceNumber?: string
  title: string
  note: string
  tags?: string[]
  categoryId?: string
  issueDate: string
  dueDate?: string
  currency: 'TRY' | 'USD' | 'EUR' | 'GBP'
  exchangeRate?: string
  rateSource?: 'TCMB' | 'manual'
  expectedExchangeRate?: string
  items: OrderItemInput[]
  warehouseId?: string
  billingAddress?: Order['billingAddress']
  localOnly: boolean
  expectedTotal?: number
  expectedTryTotal?: number
  payment?: { method: CashEntry['method']; at: string; warehouseId: string }
}

export interface RetailSale {
  id: string
  number: string
  customerId?: string
  lines: OrderLine[]
  total: number
  method: CashEntry['method']
  createdAt: string
  warehouseId?: string
  paidAmount?: number
  payments?: { method: 'cash' | 'card' | 'transfer'; amount: number }[]
  discount?: number
}

export interface Connection {
  id: string
  channel: Exclude<Channel, 'manual'>
  name: string
  active: boolean
}

/** Which alerts the header bell shows. Personal: saved per member, not per workspace. */
export interface NotificationPreferences {
  orders: boolean
  listings: boolean
  stock: boolean
}

export interface Preferences {
  businessName: string
  theme: 'light' | 'dark' | 'system'
  density: 'comfortable' | 'compact'
  orderColumns?: string[]
  notifications?: NotificationPreferences
}

/** The seller's legal and contact details, printed as the sender on order sheets. */
export interface BusinessProfile {
  legalName?: string
  taxOffice?: string
  taxId?: string
  phone?: string
  email?: string
  city?: string
  district?: string
  address?: string
}

export interface AppState {
  version: 1
  products: Product[]
  customers: Customer[]
  orders: Order[]
  listings: Listing[]
  movements: StockMovement[]
  cash: CashEntry[]
  invoices: Invoice[]
  invoiceSequence?: number
  invoiceCategories?: InvoiceCategory[]
  retailSales: RetailSale[]
  connections: Connection[]
  preferences: Preferences
  shipments?: Shipment[]
  warehouses?: Warehouse[]
  stockCounts?: StockCount[]
  returns?: SalesReturn[]
  expenses?: Expense[]
  customerEntries?: CustomerEntry[]
  marginRules?: MarginRule[]
  marginSettings?: MarginSettings[]
  categoryMappings?: CategoryMapping[]
  catalogValueMappings?: CatalogValueMapping[]
  settlementMatches?: SettlementMatch[]
  orderFilters?: SavedOrderFilter[]
  definitions?: CatalogDefinition[]
  stockTransfers?: StockTransfer[]
  exchangeRates?: ExchangeRates
  ecommerce?: EcommerceSettings
  business?: BusinessProfile
  orderReconciliations?: {
    id: string
    orderId: string
    at: string
    author: string
    sourceHash: string
    before: { lines: OrderLine[]; total: number; status: OrderStatus }
    afterTotal: number
    restockRemoved: boolean
    note: string
  }[]
}
export interface EcommerceSettings {
  version: number
  pricesIncludeVat: boolean
  exchangeRateType: ExchangeRateType
  defaultCurrency: CurrencyCode
  defaultTaxRate: number
  defaultOrigin: string
  lowStock: number
  criticalStock: number
  allowNegativeStock: boolean
  orderDays: number
  dueDays: number
  stockScope?: 'all' | 'selected'
  warehouseIds?: string[]
  invoiceTiming?: InvoiceTiming
  /** GS1 company prefix; generated barcodes are check-digited EAN-13s under it. */
  gs1Prefix?: string
  /** Own prefix for marketplaces that accept free-form barcodes, used without a GS1 prefix. */
  barcodePrefix?: string
}
export type InvoiceTiming = 'manual' | 'on_created' | 'on_approval' | 'on_shipped' | 'on_delivered'
export interface StockAllocation {
  warehouseId: string
  variantId: string
  quantity: number
  lineIndex?: number
}

export type OrderItemInput =
  | {
      kind?: 'catalog'
      variantId: string
      quantity: number
      unitPrice?: number
      taxRate?: number
      discount?: OrderDiscount
      bundleVersion?: number
    }
  | {
      kind: 'free'
      title: string
      unit?: string
      quantity: number
      unitPrice: number
      taxRate: number
      discount?: OrderDiscount
    }

export interface OrderInput {
  customerId: string
  channel: Channel
  items: OrderItemInput[]
  shipping: number
  note: string
  shippingAddress?: OrderAddress
  billingAddress?: Order['billingAddress']
  invoicePreference?: 'default' | 'draft' | 'immediate'
  invoiceConnectionId?: string
  externalNumber?: string
  paymentMethod?: CashEntry['method']
  paid?: boolean
  internalNote?: string
  warehouseId?: string
  currency?: CurrencyCode
  expectedExchangeRate?: string
  expectedTotal?: number
  expectedTryTotal?: number
  priceInputIncludesVat?: boolean
}

export interface RetailInput {
  customerId?: string
  items: { variantId: string; quantity: number; bundleVersion?: number }[]
  expectedTotal?: number
  method: 'cash' | 'card' | 'transfer'
  warehouseId?: string
  payments?: { method: 'cash' | 'card' | 'transfer'; amount: number }[]
  discount?: number
}

export type CoreCommand =
  | { type: 'order.create'; input: OrderInput }
  | {
      type: 'order.transition'
      id: string
      status: OrderStatus
      reason?: string
      restock?: boolean
      shipment?: { carrier: string; trackingNumber: string }
    }
  | { type: 'order.pay'; id: string; method?: CashEntry['method'] }
  | {
      type: 'order.prepare'
      id: string
      lineKeys: string[]
      ready: boolean
      expectedContent: string
    }
  | { type: 'order.note.add'; id: string; noteId: string; text: string }
  | { type: 'order.invoice'; id: string }
  | { type: 'invoice.create'; id: string; input: InvoiceInput }
  | {
      type: 'invoice.document.link'
      id: string
      expectedVersion: number
      expectedSource: string
      url: string
      number?: string
    }
  | { type: 'invoice.document.unlink'; id: string; expectedVersion: number }
  | {
      type: 'invoice.category.save'
      id: string
      name: string
      active: boolean
      expectedVersion: number
    }
  | { type: 'invoice.category.delete'; id: string; expectedVersion: number; expectedUsage: number }
  | { type: 'invoice.category.set'; id: string; categoryId: string | null; expectedVersion: number }
  | {
      type: 'invoice.pay.bulk'
      items: {
        id: string
        expectedTotal: number
        expectedVersion: number
        expectedPaymentId?: string
      }[]
      payment: NonNullable<InvoiceInput['payment']>
    }
  | { type: 'invoice.edit'; id: string; expectedVersion: number; input: InvoiceInput }
  | {
      type: 'invoice.pay'
      id: string
      expectedTotal: number
      expectedPaymentId?: string
      payment: NonNullable<InvoiceInput['payment']>
    }
  | { type: 'invoice.unpay'; id: string; expectedPaymentId: string }
  | {
      type: 'invoice.cancel' | 'invoice.restore' | 'invoice.delete'
      id: string
      expectedVersion: number
    }
  | { type: 'order.print'; id: string; printed: boolean; expectedContent: string }
  | { type: 'order.tax'; id: string; taxRate: number; expectedContent: string }
  | {
      type: 'order.invoice.preference'
      id: string
      preference: 'default' | 'draft' | 'immediate'
      connectionId?: string
    }
  | { type: 'order.filter.save'; filter: SavedOrderFilter }
  | { type: 'order.filter.delete'; id: string; version: number }
  | { type: 'retail.sale'; input: RetailInput }
  | { type: 'product.save'; product: Product }
  | { type: 'product.patch'; id: string; expectedVersion: number; patch: ProductPatch }
  | {
      type: 'stock.adjust'
      variantId: string
      quantity: number
      note: string
      warehouseId?: string
      expectedQuantity?: number
    }
  | { type: 'customer.save'; customer: Customer }
  | {
      type: 'listing.update'
      id: string
      status?: ListingStatus
      priceOverride?: number | null
      listPriceOverride?: number | null
      marginExcluded?: boolean
      titleOverride?: string | null
    }
  | { type: 'connection.update'; connection: Connection }
  | { type: 'preferences.update'; preferences: Preferences }
  | { type: 'ecommerce.settings'; settings: EcommerceSettings }
  | { type: 'business.update'; business: BusinessProfile }
  | { type: 'definition.save'; definition: CatalogDefinition }
  | { type: 'definition.delete'; id: string; version: number; expectedUsage: number }
  | {
      type: 'definition.value.delete'
      id: string
      valueId: string
      version: number
      expectedUsage: number
    }
  | {
      type: 'definition.move'
      id: string
      parentId?: string
      beforeId?: string
      expectedOrder: string
    }

export interface Warehouse {
  id: string
  name: string
  active: boolean
  code?: string
  city?: string
  district?: string
  address?: string
  phone?: string
  sortOrder?: number
  version?: number
}
export interface StockTransfer {
  id: string
  variantId: string
  from: string
  to: string
  quantity: number
  note: string
  createdAt: string
}
export interface StockCount {
  id: string
  name: string
  warehouseId: string
  status: 'open' | 'completed'
  baseline: Record<string, number>
  counts: Record<string, number>
  createdAt: string
  completedAt?: string
}
export interface SalesReturn {
  id: string
  source: 'retail' | 'order'
  saleId: string
  items: { lineIndex: number; quantity: number; amount: number; restock: boolean }[]
  refund: number
  note: string
  createdAt: string
}
export interface Expense {
  id: string
  number: string
  supplier: string
  category: string
  description: string
  amount: number
  paid: boolean
  method: 'cash' | 'card' | 'transfer'
  createdAt: string
  dueAt: string
  purchaseLines?: { variantId: string; quantity: number; unitCost: number }[]
}
export interface CustomerEntry {
  id: string
  customerId: string
  kind: 'debit' | 'credit'
  amount: number
  description: string
  createdAt: string
}
export interface MarginRule {
  id: string
  storeId: string
  scope: 'product' | 'desi' | 'priceRange' | 'brand' | 'category' | 'all'
  value: string
  base: 'cost' | 'price'
  markupBps: number
  commissionBps?: number
  fixedCost: number
  active: boolean
  version?: number
  kind?: 'percent' | 'amount' | 'fixed'
  direction?: 'increase' | 'decrease'
  amount?: number
  shippingCost?: number
  excluded?: boolean
  minimum?: number
  maximum?: number
  formula?: 'legacy' | 'costsBefore' | 'costsAfter'
}
export interface MarginSettings {
  storeId: string
  version: number
  enabled: boolean
  base: 'cost' | 'price'
  formula: 'costsBefore' | 'costsAfter'
  commissionMode: 'inside' | 'add'
  rounding: 'none' | 'up99' | 'up95' | 'ceil' | 'nearest'
  listPriceMode: 'same' | 'markup' | 'keep'
  listMarkupBps: number
}
export type CommerceCommand =
  | {
      type: 'stock.thresholds'
      variantId: string
      expected: Record<string, number>
      thresholds: Record<string, number>
    }
  | { type: 'warehouse.save'; warehouse: Warehouse }
  | { type: 'warehouse.delete'; id: string; version: number }
  | {
      type: 'stock.record'
      variantId: string
      warehouseId: string
      direction: 'in' | 'out'
      quantity: number
      reason: string
      note: string
      expectedQuantity: number
    }
  | {
      type: 'stock.transfer'
      variantId: string
      from: string
      to: string
      quantity: number
      note: string
    }
  | {
      type: 'stock.count.create'
      id: string
      name: string
      warehouseId: string
      variantIds: string[]
    }
  | { type: 'stock.count.complete'; id: string; counts: Record<string, number> }
  | {
      type: 'sale.return'
      id: string
      source: 'retail' | 'order'
      saleId: string
      items: { lineIndex: number; quantity: number; restock: boolean }[]
      refund: boolean
      method: 'cash' | 'card' | 'transfer'
      note: string
    }
  | {
      type: 'cash.record'
      id: string
      amount: number
      kind: 'in' | 'out'
      method: 'cash' | 'card' | 'transfer'
      description: string
      customerId?: string
    }
  | {
      type: 'cash.transfer'
      id: string
      from: 'cash' | 'card' | 'transfer'
      to: 'cash' | 'card' | 'transfer'
      amount: number
      description: string
    }
  | {
      type: 'customer.entry'
      id: string
      customerId: string
      kind: 'debit' | 'credit'
      amount: number
      description: string
    }
  | { type: 'expense.create'; expense: Omit<Expense, 'createdAt'>; warehouseId?: string }
  | { type: 'expense.pay'; id: string }
  | { type: 'margin.save'; rule: MarginRule }
  | { type: 'margin.delete'; id: string; version: number }
  | { type: 'margin.settings'; settings: MarginSettings }
  | { type: 'margin.apply'; storeId: string }
  | {
      type: 'product.bulk'
      ids: string[]
      expectedVersions: Record<string, number>
      change: { pricePercent?: number; category?: string; brand?: string; active?: boolean }
    }

export type Command = CoreCommand | CommerceCommand

export interface CommandResult {
  ok: boolean
  message: string
  id?: string
  jobId?: string
  entityVersion?: number
}

export interface Shipment {
  id: string
  uncertainJobId?: string
  orderId: string
  connectionId: string
  provider: string
  reference: string
  status: 'queued' | 'created' | 'in_transit' | 'delivered' | 'cancelled' | 'failed' | 'uncertain'
  trackingNumber?: string
  labelUrl?: string
  externalId?: string
  error?: string
  createdAt: string
  recipient?: { name: string; address: string; city: string; district: string; phone: string }
  packages?: number
  desi?: number
  weight?: number
  carrierBarcode?: string
  lastCheckedAt?: string
}
