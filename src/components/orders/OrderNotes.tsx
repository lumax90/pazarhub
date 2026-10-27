import { useId, useState } from 'react'
import { Button } from '@heroui/react'
import { Plus } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { dateLabel } from '../../lib/format'

export function OrderNotes({ orderId }: { orderId: string }) {
  const { state, run, can } = useApp(),
    fieldId = useId()
  const order = state.orders.find((order) => order.id === orderId)!
  const [text, setText] = useState(''),
    [noteId, setNoteId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const add = async () => {
    if (busy || !can('orders.write') || !text.trim()) return
    setBusy(true)
    setError('')
    const result = await run({ type: 'order.note.add', id: orderId, noteId, text })
    setBusy(false)
    if (result.ok) {
      setText('')
      setNoteId(crypto.randomUUID())
    } else setError(result.message)
  }
  return (
    <div className="order-notes-content">
      {order.note && (
        <div className="order-customer-note">
          <strong>Müşteri notu</strong>
          <p>{order.note}</p>
        </div>
      )}
      <div className="order-team-notes">
        {[...(order.notes ?? [])].reverse().map((note) => (
          <div key={note.id}>
            <p>{note.text}</p>
            <small>
              {note.author ? `${note.author} · ` : ''}
              {dateLabel(note.createdAt, true)}
            </small>
          </div>
        ))}
        {!order.notes?.length && <p className="empty-inline">Henüz sipariş notu yok.</p>}
      </div>
      {can('orders.write') && (
        <>
          <div className="native-textarea-field">
            <label className="label" htmlFor={fieldId}>
              Yeni not
            </label>
            <textarea
              className="textarea textarea--secondary"
              id={fieldId}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Not yazın…"
              rows={3}
              maxLength={5000}
              disabled={busy}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void add()}
            isDisabled={busy || !text.trim()}
          >
            <Plus size={14} />
            {busy ? 'Kaydediliyor…' : 'Not ekle'}
          </Button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
