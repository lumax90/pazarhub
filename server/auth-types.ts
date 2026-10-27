import type { Permission, Role } from '../src/domain/permissions'

export interface AuthContext {
  userId: string
  workspaceId: string
  email: string
  name: string
  /** Picks the user's generated avatar; null means "derive it from the user id". */
  avatarSeed: string | null
  workspaceName: string
  role: Role
  permissions: readonly Permission[]
  csrfToken: string
  sessionHash: string
  preferences: {
    theme?: 'light' | 'dark' | 'system'
    density?: 'comfortable' | 'compact'
    orderColumns?: string[]
    notifications?: { orders: boolean; listings: boolean; stock: boolean }
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
}
