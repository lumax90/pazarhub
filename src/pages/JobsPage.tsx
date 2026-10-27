import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { RefreshCw, Workflow } from 'lucide-react'
import { Link } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { IntegrationJob } from '../domain/integrations'
import { apiRequest } from '../lib/api'
import { dateLabel } from '../lib/format'
import { useResource } from '../lib/useResource'
import { DataTable } from '../components/ui/DataTable'
import type { Column } from '../components/ui/DataTable'
import { AsyncState } from '../components/ui/AsyncState'
import { Dialog, EmptyState, FilterTabs, PageHeader, Panel } from '../components/ui/shared'
import { operationLabels } from '../domain/integration-labels'
import { freshRequestJobs, jobPermission } from '../domain/permissions'
import { FulfillmentReconciliation } from '../components/integrations/FulfillmentReconciliation'

const labels: Record<IntegrationJob['status'], string> = {
  queued: 'Sırada',
  running: 'Çalışıyor',
  waiting: 'Bekliyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  uncertain: 'Sonuç doğrulanmalı',
  cancelled: 'İptal edildi',
}
const recordPath = (job: IntegrationJob) =>
  !job.entityId
    ? null
    : job.kind.startsWith('listing.content')
      ? `/listings/content/${job.entityId}`
      : job.kind.startsWith('listing.')
        ? `/listings/prepare/${job.entityId}`
        : job.kind.startsWith('order.fulfillment')
          ? `/orders/${job.entityId}`
          : ['question.answer', 'questions.pull'].includes(job.kind)
            ? `/questions?record=${job.entityId}`
            : ['claim.decide', 'claims.pull'].includes(job.kind)
              ? `/returns?view=marketplace&record=${job.entityId}`
              : job.kind === 'settlements.pull'
                ? `/finance/settlements?record=${job.entityId}`
                : null
export function JobsPage() {
  const { mode, notify, can } = useApp()
  const [status, setStatus] = useState('all'),
    [selection, setSelected] = useState<IntegrationJob | null>(null),
    [busy, setBusy] = useState('')
  const [reconciling, setReconciling] = useState<IntegrationJob | null>(null)
  const resource = useResource<{ jobs: IntegrationJob[] }>(
    `/api/jobs?limit=200${status === 'all' ? '' : `&status=${status}`}`,
    3000,
  )
  const selected = resource.data?.jobs.find((j) => j.id === selection?.id) ?? selection
  const retry = async (job: IntegrationJob) => {
    setBusy(job.id)
    try {
      await apiRequest(`/api/jobs/${job.id}/retry`, { method: 'POST', body: {} })
      notify('İşlem yeniden sıraya alındı.')
      await resource.reload()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'İşlem başlatılamadı.', 'error')
    } finally {
      setBusy('')
    }
  }
  const columns: Column<IntegrationJob>[] = [
    {
      id: 'operation',
      label: 'İşlem',
      rowHeader: true,
      cell: (job) => (
        <button
          className="button button--sm button--ghost text-button"
          onClick={() => setSelected(job)}
        >
          {operationLabels[job.kind] ?? job.kind}
          <small className="cell-secondary">{job.connectionName ?? 'Çalışma alanı'}</small>
        </button>
      ),
    },
    {
      id: 'status',
      label: 'Durum',
      cell: (job) => (
        <Chip
          size="sm"
          variant="soft"
          color={
            job.status === 'completed'
              ? 'success'
              : job.status === 'failed' || job.status === 'uncertain'
                ? 'danger'
                : job.status === 'running'
                  ? 'accent'
                  : 'default'
          }
        >
          {labels[job.status]}
        </Chip>
      ),
    },
    {
      id: 'result',
      label: 'Sonuç',
      cell: (job) => (
        <span className="job-result-preview">
          {job.lastError || String(job.result?.message ?? 'İşlem sonucu bekleniyor.')}
        </span>
      ),
    },
    {
      id: 'created',
      label: 'Başlangıç',
      sortValue: (job) => job.createdAt,
      cell: (job) => dateLabel(job.createdAt, true),
    },
    {
      id: 'actions',
      label: '',
      cell: (job) =>
        freshRequestJobs.includes(job.kind) && recordPath(job) ? (
          <Link className="button button--secondary button--sm" to={recordPath(job)!}>
            Kaydı aç
          </Link>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            isDisabled={
              busy === job.id ||
              !can(jobPermission(job.kind)) ||
              !['failed', 'waiting'].includes(job.status)
            }
            onPress={() => void retry(job)}
          >
            <RefreshCw size={14} />
            Yeniden dene
          </Button>
        ),
    },
  ]
  return (
    <>
      <PageHeader
        title="İşlem Merkezi"
        description="Senkronizasyon, gönderim ve belge işlemlerinin adım adım sonucu."
        actions={
          <Button variant="secondary" onPress={() => void resource.reload()}>
            <RefreshCw size={16} />
            Yenile
          </Button>
        }
      />
      {mode === 'demo' ? (
        <Panel>
          <EmptyState
            title="Gerçek işlemler burada görünecek"
            description="Bir API hesabı bağladıktan sonra kuyruk ve sağlayıcı sonuçlarını izleyebilirsiniz."
            icon={<Workflow size={27} />}
          />
        </Panel>
      ) : (
        <Panel flush className="list-panel">
          <FilterTabs
            value={status}
            onChange={setStatus}
            items={[
              { id: 'all', label: 'Tüm işlemler' },
              { id: 'running', label: 'Çalışan' },
              { id: 'waiting', label: 'Bekleyen' },
              { id: 'failed', label: 'Başarısız' },
              { id: 'uncertain', label: 'Doğrulanacak' },
              { id: 'completed', label: 'Tamamlanan' },
            ]}
          />
          <AsyncState
            loading={resource.loading}
            error={resource.error}
            retry={() => void resource.reload()}
          />
          <DataTable
            label="Entegrasyon işlemleri"
            items={resource.data?.jobs ?? []}
            columns={columns}
            emptyTitle="Henüz işlem yok"
            emptyDescription="Bağlantı testi veya senkronizasyon başlatıldığında burada görünür."
          />
        </Panel>
      )}
      {selected && (
        <Dialog
          open
          onClose={() => setSelected(null)}
          title={operationLabels[selected.kind] ?? selected.kind}
          description={selected.connectionName}
        >
          <dl className="detail-list">
            <div>
              <dt>İşlem kimliği</dt>
              <dd className="code-text">{selected.id}</dd>
            </div>
            <div>
              <dt>Durum</dt>
              <dd>{labels[selected.status]}</dd>
            </div>
            <div>
              <dt>Hata denemesi</dt>
              <dd>
                {selected.attempts} / {selected.maxAttempts}
              </dd>
            </div>
            <div>
              <dt>Sonuç</dt>
              <dd>
                {selected.lastError || String(selected.result?.message ?? 'Henüz sonuç yok.')}
              </dd>
            </div>
            {!!selected.result?.reference && (
              <div>
                <dt>Sağlayıcı işlem numarası</dt>
                <dd>{String(selected.result.reference)}</dd>
              </div>
            )}
          </dl>
          {selected.status === 'uncertain' && (
            <p className="inline-notice">
              Sağlayıcı isteği almış olabilir. Yinelenen gönderi veya fatura oluşturmamak için önce
              sağlayıcı kaydı doğrulanmalıdır.
            </p>
          )}
          {selected.entityId &&
            ['invoice.create', 'invoice.finalize', 'shipment.create', 'shipment.cancel'].includes(
              selected.kind,
            ) &&
            ['uncertain', 'failed'].includes(selected.status) &&
            can(jobPermission(selected.kind)) && (
              <Button variant="primary" onPress={() => setReconciling(selected)}>
                Sonucu uzlaştır
              </Button>
            )}
          {recordPath(selected) && (
            <Link
              className="button button--secondary"
              to={recordPath(selected)!}
              onClick={() => setSelected(null)}
            >
              İlgili kaydı aç
            </Link>
          )}
        </Dialog>
      )}
      {reconciling?.entityId && (
        <FulfillmentReconciliation
          kind={reconciling.kind.startsWith('invoice.') ? 'invoice' : 'shipment'}
          id={reconciling.entityId}
          onClose={() => setReconciling(null)}
        />
      )}
    </>
  )
}
