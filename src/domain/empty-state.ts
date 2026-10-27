import type { AppState } from './types'
import { emptyDefinitions } from './definitions'

export function createEmptyState(businessName: string): AppState {
  return {
    version: 1,
    products: [],
    customers: [],
    orders: [],
    listings: [],
    movements: [],
    cash: [],
    invoices: [],
    retailSales: [],
    connections: [],
    definitions: emptyDefinitions(),
    preferences: { businessName, theme: 'light', density: 'comfortable' },
  }
}
