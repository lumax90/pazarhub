export type Role = 'owner' | 'manager' | 'operator' | 'accountant' | 'viewer'
export type Permission =
  | 'workspace.read'
  | 'workspace.manage'
  | 'catalog.write'
  | 'orders.write'
  | 'stock.write'
  | 'retail.write'
  | 'finance.write'
  | 'integrations.manage'
  | 'team.manage'

export const roleLabels: Record<Role, string> = {
  owner: 'Kurucu',
  manager: 'Yönetici',
  operator: 'Operatör',
  accountant: 'Muhasebe',
  viewer: 'İzleyici',
}
const all: Permission[] = [
  'workspace.read',
  'workspace.manage',
  'catalog.write',
  'orders.write',
  'stock.write',
  'retail.write',
  'finance.write',
  'integrations.manage',
  'team.manage',
]
export const rolePermissions: Record<Role, readonly Permission[]> = {
  owner: all,
  manager: all,
  operator: ['workspace.read', 'catalog.write', 'orders.write', 'stock.write', 'retail.write'],
  accountant: ['workspace.read', 'finance.write'],
  viewer: ['workspace.read'],
}

export function jobPermission(kind: string): Permission {
  if (kind.startsWith('invoice.') || kind === 'claim.decide' || kind === 'settlements.pull')
    return 'finance.write'
  if (
    kind.startsWith('shipment.') ||
    kind.startsWith('order.fulfillment') ||
    ['question.answer', 'questions.pull', 'claims.pull'].includes(kind)
  )
    return 'orders.write'
  if (kind.startsWith('listing.')) return 'catalog.write'
  return 'integrations.manage'
}

export const freshRequestJobs = [
  'listing.publish',
  'listing.content',
  'question.answer',
  'claim.decide',
  'order.fulfillment',
]
