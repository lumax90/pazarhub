import { useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { Paperclip, Trash2 } from 'lucide-react'
import type { ClaimDecisionOptions } from '../../domain/marketplace'
import { useResource } from '../../lib/useResource'
import { apiMutation, apiRequest } from '../../lib/api'
import { Dialog, Field, SelectButton } from '../ui/shared'
import { AsyncState } from '../ui/AsyncState'

export function ClaimDecisionDialog({
  recordId,
  itemIds,
  decision,
  onClose,
  onDone,
}: {
  recordId: string
  itemIds: string[]
  decision: 'reject' | 'investigate'
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const resource = useResource<
    ClaimDecisionOptions & { files: { id: string; name: string; mime: string; size: number }[] }
  >(`/api/marketplace/claims/${recordId}/options`)
  const input = useRef<HTMLInputElement>(null),
    [reason, setReason] = useState(''),
    [review, setReview] = useState(''),
    [days, setDays] = useState('1'),
    [description, setDescription] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      await apiRequest(`/api/marketplace/claims/${recordId}/files`, { method: 'POST', body })
      await resource.reload()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const submit = async () => {
    if (!resource.data) return
    setBusy(true)
    setError('')
    try {
      await apiMutation(`/api/marketplace/claims/${recordId}/decision`, {
        itemIds,
        decision,
        reasonId: decision === 'reject' ? reason || resource.data.reasons[0]?.id : undefined,
        reviewType:
          decision === 'investigate' ? review || resource.data.reviewTypes[0]?.id : undefined,
        reviewDays:
          decision === 'investigate' && resource.data.reviewDaysRequired ? Number(days) : undefined,
        description: description || undefined,
        fileIds: resource.data.files.map((file) => file.id),
      })
      await onDone()
      onClose()
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
      title={decision === 'reject' ? 'İade ret talebi' : 'İnceleme talebi'}
      description={`${itemIds.length} talep kalemi seçildi.`}
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            isDisabled={
              busy ||
              !resource.data?.decisions.includes(decision) ||
              (!!resource.data?.descriptionRequired &&
                (resource.data.reviewDaysRequired ||
                  decision !== 'investigate' ||
                  (review || resource.data.reviewTypes[0]?.id) === '3') &&
                !description.trim())
            }
            onPress={() => void submit()}
          >
            {decision === 'reject' ? 'Ret talebini gönder' : 'İncelemeye gönder'}
          </Button>
        </>
      }
    >
      <div className="margin-rule-form">
        <AsyncState loading={resource.loading} error={resource.error} />
        {resource.data && (
          <>
            {decision === 'reject' && resource.data.reasons.length > 0 && (
              <SelectButton
                label="Pazaryeri ret nedeni"
                value={reason || resource.data.reasons[0]?.id || ''}
                onChange={setReason}
                options={resource.data.reasons}
                isDisabled={busy}
              />
            )}
            {decision === 'investigate' && (
              <SelectButton
                label="İnceleme türü"
                value={review || resource.data.reviewTypes[0]?.id || ''}
                onChange={setReview}
                options={resource.data.reviewTypes}
                isDisabled={busy}
              />
            )}
            {resource.data.descriptionRequired && (
              <Field
                label="Karar açıklaması"
                value={description}
                onChange={setDescription}
                maxLength={500}
                isDisabled={busy}
              />
            )}
            {decision === 'investigate' && resource.data.reviewDaysRequired && (
              <Field
                label="Erteleme süresi (gün)"
                type="number"
                min={1}
                max={14}
                value={days}
                onChange={setDays}
                isDisabled={busy}
              />
            )}
            {resource.data.filesAllowed && (
              <>
                <input
                  className="input input--secondary"
                  ref={input}
                  type="file"
                  hidden
                  aria-label="İade kanıt dosyası"
                  accept={
                    resource.data.imagesOnly
                      ? 'image/png,image/jpeg,image/webp'
                      : 'application/pdf,image/png,image/jpeg,image/webp'
                  }
                  onChange={(event) => void upload(event.target.files?.[0])}
                />
                <Button
                  variant="secondary"
                  isDisabled={busy || resource.data.files.length >= 3}
                  onPress={() => input.current?.click()}
                >
                  <Paperclip size={14} />
                  Kanıt dosyası ekle
                </Button>
                <p className="description field-description">
                  En fazla 3 dosya · dosya başına 5 MB. Ekler yalnız bu talebe bağlanır.
                </p>
                {resource.data.files.map((file) => (
                  <div className="order-attachment" key={file.id}>
                    <a className="document-link" href={`/api/files/${file.id}`} download>
                      {file.name}
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label={`${file.name} dosyasını kaldır`}
                      isDisabled={busy}
                      onPress={async () => {
                        setBusy(true)
                        try {
                          await apiRequest(`/api/marketplace/claims/${recordId}/files/${file.id}`, {
                            method: 'DELETE',
                          })
                          await resource.reload()
                        } catch (error) {
                          setError((error as Error).message)
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </>
            )}
          </>
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
