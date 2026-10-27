import type { Permission, Role } from '../src/domain/permissions'

export interface AuthContext {
  userId: string
  workspaceId: string
  email: string
  name: string
  workspaceName: string
  role: Role
  permissions: readonly Permission[]
  csrfToken: string
  sessionHash: string
  preferences: {
    theme?: 'light' | 'dark' | 'system'
    density?: 'comfortable' | 'compact'
    orderColumns?: string[]
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
}
