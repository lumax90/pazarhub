import { useState } from 'react'
import { Button, Checkbox, Label, Chip } from '@heroui/react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Listing } from '../domain/types'
import type { ListingContentFields } from '../domain/listing-content'
import { apiMutation, apiRequest } from '../lib/api'
import { useResource } from '../lib/useResource'
import { dateLabel } from '../lib/format'
import { AsyncState } from '../components/ui/AsyncState'
import { Dialog, Field, PageHeader, Panel } from '../components/ui/shared'

interface ContentDetail {
  sourceId: string
  fetchedAt: string
  current: ListingContentFields
  defaults: ListingContentFields
  members: string[]
  definition: { fields: (keyof ListingContentFields)[]; maxImages: number; imageSlots?: boolean }
  listing: Listing
}
const labels = { title: 'Başlık', description: 'Açıklama', images: 'Görseller' }
export function ListingContentPage() {
  const { id = '' } = useParams(),
    { state, refresh, notify } = useApp(),
    [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false)
  const resource = useResource<ContentDetail>(
      `/api/listing-content/${id}${epoch ? `?refresh=1&reload=${epoch}` : ''}`,
    ),
    listing = state.listings.find((item) => item.id === id),
    workflow = listing?.contentWorkflow
  return (
    <>
      <PageHeader
        title="İlan içeriği"
        description="Mevcut pazaryeri ürününde güncellenecek alanları seçip önizleyin."
        actions={
          <>
            <Link className="button button--secondary" to="/listings">
              <ArrowLeft size={15} />
              İlanlara dön
            </Link>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => setEpoch((value) => value + 1)}
            >
              <RefreshCw size={15} />
              Pazaryerinden yenile
            </Button>
          </>
        }
      />
      <AsyncState loading={resource.loading} error={resource.error} />
      {workflow && (
        <Panel
          className="product-form-card"
          title="Son içerik işlemi"
          actions={
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy || ['queued', 'pending'].includes(workflow.state)}
              onPress={async () => {
                setBusy(true)
                try {
                  await apiMutation(`/api/listing-content/${id}/check`, {})
                  await refresh()
                  notify('İçerik sonucu sağlayıcıdan sorgulanacak.')
                } catch (error) {
                  notify((error as Error).message, 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Sonucu sorgula
            </Button>
          }
        >
          <Chip
            size="sm"
            variant="soft"
            color={
              workflow.state === 'applied'
                ? 'success'
                : ['uncertain', 'rejected'].includes(workflow.state)
                  ? 'danger'
                  : 'accent'
            }
          >
            {
              {
                queued: 'Sırada',
                pending: 'Onay bekliyor',
                applied: 'Güncellendi',
                rejected: 'Kontrol gerekiyor',
                uncertain: 'Doğrulanmalı',
              }[workflow.state]
            }
          </Chip>
          <p className="description field-description" role="status">
            {workflow.message}
          </p>
        </Panel>
      )}
      {resource.data && (
        <ContentEditor
          key={resource.data.sourceId}
          id={id}
          detail={resource.data}
          locked={!!workflow && ['queued', 'pending', 'uncertain'].includes(workflow.state)}
        />
      )}
    </>
  )
}
function ContentEditor({
  id,
  detail,
  locked,
}: {
  id: string
  detail: ContentDetail
  locked: boolean
}) {
  const { refresh, notify } = useApp(),
    [fields, setFields] = useState(() => structuredClone(detail.current)),
    [selected, setSelected] = useState<(keyof ListingContentFields)[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<{
      previewId: string
      changes: Partial<ListingContentFields>
      members: string[]
    } | null>(null)
  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      setPreview(
        await apiRequest(`/api/listing-content/${id}/preview`, {
          method: 'POST',
          body: {
            sourceId: detail.sourceId,
            changes: Object.fromEntries(
              selected.map((key) => [
                key,
                key === 'images' ? fields.images.filter(Boolean) : fields[key],
              ]),
            ),
          },
        }),
      )
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const submit = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      await apiMutation(`/api/listing-content/${id}/send`, { previewId: preview.previewId })
      await refresh()
      setPreview(null)
      notify('İçerik değişikliği sıraya alındı.')
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <p className="description field-description">
        Okunma: {dateLabel(detail.fetchedAt, true)} · İlgili stok kodları:{' '}
        {detail.members.join(', ')}
      </p>
      {detail.definition.fields.map((key) => (
        <Panel
          key={key}
          className="product-form-card"
          title={labels[key]}
          actions={
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy || locked}
              onPress={() => {
                setFields((current) => ({ ...current, [key]: detail.defaults[key] }))
                setSelected((current) => (current.includes(key) ? current : [...current, key]))
                setPreview(null)
              }}
            >
              Ürün kartından al
            </Button>
          }
        >
          <div className="margin-rule-form">
            <Checkbox
              className="app-checkbox"
              isSelected={selected.includes(key)}
              isDisabled={busy || locked}
              onChange={(enabled) => {
                setSelected((current) =>
                  enabled ? [...current, key] : current.filter((field) => field !== key),
                )
                setPreview(null)
              }}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>{labels[key]} alanını güncelle</Label>
              </Checkbox.Content>
            </Checkbox>
            {key === 'title' ? (
              <Field
                label="Pazaryeri başlığı"
                value={fields.title}
                onChange={(value) => {
                  setFields((current) => ({ ...current, title: value }))
                  setPreview(null)
                }}
                isDisabled={busy || locked || !selected.includes(key)}
              />
            ) : (
              <div className="native-textarea-field">
                <label className="label" htmlFor={`content-${key}`}>
                  {key === 'images'
                    ? 'Görsel adresleri (her satıra bir HTTPS adresi)'
                    : 'Pazaryeri açıklaması'}
                </label>
                <textarea
                  className="textarea textarea--secondary"
                  id={`content-${key}`}
                  rows={key === 'images' ? 5 : 9}
                  value={key === 'images' ? fields.images.join('\n') : fields.description}
                  disabled={busy || locked || !selected.includes(key)}
                  onChange={(event) => {
                    setFields((current) => ({
                      ...current,
                      [key]:
                        key === 'images'
                          ? event.target.value.split('\n').map((url) => url.trim())
                          : event.target.value,
                    }))
                    setPreview(null)
                  }}
                />
              </div>
            )}
            {key === 'images' && (
              <p className="description field-description">
                En fazla {detail.definition.maxImages} görsel.
                {detail.definition.imageSlots
                  ? ' Girilen görseller ilgili sıra numaralarını günceller.'
                  : ''}
              </p>
            )}
          </div>
        </Panel>
      ))}
      <div className="page-actions">
        <Button
          variant="primary"
          isDisabled={busy || locked || !selected.length}
          onPress={() => void prepare()}
        >
          İçeriği önizle
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <Dialog
          open
          wide
          title="İçerik güncelleme önizlemesi"
          description={`${preview.members.join(', ')}`}
          onClose={() => {
            if (!busy) setPreview(null)
          }}
          footer={
            <>
              <Button variant="secondary" isDisabled={busy} onPress={() => setPreview(null)}>
                Düzenlemeye dön
              </Button>
              <Button variant="primary" isDisabled={busy} onPress={() => void submit()}>
                Bu içeriği pazaryerine gönder
              </Button>
            </>
          }
        >
          <div className="margin-rule-form">
            {Object.entries(preview.changes).map(([key, value]) => (
              <div key={key}>
                <strong>{labels[key as keyof ListingContentFields]}</strong>
                <p className="description field-description content-preview-text">
                  {Array.isArray(value) ? value.join('\n') : value}
                </p>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}
