import type { AppState, Command, CommandResult } from '../domain/types'
import type { Permission, Role } from '../domain/permissions'

export interface SessionResponse {
  user: { id: string; name: string; email: string; role: Role; permissions: Permission[] } | null
  workspace?: { id: string; name: string }
  workspaces?: { id: string; name: string; role: Role }[]
  csrfToken?: string
  registrationEnabled: boolean
}
export interface WorkspaceResponse {
  state: AppState
  revision: number
  serverTime: string
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: { path: string; message: string }[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let csrfToken: string | undefined
let workspaceId: string | undefined
let userId: string | undefined
let sessionEpoch = 0
const operationKeys = new Map<string, string>()

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    key?: string
    signal?: AbortSignal
    businessResponse?: boolean
  } = {},
): Promise<T> {
  let response: Response
  const multipart = options.body instanceof FormData
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      signal: options.signal ?? AbortSignal.timeout(30000),
      headers: {
        ...(options.body !== undefined && !multipart ? { 'content-type': 'application/json' } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
        ...(options.key ? { 'idempotency-key': options.key } : {}),
      },
      body: multipart
        ? (options.body as FormData)
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(
      0,
      'NETWORK_UNAVAILABLE',
      'Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.',
    )
  }
  const data = await response.json().catch(() => null)
  if (!response.ok && !(options.businessResponse && response.status === 422 && data?.result))
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'API_ERROR',
      data?.error?.message ?? 'İşlem tamamlanamadı.',
      data?.error?.fields,
    )
  return data as T
}

/** Retains only an opaque request key while a write's HTTP outcome is unknown. */
export async function apiMutation<T>(
  path: string,
  body: unknown,
  options: { method?: string; businessResponse?: boolean } = {},
) {
  const scope = `${userId}:${workspaceId}`,
    method = options.method ?? 'POST'
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ path, method, body })),
  )
  if (scope !== `${userId}:${workspaceId}`)
    throw new ApiError(
      409,
      'WORKSPACE_CHANGED',
      'Çalışma alanı değişti. Güncel alanda tekrar deneyin.',
    )
  const fingerprint = `${scope}:${Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`
  const storageKey = `pazarhub.pending.${fingerprint}`
  let saved: string | null = null
  try {
    saved = sessionStorage.getItem(storageKey)
  } catch {
    /* Memory fallback. */
  }
  const key = operationKeys.get(fingerprint) ?? saved ?? crypto.randomUUID()
  operationKeys.set(fingerprint, key)
  try {
    sessionStorage.setItem(storageKey, key)
  } catch {
    /* Memory fallback. */
  }
  const clear = () => {
    operationKeys.delete(fingerprint)
    try {
      sessionStorage.removeItem(storageKey)
    } catch {
      /* Memory fallback. */
    }
  }
  try {
    const result = await apiRequest<T>(path, { ...options, method, body, key })
    clear()
    return result
  } catch (error) {
    if (error instanceof ApiError && error.status > 0 && error.status < 500) clear()
    throw error
  }
}

export const api = {
  async session() {
    const epoch = sessionEpoch
    const session = await apiRequest<SessionResponse>('/api/session')
    if (epoch === sessionEpoch) {
      csrfToken = session.csrfToken
      workspaceId = session.workspace?.id
      userId = session.user?.id
    }
    return session
  },
  workspace: () => apiRequest<WorkspaceResponse>('/api/workspace'),
  async login(email: string, password: string) {
    await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } })
    workspaceId = undefined
    return this.session()
  },
  async register(input: { name: string; workspaceName: string; email: string; password: string }) {
    await apiRequest('/api/auth/register', { method: 'POST', body: input })
    workspaceId = undefined
    return this.session()
  },
  async logout() {
    await apiRequest('/api/auth/logout', { method: 'POST', body: {} })
    this.clear()
  },
  async switchWorkspace(id: string) {
    await apiRequest('/api/workspaces/switch', { method: 'POST', body: { workspaceId: id } })
    workspaceId = undefined
    return this.session()
  },
  async command(command: Command) {
    return apiMutation<WorkspaceResponse & { result: CommandResult }>('/api/commands', command, {
      businessResponse: true,
    })
  },
  clear() {
    sessionEpoch++
    csrfToken = undefined
    workspaceId = undefined
    userId = undefined
    operationKeys.clear()
  },
}
