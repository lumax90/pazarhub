import type { MarketplaceProvider } from './integrations'

export type MarketplaceOrderAction = 'prepare' | 'pack' | 'label' | 'ship' | 'cancel'
export const fulfillmentProviders: MarketplaceProvider[] = [
  'trendyol',
  'hepsiburada',
  'toptantr',
  'pttavm',
  'amazon',
  'n11',
  'ciceksepeti',
  'pazarama',
]
export interface MarketplacePackage {
  id: string
  number: string
  status: string
  trackingNumber?: string
  trackingUrl?: string
  carrier?: string
  lines: { id: string; quantity: number }[]
  labels?: { id: string; name: string; url: string }[]
}
export interface OrderFulfillmentView {
  provider: MarketplaceProvider
  orderNumber: string
  packages: MarketplacePackage[]
  lines: {
    id: string
    name: string
    sku: string
    quantity: number
    status: string
    packageId?: string
    packable: boolean
    preparable?: boolean
    cancellable: boolean
  }[]
  actions: MarketplaceOrderAction[]
  cancellationReasons: { id: string; label: string }[]
  fingerprint: string
  carriers?: { id: string; label: string; contracted: boolean }[]
  warehouses?: { id: string; label: string }[]
  shipCreatesPackage?: boolean
}
export interface OrderFulfillmentInput {
  action: MarketplaceOrderAction
  lines: { id: string; quantity: number }[]
  packageId?: string
  reasonId?: string
  parcels: number
  desi: number
  trackingNumber?: string
  trackingUrl?: string
  shippedAt?: string
  carrierId?: string
  carrierName?: string
  warehouseId?: string
  weight?: number
  width?: number
  height?: number
  length?: number
}
export interface OrderFulfillmentPlan extends OrderFulfillmentInput {
  orderId: string
  externalId: string
  orderNumber: string
  localKey: string
  remoteKey: string
  reference: string
}
export interface OrderFulfillmentWorkflow {
  jobId: string
  action: MarketplaceOrderAction
  state: 'queued' | 'pending' | 'confirmed' | 'uncertain' | 'failed'
  message?: string
  updatedAt: string
}
export const marketplaceActionLabels: Record<MarketplaceOrderAction, string> = {
  prepare: 'Hazırlanıyor bildir',
  pack: 'Paket hazırla',
  label: 'Etiket al',
  ship: 'Kargoya verildi bildir',
  cancel: 'Pazaryerinde iptal et',
}
