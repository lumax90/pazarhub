import type { AppState } from '../../src/domain/types'
import type { Listing } from '../../src/domain/types'
import { listingPrice, listingListPrice, listingQuantity } from '../../src/domain/selectors'
import { storeWarehouseIds } from '../../src/domain/stock-allocation'
import type { PublicationState } from '../../src/domain/publishing'
import type { PublicationPlan } from '../publishing/types'
import type { MarketplacePackage } from '../../src/domain/order-fulfillment'
import type { ListingContentWorkflow } from '../../src/domain/listing-content'
import type {
  IntegrationOperation,
  IntegrationSettings,
  ProviderId,
  RemoteOrder,
  RemoteProduct,
} from '../../src/domain/integrations'

export interface AdapterContext {
  connectionId: string
  workspaceId: string
  provider: ProviderId
  credentials: Record<string, string>
  settings: IntegrationSettings
  integrationName: string
  /** Our Hepsiburada integrator username; unset until Hepsiburada issues one. */
  hepsiburadaIntegrator?: string
  state: AppState
}

export interface AdapterResult {
  message: string
  nextPayload?: Record<string, unknown>
  delaySeconds?: number
  products?: RemoteProduct[]
  orders?: RemoteOrder[]
  records?: {
    id: string
    resource: 'question' | 'claim' | 'settlement'
    data: Record<string, unknown>
  }[]
  reference?: string
  listingStatus?: 'active' | 'archived'
  publication?: {
    listingId: string
    state: PublicationState
    externalId?: string
    attributes?: Record<string, string | number>
    plan: PublicationPlan
    members?: {
      listingId: string
      state: PublicationState
      externalId?: string
      attributes?: Record<string, string | number>
    }[]
  }
  failure?: { code: string; message: string }
  resolution?: { outcome: 'confirmed' | 'resume'; nextPayload?: Record<string, unknown> }
  orderFulfillment?: {
    orderId: string
    confirmed: boolean
    packages: MarketplacePackage[]
    labels?: {
      packageId: string
      data: string
      mime: 'text/plain' | 'application/pdf'
      encoding: 'utf8' | 'base64'
    }[]
  }
  contentUpdate?: {
    listingId: string
    state: 'pending' | 'applied' | 'rejected'
    message: string
    resourceKey: string
    changes: ListingContentWorkflow['changes']
  }
  marketplaceAction?: {
    resource: 'question' | 'claim'
    externalId: string
    answer?: string
    itemIds?: string[]
    confirmed: boolean
    decision?: 'approve' | 'reject' | 'investigate'
  }
  financialDetails?: { paymentOrderId: string }
  invoice?: {
    externalId?: string
    remoteCategoryId?: string
    remoteCategoryName?: string
    documentNumber?: string
    url?: string
    status: 'draft' | 'processing' | 'issued'
    finalizeAfterSeconds?: number
    documentType?: 'e_archives' | 'e_invoices'
    documentId?: string
    issuedAt?: string
    pdfUrl?: string
  }
  shipment?: {
    externalId: string
    trackingNumber?: string
    labelUrl?: string
    status: 'created' | 'in_transit' | 'delivered' | 'cancelled'
    label?: {
      data: string
      encoding: 'base64' | 'utf8'
      mime: 'image/png' | 'application/pdf' | 'text/plain'
    }
  }
}

export interface ProviderAdapter {
  capabilities: readonly IntegrationOperation[]
  execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult>
}

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
export const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : ''
export const integer = (value: unknown, fallback = 0) => {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : fallback
}
export const remoteInteger = (value: unknown, fallback = -1) =>
  value === null ||
  value === undefined ||
  typeof value === 'boolean' ||
  (typeof value === 'string' && !value.trim())
    ? fallback
    : integer(value, fallback)
export function cents(value: unknown) {
  if (value === null || value === undefined || value === '') return NaN
  const number = Number(value)
  const result = Math.round(number * 100)
  return Number.isFinite(number) && Number.isSafeInteger(result) && result >= 0 ? result : NaN
}
export function iso(value: unknown, fallback = new Date().toISOString()) {
  const date = new Date(typeof value === 'number' ? value : text(value))
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}
export const urls = (values: unknown) =>
  array(values)
    .map((value) => (typeof value === 'string' ? value : text(record(value).url)))
    .filter((value) => {
      try {
        const url = new URL(value)
        return (
          url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )
      } catch {
        return false
      }
    })
export const pathPart = (value: string) => encodeURIComponent(value)

export function inventoryValues(
  context: AdapterContext,
  listing: Listing,
  payload: Record<string, unknown>,
) {
  const planned = record(payload.inventoryPlan)
  return {
    price: typeof planned.price === 'number' ? planned.price : listingPrice(context.state, listing),
    listPrice:
      typeof planned.listPrice === 'number'
        ? planned.listPrice
        : typeof planned.price === 'number'
          ? planned.price
          : listingListPrice(context.state, listing),
    quantity:
      typeof planned.quantity === 'number'
        ? planned.quantity
        : listingQuantity(
            context.state,
            listing,
            context.settings.stockBuffer,
            storeWarehouseIds(context.state, context.settings),
          ),
  }
}
