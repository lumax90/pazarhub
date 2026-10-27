import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Checkbox, Chip, Description, Label } from '@heroui/react'
import { ArrowUpRight, Power, RefreshCw, Settings2, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../../app/AppProvider'
import { warehouses } from '../../domain/inventory'
import type {
  IntegrationOperation,
  IntegrationSettings,
  ProviderDefinition,
  PublicIntegration,
  SyncOperation,
  SyncRun,
} from '../../domain/integrations'
import { apiRequest } from '../../lib/api'
import { dateLabel } from '../../lib/format'
import { Dialog, Panel } from '../ui/shared'

/** The settings that are plain on/off switches. */
type Flag = {
  [K in keyof IntegrationSettings]-?: IntegrationSettings[K] extends boolean ? K : never
}[keyof IntegrationSettings]

/** Read-only syncs: safe to switch on for a store another system also manages. */
const syncs: { operation: SyncOperation; setting: Flag; label: string; every: string }[] = [
  { operation: 'orders.pull', setting: 'pullOrders', label: 'Siparişler', every: '5 dakikada bir' },
  { operation: 'catalog.pull', setting: 'pullCatalog', label: 'Katalog', every: '30 dakikada bir' },
  {
    operation: 'questions.pull',
    setting: 'pullQuestions',
    label: 'Müşteri soruları',
    every: '5 dakikada bir',
  },
  { operation: 'claims.pull', setting: 'pullClaims', label: 'İadeler', every: 'saatte bir' },
  {
    operation: 'settlements.pull',
    setting: 'pullSettlements',
    label: 'Hakediş',
    every: 'günde bir',
  },
]
const runLabels: Record<SyncRun['status'], string> = {
  queued: 'sırada',
  running: 'sürüyor',
  waiting: 'sürüyor',
  completed: 'başarılı',
  failed: 'başarısız',
  uncertain: 'sonucu belirsiz',
  cancelled: 'iptal edildi',
}
const invoiceModes: Record<IntegrationSettings['invoiceMode'], string> = {
  workspace: 'Firma fatura zamanına göre',
  manual: 'Elle',
  on_approval: 'Sipariş onayında',
}

function connectionChip(connection: PublicIntegration) {
  if (connection.status === 'verified')
    return connection.enabled
      ? { color: 'success' as const, label: 'Aktif' }
      : { color: 'warning' as const, label: 'Etkinleştirilmedi' }
  return {
    configured: { color: 'warning' as const, label: 'Test bekliyor' },
    testing: { color: 'default' as const, label: 'Test sürüyor' },
    degraded: { color: 'warning' as const, label: 'Kontrol gerekiyor' },
    failed: { color: 'danger' as const, label: 'Test başarısız' },
    paused: { color: 'default' as const, label: 'Duraklatıldı' },
  }[connection.status]
}

/**
 * One store, account or provider: what runs automatically, what ran last, and the next
 * step when setup is unfinished. Modelled on Supsem's connection card.
 */
export function ConnectionCard({
  connection,
  definition,
  icon,
  working,
  onPerform,
  onSettings,
  onEnabled,
  extraActions,
}: {
  connection: PublicIntegration
  definition: ProviderDefinition
  icon: ReactNode
  working: string
  onPerform: (operation: IntegrationOperation) => void
  onSettings: () => void
  onEnabled: () => Promise<void>
  extraActions?: ReactNode
}) {
  const { state, can } = useApp()
  const [enabling, setEnabling] = useState(false)
  const marketplace = connection.kind === 'marketplace'
  const ready = connection.enabled && connection.status === 'verified'
  const has = (operation: IntegrationOperation) => connection.capabilities.includes(operation)
  const settings = connection.settings
  const chip = connectionChip(connection)
  const manage = can('integrations.manage')
  const warehouse = warehouses(state).find((item) => item.id === settings.warehouseId)

  const facts: { label: string; value: ReactNode }[] = []
  if (marketplace) {
    for (const sync of syncs.filter((item) => has(item.operation))) {
      const run = connection.activity?.[sync.operation]
      const extra =
        sync.operation === 'orders.pull' && settings.autoApproveOrders
          ? ' · eşleşenler otomatik onaylanır'
          : ''
      facts.push({
        label: sync.label,
        value: (
          <>
            {settings[sync.setting]
              ? `${sync.every.charAt(0).toLocaleUpperCase('tr')}${sync.every.slice(1)} alınır${extra}`
              : 'Kapalı — yalnız elle'}
            {run && (
              <small className={run.status === 'failed' ? 'is-failed' : undefined}>
                Son çalışma {dateLabel(run.at, true)} · {runLabels[run.status]}
                {run.status === 'failed' && run.error ? ` · ${run.error}` : ''}
              </small>
            )}
          </>
        ),
      })
    }
    if (has('inventory.push'))
      facts.push({
        label: 'Fiyat / stok',
        value: settings.pushInventory
          ? `Otomatik gönderilir${settings.stockBuffer ? ` · güvenlik payı ${settings.stockBuffer}` : ''}`
          : 'Kapalı — Pazarhub stok ve fiyat göndermez',
      })
    facts.push({
      label: 'Fatura',
      value: `${invoiceModes[settings.invoiceMode]}${
        has('invoice.link') && settings.sendInvoiceLink !== false
          ? ' · bağlantı pazaryerine iletilir'
          : ''
      }`,
    })
    facts.push({ label: 'Stok deposu', value: warehouse?.name ?? 'Firma e-ticaret depoları' })
  } else {
    facts.push({ label: 'Otomasyon', value: connection.enabled ? 'Açık' : 'Kapalı' })
  }
  facts.push({
    label: 'Ortam',
    value: settings.environment === 'production' ? 'Canlı hesap' : 'Sandbox / test hesabı',
  })
  facts.push({
    label: 'Son test',
    value: connection.lastTestAt
      ? `${connection.status === 'failed' ? 'Başarısız' : 'Başarılı'} · ${dateLabel(connection.lastTestAt, true)}`
      : 'Henüz yapılmadı',
  })

  const pull = (operation: SyncOperation, label: string) =>
    has(operation) && (
      <Button
        size="sm"
        variant="secondary"
        isDisabled={!ready || !!working || !manage}
        onPress={() => onPerform(operation)}
      >
        {label}
      </Button>
    )

  return (
    <Panel className="connection-card">
      <div className="connection-card-top">
        {icon}
        <div className="connection-card-title">
          <h2>{connection.name}</h2>
          <p className="connection-name">{definition.name}</p>
        </div>
        {connection.isDefault && (
          <Chip size="sm" variant="soft" color="accent">
            Varsayılan fatura hesabı
          </Chip>
        )}
        <Chip size="sm" color={chip.color} variant="soft">
          <span className="status-dot" />
          {chip.label}
        </Chip>
      </div>
      {!ready && (
        <div className="inline-notice warning connection-setup">
          <Power size={16} aria-hidden="true" />
          {connection.status === 'verified' ? (
            <>
              <p>
                Test başarılı ama bağlantı kapalı. Etkinleştirmeden sipariş, ürün veya stok işlemi
                yapılmaz.
              </p>
              <Button
                size="sm"
                variant="primary"
                isDisabled={!manage}
                onPress={() => setEnabling(true)}
              >
                Etkinleştir
              </Button>
            </>
          ) : (
            <p>
              {connection.status === 'testing'
                ? 'Bağlantı test ediliyor…'
                : 'Kurulumu tamamlamak için bağlantıyı test edin; test başarılı olunca etkinleştirebilirsiniz.'}
            </p>
          )}
        </div>
      )}
      <dl className="connection-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {connection.lastError && <p className="connection-error">{connection.lastError}</p>}
      <div className="connection-card-actions">
        <Button
          size="sm"
          variant="secondary"
          isDisabled={!!working || connection.status === 'testing' || !manage}
          onPress={() => onPerform('test')}
        >
          <RefreshCw size={14} />
          Bağlantıyı test et
        </Button>
        {marketplace && (
          <>
            {pull('orders.pull', 'Siparişleri çek')}
            {pull('catalog.pull', 'Kataloğu çek')}
            {pull('settlements.pull', 'Hakedişi çek')}
          </>
        )}
        {extraActions}
      </div>
      <div className="connection-links">
        {marketplace && (
          <Link to={`/listings?store=${encodeURIComponent(connection.id)}&view=mapping`}>
            Ürün eşleme
            <ArrowUpRight size={13} />
          </Link>
        )}
        <Link to="/jobs">
          İşlem merkezi
          <ArrowUpRight size={13} />
        </Link>
        <Button size="sm" variant="ghost" onPress={onSettings}>
          <Settings2 size={14} />
          Ayarlar
        </Button>
      </div>
      {enabling && (
        <EnableConnection
          connection={connection}
          onClose={() => setEnabling(false)}
          onDone={async () => {
            setEnabling(false)
            await onEnabled()
          }}
        />
      )}
    </Panel>
  )
}

/** Writes change the store itself; they stay off until chosen deliberately. */
const writes: { setting: Flag; operation?: IntegrationOperation; label: string; detail: string }[] =
  [
    {
      setting: 'pushInventory',
      operation: 'inventory.push',
      label: 'Stok ve fiyatı pazaryerine gönder',
      detail: 'Pazarhub’daki satılabilir stok ve fiyat mağazaya yazılır.',
    },
    {
      setting: 'autoApproveOrders',
      label: 'Eşleşen siparişleri otomatik onayla',
      detail: 'Onay pazaryerine bildirilir ve stok düşülür.',
    },
  ]

function EnableConnection({
  connection,
  onClose,
  onDone,
}: {
  connection: PublicIntegration
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { notify } = useApp()
  const marketplace = connection.kind === 'marketplace'
  const reads = syncs.filter((sync) => connection.capabilities.includes(sync.operation))
  const offered = writes.filter(
    (write) => !write.operation || connection.capabilities.includes(write.operation),
  )
  // Reads start on (they only copy data in); writes keep whatever was saved before.
  const [choices, setChoices] = useState<Partial<Record<Flag, boolean>>>(() => ({
    ...Object.fromEntries(reads.map((sync) => [sync.setting, true])),
    ...Object.fromEntries(
      offered.map((write) => [write.setting, connection.settings[write.setting]]),
    ),
  }))
  const [fetchNow, setFetchNow] = useState(true)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const choose = (setting: Flag, value: boolean) =>
    setChoices((current) => ({ ...current, [setting]: value }))
  const enable = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/integrations/${connection.id}`, {
        method: 'PATCH',
        key: crypto.randomUUID(),
        body: {
          provider: connection.provider,
          name: connection.name,
          // Unchanged identity keeps the verified test; secrets stay as stored.
          credentials: connection.identity,
          settings: { ...connection.settings, ...choices },
          enabled: true,
        },
      })
      const first = (['orders.pull', 'catalog.pull'] as const).filter(
        (operation) =>
          fetchNow && reads.some((sync) => sync.operation === operation && choices[sync.setting]),
      )
      for (const operation of first)
        await apiRequest(`/api/integrations/${connection.id}/jobs`, {
          method: 'POST',
          key: crypto.randomUUID(),
          body: { operation },
        })
      notify(
        first.length
          ? `${connection.name} etkinleştirildi; ilk veriler alınıyor.`
          : `${connection.name} etkinleştirildi.`,
      )
      await onDone()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Bağlantı etkinleştirilemedi.')
    } finally {
      setBusy(false)
    }
  }
  const option = (setting: Flag, label: string, detail?: string) => (
    <Checkbox
      key={setting}
      className="app-checkbox connection-choice"
      isSelected={!!choices[setting]}
      onChange={(value) => choose(setting, value)}
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Label>{label}</Label>
      </Checkbox.Content>
      {detail && <Description>{detail}</Description>}
    </Checkbox>
  )
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${connection.name} bağlantısını etkinleştir`}
      description="Hangi işlerin otomatik yapılacağını seçin. Bunları sonra Ayarlar’dan değiştirebilirsiniz."
      footer={
        <>
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            Vazgeç
          </Button>
          <Button variant="primary" onPress={() => void enable()} isDisabled={busy}>
            {busy ? 'Etkinleştiriliyor…' : 'Etkinleştir'}
          </Button>
        </>
      }
    >
      <div className="connection-enable">
        {marketplace && (
          <>
            <section>
              <h3>Pazaryerinden alınacaklar</h3>
              <p className="subtle">Yalnız okur; mağazada hiçbir şeyi değiştirmez.</p>
              {reads.map((sync) => option(sync.setting, `${sync.label} (${sync.every})`))}
            </section>
            {!!offered.length && (
              <section>
                <h3>Pazaryerine yazılacaklar</h3>
                <p className="inline-notice warning">
                  <TriangleAlert size={15} aria-hidden="true" />
                  Bu mağaza başka bir sistemde (ör. Supsem) de bağlıysa bunları yalnız birinde açın:
                  iki sistem aynı mağazaya stok yazarsa birbirinin üstüne yazar. Ürünleri eşlemeden
                  stok göndermeyi açmayın.
                </p>
                {offered.map((write) => option(write.setting, write.label, write.detail))}
              </section>
            )}
            <section>
              <Checkbox
                className="app-checkbox connection-choice"
                isSelected={fetchNow}
                onChange={setFetchNow}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>Siparişleri ve kataloğu şimdi al</Label>
                </Checkbox.Content>
                <Description>
                  İlk sipariş alımı son 7 günü kapsar; ürünler Ürün eşleme ekranına düşer.
                </Description>
              </Checkbox>
            </section>
          </>
        )}
        {!marketplace && (
          <p className="subtle">Bağlantı açılınca ilgili otomasyonlar bu hesabı kullanır.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
