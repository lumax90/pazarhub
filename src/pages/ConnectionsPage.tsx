import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { ArrowRight, Link2, Plus, Settings2, ShieldCheck, Workflow } from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Connection } from '../domain/types'
import {
  ChannelIcon,
  Dialog,
  Field,
  PageHeader,
  Panel,
  SectionTitle,
  SelectButton,
} from '../components/ui/shared'
import { channelNames } from '../domain/channels'

export function ConnectionsPage() {
  const { state } = useApp()
  const [editing, setEditing] = useState<Connection | null>(null)
  return (
    <>
      <PageHeader
        title="Pazaryeri Entegrasyonları"
        description="Mağazalarınızın bağlantılarını ve çalışma düzenini tek yerden görün."
        actions={
          <Button
            variant="primary"
            onPress={() =>
              setEditing({ id: crypto.randomUUID(), channel: 'trendyol', name: '', active: true })
            }
          >
            <Plus size={17} />
            Demo mağaza ekle
          </Button>
        }
      />
      <div className="integration-intro">
        <span className="integration-intro-icon">
          <Workflow size={25} />
        </span>
        <div>
          <h2>Mağazalarınız için ortak bir çalışma alanı.</h2>
          <p>Ürün, sipariş ve stok ilişkilerini örnek bağlantılarla deneyimleyin.</p>
        </div>
        <Chip variant="soft" color="accent">
          Tanıtım ortamı
        </Chip>
      </div>
      <div className="connection-grid">
        {state.connections.map((connection) => (
          <Panel
            className={`connection-card ${connection.active ? '' : 'is-paused'}`}
            key={connection.id}
          >
            <div className="connection-card-top">
              <ChannelIcon channel={connection.channel} size="lg" />
              <Chip variant="soft" color={connection.active ? 'success' : 'default'} size="sm">
                <span className="status-dot" />
                {connection.active ? 'Demo etkin' : 'Duraklatıldı'}
              </Chip>
            </div>
            <h2>{channelNames[connection.channel]}</h2>
            <p className="connection-name">{connection.name}</p>
            <div className="connection-stats">
              <div>
                <strong>
                  {state.listings.filter((listing) => listing.storeId === connection.id).length}
                </strong>
                <span>ilan</span>
              </div>
              <div>
                <strong>
                  {state.orders.filter((order) => order.storeId === connection.id).length}
                </strong>
                <span>sipariş</span>
              </div>
              <div>
                <strong>Merkez</strong>
                <span>stok deposu</span>
              </div>
            </div>
            <div className="connection-card-bottom">
              <span>
                <ShieldCheck size={14} />
                Örnek bağlantı
              </span>
              <Button variant="secondary" size="sm" onPress={() => setEditing(connection)}>
                <Settings2 size={14} />
                Ayarlar
              </Button>
            </div>
          </Panel>
        ))}
        <Panel className="add-connection-card">
          <span className="add-connection-icon" aria-hidden="true">
            <Plus size={26} strokeWidth={1.5} />
          </span>
          <strong>Bir mağaza daha ekleyin</strong>
          <p>Aynı pazaryerinde birden fazla mağazayı ayrı takip edin.</p>
          <Button
            size="sm"
            variant="secondary"
            onPress={() =>
              setEditing({
                id: crypto.randomUUID(),
                channel: 'hepsiburada',
                name: '',
                active: true,
              })
            }
          >
            <Plus size={14} />
            Mağaza ekle
          </Button>
        </Panel>
      </div>
      <div className="integration-bottom-note">
        <Link2 size={17} />
        <span>Mağaza ilanları ürün kartınıza bağlanır; mağazaya özel fiyatlar ayrı tutulur.</span>
        <Link to="/listings">
          İlanlara git
          <ArrowRight size={14} />
        </Link>
      </div>
      {editing && (
        <ConnectionEditor key={editing.id} connection={editing} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function ConnectionEditor({
  connection,
  onClose,
}: {
  connection: Connection
  onClose: () => void
}) {
  const { state, run } = useApp()
  const [draft, setDraft] = useState({ ...connection })
  const [error, setError] = useState('')
  const isNew = !state.connections.some((item) => item.id === connection.id)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const result = await run({ type: 'connection.update', connection: draft })
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Demo mağaza ekle' : 'Mağaza ayarları'}
      description="Bu aşamada örnek bağlantı kaydı oluşturulur; API anahtarı gerekmez."
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="connection-form" variant="primary">
            Kaydet
          </Button>
        </>
      }
    >
      <form id="connection-form" onSubmit={save}>
        <SectionTitle title="Bağlantı bilgileri">
          <div className="select-field">
            <label className="label">Pazaryeri</label>
            {isNew ? (
              <SelectButton
                label="Bağlanacak pazaryeri"
                value={draft.channel}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, channel: value as Connection['channel'] }))
                }
                options={Object.entries(channelNames)
                  .filter(([id]) => id !== 'manual')
                  .map(([id, label]) => ({ id, label }))}
              />
            ) : (
              <div className="connection-provider-readonly">
                <ChannelIcon channel={draft.channel} />
                {channelNames[draft.channel]}
              </div>
            )}
          </div>
          <Field
            label="Mağaza adı"
            required
            value={draft.name}
            onChange={(name) => setDraft((current) => ({ ...current, name }))}
            placeholder="Örn. Ana mağazam"
          />
          <Checkbox
            isSelected={draft.active}
            onChange={(active) => setDraft((current) => ({ ...current, active }))}
            className="app-checkbox"
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Demo bağlantı etkin</Label>
            </Checkbox.Content>
          </Checkbox>
        </SectionTitle>
        <div className="inline-notice">
          Gerçek pazaryeri bağlantısı ve otomatik senkronizasyon, sunucu entegrasyonu aşamasında
          eklenecek.
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
