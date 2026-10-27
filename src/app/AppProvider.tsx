import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { Check, CircleAlert, Info, X } from 'lucide-react'
import { Button } from '@heroui/react'
import { createSeedState } from '../domain/seed'
import { createEmptyState } from '../domain/empty-state'
import { hydrateDefinitionReferences, initializeDefinitions } from '../domain/definitions'
import { executeCommand } from '../domain/operations'
import type { AppState, Command, CommandResult } from '../domain/types'
import type { Permission } from '../domain/permissions'
import { api, ApiError, apiRequest } from '../lib/api'
import type { SessionResponse, WorkspaceResponse } from '../lib/api'
import { motionTransitions } from '../lib/motion'

const STORAGE_KEY = 'pazarhub.workspace.v1'
type Mode = 'demo' | 'live'
type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: string
  message: string
  kind: ToastKind
}
interface ContextValue {
  state: AppState
  getState: () => AppState
  mode: Mode
  session: SessionResponse | null
  status: 'loading' | 'ready' | 'error'
  connectionError: string | null
  revision: number
  run: (command: Command, options?: { silent?: boolean }) => Promise<CommandResult>
  notify: (message: string, kind?: ToastKind) => void
  reset: () => void
  resolvedTheme: 'light' | 'dark'
  changeMode: (mode: Mode) => void
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (input: {
    name: string
    workspaceName: string
    email: string
    password: string
  }) => Promise<void>
  logout: () => Promise<void>
  switchWorkspace: (id: string) => Promise<void>
  can: (permission: Permission) => boolean
}
const AppContext = createContext<ContextValue | null>(null)
function subscribeSystemTheme(callback: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
const systemThemeSnapshot = () => window.matchMedia('(prefers-color-scheme: dark)').matches
function initialMode(): Mode {
  try {
    const query = new URLSearchParams(location.search)
    if (query.has('invite') || query.has('reset')) return 'live'
    return sessionStorage.getItem('pazarhub.mode') === 'demo' ||
      new URLSearchParams(location.search).get('demo') === '1'
      ? 'demo'
      : 'live'
  } catch {
    return 'live'
  }
}
function loadDemo(): AppState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as AppState | null
    if (
      saved?.version === 1 &&
      Array.isArray(saved.products) &&
      Array.isArray(saved.orders) &&
      Array.isArray(saved.customers) &&
      Array.isArray(saved.connections) &&
      Array.isArray(saved.listings) &&
      Array.isArray(saved.movements) &&
      Array.isArray(saved.cash) &&
      Array.isArray(saved.invoices) &&
      Array.isArray(saved.retailSales) &&
      saved.preferences?.businessName &&
      saved.products.every((product) => Array.isArray(product.variants))
    ) {
      initializeDefinitions(saved)
      hydrateDefinitionReferences(saved)
      return saved
    }
  } catch {
    /* Demo records are isolated from server data. */
  }
  const state = createSeedState()
  initializeDefinitions(state)
  return state
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState(initialMode)
  const modeRef = useRef(mode)
  const [state, setState] = useState(() =>
    mode === 'demo' ? loadDemo() : createEmptyState('Çalışma alanı'),
  )
  const stateRef = useRef(state)
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [status, setStatus] = useState<ContextValue['status']>(
    mode === 'demo' ? 'ready' : 'loading',
  )
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)
  const generation = useRef(0)
  const inFlight = useRef(new Map<string, Promise<CommandResult>>())
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Set<number>())
  const systemDark = useSyncExternalStore(subscribeSystemTheme, systemThemeSnapshot, () => false)
  const resolvedTheme =
    (mode === 'live' && !session?.user) || state.preferences.theme === 'system'
      ? systemDark
        ? 'dark'
        : 'light'
      : state.preferences.theme

  const notify = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current.slice(-2), { id, message, kind }])
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
      timers.current.delete(timer)
    }, 4600)
    timers.current.add(timer)
  }, [])
  const commit = useCallback(
    (next: AppState, serverRevision?: number) => {
      if (
        modeRef.current === 'live' &&
        serverRevision !== undefined &&
        serverRevision !== 0 &&
        serverRevision < revisionRef.current
      )
        return
      stateRef.current = next
      setState(next)
      if (serverRevision !== undefined) {
        revisionRef.current = serverRevision
        setRevision(serverRevision)
      }
      if (modeRef.current === 'demo')
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          notify(
            'Tarayıcı depolaması kullanılamıyor. Değişiklikler bu oturumda saklanacak.',
            'error',
          )
        }
    },
    [notify],
  )

  const refresh = useCallback(async () => {
    if (modeRef.current !== 'live') return
    const current = generation.current
    try {
      const nextSession = await api.session()
      if (current !== generation.current) return
      setSession(nextSession)
      if (nextSession.user) {
        const data = await api.workspace()
        if (current !== generation.current) return
        commit(data.state, data.revision)
      } else commit(createEmptyState('Çalışma alanı'), 0)
      setConnectionError(null)
      setStatus('ready')
    } catch (error) {
      if (current === generation.current) {
        setConnectionError(error instanceof Error ? error.message : 'Sunucuya ulaşılamadı.')
        setStatus('error')
      }
    }
  }, [commit])

  useEffect(() => {
    const counter = generation
    let disposed = false
    if (mode === 'live')
      void Promise.resolve().then(() => {
        if (!disposed) return refresh()
      })
    return () => {
      disposed = true
      counter.current++
    }
  }, [mode, refresh])

  useEffect(() => {
    if (mode !== 'live' || !session?.user) return
    let busy = false,
      disposed = false
    const timer = window.setInterval(async () => {
      if (busy || document.hidden || inFlight.current.size) return
      busy = true
      try {
        const meta = await apiRequest<{ revision: number }>('/api/workspace/revision')
        if (!disposed && meta.revision > revisionRef.current) {
          const snapshot = await api.workspace()
          if (!disposed) commit(snapshot.state, snapshot.revision)
        }
      } catch (error) {
        if (!disposed && error instanceof ApiError && error.status === 401) {
          api.clear()
          setSession(null)
          commit(createEmptyState('Çalışma alanı'), 0)
        }
      } finally {
        busy = false
      }
    }, 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [mode, session?.user, commit])

  const run = useCallback(
    (command: Command, options?: { silent?: boolean }): Promise<CommandResult> => {
      const key = JSON.stringify(command)
      const pending = inFlight.current.get(key)
      if (pending) return pending
      const current = generation.current
      const promise = (async () => {
        try {
          const outcome =
            modeRef.current === 'demo'
              ? executeCommand(stateRef.current, command)
              : await api.command(command)
          if (current === generation.current) {
            if (outcome.result.ok || 'revision' in outcome)
              commit(outcome.state, 'revision' in outcome ? Number(outcome.revision) : undefined)
            if (!options?.silent)
              notify(outcome.result.message, outcome.result.ok ? 'success' : 'error')
          }
          return outcome.result
        } catch (error) {
          const message = error instanceof Error ? error.message : 'İşlem tamamlanamadı.'
          if (current === generation.current) {
            if (!options?.silent) notify(message, 'error')
            if (error instanceof ApiError && error.status === 401) {
              api.clear()
              setSession(null)
              commit(createEmptyState('Çalışma alanı'), 0)
            }
          }
          return { ok: false, message }
        }
      })().finally(() => {
        if (inFlight.current.get(key) === promise) inFlight.current.delete(key)
      })
      inFlight.current.set(key, promise)
      return promise
    },
    [commit, notify],
  )

  const changeMode = useCallback(
    (next: Mode) => {
      generation.current++
      modeRef.current = next
      api.clear()
      inFlight.current.clear()
      try {
        sessionStorage.setItem('pazarhub.mode', next)
        const url = new URL(location.href)
        url.searchParams.delete('demo')
        history.replaceState(null, '', url.pathname + url.search)
      } catch {
        /* Mode still works for this tab. */
      }
      setMode(next)
      setSession(null)
      setConnectionError(null)
      setStatus(next === 'demo' ? 'ready' : 'loading')
      commit(next === 'demo' ? loadDemo() : createEmptyState('Çalışma alanı'), 0)
    },
    [commit],
  )
  const authenticate = useCallback(
    async (next: SessionResponse, epoch: number) => {
      if (epoch !== generation.current || modeRef.current !== 'live') return
      const data: WorkspaceResponse = await api.workspace()
      if (epoch !== generation.current || modeRef.current !== 'live') return
      setSession(next)
      commit(data.state, data.revision)
      setStatus('ready')
      setConnectionError(null)
    },
    [commit],
  )
  const login = useCallback(
    async (email: string, password: string) => {
      const epoch = generation.current
      await authenticate(await api.login(email, password), epoch)
    },
    [authenticate],
  )
  const register = useCallback(
    async (input: { name: string; workspaceName: string; email: string; password: string }) => {
      const epoch = generation.current
      await authenticate(await api.register(input), epoch)
    },
    [authenticate],
  )
  const logout = useCallback(async () => {
    await api.logout()
    generation.current++
    setSession(null)
    commit(createEmptyState('Çalışma alanı'), 0)
    setStatus('ready')
  }, [commit])
  const switchWorkspace = useCallback(
    async (id: string) => {
      generation.current++
      const epoch = generation.current
      setStatus('loading')
      commit(createEmptyState('Çalışma alanı'), 0)
      try {
        await authenticate(await api.switchWorkspace(id), epoch)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Çalışma alanı açılamadı.', 'error')
        await refresh()
      }
    },
    [authenticate, commit, notify, refresh],
  )
  const reset = useCallback(() => {
    if (modeRef.current !== 'demo') {
      notify('Gerçek çalışma alanı bu düğmeyle sıfırlanamaz.', 'info')
      return
    }
    const next = createSeedState()
    initializeDefinitions(next)
    commit(next)
    notify('Örnek çalışma alanı yenilendi.')
  }, [commit, notify])
  const can = useCallback(
    (permission: Permission) =>
      mode === 'demo' || !!session?.user?.permissions.includes(permission),
    [mode, session],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.style.colorScheme = resolvedTheme
    document.documentElement.dataset.density = state.preferences.density
  }, [resolvedTheme, state.preferences.density])
  useEffect(() => {
    const current = timers.current
    return () => current.forEach(window.clearTimeout)
  }, [])

  return (
    <AppContext.Provider
      value={{
        state,
        getState: () => stateRef.current,
        mode,
        session,
        status,
        connectionError,
        revision,
        run,
        notify,
        reset,
        resolvedTheme,
        changeMode,
        refresh,
        login,
        register,
        logout,
        switchWorkspace,
        can,
      }}
    >
      <MotionConfig reducedMotion="user" transition={motionTransitions.standard}>
        {children}
        <div className="toast-stack" aria-live="polite" aria-relevant="additions">
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <motion.div
                layout
                key={toast.id}
                className={`app-toast app-toast--${toast.kind}`}
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 28 }}
                transition={motionTransitions.toast}
                role={toast.kind === 'error' ? 'alert' : 'status'}
              >
                <span className="toast-icon">
                  {toast.kind === 'success' ? (
                    <Check size={17} />
                  ) : toast.kind === 'error' ? (
                    <CircleAlert size={17} />
                  ) : (
                    <Info size={17} />
                  )}
                </span>
                <span>{toast.message}</span>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label="Bildirimi kapat"
                  onPress={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}
                >
                  <X size={15} />
                </Button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </MotionConfig>
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
