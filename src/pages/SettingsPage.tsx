import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Description, Label, Switch, Tabs } from '@heroui/react'
import {
  Bell,
  Building2,
  Check,
  DatabaseBackup,
  Download,
  FlaskConical,
  RotateCcw,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { BusinessProfile, NotificationPreferences } from '../domain/types'
import { useMediaQuery } from '../lib/useMediaQuery'
import { Dialog, Field, PageHeader, Panel } from '../components/ui/shared'

const sections = [
  { id: 'business', label: 'İşletme bilgileri', icon: Building2 },
  { id: 'notifications', label: 'Bildirimler', icon: Bell },
  { id: 'data', label: 'Veri ve yedek', icon: DatabaseBackup },
] as const
type SectionId = (typeof sections)[number]['id']

export function SettingsPage() {
  const { section } = useParams()
  const navigate = useNavigate()
  const narrow = useMediaQuery('(max-width: 880px)')
  const selected = sections.find((item) => item.id === section)?.id ?? 'business'
  return (
    <>
      <PageHeader
        title="Çalışma Alanı Ayarları"
        description="İşletmenizin bilgileri, bildirimleriniz ve verileriniz."
      />
      <Tabs
        className="settings-tabs"
        orientation={narrow ? 'horizontal' : 'vertical'}
        align="start"
        selectedKey={selected}
        onSelectionChange={(key) => navigate(`/settings/${String(key) as SectionId}`)}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Ayar bölümleri">
            {sections.map((item) => (
              <Tabs.Tab id={item.id} key={item.id}>
                <item.icon size={16} aria-hidden="true" />
                {item.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="business">
          <BusinessSection />
        </Tabs.Panel>
        <Tabs.Panel id="notifications">
          <NotificationSection />
        </Tabs.Panel>
        <Tabs.Panel id="data">
          <DataSection />
        </Tabs.Panel>
      </Tabs>
    </>
  )
}

const businessFields: {
  key: keyof BusinessProfile
  label: string
  type?: 'tel' | 'email'
  description?: string
  wide?: boolean
}[] = [
  {
    key: 'legalName',
    label: 'Ticari unvan',
    description: 'Resmi belgelerde geçen tam unvan.',
    wide: true,
  },
  { key: 'taxOffice', label: 'Vergi dairesi' },
  {
    key: 'taxId',
    label: 'Vergi no / T.C. kimlik no',
    description: '10 haneli vergi ya da 11 haneli T.C. kimlik numarası.',
  },
  { key: 'phone', label: 'Telefon', type: 'tel' },
  { key: 'email', label: 'E-posta', type: 'email' },
  { key: 'city', label: 'İl' },
  { key: 'district', label: 'İlçe' },
  { key: 'address', label: 'Açık adres', wide: true },
]

/** Trimmed, empty fields dropped, keys sorted: what the command will actually store. */
const stored = (business: BusinessProfile) =>
  JSON.stringify(
    Object.entries(business)
      .map(([key, value]) => [key, value?.trim()])
      .filter(([, value]) => value)
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  )

function BusinessSection() {
  const { state, run, can, notify } = useApp()
  const editable = can('workspace.manage')
  const [name, setName] = useState(state.preferences.businessName)
  const [business, setBusiness] = useState<BusinessProfile>(state.business ?? {})
  const [busy, setBusy] = useState(false)
  const renamed = name.trim() !== state.preferences.businessName
  const dirty = renamed || stored(business) !== stored(state.business ?? {})
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !dirty) return
    setBusy(true)
    try {
      if (renamed) {
        const result = await run(
          {
            type: 'preferences.update',
            preferences: { ...state.preferences, businessName: name.trim() },
          },
          { silent: true },
        )
        if (!result.ok) {
          notify(result.message, 'error')
          return
        }
      }
      await run({ type: 'business.update', business })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="İşletme bilgileri" description="Sipariş çıktısında gönderici olarak yazdırılır.">
      <form onSubmit={save}>
        <div className="form-grid">
          <Field
            className="span-2"
            label="İşletme adı"
            description="Menüde ve sipariş çıktısında görünen kısa ad."
            value={name}
            onChange={setName}
            required
            readOnly={!editable}
          />
          {businessFields.map((field) => (
            <Field
              key={field.key}
              className={field.wide ? 'span-2' : ''}
              label={field.label}
              type={field.type}
              description={field.description}
              value={business[field.key] ?? ''}
              onChange={(value) => setBusiness((current) => ({ ...current, [field.key]: value }))}
              readOnly={!editable}
            />
          ))}
        </div>
        {editable ? (
          <div className="settings-save">
            <Button variant="primary" type="submit" isDisabled={!dirty || busy}>
              <Check size={16} />
              Kaydet
            </Button>
          </div>
        ) : (
          <p className="subtle settings-note">
            Bu bilgileri yalnız çalışma alanı yöneticileri değiştirebilir.
          </p>
        )}
      </form>
    </Panel>
  )
}

const alerts: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: 'orders',
    label: 'Gönderim bekleyen siparişler',
    description: 'Onay ya da kargo bekleyen sipariş olduğunda.',
  },
  {
    key: 'listings',
    label: 'Kontrol bekleyen ilanlar',
    description: 'Pazaryeri bir ilanı reddettiğinde.',
  },
  {
    key: 'stock',
    label: 'Düşük stok',
    description: 'Bir ürün belirlediğiniz stok eşiğine indiğinde.',
  },
]

function NotificationSection() {
  const { state, run, notify } = useApp()
  const shown = state.preferences.notifications ?? { orders: true, listings: true, stock: true }
  const change = async (key: keyof NotificationPreferences, value: boolean) => {
    const result = await run(
      {
        type: 'preferences.update',
        preferences: { ...state.preferences, notifications: { ...shown, [key]: value } },
      },
      { silent: true },
    )
    notify(
      result.ok ? 'Bildirim tercihiniz kaydedildi.' : result.message,
      result.ok ? 'success' : 'error',
    )
  }
  return (
    <Panel
      title="Bildirimler"
      description="Sağ üstteki zil menüsünde hangi uyarıların görüneceğini seçin. Bu tercih yalnız sizin hesabınız için geçerlidir."
    >
      <div className="settings-switches">
        {alerts.map((alert) => (
          <div className="settings-switch-row" key={alert.key}>
            <Switch
              className="settings-switch"
              isSelected={shown[alert.key]}
              onChange={(value) => void change(alert.key, value)}
            >
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Label>{alert.label}</Label>
              </Switch.Content>
              <Description>{alert.description}</Description>
            </Switch>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function DataSection() {
  const { state, mode, reset, changeMode, can } = useApp()
  const [confirmReset, setConfirmReset] = useState(false)
  const manager = can('workspace.manage')
  const download = () => {
    const file = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `pazarhub-yedek-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="settings-stack">
      <Panel
        title="Yedek indir"
        description="Ürün, sipariş, stok, cari ve kasa kayıtlarınızın tamamı tek bir JSON dosyasına yazılır ve yalnız bu bilgisayara iner."
      >
        <div className="settings-actions">
          <Button variant="secondary" onPress={download} isDisabled={!manager}>
            <Download size={16} />
            Yedeği indir
          </Button>
          {!manager && (
            <p className="subtle">Yedeği yalnız çalışma alanı yöneticileri indirebilir.</p>
          )}
        </div>
      </Panel>
      {mode === 'demo' ? (
        <Panel
          title="Örnek verileri sıfırla"
          description="Bu tarayıcıda yaptığınız değişiklikler silinir; çalışma alanı başlangıçtaki örnek kayıtlara döner."
        >
          <div className="settings-actions">
            <Button variant="secondary" onPress={() => setConfirmReset(true)}>
              <RotateCcw size={16} />
              Örnek verileri sıfırla
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel
          title="Örnek çalışma alanı"
          description="Gerçek kayıtlarınıza dokunmadan ekranları örnek verilerle deneyin."
        >
          <div className="settings-actions">
            <Button variant="secondary" onPress={() => changeMode('demo')}>
              <FlaskConical size={16} />
              Örnek çalışma alanını aç
            </Button>
          </div>
        </Panel>
      )}
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
    </div>
  )
}
