import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../app/AppProvider'
import { apiRequest } from './api'

export function useResource<T>(path: string | null, pollMilliseconds = 0) {
  const { mode, session } = useApp()
  const key = `${mode}:${session?.workspace?.id ?? ''}:${path ?? ''}`
  const [result, setResult] = useState<{ key: string; data: T | null; error: string } | null>(null)
  const epoch = useRef(0)
  const reload = useCallback(async () => {
    if (!path || mode !== 'live') return
    const current = ++epoch.current
    try {
      const data = await apiRequest<T>(path)
      if (current === epoch.current) setResult({ key, data, error: '' })
    } catch (problem) {
      if (current === epoch.current)
        setResult({
          key,
          data: null,
          error: problem instanceof Error ? problem.message : 'Veriler yüklenemedi.',
        })
    }
  }, [path, mode, key])
  useEffect(() => {
    let disposed = false
    const counter = epoch
    void Promise.resolve().then(() => {
      if (!disposed) return reload()
    })
    const timer = pollMilliseconds
      ? window.setInterval(() => {
          if (!document.hidden) void reload()
        }, pollMilliseconds)
      : undefined
    return () => {
      disposed = true
      counter.current++
      if (timer) clearInterval(timer)
    }
  }, [reload, pollMilliseconds])
  const current = result?.key === key ? result : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? '',
    loading: !!path && mode === 'live' && !current,
    reload,
  }
}
