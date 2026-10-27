import { useState } from 'react'
import { Button } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { IntegrationJob } from '../../domain/integrations'
import { operationLabels } from '../../domain/integration-labels'
import { useResource } from '../../lib/useResource'
import { apiMutation } from '../../lib/api'
import { dateLabel } from '../../lib/format'
import { Dialog, Field, SelectButton } from '../ui/shared'
import { AsyncState } from '../ui/AsyncState'

export function FulfillmentReconciliation({
  kind,
  id,
  onClose,
}: {
  kind: 'invoice' | 'shipment'
  id: string
  onClose: () => void
}) {
  const { refresh, notify } = useApp(),
    [selected, setSelected] = useState(''),
    [externalId, setExternalId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const resource = useResource<{ reference: string; supported: boolean; jobs: IntegrationJob[] }>(
    `/api/fulfillment/${kind}/${id}/reconciliation`,
    3000,
  )
  const jobs = resource.data?.jobs ?? [],
    sources = jobs.filter(
      (job) =>
        ['failed', 'uncertain'].includes(job.status) &&
        ['invoice.create', 'invoice.finalize', 'shipment.create', 'shipment.cancel'].includes(
          job.kind,
        ),
    )
  const sourceId = selected || sources[0]?.id,
    source = sources.find((job) => job.id === sourceId)
  const pending = jobs.some(
    (job) =>
      job.kind === `${kind}.reconcile` && ['queued', 'waiting', 'running'].includes(job.status),
  )
  const latest = jobs.find((job) => job.kind === `${kind}.reconcile`)
  const submit = async () => {
    if (busy || !sourceId) return
    setBusy(true)
    setError('')
    try {
      await apiMutation(`/api/fulfillment/${kind}/${id}/reconcile`, {
        sourceJobId: sourceId,
        ...(kind === 'invoice' && externalId.trim() ? { externalId: externalId.trim() } : {}),
      })
      await resource.reload()
      await refresh()
      notify('Sağlayıcı kaydını doğrulama işlemi sıraya alındı.')
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      wide
      title={kind === 'invoice' ? 'Fatura sonucunu uzlaştır' : 'Gönderi sonucunu uzlaştır'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Kapat
          </Button>
          <Button
            variant="primary"
            isDisabled={busy || pending || !source || !resource.data?.supported}
            onPress={() => void submit()}
          >
            <RefreshCw size={15} />
            Sağlayıcı kaydını doğrula
          </Button>
        </>
      }
    >
      <div className="margin-rule-form">
        <AsyncState
          loading={resource.loading}
          error={resource.error}
          retry={() => void resource.reload()}
        />
        <p className="description field-description">
          Kayıt, oluşturma referansı ve sağlayıcı bilgileriyle eşleştirilir. Doğrulanan işlem
          tamamlanır; doğrulanmış hazırlık adımı varsa kaldığı yerden sürdürülür.
        </p>
        {resource.data && (
          <div className="field-source">
            Referans: <span className="code-text">{resource.data.reference}</span>
          </div>
        )}
        {sources.length > 0 && (
          <SelectButton
            label="Uzlaştırılacak işlem"
            value={sourceId ?? ''}
            onChange={setSelected}
            options={sources.map((job) => ({
              id: job.id,
              label: `${operationLabels[job.kind]} · ${dateLabel(job.createdAt, true)}`,
            }))}
            isDisabled={busy || pending}
          />
        )}
        {source?.lastError && <p className="resource-error">{source.lastError}</p>}
        {kind === 'invoice' && source && (
          <Field
            label="Paraşüt fatura kimliği (isteğe bağlı)"
            value={externalId}
            onChange={setExternalId}
            description="Boş bırakırsanız kayıt, oluşturma günü ve yerel referansıyla aranır."
            isDisabled={busy || pending}
          />
        )}
        {latest && (
          <p
            className={latest.status === 'failed' ? 'form-error' : 'description field-description'}
            role="status"
          >
            {latest.lastError || String(latest.result?.message ?? 'Doğrulama sürüyor…')}
          </p>
        )}
        {!sources.length && resource.data && (
          <p className="description field-description">Uzlaştırma bekleyen işlem yok.</p>
        )}
        {resource.data && !resource.data.supported && (
          <p className="description field-description">
            Bu bağlantının referans sorgu sözleşmesi henüz doğrulanmadı. Sağlayıcıdaki mevcut kaydı
            kontrol edin.
          </p>
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
