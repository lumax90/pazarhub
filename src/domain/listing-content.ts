import type { MarketplaceProvider } from './integrations'

export interface ListingContentFields {
  title: string
  description: string
  images: string[]
}
export const contentDefinitions: Partial<
  Record<
    MarketplaceProvider,
    { fields: (keyof ListingContentFields)[]; maxImages: number; imageSlots?: boolean }
  >
> = {
  trendyol: { fields: ['title', 'description', 'images'], maxImages: 8 },
  hepsiburada: { fields: ['title', 'description', 'images'], maxImages: 10, imageSlots: true },
  n11: { fields: ['description'], maxImages: 0 },
  ciceksepeti: { fields: ['title', 'description', 'images'], maxImages: 8 },
  pttavm: { fields: ['title', 'description', 'images'], maxImages: 12 },
  toptantr: { fields: ['title', 'description', 'images'], maxImages: 12 },
}
export interface ListingContentWorkflow {
  jobId: string
  state: 'queued' | 'pending' | 'applied' | 'rejected' | 'uncertain'
  resourceKey: string
  message?: string
  reference?: string
  checkedAt?: string
  changes: Partial<ListingContentFields>
}
