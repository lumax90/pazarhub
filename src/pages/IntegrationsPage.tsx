import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Link2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { warehouses } from '../domain/inventory'
import { providers, defaultIntegrationSettings } from '../domain/integrations'
import type {
  IntegrationKind,
  CargoProvider,
  MarketplaceProvider,
  IntegrationOperation,
  IntegrationSettings,
  ProviderDefinition,
  PublicIntegration,
} from '../domain/integrations'
import { apiRequest } from '../lib/api'
import { useResource } from '../lib/useResource'
import { dateLabel } from '../lib/format'
import { AsyncState } from '../components/ui/AsyncState'
import {
  ChannelIcon,
  Dialog,
  Field,
  FilterTabs,
  PageHeader,
  Panel,
  SectionTitle,
  SelectButton,
} from '../components/ui/shared'
import { ConnectionsPage } from './ConnectionsPage'
import { ProviderLogo } from '../components/ui/ProviderLogo'

import { operationLabels } from '../domain/integration-labels'
const statuses: Record<PublicIntegration['status'], string> = {
  configured: 'Test bekliyor',
  testing: 'Test sürüyor',
  verified: 'Test başarılı',
  degraded: 'Kontrol gerekiyor',
  failed: 'Test başarısız',
  paused: 'Duraklatıldı',
}

export function IntegrationsPage() {
  const { mode } = useApp()
  return mode === 'demo' ? <ConnectionsPage /> : <LiveIntegrations />
}

function ProviderIcon({ definition }: { definition: ProviderDefinition }) {
  if (definition.kind === 'marketplace')
    return <ChannelIcon channel={definition.id as MarketplaceProvider} size="lg" />
  if (definition.kind === 'cargo')
    return (
      <span className="provider-icon provider-icon--cargo channel-icon--cargo" aria-hidden="true">
        <ProviderLogo provider={definition.id as CargoProvider} />
      </span>
    )
  return (
    <span className="provider-icon provider-icon--invoice">
      <FileText size={25} />
    </span>
  )
}

function LiveIntegrations() {
  const { state, notify, refresh, can } = useApp()
  const { kind: routeKind } = useParams()
  const [kind, setKind] = useState<IntegrationKind>(
    routeKind === 'cargo' ? 'cargo' : routeKind === 'invoice' ? 'invoice' : 'marketplace',
  )
  const [editor, setEditor] = useState<{
    provider: ProviderDefinition
    connection?: PublicIntegration
  } | null>(null)
  const resource = useResource<{ connections: PublicIntegration[] }>('/api/integrations', 5000)
  const catalog = useResource<{
    providers: (ProviderDefinition & { capabilities: IntegrationOperation[] })[]
  }>('/api/providers')
  const [working, setWorking] = useState('')
  const connections = resource.data?.connections ?? []
  const perform = async (connection: PublicIntegration, operation: IntegrationOperation) => {
    if (working) return
    setWorking(`${connection.id}:${operation}`)
    try {
      await apiRequest(`/api/integrations/${connection.id}/jobs`, {
        method: 'POST',
        key: crypto.randomUUID(),
        body: { operation },
      })
      notify(`${operationLabels[operation]} kuyruğa alındı.`)
      await resource.reload()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'İşlem başlatılamadı.', 'error')
    } finally {
      setWorking('')
    }
  }
  return (
    <>
      <PageHeader
        title="Entegrasyonlar"
        description="Mağazalarınız, kargo hesaplarınız ve e-fatura sağlayıcınız aynı akışta."
        actions={
          <Link to="/jobs" className="button button--secondary">
            <Workflow size={16} />
            İşlem merkezi
            <ArrowRight size={15} />
          </Link>
        }
      />
      <div className="integration-intro">
        <span className="integration-intro-icon">
          <Workflow size={25} />
        </span>
        <div>
          <h2>Bağlayın. Test edin. Birlikte çalıştırın.</h2>
          <p>Her bağlantının durumu, yetenekleri ve son işlem sonucu görünür.</p>
        </div>
        <Chip color="accent" variant="soft">
          <ShieldCheck size={13} />
          Sunucuda şifreli
        </Chip>
      </div>
      <FilterTabs
        value={kind}
        onChange={(value) => setKind(value as IntegrationKind)}
        label="Entegrasyon türü"
        items={[
          { id: 'marketplace', label: 'Pazaryerleri' },
          { id: 'cargo', label: 'Kargo firmaları' },
          { id: 'invoice', label: 'E-fatura' },
        ]}
      />
      <AsyncState
        loading={resource.loading}
        error={resource.error || catalog.error}
        retry={() => void resource.reload()}
      />
      <div className="connection-grid">
        {connections
          .filter((connection) => connection.kind === kind)
          .map((connection) => {
            const definition = providers.find((item) => item.id === connection.provider)!
            return (
              <Panel key={connection.id} className="connection-card">
                <div className="connection-card-top">
                  <ProviderIcon definition={definition} />
                  <Chip
                    size="sm"
                    color={
                      connection.status === 'verified'
                        ? 'success'
                        : connection.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                    variant="soft"
                  >
                    <span className="status-dot" />
                    {statuses[connection.status]}
                  </Chip>
                </div>
                <h2>{definition.name}</h2>
                {connection.isDefault && (
                  <Chip size="sm" variant="soft" color="accent">
                    Varsayılan fatura hesabı
                  </Chip>
                )}
                <p className="connection-name">{connection.name}</p>
                <div className="connection-stats">
                  <div>
                    <strong>{connection.enabled ? 'Açık' : 'Kapalı'}</strong>
                    <span>otomasyon</span>
                  </div>
                  <div>
                    <strong>
                      {connection.settings.environment === 'production' ? 'Canlı' : 'Test'}
                    </strong>
                    <span>sağlayıcı ortamı</span>
                  </div>
                  {kind === 'marketplace' && (
                    <div>
                      <strong>
                        {state.listings.filter((item) => item.storeId === connection.id).length}
                      </strong>
                      <span>eşlenmiş ilan</span>
                    </div>
                  )}
                </div>
                <p className="connection-last-test">
                  {connection.lastTestAt
                    ? `Son test: ${dateLabel(connection.lastTestAt, true)}`
                    : 'Henüz API testi yapılmadı.'}
                </p>
                {connection.lastError && <p className="connection-error">{connection.lastError}</p>}
                <div className="connection-card-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={!!working || connection.status === 'testing'}
                    onPress={() => void perform(connection, 'test')}
                  >
                    <RefreshCw size={14} />
                    Test et
                  </Button>
                  {connection.enabled &&
                    connection.status === 'verified' &&
                    connection.capabilities.includes('orders.pull') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={!!working}
                        onPress={() => void perform(connection, 'orders.pull')}
                      >
                        Sipariş al
                      </Button>
                    )}
                  {connection.enabled &&
                    connection.status === 'verified' &&
                    connection.capabilities.includes('catalog.pull') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={!!working}
                        onPress={() => void perform(connection, 'catalog.pull')}
                      >
                        Katalog al
                      </Button>
                    )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => setEditor({ provider: definition, connection })}
                  >
                    <Settings2 size={14} />
                    Ayarlar
                  </Button>
                  {connection.kind === 'invoice' && !connection.isDefault && (
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={!!working || !can('integrations.manage')}
                      onPress={async () => {
                        setWorking(connection.id)
                        try {
                          await apiRequest(`/api/integrations/${connection.id}/default`, {
                            method: 'POST',
                            key: crypto.randomUUID(),
                            body: {},
                          })
                          notify('Varsayılan fatura hesabı güncellendi.')
                          await resource.reload()
                          await refresh()
                        } catch (error) {
                          notify(
                            error instanceof Error ? error.message : 'Varsayılan değiştirilemedi.',
                            'error',
                          )
                        } finally {
                          setWorking('')
                        }
                      }}
                    >
                      Varsayılan yap
                    </Button>
                  )}
                </div>
              </Panel>
            )
          })}
      </div>
      <div className="section-heading-inline">
        <div>
          <h2>
            {kind === 'marketplace'
              ? 'Pazaryeri bağlayın'
              : kind === 'cargo'
                ? 'Kargo hesabı bağlayın'
                : 'Fatura sağlayıcısı bağlayın'}
          </h2>
          <p>Aynı sağlayıcıya birden fazla hesap ekleyebilirsiniz.</p>
        </div>
      </div>
      <div className="provider-grid">
        {(catalog.data?.providers ?? [])
          .filter((provider) => provider.kind === kind)
          .map((provider) => (
            <Panel key={provider.id} className="provider-card">
              <ProviderIcon definition={provider} />
              <div>
                <h3>{provider.name}</h3>
                <p>
                  {provider.capabilities.length
                    ? provider.capabilities
                        .filter((operation) => operation !== 'test')
                        .map((operation) => operationLabels[operation])
                        .slice(0, 3)
                        .join(' · ')
                    : 'API sözleşmesi bekleniyor'}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={!can('integrations.manage') || !provider.capabilities.length}
                onPress={() => setEditor({ provider })}
              >
                <Plus size={15} />
                Bağla
              </Button>
            </Panel>
          ))}
      </div>
      <div className="integration-bottom-note">
        <Link2 size={17} />
        <span>Bağlantı testi API erişimini doğrular. Gönderimler ayrı iş olarak takip edilir.</span>
        <Link to="/listings">
          Ürün eşleme
          <ArrowRight size={14} />
        </Link>
      </div>
      {editor && (
        <IntegrationEditor
          key={editor.connection?.id ?? editor.provider.id}
          definition={editor.provider}
          connection={editor.connection}
          connections={connections}
          capabilities={
            catalog.data?.providers.find((p) => p.id === editor.provider.id)?.capabilities ?? []
          }
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null)
            await resource.reload()
            await refresh()
          }}
        />
      )}
    </>
  )
}

function Toggle({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  description?: string
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="setting-toggle">
      <Checkbox
        className="app-checkbox"
        isSelected={value}
        isDisabled={disabled}
        onChange={onChange}
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Label>{label}</Label>
        </Checkbox.Content>
      </Checkbox>
      {description && <p>{description}</p>}
    </div>
  )
}

function IntegrationEditor({
  definition,
  connection,
  connections,
  capabilities,
  onClose,
  onSaved,
}: {
  definition: ProviderDefinition
  connection?: PublicIntegration
  connections: PublicIntegration[]
  capabilities: IntegrationOperation[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify, state } = useApp()
  const [name, setName] = useState(connection?.name ?? definition.name)
  const [credentials, setCredentials] = useState<Record<string, string>>(connection?.identity ?? {})
  const [settings, setSettings] = useState<IntegrationSettings>(
    connection?.settings ?? {
      ...defaultIntegrationSettings,
      ...(definition.kind === 'marketplace' ? { invoiceMode: 'workspace' as const } : {}),
    },
  )
  const [isDefault, setIsDefault] = useState(
    connection?.isDefault ?? connections.filter((c) => c.kind === 'invoice').length === 0,
  )
  const [enabled, setEnabled] = useState(connection?.enabled ?? false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [key] = useState(() => crypto.randomUUID())
  const set = <K extends keyof IntegrationSettings>(field: K, value: IntegrationSettings[K]) =>
    setSettings((current) => ({ ...current, [field]: value }))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiRequest(connection ? `/api/integrations/${connection.id}` : '/api/integrations', {
        method: connection ? 'PATCH' : 'POST',
        key,
        body: {
          provider: definition.id,
          name,
          credentials,
          settings,
          enabled,
          ...(definition.kind === 'invoice' ? { isDefault } : {}),
        },
      })
      setCredentials({})
      notify('Bağlantı kaydedildi.')
      await onSaved()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Bağlantı kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`${definition.name} ${connection ? 'ayarları' : 'bağlantısı'}`}
      description={
        definition.note ?? 'Bilgiler sunucuda şifrelenir. Kaydetme ve API testi ayrı işlemlerdir.'
      }
      footer={
        <>
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="live-integration-form" isDisabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Bağlantıyı kaydet'}
          </Button>
        </>
      }
    >
      <form id="live-integration-form" onSubmit={save}>
        <SectionTitle title="Hesap bilgileri">
          <Field label="Bağlantı adı" value={name} onChange={setName} required />
          <div className="form-grid">
            {definition.fields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                value={credentials[field.key] ?? ''}
                type={field.secret ? 'password' : 'text'}
                required={field.required && !connection?.configuredFields.includes(field.key)}
                onChange={(value) => {
                  setCredentials((current) => ({ ...current, [field.key]: value }))
                  if (field.secret) setEnabled(false)
                }}
                placeholder={
                  connection?.configuredFields.includes(field.key) && field.secret
                    ? 'Kayıtlı · değiştirmek için doldurun'
                    : field.placeholder
                }
              />
            ))}
          </div>
          <div className="select-field">
            <label className="label">Sağlayıcı ortamı</label>
            <SelectButton
              label="Sağlayıcı ortamı"
              value={settings.environment}
              onChange={(value) => {
                set('environment', value as IntegrationSettings['environment'])
                setEnabled(false)
              }}
              options={[
                { id: 'production', label: 'Canlı API hesabı' },
                { id: 'sandbox', label: 'Sandbox / test hesabı' },
              ]}
            />
          </div>
        </SectionTitle>
        <SectionTitle
          title="Çalışma düzeni"
          description={
            connection?.status === 'verified'
              ? 'Bağlantı testi başarılı. Kullanmak istediğiniz otomasyonları seçin.'
              : 'Önce kaydedin ve bağlantı testini çalıştırın. Başarılı testten sonra etkinleştirebilirsiniz.'
          }
        >
          <Toggle
            label="Bağlantı etkin"
            value={enabled}
            onChange={setEnabled}
            disabled={connection?.status !== 'verified'}
          />
          {definition.kind === 'marketplace' && (
            <div className="settings-toggle-grid">
              {(
                [
                  ['pullOrders', 'orders.pull', 'Siparişleri otomatik al'],
                  ['pullCatalog', 'catalog.pull', 'Kataloğu düzenli oku'],
                  ['pushInventory', 'inventory.push', 'Stok / fiyatı otomatik gönder'],
                  ['pullQuestions', 'questions.pull', 'Müşteri sorularını al'],
                  ['pullClaims', 'claims.pull', 'İade taleplerini al'],
                  ['pullSettlements', 'settlements.pull', 'Hakediş kayıtlarını al'],
                ] as const
              )
                .filter(([, operation]) => capabilities.includes(operation))
                .map(([field, , label]) => (
                  <Toggle
                    key={field}
                    label={label}
                    value={settings[field]}
                    onChange={(value) => set(field, value)}
                  />
                ))}
              <Toggle
                label="Eşleşen siparişleri otomatik onayla"
                description="Yeterli stok ve tüm satır eşlemeleri olduğunda uygulanır."
                value={settings.autoApproveOrders}
                onChange={(value) => set('autoApproveOrders', value)}
              />
            </div>
          )}
          {definition.kind === 'marketplace' && (
            <>
              <SelectButton
                label="Mağaza stok deposu"
                value={settings.warehouseId ?? 'workspace'}
                onChange={(value) => set('warehouseId', value === 'workspace' ? undefined : value)}
                options={[
                  { id: 'workspace', label: 'Firma e-ticaret depoları' },
                  ...warehouses(state)
                    .filter((warehouse) => warehouse.active)
                    .map((warehouse) => ({ id: warehouse.id, label: warehouse.name })),
                ]}
              />
              <Field
                label="Stok güvenlik payı (adet)"
                type="number"
                value={String(settings.stockBuffer)}
                onChange={(value) => set('stockBuffer', Number(value))}
                description="Bu miktar pazaryerine gönderilen satılabilir stoktan düşülür."
              />
            </>
          )}
        </SectionTitle>
        {definition.kind === 'marketplace' && (
          <SectionTitle title="Fatura ve kargo ilişkisi">
            <div className="form-grid">
              <div className="select-field">
                <label className="label">Fatura sağlayıcısı</label>
                <SelectButton
                  label="Fatura bağlantısı"
                  value={settings.invoiceConnectionId ?? ''}
                  options={[
                    { id: '', label: 'Varsayılan Paraşüt hesabını kullan' },
                    ...connections
                      .filter((item) => item.kind === 'invoice')
                      .map((item) => ({ id: item.id, label: item.name })),
                  ]}
                  onChange={(value) => set('invoiceConnectionId', value || undefined)}
                />
              </div>
              <div className="select-field">
                <label className="label">Fatura oluşturma</label>
                <SelectButton
                  label="Fatura oluşturma"
                  value={settings.invoiceMode}
                  onChange={(value) =>
                    set('invoiceMode', value as IntegrationSettings['invoiceMode'])
                  }
                  options={[
                    { id: 'workspace', label: 'Firma fatura zamanını kullan' },
                    { id: 'manual', label: 'Elle gönder' },
                    { id: 'on_approval', label: 'Sipariş onayında oluştur' },
                  ]}
                />
              </div>
              <div className="select-field">
                <label className="label">Kendi kargo anlaşmam</label>
                <SelectButton
                  label="Kargo bağlantısı"
                  value={settings.cargoConnectionId ?? ''}
                  options={[
                    { id: '', label: 'Pazaryeri kargosu' },
                    ...connections
                      .filter((item) => item.kind === 'cargo')
                      .map((item) => ({ id: item.id, label: item.name })),
                  ]}
                  onChange={(value) => set('cargoConnectionId', value || undefined)}
                />
              </div>
            </div>
          </SectionTitle>
        )}
        {definition.kind === 'invoice' && (
          <SectionTitle title="Resmileştirme">
            <Toggle
              label="Varsayılan fatura hesabı"
              description="Yeni belge otomasyonlarında kullanılır. Test ve etkinleştirme ayrı işlemlerdir; mevcut belgelerin bağlı hesabı değiştirilmez."
              value={isDefault}
              onChange={setIsDefault}
              disabled={!connection && connections.every((c) => c.kind !== 'invoice')}
            />
            <Toggle
              label="Oluşturulan faturaları otomatik resmileştir"
              description="Siparişte “Resmîleşmesin” seçildiyse uygulanmaz."
              value={settings.finalizeInvoices}
              onChange={(value) => set('finalizeInvoices', value)}
            />
            <Field
              label="Resmileştirme gecikmesi (dakika)"
              type="number"
              value={String(settings.finalizeDelayMinutes)}
              onChange={(value) => set('finalizeDelayMinutes', Number(value))}
            />
          </SectionTitle>
        )}
        {definition.kind === 'marketplace' && capabilities.includes('invoice.link') && (
          <SectionTitle title="Fatura bağlantısı iletimi">
            <Toggle
              label="Fatura bağlantısını pazaryerine otomatik gönder"
              description="Kapalıyken fatura kesilebilir, ancak link otomatik iletilmez. Gönderilmiş bağlantı bu ayarla geri çekilmez."
              value={settings.sendInvoiceLink !== false}
              onChange={(value) => set('sendInvoiceLink', value)}
            />
          </SectionTitle>
        )}
        {definition.kind === 'cargo' && (
          <SectionTitle title="Gönderici adresi">
            <div className="form-grid">
              {(
                [
                  ['senderName', 'Gönderici adı'],
                  ['senderPhone', 'Telefon'],
                  ['senderCity', 'İl'],
                  ['senderDistrict', 'İlçe'],
                  ['senderAddress', 'Açık adres'],
                ] as const
              ).map(([field, label]) => (
                <Field
                  key={field}
                  label={label}
                  value={settings[field] ?? ''}
                  onChange={(value) => set(field, value)}
                  required
                />
              ))}
            </div>
          </SectionTitle>
        )}
        <div className="capability-list">
          <CheckCircle2 size={16} />
          <span>{capabilities.map((operation) => operationLabels[operation]).join(' · ')}</span>
        </div>
        <a className="provider-doc-link" href={definition.docsUrl} target="_blank" rel="noreferrer">
          Sağlayıcının resmî belgeleri
          <ArrowRight size={13} />
        </a>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
