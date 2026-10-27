import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button, SurfaceContext } from '@heroui/react'
import {
  ArrowRight,
  Check,
  Layers3,
  LockKeyhole,
  Package,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useApp } from './AppProvider'
import { api, apiRequest } from '../lib/api'
import { useResource } from '../lib/useResource'
import { Field } from '../components/ui/shared'
import { PASSWORD_HINT } from '../domain/auth-policy'
import { useRevealMotion } from '../lib/motion'

type Screen = 'login' | 'register' | 'forgot' | 'reset' | 'invite'
export function SessionGate({ children }: { children: ReactNode }) {
  const reveal = useRevealMotion()
  const app = useApp()
  const [invite, setInvite] = useState(() => new URLSearchParams(location.search).get('invite'))
  const [resetToken, setResetToken] = useState(() =>
    new URLSearchParams(location.search).get('reset'),
  )
  const [screen, setScreen] = useState<Screen>(resetToken ? 'reset' : invite ? 'invite' : 'login')
  const preview = useResource<{ name: string; email: string; role: string }>(
    invite ? `/api/invitations/preview?token=${encodeURIComponent(invite)}` : null,
  )
  const [name, setName] = useState(''),
    [workspaceName, setWorkspaceName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const clearLinks = () => {
    const url = new URL(location.href)
    url.searchParams.delete('invite')
    url.searchParams.delete('reset')
    history.replaceState(null, '', url.pathname + url.search)
    setInvite(null)
    setResetToken(null)
  }
  if (
    app.mode === 'demo' ||
    (!invite && !resetToken && app.status !== 'loading' && app.session?.user)
  )
    return children
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (screen === 'login') {
        await app.login(email, password)
        if (invite) setScreen('invite')
      }
      if (screen === 'register') await app.register({ name, workspaceName, email, password })
      if (screen === 'forgot') {
        const result = await apiRequest<{ message: string }>('/api/auth/forgot-password', {
          method: 'POST',
          body: { email },
        })
        setMessage(result.message)
      }
      if (screen === 'reset') {
        await apiRequest('/api/auth/reset-password', {
          method: 'POST',
          body: { token: resetToken, password },
        })
        api.clear()
        clearLinks()
        await app.refresh()
        setScreen('login')
        setPassword('')
        setMessage('Parolanız yenilendi. Yeni parolanızla giriş yapın.')
      }
      if (screen === 'invite') {
        await apiRequest('/api/auth/accept-invitation', {
          method: 'POST',
          body: {
            token: invite,
            name: name || app.session?.user?.name,
            password: app.session?.user ? undefined : password,
          },
        })
        clearLinks()
        await app.refresh()
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusy(false)
    }
  }
  const headings: Record<Screen, [string, string, string]> = {
    login: ['Tekrar hoş geldiniz.', 'Çalışma alanınıza giriş yapın.', 'Giriş yap'],
    register: [
      'İşinize yeni bir başlangıç.',
      'Hesabınızı ve ilk çalışma alanınızı oluşturun.',
      'Çalışma alanını oluştur',
    ],
    forgot: [
      'Parolanızı yenileyin.',
      'E-posta adresinize bir yenileme bağlantısı göndereceğiz.',
      'Bağlantı gönder',
    ],
    reset: ['Yeni bir parola belirleyin.', PASSWORD_HINT, 'Parolayı yenile'],
    invite: [
      'Ekibinize katılın.',
      preview.data
        ? `${preview.data.name} · ${preview.data.email}`
        : 'Davet bilgileri doğrulanıyor.',
      'Daveti kabul et',
    ],
  }
  const heading = headings[screen]
  return (
    <div className="auth-page">
      <motion.div className="auth-layout" {...reveal}>
        <section className="auth-story">
          <div className="auth-brand">
            <span>
              <Package size={27} />
            </span>
            pazarhub<span>.</span>
          </div>
          <div className="auth-story-content">
            <span className="auth-eyebrow">İŞİNİZİN ORTAK ÇALIŞMA ALANI</span>
            <h1>
              Her mağaza.
              <br />
              Aynı düzen.
            </h1>
            <p>
              Ürünler, siparişler, stok ve tahsilat.
              <br />
              Birbirine bağlı, size tanıdık bir çalışma alanı.
            </p>
            <div className="auth-flow">
              <span>
                <Package size={21} />
                Ürün
              </span>
              <i />
              <span>
                <Layers3 size={21} />
                Mağaza
              </span>
              <i />
              <span>
                <Check size={21} />
                Sipariş
              </span>
            </div>
          </div>
          <div className="auth-assurance">
            <ShieldCheck size={17} />
            <span>Veriler çalışma alanınıza özel tutulur.</span>
          </div>
        </section>
        <section className="auth-form-panel">
          <div className="auth-form-heading">
            <span className="auth-form-icon">
              <LockKeyhole size={22} />
            </span>
            <h2>{heading[0]}</h2>
            <p>{heading[1]}</p>
          </div>
          {app.status === 'loading' ? (
            <div className="auth-loading" role="status">
              <RefreshCw size={22} className="spin" />
              <span>Çalışma alanına bağlanılıyor…</span>
            </div>
          ) : app.status === 'error' ? (
            <div className="auth-server-error">
              <p>{app.connectionError}</p>
              <Button variant="primary" onPress={() => void app.refresh()}>
                <RefreshCw size={16} />
                Yeniden dene
              </Button>
              <small>API sunucusuyla bağlantıyı kontrol edin.</small>
            </div>
          ) : (
            <SurfaceContext value={{ variant: 'default' }}>
              <form onSubmit={submit} className="auth-form">
                {(screen === 'register' || (screen === 'invite' && !app.session?.user)) && (
                  <Field label="Ad soyad" value={name} onChange={setName} required />
                )}
                {screen === 'register' && (
                  <Field
                    label="İşletme / çalışma alanı"
                    value={workspaceName}
                    onChange={setWorkspaceName}
                    required
                  />
                )}
                {['login', 'register', 'forgot'].includes(screen) && (
                  <Field
                    label="E-posta"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    required
                    placeholder="ad@isletmeniz.com"
                  />
                )}
                {screen !== 'forgot' && !(screen === 'invite' && app.session?.user) && (
                  <Field
                    label={screen === 'reset' ? 'Yeni parola' : 'Parola'}
                    type="password"
                    value={password}
                    onChange={setPassword}
                    required
                    description={
                      screen === 'register' || screen === 'invite' ? PASSWORD_HINT : undefined
                    }
                  />
                )}
                {screen === 'invite' && app.session?.user && (
                  <p className="description field-description">
                    {app.session.user.email} hesabıyla katılacaksınız.
                  </p>
                )}
                {(error || (screen === 'invite' && preview.error)) && (
                  <p className="form-error" role="alert">
                    {error || preview.error}
                  </p>
                )}
                {message && (
                  <p className="inline-notice" role="status">
                    {message}
                  </p>
                )}
                <Button
                  variant="primary"
                  type="submit"
                  isDisabled={busy || (screen === 'invite' && !!preview.error)}
                  className="auth-submit"
                >
                  {busy ? 'İşlem sürüyor…' : heading[2]}
                  <ArrowRight size={17} />
                </Button>
                {screen === 'login' && (
                  <button
                    type="button"
                    className="button button--sm button--ghost auth-text-link"
                    onClick={() => {
                      setScreen('forgot')
                      setError('')
                    }}
                  >
                    Parolamı unuttum
                  </button>
                )}
                {screen === 'invite' && (
                  <button
                    type="button"
                    className="button button--sm button--ghost auth-text-link"
                    onClick={() => {
                      if (app.session?.user) void app.logout()
                      setScreen('login')
                      setEmail(preview.data?.email ?? '')
                      setError('')
                    }}
                  >
                    Mevcut hesabımla giriş yap
                  </button>
                )}
                {['login', 'register'].includes(screen) &&
                  (app.session?.registrationEnabled ?? true) && (
                    <p className="auth-switch">
                      {screen === 'login' ? 'Henüz hesabınız yok mu?' : 'Zaten hesabınız var mı?'}{' '}
                      <button
                        className="button button--md button--ghost"
                        type="button"
                        onClick={() => {
                          setScreen(screen === 'login' ? 'register' : 'login')
                          setError('')
                        }}
                      >
                        {screen === 'login' ? 'Hesap oluştur' : 'Giriş yap'}
                      </button>
                    </p>
                  )}
                {['reset', 'forgot', 'invite'].includes(screen) && (
                  <button
                    type="button"
                    className="button button--sm button--ghost auth-text-link"
                    onClick={() => {
                      clearLinks()
                      setScreen('login')
                      setError('')
                      setMessage('')
                    }}
                  >
                    Giriş ekranına dön
                  </button>
                )}
              </form>
            </SurfaceContext>
          )}
          {!invite && !resetToken && (
            <div className="auth-demo">
              <span>Önce çalışma düzenini görmek ister misiniz?</span>
              <Button variant="secondary" isDisabled={busy} onPress={() => app.changeMode('demo')}>
                Örnek ekranları incele
                <ArrowRight size={15} />
              </Button>
              <small>Örnek veriler gerçek çalışma alanınıza aktarılmaz.</small>
            </div>
          )}
        </section>
      </motion.div>
      <p className="auth-footer">Pazarhub · Pazaryeri operasyonlarınız için ortak zemin.</p>
    </div>
  )
}
