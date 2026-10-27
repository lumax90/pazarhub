import { useDeferredValue, useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { ArrowUpRight, MessageCircle, RefreshCw, Send } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { MarketplaceQuestion, MarketplaceRecord } from '../domain/marketplace'
import { questionStatusLabels, workflowBusy } from '../domain/marketplace'
import { apiMutation } from '../lib/api'
import { dateLabel } from '../lib/format'
import { useResource } from '../lib/useResource'
import { DataTable } from '../components/ui/DataTable'
import { AsyncState } from '../components/ui/AsyncState'
import { Dialog, EmptyState, FilterTabs, PageHeader, Panel } from '../components/ui/shared'
import {
  MarketplaceToolbar,
  RecordsPagination,
  WorkflowBadge,
  WorkflowMessage,
} from '../components/marketplace/MarketplaceTools'

type QuestionRecord = MarketplaceRecord<MarketplaceQuestion>
export function QuestionsPage() {
  const { mode } = useApp(),
    [params, setParams] = useSearchParams()
  const [store, setStore] = useState('all'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [offset, setOffset] = useState(0)
  const deferred = useDeferredValue(query),
    selected = params.get('record')
  const search = new URLSearchParams({
    resource: 'question',
    query: deferred,
    offset: String(offset),
    ...(store === 'all' ? {} : { connectionId: store }),
    ...(status === 'all' ? {} : { status }),
  })
  const result = useResource<{ records: QuestionRecord[]; hasMore: boolean }>(
    `/api/marketplace/records?${search}`,
    5000,
  )
  return (
    <>
      <PageHeader
        title="Müşteri Soruları"
        description="Ürün sorularını okuyun, yanıtlayın ve platformdaki sonucunu izleyin."
        actions={
          <Link to="/jobs" className="button button--secondary">
            İşlem merkezi
          </Link>
        }
      />
      <Panel flush className="list-panel">
        <FilterTabs
          label="Soru durumları"
          value={status}
          onChange={(v) => {
            setStatus(v)
            setOffset(0)
          }}
          items={[
            { id: 'all', label: 'Tüm sorular' },
            { id: 'WAITING_FOR_ANSWER', label: 'Yanıt bekleyen' },
            { id: 'ANSWERED', label: 'Yanıtlanan' },
            { id: 'REJECTED', label: 'Reddedilen' },
          ]}
        />
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
          operation="questions.pull"
          onRefresh={result.reload}
        />
        <AsyncState
          loading={result.loading}
          error={result.error}
          retry={() => void result.reload()}
        />
        {mode === 'demo' ? (
          <EmptyState
            title="Pazaryeri sorularınız burada"
            description="Bağlı mağazaların soruları gerçek çalışma alanınızda görünür."
            icon={<MessageCircle size={26} />}
          />
        ) : (
          <>
            <DataTable
              paginate={false}
              label="Müşteri soruları"
              items={result.data?.records ?? []}
              emptyTitle="Bu görünümde soru yok"
              emptyDescription="Mağazadan kayıtları alın veya durum filtresini değiştirin."
              columns={[
                {
                  id: 'question',
                  label: 'Soru / ürün',
                  rowHeader: true,
                  cell: (r) => (
                    <button
                      className="button button--sm button--ghost text-button marketplace-question-cell"
                      onClick={() => setParams({ record: r.id })}
                    >
                      <strong>{r.document.text}</strong>
                      <small className="cell-secondary">{r.document.productName}</small>
                    </button>
                  ),
                },
                { id: 'store', label: 'Mağaza', cell: (r) => r.connectionName },
                {
                  id: 'status',
                  label: 'Durum',
                  cell: (r) => (
                    <div className="marketplace-status-stack">
                      <Chip
                        size="sm"
                        variant="soft"
                        color={r.document.status === 'ANSWERED' ? 'success' : 'default'}
                      >
                        {questionStatusLabels[r.document.status] ?? r.document.status}
                      </Chip>
                      {r.workflow?.state !== 'confirmed' && <WorkflowBadge workflow={r.workflow} />}
                    </div>
                  ),
                },
                {
                  id: 'date',
                  label: 'Soru tarihi',
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
      </Panel>
      {selected && mode === 'live' && (
        <QuestionDialog
          key={selected}
          id={selected}
          onClose={() => setParams({})}
          onChange={result.reload}
        />
      )}
    </>
  )
}
function QuestionDialog({
  id,
  onClose,
  onChange,
}: {
  id: string
  onClose: () => void
  onChange: () => Promise<void>
}) {
  const resource = useResource<QuestionRecord>(`/api/marketplace/records/${id}`, 3000)
  return (
    <Dialog
      open
      drawer
      title="Soruyu yanıtla"
      description={resource.data?.connectionName}
      onClose={onClose}
    >
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data?.document.kind === 'question' && (
        <QuestionEditor
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
function QuestionEditor({
  record,
  reload,
}: {
  record: QuestionRecord
  reload: () => Promise<void>
}) {
  const { can, notify } = useApp(),
    [text, setText] = useState(record.workflow?.answer ?? ''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const question = record.document,
    editable =
      question.status === 'WAITING_FOR_ANSWER' &&
      !workflowBusy(record.workflow) &&
      can('orders.write')
  const action = async (kind: 'answer' | 'refresh') => {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      await apiMutation(
        kind === 'answer'
          ? `/api/marketplace/questions/${record.id}/answer`
          : `/api/marketplace/records/${record.id}/refresh`,
        kind === 'answer' ? { text } : {},
      )
      notify(kind === 'answer' ? 'Yanıt gönderim sırasına alındı.' : 'Soru durumu sorgulanıyor.')
      await reload()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="marketplace-detail">
      <div className="marketplace-product-context">
        {question.imageUrl && <img src={question.imageUrl} referrerPolicy="no-referrer" alt="" />}
        <div>
          <strong>{question.productName || 'Ürün sorusu'}</strong>
          <small>
            {question.customerName || 'Pazaryeri müşterisi'}
            {question.createdAt ? ` · ${dateLabel(question.createdAt, true)}` : ''}
          </small>
          {question.productUrl && (
            <a href={question.productUrl} target="_blank" rel="noreferrer">
              Ürünü gör
              <ArrowUpRight size={13} />
            </a>
          )}
        </div>
      </div>
      <blockquote className="marketplace-question-bubble">{question.text}</blockquote>
      <WorkflowMessage workflow={record.workflow} />
      {question.answer && (
        <div className="marketplace-answer-bubble">
          <strong>Yayındaki yanıt</strong>
          <p>{question.answer}</p>
        </div>
      )}
      {question.rejectedAnswer && (
        <div className="marketplace-rejected-answer">
          <strong>Son reddedilen yanıt</strong>
          <p>{question.rejectedAnswer}</p>
          <small>{question.rejectionReason}</small>
        </div>
      )}
      {editable && (
        <div className="native-textarea-field">
          <label className="label" htmlFor="marketplace-answer">
            Yanıtınız
          </label>
          <textarea
            className="textarea textarea--secondary"
            id="marketplace-answer"
            rows={6}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ürünle ilgili açık ve yardımcı bir yanıt yazın…"
          />
          <span className="description field-description">
            {text.trim().length} / 2000 karakter · en az 10 karakter
          </span>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="marketplace-detail-actions">
        <Button variant="secondary" isDisabled={!!busy} onPress={() => void action('refresh')}>
          <RefreshCw size={15} />
          Durumu yenile
        </Button>
        {editable && (
          <Button
            variant="primary"
            isDisabled={!!busy || text.trim().length < 10}
            onPress={() => void action('answer')}
          >
            <Send size={15} />
            Yanıtı gönder
          </Button>
        )}
      </div>
    </div>
  )
}
