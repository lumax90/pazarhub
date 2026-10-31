import type { Channel } from './types'

export type MarketplaceProvider = Exclude<Channel, 'manual'>
export type CargoProvider = 'yurtici' | 'dhl' | 'aras' | 'ptt'
export type ProviderId = MarketplaceProvider | CargoProvider | 'parasut'
export type IntegrationKind = 'marketplace' | 'cargo' | 'invoice'
export type IntegrationOperation =
  | 'test'
  | 'catalog.pull'
  | 'orders.pull'
  | 'inventory.push'
  | 'listing.publish'
  | 'listing.status'
  | 'listing.content'
  | 'listing.content.status'
  | 'order.update'
  | 'order.fulfillment'
  | 'order.fulfillment.status'
  | 'invoice.link'
  | 'questions.pull'
  | 'question.answer'
  | 'claims.pull'
  | 'claim.decide'
  | 'settlements.pull'
  | 'shipment.create'
  | 'shipment.track'
  | 'shipment.cancel'
  | 'shipment.reconcile'
  | 'invoice.create'
  | 'invoice.finalize'
  | 'invoice.status'
  | 'invoice.reconcile'
export interface CredentialField {
  key: string
  label: string
  secret?: boolean
  required?: boolean
  placeholder?: string
}
export interface ProviderDefinition {
  id: ProviderId
  name: string
  kind: IntegrationKind
  fields: CredentialField[]
  docsUrl: string
  note?: string
}

const field = (key: string, label: string, secret = false, required = true): CredentialField => ({
  key,
  label,
  secret,
  required,
})
export const providers: ProviderDefinition[] = [
  {
    id: 'trendyol',
    name: 'Trendyol',
    kind: 'marketplace',
    fields: [
      field('sellerId', 'Satıcı ID'),
      field('apiKey', 'API Key', true),
      field('apiSecret', 'API Secret', true),
    ],
    docsUrl: 'https://developers.trendyol.com/',
  },
  {
    id: 'hepsiburada',
    name: 'Hepsiburada',
    kind: 'marketplace',
    fields: [
      field('merchantId', 'Merchant ID'),
      field('username', 'Entegratör kullanıcı adı'),
      field('password', 'Servis anahtarı', true),
    ],
    docsUrl: 'https://developers.hepsiburada.com/',
    note: 'Servis anahtarını satıcı panelinde Bilgilerim → Entegrasyon → Entegratör Bilgileri bölümünden, seçtiğiniz entegratör için oluşturun. Kullanıcı adı o entegratörün adıdır.',
  },
  {
    id: 'n11',
    name: 'n11',
    kind: 'marketplace',
    fields: [field('appKey', 'API Key', true), field('appSecret', 'API Secret', true)],
    docsUrl: 'https://developer.n11.com/',
  },
  {
    id: 'amazon',
    name: 'Amazon Türkiye',
    kind: 'marketplace',
    fields: [
      field('sellerId', 'Seller ID'),
      field('clientId', 'LWA Client ID'),
      field('clientSecret', 'LWA Client Secret', true),
      field('refreshToken', 'Refresh Token', true),
    ],
    docsUrl: 'https://developer-docs.amazon.com/sp-api/',
    note: 'Türkiye pazaryeri ve satıcı gönderimli siparişler. SP-API uygulama yetkileri gerekir.',
  },
  {
    id: 'ciceksepeti',
    name: 'Çiçeksepeti',
    kind: 'marketplace',
    fields: [field('sellerId', 'Satıcı ID'), field('apiKey', 'API Key', true)],
    docsUrl: 'https://ciceksepeti.dev/',
    note: 'API anahtarı ilk kez Çiçeksepeti destekten "API Entegrasyon Süreçleri" talebiyle alınır; sonra Hesap Yönetimi → Entegrasyon Bilgilerim\'de görünür. Aynı alanda Entegratör Adı olarak Pazarhub yazın. Bağlantı testi 10 dakikada bir tekrarlanabilir.',
  },
  {
    id: 'pazarama',
    name: 'Pazarama',
    kind: 'marketplace',
    fields: [
      field('clientId', 'API Key / Client ID'),
      field('clientSecret', 'API Secret', true),
      field('sellerId', 'Paketleme için Satıcı ID (GUID)', false, false),
    ],
    docsUrl: 'https://isortagim.pazarama.com/auth/integration',
  },
  {
    id: 'pttavm',
    name: 'PttAVM',
    kind: 'marketplace',
    fields: [
      field('shopId', 'Mağaza ID'),
      field('apiKey', 'API Key', true),
      field('accessToken', 'Access Token', true),
    ],
    docsUrl: 'https://developers.pttavm.com/',
    note: 'Güncel REST API için sağlayıcının verdiği API Key ve Access Token gerekir. Süresi dolan token bağlantıdan yenilenir.',
  },
  {
    id: 'toptantr',
    name: 'ToptanTR',
    kind: 'marketplace',
    fields: [field('username', 'API kullanıcı adı'), field('password', 'API parolası', true)],
    docsUrl: 'https://sapi.toptantr.com/sapi/docs',
    note: 'API kullanıcı adı ve parolası ToptanTR tarafından verilir. Ayrı test ortamı desteklenir.',
  },
  {
    id: 'yurtici',
    name: 'Yurtiçi Kargo',
    kind: 'cargo',
    fields: [
      field('username', 'Web servis kullanıcı adı'),
      field('password', 'Web servis parolası', true),
      field('customerCode', 'Müşteri kodu', false, false),
      field('testReference', 'Test için hesaba ait kargo referansı'),
    ],
    docsUrl: 'https://www.yurticikargo.com/',
  },
  {
    id: 'dhl',
    name: 'DHL eCommerce',
    kind: 'cargo',
    fields: [
      field('customerNumber', 'Müşteri numarası'),
      field('password', 'API şifresi', true),
      field('clientId', 'Client ID'),
      field('clientSecret', 'Client Secret', true),
    ],
    docsUrl: 'https://developer.dhl.com/',
    note: 'Türkiye eCommerce/MNG hesabının API erişimi gerekir.',
  },
  {
    id: 'aras',
    name: 'Aras Kargo',
    kind: 'cargo',
    fields: [
      field('username', 'Web servis kullanıcı adı'),
      field('password', 'Web servis parolası', true),
      field('customerCode', 'Müşteri kodu'),
      field('testReference', 'Test için hesaba ait entegrasyon kodu'),
    ],
    docsUrl: 'https://www.araskargo.com.tr/',
  },
  {
    id: 'ptt',
    name: 'PTT Kargo',
    kind: 'cargo',
    fields: [
      field('username', 'Web servis kullanıcı adı'),
      field('password', 'Web servis parolası', true),
      field('customerCode', 'Müşteri numarası'),
      field('testReference', 'Test için hesaba ait gönderi barkodu'),
      field('shipmentType', 'Sözleşmedeki gönderi tipi kodu'),
      field('shipmentKind', 'Sözleşmedeki gönderi türü kodu'),
    ],
    docsUrl: 'https://www.ptt.gov.tr/',
  },
  {
    id: 'parasut',
    name: 'Paraşüt',
    kind: 'invoice',
    fields: [
      field('clientId', 'Client ID'),
      field('clientSecret', 'Client Secret', true),
      field('email', 'Paraşüt e-posta'),
      field('password', 'Paraşüt parolası', true),
      field('companyId', 'Company ID'),
    ],
    docsUrl: 'https://apidocs.parasut.com/',
  },
]

export interface IntegrationSettings {
  environment: 'production' | 'sandbox'
  warehouseId?: string
  pullOrders: boolean
  pullCatalog: boolean
  pushInventory: boolean
  pullQuestions: boolean
  pullClaims: boolean
  pullSettlements: boolean
  invoiceConnectionId?: string
  cargoConnectionId?: string
  invoiceMode: 'workspace' | 'manual' | 'on_approval'
  sendInvoiceLink?: boolean
  finalizeInvoices: boolean
  finalizeDelayMinutes: number
  stockBuffer: number
  autoApproveOrders: boolean
  senderName?: string
  senderPhone?: string
  senderAddress?: string
  senderCity?: string
  senderDistrict?: string
}

export const defaultIntegrationSettings: IntegrationSettings = {
  environment: 'production',
  pullOrders: false,
  pullCatalog: false,
  pushInventory: false,
  pullQuestions: false,
  pullClaims: false,
  pullSettlements: false,
  invoiceMode: 'manual',
  sendInvoiceLink: true,
  finalizeInvoices: false,
  finalizeDelayMinutes: 60,
  stockBuffer: 0,
  autoApproveOrders: false,
}

export interface PublicIntegration {
  id: string
  provider: ProviderId
  kind: IntegrationKind
  name: string
  enabled: boolean
  isDefault?: boolean
  status: 'configured' | 'testing' | 'verified' | 'degraded' | 'failed' | 'paused'
  settings: IntegrationSettings
  configuredFields: string[]
  identity: Record<string, string>
  capabilities: IntegrationOperation[]
  lastTestAt: string | null
  lastError: string | null
  createdAt: string
  /** Latest run of each sync the connection card reports on (listing endpoint only). */
  activity?: Partial<Record<SyncOperation, SyncRun>>
}

export const syncOperations = [
  'orders.pull',
  'catalog.pull',
  'questions.pull',
  'claims.pull',
  'settlements.pull',
] as const
export type SyncOperation = (typeof syncOperations)[number]
export interface SyncRun {
  status: IntegrationJob['status']
  /** When it finished, or when it was queued if still open. */
  at: string
  error: string | null
}

export interface IntegrationJob {
  id: string
  connectionId: string | null
  connectionName?: string
  kind: IntegrationOperation | 'inventory.reconcile'
  entityId: string | null
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'uncertain' | 'cancelled'
  attempts: number
  maxAttempts: number
  lastError: string | null
  result: Record<string, unknown> | null
  createdAt: string
  availableAt: string
  finishedAt: string | null
}

export interface RemoteProduct {
  externalId: string
  sku: string
  barcode: string
  title: string
  price: number
  listPrice?: number
  quantity: number
  category?: string
  categoryId?: string
  brand?: string
  taxRate?: number
  images: string[]
  attributes?: Record<string, string | number>
  asin?: string
  status?: 'active' | 'pending' | 'rejected' | 'archived'
}

export interface RemoteOrder {
  externalId: string
  number: string
  createdAt: string
  modifiedAt: string
  status: string
  total: number
  shipping: number
  recipient: {
    name: string
    address: string
    city: string
    district: string
    phone: string
    country: string
    email?: string
    taxId?: string
  }
  billing?: {
    name: string
    address: string
    city: string
    district?: string
    phone: string
    taxId?: string
    taxOffice?: string
  }
  lines: {
    externalId: string
    status?: 'pending' | 'shipped' | 'delivered' | 'cancelled' | 'returned'
    sku: string
    barcode: string
    title: string
    quantity: number
    unitPrice: number
    taxRate?: number
    total?: number
  }[]
  normalizedStatus?: 'pending' | 'shipped' | 'delivered' | 'cancelled' | 'returned'
  trackingNumber?: string
  cargoProvider?: string
  packageNumbers?: string[]
  requiresReconciliation?: string
}
