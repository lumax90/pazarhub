import { useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { Download, Paperclip, Trash2 } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { Order } from '../../domain/types'
import { apiRequest } from '../../lib/api'
import { dateLabel } from '../../lib/format'
import { Dialog, Panel } from '../ui/shared'

export function OrderAttachments({ order }: { order: Order }) {
  const { mode, can, refresh } = useApp(),
    input = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState<string | null>(null)
  const upload = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      await apiRequest(`/api/orders/${order.id}/attachments`, { method: 'POST', body })
      await refresh()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <Panel
      title="Ekler"
      className="order-card"
      actions={
        <Button
          variant="secondary"
          size="sm"
          isDisabled={mode !== 'live' || !can('orders.write') || busy}
          onPress={() => input.current?.click()}
        >
          <Paperclip size={14} />
          Dosya ekle
        </Button>
      }
    >
      <div className="order-card-body margin-rule-form">
        <input
          className="input input--secondary"
          ref={input}
          type="file"
          aria-label="Sipariş eki"
          hidden
          accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        {(order.attachments ?? []).map((file) => (
          <div key={file.id} className="order-attachment">
            <div>
              <a href={`/api/files/${file.id}`} className="provider-doc-link" download>
                <Download size={13} />
                {file.name}
              </a>
              <small>
                {file.author} · {dateLabel(file.createdAt)} · {Math.ceil(file.size / 1024)} KB
              </small>
            </div>
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              aria-label={`${file.name} ekini kaldır`}
              isDisabled={!can('orders.write') || busy}
              onPress={() => setDeleting(file.id)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {!order.attachments?.length && (
          <p className="description field-description">
            Bu siparişe ait dosya yok. PDF veya görsel · dosya başına 5 MB.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {deleting && (
          <Dialog
            open
            title="Sipariş ekini kaldır"
            onClose={() => {
              if (!busy) setDeleting(null)
            }}
            footer={
              <>
                <Button variant="secondary" isDisabled={busy} onPress={() => setDeleting(null)}>
                  Vazgeç
                </Button>
                <Button
                  variant="danger"
                  isDisabled={busy}
                  onPress={async () => {
                    setBusy(true)
                    try {
                      await apiRequest(`/api/orders/${order.id}/attachments/${deleting}`, {
                        method: 'DELETE',
                      })
                      await refresh()
                      setDeleting(null)
                    } catch (error) {
                      setError((error as Error).message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Kaldır
                </Button>
              </>
            }
          >
            <p className="description field-description">
              {order.attachments?.find((file) => file.id === deleting)?.name}
            </p>
          </Dialog>
        )}
      </div>
    </Panel>
  )
}
