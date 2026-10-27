import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Label, ToggleButton, ToggleButtonGroup } from '@heroui/react'
import { Check, KeyRound, Laptop, Moon, Sun } from 'lucide-react'
import { useApp } from '../app/AppProvider'
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from '../domain/auth-policy'
import { roleLabels } from '../domain/permissions'
import { apiRequest } from '../lib/api'
import { Dialog, Field, PageHeader, Panel, SectionTitle } from '../components/ui/shared'
import { UserAvatar } from '../components/ui/UserAvatar'

/** Eight pictures to choose from; the first is the one derived from the account itself. */
const avatarChoices = (base: string) => [
  base,
  ...Array.from({ length: 7 }, (_, index) => `${base}-${index + 2}`),
]

export function ProfilePage() {
  const { profile, updateProfile, mode, notify } = useApp()
  const [name, setName] = useState(profile.name)
  const [avatarSeed, setAvatarSeed] = useState(profile.avatarSeed)
  const [busy, setBusy] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const chosen = avatarSeed ?? profile.baseSeed
  const valid = name.trim().length >= 2
  const dirty = name.trim() !== profile.name || avatarSeed !== profile.avatarSeed
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !dirty || !valid) return
    setBusy(true)
    try {
      await updateProfile({ name, avatarSeed })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Profil kaydedilemedi.', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader
        title="Profilim"
        description="Adınız, avatarınız, görünüm tercihleriniz ve hesap güvenliğiniz."
      />
      <div className="settings-layout">
        <div className="settings-stack">
          <Panel title="Profil" description="Ekip arkadaşlarınız sizi bu ad ve avatarla görür.">
            <form onSubmit={save}>
              <div className="profile-identity">
                <UserAvatar name={name || profile.name} seed={chosen} size="lg" />
                <div>
                  <strong>{name.trim() || profile.name}</strong>
                  <span>
                    {profile.email ?? 'Örnek çalışma alanı'}
                    {profile.role && ` · ${roleLabels[profile.role]}`}
                  </span>
                </div>
              </div>
              <div className="profile-avatars">
                <Label id="avatar-choice-label">Avatar</Label>
                <ToggleButtonGroup
                  aria-labelledby="avatar-choice-label"
                  selectionMode="single"
                  disallowEmptySelection
                  isDetached
                  selectedKeys={new Set([chosen])}
                  onSelectionChange={(keys) => {
                    const next = String([...keys][0])
                    setAvatarSeed(next === profile.baseSeed ? null : next)
                  }}
                >
                  {avatarChoices(profile.baseSeed).map((seed, index) => (
                    <ToggleButton
                      key={seed}
                      id={seed}
                      isIconOnly
                      size="lg"
                      variant="ghost"
                      aria-label={`Avatar ${index + 1}`}
                      className="avatar-choice"
                    >
                      <UserAvatar name={name || profile.name} seed={seed} />
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
              <div className="form-grid">
                <Field label="Ad soyad" value={name} onChange={setName} required />
                {profile.email && (
                  <Field
                    label="E-posta"
                    value={profile.email}
                    readOnly
                    description="Giriş için kullanılır; buradan değiştirilemez."
                  />
                )}
              </div>
              <div className="settings-save">
                <Button variant="primary" type="submit" isDisabled={!dirty || !valid || busy}>
                  <Check size={16} />
                  Profili kaydet
                </Button>
              </div>
            </form>
          </Panel>
          <AppearancePanel />
        </div>
        <div className="settings-aside">
          <Panel title="Güvenlik">
            {mode === 'live' ? (
              <div className="settings-actions">
                <p className="subtle">
                  Parolanızı değiştirdiğinizde diğer cihazlardaki oturumlarınız kapanır.
                </p>
                <Button variant="secondary" onPress={() => setPasswordOpen(true)}>
                  <KeyRound size={15} />
                  Parolamı değiştir
                </Button>
              </div>
            ) : (
              <p className="subtle">
                Örnek çalışma alanında parola yoktur. Kendi hesabınızla giriş yaptığınızda
                parolanızı buradan değiştirebilirsiniz.
              </p>
            )}
          </Panel>
        </div>
      </div>
      {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} />}
    </>
  )
}

/** Theme and table density are saved per member, so they live on the profile. */
function AppearancePanel() {
  const { state, run } = useApp()
  return (
    <Panel title="Görünüm" description="Yalnız sizin ekranınızı etkiler.">
      <SectionTitle title="Tema">
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
      <SectionTitle title="Tablo yoğunluğu" description="Aynı bilgiler, alıştığınız boşluk düzeni.">
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
