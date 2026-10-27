import { useDeferredValue, useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import { Check, RefreshCw, RotateCcw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useApp } from '../../app/AppProvider'
import { ClaimDecisionDialog } from './ClaimDecisionDialog'
import type { MarketplaceClaim, MarketplaceRecord } from '../../domain/marketplace'
import { claimStatusLabels, workflowBusy } from '../../domain/marketplace'
import { apiMutation } from '../../lib/api'
import { dateLabel, money } from '../../lib/format'
import { useResource } from '../../lib/useResource'
import { DataTable } from '../ui/DataTable'
import { AsyncState } from '../ui/AsyncState'
import { Dialog, EmptyState, SelectButton } from '../ui/shared'
import {
  MarketplaceToolbar,
  RecordsPagination,
  WorkflowBadge,
  WorkflowMessage,
} from './MarketplaceTools'

type ClaimRecord = MarketplaceRecord<MarketplaceClaim>
export function MarketplaceClaims() {
  const { mode } = useApp(),
    [params, setParams] = useSearchParams()
  const [store, setStore] = useState('all'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [offset, setOffset] = useState(0)
  const deferred = useDeferredValue(query),
    selected = params.get('record')
  const search = new URLSearchParams({
    resource: 'claim',
    query: deferred,
    offset: String(offset),
    ...(store === 'all' ? {} : { connectionId: store }),
    ...(status === 'all' ? {} : { status }),
  })
  const result = useResource<{ records: ClaimRecord[]; hasMore: boolean }>(
    `/api/marketplace/records?${search}`,
    5000,
  )
  return (
    <>
      <MarketplaceToolbar
        store={store}
        onStore={(id) => {
          setStore(id)
          setOffset(0)
        }}
        query={query}
        onQuery={(v) => {
          setQuery(v)
          setOffset(0)
        }}
        operation="claims.pull"
        onRefresh={result.reload}
      />
      <div className="marketplace-subfilters">
        <SelectButton
          label="İade talebi durumu"
          value={status}
          onChange={(s) => {
            setStatus(s)
            setOffset(0)
          }}
          options={[
            { id: 'all', label: 'Tüm durumlar' },
            ...Object.entries(claimStatusLabels).map(([id, label]) => ({ id, label })),
          ]}
        />
        <span className="description field-description">
          Satır bazında platform kararı ve onay takibi
        </span>
      </div>
      <AsyncState
        loading={result.loading}
        error={result.error}
        retry={() => void result.reload()}
      />
      {mode === 'demo' ? (
        <EmptyState
          title="Pazaryeri iade talepleriniz burada"
          description="Bağlı mağazaların iade talepleri gerçek çalışma alanınızda görünür."
          icon={<RotateCcw size={26} />}
        />
      ) : (
        <>
          <DataTable
            paginate={false}
            label="Pazaryeri iade talepleri"
            items={result.data?.records ?? []}
            emptyTitle="Bu görünümde iade talebi yok"
            emptyDescription="Mağazadan kayıtları alabilir veya durum filtresini değiştirebilirsiniz."
            columns={[
              {
                id: 'order',
                label: 'Sipariş / iade',
                rowHeader: true,
                cell: (r) => (
                  <button
                    className="button button--sm button--ghost text-button"
                    onClick={() => setParams({ view: 'marketplace', record: r.id })}
                  >
                    <strong>{r.document.orderNumber || r.externalId}</strong>
                    <small className="cell-secondary">
                      {r.document.items.length} iade kalemi · {r.connectionName}
                    </small>
                  </button>
                ),
              },
              {
                id: 'product',
                label: 'Ürünler',
                cell: (r) => (
                  <span className="marketplace-question-cell">
                    {[...new Set(r.document.items.map((i) => i.productName))].join(', ')}
                  </span>
                ),
              },
              {
                id: 'state',
                label: 'Durum',
                cell: (r) => (
                  <div className="marketplace-status-stack">
                    {[...new Set(r.document.items.map((i) => i.status))].map((s) => (
                      <Chip
                        key={s}
                        variant="soft"
                        size="sm"
                        color={
                          s === 'Accepted'
                            ? 'success'
                            : s === 'WaitingInAction'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {claimStatusLabels[s] ?? s}
                      </Chip>
                    ))}
                    {r.workflow?.state !== 'confirmed' && <WorkflowBadge workflow={r.workflow} />}
                  </div>
                ),
              },
              {
                id: 'date',
                label: 'Talep tarihi',
                cell: (r) => (r.document.createdAt ? dateLabel(r.document.createdAt, true) : '—'),
              },
            ]}
          />
          <RecordsPagination
            offset={offset}
            count={result.data?.records.length ?? 0}
            hasMore={result.data?.hasMore ?? false}
            onChange={setOffset}
          />
        </>
      )}
      {selected && mode === 'live' && (
        <ClaimDialog
          key={selected}
          id={selected}
          onClose={() => setParams({ view: 'marketplace' })}
          onChange={result.reload}
        />
      )}
    </>
  )
}
function ClaimDialog({
  id,
  onClose,
  onChange,
}: {
  id: string
  onClose: () => void
  onChange: () => Promise<void>
}) {
  const resource = useResource<ClaimRecord>(`/api/marketplace/records/${id}`, 3000)
  return (
    <Dialog
      open
      wide
      title="Pazaryeri iade talebi"
      description={resource.data?.connectionName}
      onClose={onClose}
    >
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data?.document.kind === 'claim' && (
        <ClaimEditor
          record={resource.data}
          reload={async () => {
            await resource.reload()
            await onChange()
          }}
        />
      )}
    </Dialog>
  )
}
function ClaimEditor({ record, reload }: { record: ClaimRecord; reload: () => Promise<void> }) {
  const { state, can, notify } = useApp(),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const [decision, setDecision] = useState<'reject' | 'investigate' | null>(null)
  const claim = record.document,
    actionable = !workflowBusy(record.workflow) && can('finance.write'),
    chosen = selected.filter((id) =>
      claim.items.some((i) => i.id === id && i.status === 'WaitingInAction'),
    )
  const orders = state.orders.filter(
    (o) => o.storeId === record.connectionId && o.externalNumber === claim.orderNumber,
  )
  const action = async (kind: 'approve' | 'refresh') => {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      await apiMutation(
        kind === 'approve'
          ? `/api/marketplace/claims/${record.id}/approve`
          : `/api/marketplace/records/${record.id}/refresh`,
        kind === 'approve' ? { itemIds: chosen } : {},
      )
      notify(
        kind === 'approve'
          ? 'Seçilen iade kalemleri onay sırasına alındı.'
          : 'İade durumu sorgulanıyor.',
      )
      setSelected([])
      await reload()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="marketplace-detail">
      <dl className="detail-list">
        <div>
          <dt>Sipariş</dt>
          <dd>
            {claim.orderNumber || '—'}
            {orders.map((o) => (
              <Link key={o.id} className="cell-secondary order-link" to={`/orders/${o.id}`}>
                {o.number}
              </Link>
            ))}
          </dd>
        </div>
        <div>
          <dt>İade takip no</dt>
          <dd>{claim.trackingNumber || '—'}</dd>
        </div>
        <div>
          <dt>İade kimliği</dt>
          <dd className="code-text">{claim.externalId}</dd>
        </div>
      </dl>
      <WorkflowMessage workflow={record.workflow} />
      {claim.claimType === 'exchange' && <Chip variant="soft">Değişim talebi</Chip>}
      <div className="marketplace-claim-items">
        {claim.items.map((item) => (
          <div key={item.id} className="marketplace-claim-item">
            <Checkbox
              className="app-checkbox"
              isDisabled={!actionable || item.status !== 'WaitingInAction' || !!busy}
              isSelected={chosen.includes(item.id)}
              onChange={(checked) =>
                setSelected((ids) =>
                  checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                )
              }
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>{item.productName || item.sku || item.id}</Label>
              </Checkbox.Content>
            </Checkbox>
            <div className="marketplace-claim-copy">
              <small>
                {item.sku} · {item.barcode}
              </small>
              <p>{item.reason}</p>
              {item.customerNote && <blockquote>{item.customerNote}</blockquote>}
              <div>
                <Chip
                  variant="soft"
                  size="sm"
                  color={item.status === 'Accepted' ? 'success' : 'default'}
                >
                  {claimStatusLabels[item.status] ?? item.status}
                </Chip>
                <span>{item.amount === null ? 'Tutar belirtilmemiş' : money(item.amount)}</span>
                <small>
                  {item.quantity === undefined ? 'Talebin tamamı' : `${item.quantity} adet`}
                </small>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="description field-description">
        Onay, seçilen kalemler için platformun iade kararını başlatır. Depoya ulaşan ürünlerin stok
        dönüşünü “Satış iadeleri” sekmesinden kaydedin.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="marketplace-detail-actions">
        {['trendyol', 'ciceksepeti', 'pazarama', 'hepsiburada', 'n11'].includes(record.provider) &&
          can('finance.write') && (
            <Button
              variant="secondary"
              isDisabled={!!busy || !actionable || !chosen.length}
              onPress={() => setDecision('reject')}
            >
              Ret talebi
            </Button>
          )}
        {['pazarama', 'n11'].includes(record.provider) && can('finance.write') && (
          <Button
            variant="secondary"
            isDisabled={!!busy || !actionable || !chosen.length}
            onPress={() => setDecision('investigate')}
          >
            {record.provider === 'n11' ? 'İnceleme / erteleme' : 'İncelemeye gönder'}
          </Button>
        )}
        <Button variant="secondary" isDisabled={!!busy} onPress={() => void action('refresh')}>
          <RefreshCw size={15} />
          Durumu yenile
        </Button>
        {can('finance.write') && (
          <Button
            variant="primary"
            isDisabled={!!busy || !actionable || chosen.length === 0}
            onPress={() => void action('approve')}
          >
            <Check size={15} />
            {chosen.length} kalemi onayla
          </Button>
        )}
      </div>
      {decision && (
        <ClaimDecisionDialog
          recordId={record.id}
          itemIds={chosen}
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={async () => {
            setSelected([])
            await reload()
            notify('İade kararı gönderildi; sağlayıcı sonucu izlenecek.')
          }}
        />
      )}
    </div>
  )
}
