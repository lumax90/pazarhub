import { useState } from 'react'
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from '../domain/auth-policy'
import type { FormEvent } from 'react'
import { Button } from '@heroui/react'
import { Check, Laptop, Moon, RotateCcw, Sun, KeyRound, Users } from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../app/AppProvider'
import { Dialog, Field, PageHeader, Panel, SectionTitle } from '../components/ui/shared'
import { apiRequest } from '../lib/api'
import { roleLabels } from '../domain/permissions'

export function SettingsPage() {
  const { state, run, reset, mode, session, can, changeMode } = useApp()
  const [name, setName] = useState(state.preferences.businessName)
  const [confirmReset, setConfirmReset] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const save = (event: FormEvent) => {
    event.preventDefault()
    run({ type: 'preferences.update', preferences: { ...state.preferences, businessName: name } })
  }
  return (
    <>
      <PageHeader
        title="Çalışma Alanı Ayarları"
        description="Görünümü ve çalışma düzenini kendinize göre ayarlayın."
      />
      <div className="settings-layout">
        <Panel className="settings-main">
          <form onSubmit={save}>
            <SectionTitle
              title="İşletme bilgileri"
              description="Bu ad çalışma alanı menüsünde görünür."
            >
              <div className="form-grid">
                <Field
                  label="İşletme adı"
                  value={name}
                  onChange={setName}
                  required
                  readOnly={!can('workspace.manage')}
                />
                <Field label="Para birimi" value="TRY · Türk Lirası" readOnly />
              </div>
              <div className="settings-save">
                <Button variant="primary" type="submit">
                  <Check size={16} />
                  Bilgileri kaydet
                </Button>
              </div>
            </SectionTitle>
          </form>
          <SectionTitle
            title="Görünüm"
            description="Her ekranda aynı tasarım dili, sizin seçtiğiniz tema."
          >
            <div className="theme-options">
              {(
                [
                  { id: 'light', label: 'Açık', icon: Sun },
                  { id: 'dark', label: 'Koyu', icon: Moon },
                  { id: 'system', label: 'Sistem', icon: Laptop },
                ] as const
              ).map((theme) => (
                <Button
                  variant={state.preferences.theme === theme.id ? 'secondary' : 'ghost'}
                  className={`theme-option ${state.preferences.theme === theme.id ? 'is-selected' : ''}`}
                  key={theme.id}
                  aria-pressed={state.preferences.theme === theme.id}
                  onPress={() =>
                    void run({
                      type: 'preferences.update',
                      preferences: { ...state.preferences, theme: theme.id },
                    })
                  }
                >
                  <span className="theme-preview" aria-hidden="true">
                    {(theme.id === 'system' ? ['light', 'dark'] : [theme.id]).map((appearance) => (
                      <span className="theme-preview-pane" data-theme={appearance} key={appearance}>
                        <i />
                        <span>
                          <b />
                          <b />
                          <b />
                        </span>
                      </span>
                    ))}
                  </span>
                  <span>
                    <theme.icon size={15} />
                    {theme.label}
                    {state.preferences.theme === theme.id && <Check size={15} />}
                  </span>
                </Button>
              ))}
            </div>
          </SectionTitle>
          <SectionTitle
            title="Tablo yoğunluğu"
            description="Aynı bilgiler, alıştığınız boşluk düzeni."
          >
            <div className="density-options">
              {(
                [
                  {
                    id: 'comfortable',
                    label: 'Rahat',
                    description: 'Daha geniş satırlar ve boşluklar',
                  },
                  { id: 'compact', label: 'Kompakt', description: 'Bir ekranda daha fazla kayıt' },
                ] as const
              ).map((density) => (
                <Button
                  variant={state.preferences.density === density.id ? 'secondary' : 'ghost'}
                  key={density.id}
                  aria-pressed={state.preferences.density === density.id}
                  className={state.preferences.density === density.id ? 'is-selected' : ''}
                  onPress={() =>
                    void run({
                      type: 'preferences.update',
                      preferences: { ...state.preferences, density: density.id },
                    })
                  }
                >
                  <strong>{density.label}</strong>
                  <span>{density.description}</span>
                  {state.preferences.density === density.id && <Check size={16} />}
                </Button>
              ))}
            </div>
          </SectionTitle>
        </Panel>
        <div className="settings-aside">
          <Panel title="Bu çalışma alanı hakkında">
            <div className="about-workspace">
              <span className="version-pill">Bağlı çalışma alanı · v0.2</span>
              <p>
                {mode === 'demo'
                  ? 'Örnek kayıtlar bu tarayıcıda saklanır.'
                  : 'Kayıtlar sunucudaki PostgreSQL veritabanında saklanır.'}{' '}
                Sipariş, stok, perakende ve kasa ortak çalışır.
              </p>
              <div>
                <span>Arayüz</span>
                <strong>HeroUI 3.2.6</strong>
              </div>
              <div>
                <span>Uygulama</span>
                <strong>React + Vite</strong>
              </div>
              <div>
                <span>Hareket</span>
                <strong>Motion for React</strong>
              </div>
              <div>
                <span>Ortam</span>
                <strong>{mode === 'demo' ? 'Yerel demo' : 'Sunucu bağlantısı'}</strong>
              </div>
            </div>
          </Panel>
          {mode === 'live' && (
            <Panel title="Hesap ve ekip">
              <div className="form-section">
                <p className="description field-description">
                  {session?.user?.email} · {session?.user && roleLabels[session.user.role]}
                </p>
                <Button variant="secondary" onPress={() => setPasswordOpen(true)}>
                  <KeyRound size={15} />
                  Parolamı değiştir
                </Button>
                {can('team.manage') && (
                  <Link to="/team" className="button button--secondary">
                    <Users size={15} />
                    Kullanıcılar ve roller
                  </Link>
                )}
              </div>
            </Panel>
          )}
          {mode === 'demo' ? (
            <Panel
              title="Örnek verileri yenile"
              description="Çalışma alanını başlangıçtaki örnek kayıtlara döndürün."
            >
              <Button variant="secondary" onPress={() => setConfirmReset(true)}>
                <RotateCcw size={15} />
                Örnek verileri sıfırla
              </Button>
            </Panel>
          ) : (
            <Panel title="Örnek ekranlar">
              <Button variant="secondary" onPress={() => changeMode('demo')}>
                Örnek çalışma alanını aç
              </Button>
            </Panel>
          )}
        </div>
      </div>
      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Örnek veriler sıfırlansın mı?"
        description="Bu tarayıcıda eklediğiniz sipariş, ürün ve satış kayıtları başlangıç verileriyle değiştirilecek."
        footer={
          <>
            <Button variant="secondary" onPress={() => setConfirmReset(false)}>
              Vazgeç
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                reset()
                setName('Kuzey Studio')
                setConfirmReset(false)
              }}
            >
              Sıfırla
            </Button>
          </>
        }
      >
        <p className="subtle">Bu işlem yalnızca yerel demo çalışma alanını etkiler.</p>
      </Dialog>
      {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} />}
    </>
  )
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { notify } = useApp()
  const [currentPassword, setCurrent] = useState(''),
    [newPassword, setNew] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      await apiRequest('/api/auth/password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      })
      notify('Parolanız değiştirildi; diğer oturumlar kapatıldı.')
      onClose()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Parola değiştirilemedi.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title="Parolamı değiştir"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            isDisabled={busy || newPassword.length < MIN_PASSWORD_LENGTH}
            onPress={() => void save()}
          >
            Parolayı kaydet
          </Button>
        </>
      }
    >
      <div className="form-section">
        <Field
          type="password"
          label="Mevcut parola"
          value={currentPassword}
          onChange={setCurrent}
          required
        />
        <Field
          type="password"
          label="Yeni parola"
          value={newPassword}
          onChange={setNew}
          required
          description={PASSWORD_HINT}
        />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
