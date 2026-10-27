import { useDeferredValue, useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { ArrowDownLeft, Check, FileSearch, Link2, RefreshCw, Unlink, Wallet } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type {
  FinancialBreakdown,
  FinancialRecord,
  MarketplaceRecord,
  RemoteWorkflow,
  SettlementMatch,
} from '../domain/marketplace'
import { financialTypeLabels, ticksToCents } from '../domain/marketplace'
import { apiMutation } from '../lib/api'
import { dateLabel, money, moneyTicks } from '../lib/format'
import { useResource } from '../lib/useResource'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import { AsyncState } from '../components/ui/AsyncState'
import {
  Dialog,
  EmptyState,
  FilterTabs,
  Metric,
  PageHeader,
  Panel,
  SelectButton,
  SectionTitle,
} from '../components/ui/shared'
import {
  MarketplaceToolbar,
  RecordsPagination,
  WorkflowMessage,
} from '../components/marketplace/MarketplaceTools'

type RecordRow = MarketplaceRecord<FinancialRecord>
interface PayoutDetail {
  connectionId: string
  payout: FinancialRecord
  workflow: RemoteWorkflow | null
  complete: boolean
  summary: FinancialBreakdown
  differenceTicks: string | null
}
export function SettlementsPage() {
  const { mode, state } = useApp(),
    [params, setParams] = useSearchParams()
  const [store, setStore] = useState('all'),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0)
  const deferred = useDeferredValue(query),
    view =
      params.get('type') === 'entries' ||
      (!params.has('type') &&
        state.connections.find((connection) => connection.id === store)?.channel === 'hepsiburada')
        ? 'entries'
        : 'payouts',
    selected = params.get('record')
  const search = new URLSearchParams({
    resource: 'settlement',
    kind: view === 'payouts' ? 'payout' : 'entry',
    query: deferred,
    offset: String(offset),
    ...(store === 'all' ? {} : { connectionId: store }),
  })
  const resource = useResource<{ records: RecordRow[]; hasMore: boolean }>(
    `/api/marketplace/records?${search}`,
    5000,
  )
  const summary = useResource<{
    payoutCount: number
    payoutCents: number
    matches: SettlementMatch[]
  }>(`/api/marketplace/financial-summary${store === 'all' ? '' : `?connectionId=${store}`}`, 5000)
  const matched = summary.data?.matches ?? []
  const columns: Column<RecordRow>[] = [
    {
      id: 'type',
      label: view === 'payouts' ? 'Ödeme emri' : 'İşlem türü',
      rowHeader: true,
      cell: (r) =>
        view === 'payouts' ? (
          <button
            className="button button--sm button--ghost text-button"
            onClick={() => setParams({ record: r.id })}
          >
            <strong>#{r.document.paymentOrderId}</strong>
            <small className="cell-secondary">{r.connectionName}</small>
          </button>
        ) : (
          <span>
            <strong>
              {financialTypeLabels[r.document.transactionType] ?? r.document.transactionType}
            </strong>
            <small className="cell-secondary">{r.connectionName}</small>
            {r.document.description && (
              <small className="cell-secondary">{r.document.description}</small>
            )}
          </span>
        ),
    },
    {
      id: 'date',
      label: 'Tarih',
      cell: (r) => (r.document.transactionDate ? dateLabel(r.document.transactionDate) : '—'),
    },
    ...(view === 'payouts'
      ? [
          {
            id: 'amount',
            label: 'Ödenen tutar',
            className: 'align-right',
            cell: (r: RecordRow) => (
              <strong className="money-cell">{moneyTicks(r.document.amountTicks)}</strong>
            ),
          },
          {
            id: 'match',
            label: 'Tahsilat',
            cell: (r: RecordRow) => (
              <Chip
                size="sm"
                variant="soft"
                color={
                  matched.some(
                    (m) =>
                      m.connectionId === r.connectionId &&
                      m.paymentOrderId === r.document.paymentOrderId,
                  )
                    ? 'success'
                    : 'warning'
                }
              >
                {matched.some(
                  (m) =>
                    m.connectionId === r.connectionId &&
                    m.paymentOrderId === r.document.paymentOrderId,
                )
                  ? 'Kasa ile eşleşti'
                  : 'Eşleme bekliyor'}
              </Chip>
            ),
          },
          {
            id: 'action',
            label: '',
            cell: (r: RecordRow) => (
              <Button size="sm" variant="ghost" onPress={() => setParams({ record: r.id })}>
                <FileSearch size={15} />
                İncele
              </Button>
            ),
          },
        ]
      : [
          {
            id: 'order',
            label: 'Sipariş / ödeme emri',
            cell: (r: RecordRow) => (
              <span>
                {r.localOrderId ? (
                  <Link className="order-link" to={`/orders/${r.localOrderId}`}>
                    {r.document.orderNumber}
                  </Link>
                ) : (
                  (r.document.orderNumber ?? '—')
                )}
                <small className="cell-secondary">
                  {r.document.paymentOrderId
                    ? `Ödeme #${r.document.paymentOrderId}`
                    : r.provider === 'hepsiburada'
                      ? r.document.status === 'Paid'
                        ? 'Sağlayıcıda ödendi'
                        : 'Sağlayıcı ödemesi bekleniyor'
                      : 'Henüz ödemeye bağlanmadı'}
                </small>
              </span>
            ),
          },
          {
            id: 'debit',
            label: 'Borç',
            className: 'align-right',
            cell: (r: RecordRow) => moneyTicks(r.document.debitTicks),
          },
          {
            id: 'credit',
            label: 'Alacak',
            className: 'align-right',
            cell: (r: RecordRow) => moneyTicks(r.document.creditTicks),
          },
          {
            id: 'commission',
            label: 'Komisyon',
            className: 'align-right',
            cell: (r: RecordRow) => moneyTicks(r.document.commissionTicks),
          },
          {
            id: 'effect',
            label: 'Net etki',
            className: 'align-right',
            cell: (r: RecordRow) => moneyTicks(r.document.effectTicks),
          },
        ]),
  ]
  return (
    <>
      <PageHeader
        title="Hakedişler"
        description="Pazaryeri ödeme emirleri, komisyonlar ve banka tahsilatı eşlemesi."
        actions={
          <Link to="/finance/cash" className="button button--secondary">
            <Wallet size={15} />
            Kasa hareketleri
          </Link>
        }
      />
      <div className="metrics-grid metrics-grid--three">
        <Metric
          label="Kayıtlı ödeme emirleri"
          value={String(summary.data?.payoutCount ?? 0)}
          detail="sağlayıcı tarafından ödenmiş"
          icon={<FileSearch size={18} />}
        />
        <Metric
          label="Ödeme emri toplamı"
          value={money(summary.data?.payoutCents ?? 0)}
          detail="içe alınan hakedişler"
          icon={<ArrowDownLeft size={18} />}
          index={1}
        />
        <Metric
          label="Tahsilatla eşleşen"
          value={String(matched.length)}
          detail="kasada karşılığı seçilmiş"
          icon={<Link2 size={18} />}
          index={2}
        />
      </div>
      <AsyncState
        loading={summary.loading}
        error={summary.error}
        retry={() => void summary.reload()}
      />
      <Panel flush className="list-panel">
        <FilterTabs
          label="Hakediş görünümü"
          value={view}
          onChange={(type) => {
            setParams(type === 'entries' ? { type } : {})
            setOffset(0)
            setQuery('')
          }}
          items={[
            { id: 'payouts', label: 'Ödeme emirleri' },
            { id: 'entries', label: 'Satış ve kesinti kayıtları' },
          ]}
        />
        <MarketplaceToolbar
          store={store}
          onStore={(id) => {
            setStore(id)
            setOffset(0)
          }}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setOffset(0)
          }}
          operation="settlements.pull"
          onRefresh={resource.reload}
        />
        <AsyncState
          loading={resource.loading}
          error={resource.error}
          retry={() => void resource.reload()}
        />
        {mode === 'demo' ? (
          <EmptyState
            title="Mağaza hakedişleriniz burada"
            description="Finans kayıtları bağlı pazaryeri hesabınızdan alınır."
            icon={<Wallet size={26} />}
          />
        ) : (
          <>
            <DataTable
              paginate={false}
              label={view === 'payouts' ? 'Pazaryeri ödeme emirleri' : 'Pazaryeri finans kayıtları'}
              items={resource.data?.records ?? []}
              columns={columns}
              emptyTitle="Bu görünümde finans kaydı yok"
              emptyDescription="Pazaryerinden al düğmesiyle son 45 günün kayıtlarını getirebilirsiniz."
            />
            <RecordsPagination
              offset={offset}
              count={resource.data?.records.length ?? 0}
              hasMore={resource.data?.hasMore ?? false}
              onChange={setOffset}
            />
          </>
        )}
      </Panel>
      {selected && mode === 'live' && (
        <PayoutDialog
          key={selected}
          id={selected}
          onClose={() => setParams(view === 'entries' ? { type: 'entries' } : {})}
          onChange={async () => {
            await resource.reload()
            await summary.reload()
          }}
        />
      )}
    </>
  )
}
function PayoutDialog({
  id,
  onClose,
  onChange,
}: {
  id: string
  onClose: () => void
  onChange: () => Promise<void>
}) {
  const resource = useResource<PayoutDetail>(`/api/marketplace/payouts/${id}`, 3000)
  return (
    <Dialog
      open
      wide
      title={
        resource.data ? `Hakediş #${resource.data.payout.paymentOrderId}` : 'Hakediş detayları'
      }
      onClose={onClose}
    >
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data && (
        <PayoutEditor
          id={id}
          detail={resource.data}
          reload={async () => {
            await resource.reload()
            await onChange()
          }}
        />
      )}
    </Dialog>
  )
}
function PayoutEditor({
  id,
  detail,
  reload,
}: {
  id: string
  detail: PayoutDetail
  reload: () => Promise<void>
}) {
  const { state, refresh, can, notify } = useApp(),
    [cashId, setCashId] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const { payout, summary, workflow } = detail,
    amount = ticksToCents(payout.amountTicks!)
  const match = state.settlementMatches?.find(
    (m) => m.connectionId === detail.connectionId && m.paymentOrderId === payout.paymentOrderId,
  )
  const options = state.cash.filter(
    (c) =>
      c.kind === 'in' &&
      c.method === 'transfer' &&
      !c.transferId &&
      !c.customerId &&
      c.amount === amount &&
      !state.settlementMatches?.some((m) => m.cashEntryId === c.id),
  )
  const action = async (kind: 'refresh' | 'match' | 'unmatch') => {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      await apiMutation(
        `/api/marketplace/payouts/${id}/${kind === 'unmatch' ? 'match' : kind}`,
        kind === 'match'
          ? { cashEntryId: cashId }
          : kind === 'unmatch'
            ? { matchId: match!.id }
            : {},
        { method: kind === 'unmatch' ? 'DELETE' : 'POST' },
      )
      notify(
        kind === 'refresh'
          ? 'Hakediş detayları sorgulanıyor.'
          : kind === 'match'
            ? 'Hakediş banka tahsilatıyla eşleştirildi.'
            : 'Tahsilat eşlemesi kaldırıldı.',
      )
      await refresh()
      await reload()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusy('')
    }
  }
  const balanced =
    detail.complete && summary.netTicks !== null && ticksToCents(summary.netTicks) === amount
  return (
    <div className="marketplace-detail">
      <div className="payout-total">
        <span>{payout.payoutDate ? dateLabel(payout.payoutDate) : 'Ödeme tarihi'}</span>
        <strong>{money(amount)}</strong>
        <Chip size="sm" variant="soft" color="success">
          Sağlayıcıda ödendi
        </Chip>
      </div>
      <SectionTitle
        title="Hakediş dökümü"
        description="Seçilen ödeme emrinin tüm satış ve kesinti sayfaları birlikte kontrol edilir."
      >
        <Button
          variant="secondary"
          isDisabled={
            !!busy ||
            !can('finance.write') ||
            workflow?.state === 'queued' ||
            workflow?.state === 'pending'
          }
          onPress={() => void action('refresh')}
        >
          <RefreshCw size={15} />
          Detayları pazaryerinden al
        </Button>
        <WorkflowMessage workflow={workflow} />
        {summary.groups.length > 0 && (
          <DataTable
            label="Hakediş kırılımı"
            pageSize={50}
            items={summary.groups}
            columns={[
              {
                id: 'type',
                label: 'İşlem',
                rowHeader: true,
                cell: (r) => financialTypeLabels[r.type] ?? r.type,
              },
              { id: 'count', label: 'Kayıt', cell: (r) => r.count },
              {
                id: 'debit',
                label: 'Borç',
                className: 'align-right',
                cell: (r) => moneyTicks(r.debitTicks),
              },
              {
                id: 'credit',
                label: 'Alacak',
                className: 'align-right',
                cell: (r) => moneyTicks(r.creditTicks),
              },
              {
                id: 'effect',
                label: 'Net etki',
                className: 'align-right',
                cell: (r) => moneyTicks(r.effectTicks),
              },
            ]}
          />
        )}
        <dl className="detail-list">
          <div>
            <dt>Hesaplanan net hakediş</dt>
            <dd>
              {detail.complete ? moneyTicks(summary.netTicks) : 'Detaylar tamamlanınca hesaplanır'}
            </dd>
          </div>
          <div>
            <dt>Ödeme emri farkı</dt>
            <dd>
              {moneyTicks(detail.differenceTicks)}
              {balanced && (
                <Chip size="sm" variant="soft" color="success">
                  Kuruş bazında uyumlu
                </Chip>
              )}
            </dd>
          </div>
        </dl>
        {summary.unknownCount > 0 && (
          <p className="inline-notice">
            {summary.unknownCount} kayıtta net etki için gerekli sağlayıcı tutarı eksik.
          </p>
        )}
      </SectionTitle>
      <SectionTitle
        title="Banka tahsilatıyla eşleştir"
        description="Hakediş tutarıyla aynı olan bir havale/EFT kasa girişini seçin."
      >
        {match ? (
          <div className="payout-match">
            <Check size={18} />
            <div>
              <strong>Tahsilat eşleşti</strong>
              <p>{state.cash.find((c) => c.id === match.cashEntryId)?.description}</p>
              <small>{dateLabel(match.matchedAt, true)}</small>
            </div>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={!!busy || !can('finance.write')}
              onPress={() => void action('unmatch')}
            >
              <Unlink size={14} />
              Eşlemeyi kaldır
            </Button>
          </div>
        ) : options.length ? (
          <div className="marketplace-detail-actions">
            <SelectButton
              label="Eşleştirilecek banka tahsilatı"
              value={cashId}
              onChange={setCashId}
              options={options.map((c) => ({
                id: c.id,
                label: `${dateLabel(c.createdAt)} · ${c.description}`,
              }))}
            />
            <Button
              variant="primary"
              isDisabled={!!busy || !can('finance.write') || !cashId}
              onPress={() => void action('match')}
            >
              <Link2 size={15} />
              Tahsilatla eşleştir
            </Button>
          </div>
        ) : (
          <p className="description field-description">
            Bu tutarda eşlenmemiş banka tahsilatı yok.{' '}
            <Link to="/finance/cash" className="order-link">
              Kasa hareketlerine git
            </Link>
          </p>
        )}
      </SectionTitle>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
