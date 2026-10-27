import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../../app/AppProvider'
import type { IntegrationOperation, PublicIntegration } from '../../domain/integrations'
import type { RemoteWorkflow } from '../../domain/marketplace'
import { jobPermission } from '../../domain/permissions'
import { apiMutation } from '../../lib/api'
import { useResource } from '../../lib/useResource'
import { AsyncState } from '../ui/AsyncState'
import { SearchBox, SelectButton } from '../ui/shared'

export function MarketplaceToolbar({
  store,
  onStore,
  query,
  onQuery,
  operation,
  onRefresh,
}: {
  store: string
  onStore: (id: string) => void
  query: string
  onQuery: (value: string) => void
  operation: Extract<IntegrationOperation, 'questions.pull' | 'claims.pull' | 'settlements.pull'>
  onRefresh: () => Promise<void>
}) {
  const { mode, can, notify } = useApp(),
    [busy, setBusy] = useState(false)
  const resource = useResource<{ connections: PublicIntegration[] }>(
    '/api/integration-options?kind=marketplace',
  )
  const stores = (resource.data?.connections ?? []).filter((c) =>
    c.capabilities.includes(operation),
  )
  const targets = stores.filter(
    (c) => (store === 'all' || c.id === store) && c.enabled && c.status === 'verified',
  )
  const sync = async () => {
    if (busy) return
    setBusy(true)
    const results = await Promise.allSettled(
      targets.map((c) => apiMutation('/api/marketplace/sync', { connectionId: c.id, operation })),
    )
    const success = results.filter((r) => r.status === 'fulfilled').length
    if (success) notify(`${success} mağazanın kayıtları sıraya alındı.`)
    const failed = results.find((r) => r.status === 'rejected')
    if (failed?.status === 'rejected')
      notify(
        failed.reason instanceof Error ? failed.reason.message : 'Kayıtlar alınamadı.',
        'error',
      )
    await onRefresh()
    setBusy(false)
  }
  return (
    <>
      <div className="list-toolbar">
        <SearchBox
          value={query}
          onChange={onQuery}
          label="Pazaryeri kayıtlarında ara"
          placeholder="Soru, ürün, sipariş veya ödeme numarası…"
        />
        <div className="filter-actions">
          <SelectButton
            label="Pazaryeri mağazası"
            value={store}
            onChange={onStore}
            options={[
              { id: 'all', label: 'Tüm mağazalar' },
              ...stores.map((c) => ({ id: c.id, label: c.name })),
            ]}
          />
          <Button
            variant="secondary"
            isDisabled={
              busy || mode !== 'live' || !can(jobPermission(operation)) || targets.length === 0
            }
            onPress={() => void sync()}
          >
            <RefreshCw size={15} />
            {busy ? 'Sıraya alınıyor…' : 'Pazaryerinden al'}
          </Button>
        </div>
      </div>
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {mode === 'live' && resource.data && targets.length === 0 && (
        <p className="marketplace-connection-hint">
          Bu işlem için etkin mağaza seçin.{' '}
          <Link to="/connections">
            Bağlantı ayarları
            <ArrowRight size={12} />
          </Link>
        </p>
      )}
    </>
  )
}

const workflowLabels: Record<RemoteWorkflow['state'], string> = {
  queued: 'İşlem sırada',
  pending: 'Platform sonucu bekleniyor',
  confirmed: 'Sonuç doğrulandı',
  rejected: 'Düzeltme gerekiyor',
  uncertain: 'Sonuç doğrulanmalı',
  failed: 'İşlem tamamlanamadı',
}
export function WorkflowBadge({ workflow }: { workflow: RemoteWorkflow | null | undefined }) {
  if (!workflow) return null
  return (
    <Chip
      size="sm"
      variant="soft"
      color={
        workflow.state === 'confirmed'
          ? 'success'
          : ['failed', 'rejected', 'uncertain'].includes(workflow.state)
            ? 'danger'
            : 'accent'
      }
    >
      {workflowLabels[workflow.state]}
    </Chip>
  )
}
export function WorkflowMessage({ workflow }: { workflow: RemoteWorkflow | null | undefined }) {
  if (!workflow) return null
  return (
    <div className={`marketplace-workflow marketplace-workflow--${workflow.state}`} role="status">
      <WorkflowBadge workflow={workflow} />
      <p>{workflow.message ?? workflowLabels[workflow.state]}</p>
    </div>
  )
}
export function RecordsPagination({
  offset,
  count,
  hasMore,
  onChange,
}: {
  offset: number
  count: number
  hasMore: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="marketplace-pagination">
      <span>{count ? `${offset + 1}–${offset + count} kayıt` : 'Kayıt yok'}</span>
      <div>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={offset === 0}
          onPress={() => onChange(Math.max(0, offset - 50))}
        >
          <ArrowLeft size={14} />
          Önceki
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={!hasMore}
          onPress={() => onChange(offset + 50)}
        >
          Sonraki
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  )
}
