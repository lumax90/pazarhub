import { useState } from 'react'
import { Button, Checkbox, Label } from '@heroui/react'
import { Check, Trash2, X } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { invoiceCategoryUsage } from '../../domain/invoice-categories'
import { Dialog, Field } from '../ui/shared'
import type { InvoiceCategory } from '../../domain/types'

export function InvoiceCategoryManager({ onClose }: { onClose: () => void }) {
  const { state, run, can } = useApp(),
    [name, setName] = useState(''),
    [addId, setAddId] = useState(() => crypto.randomUUID()),
    [editing, setEditing] = useState<{ id: string; name: string; version: number } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const save = async (category: InvoiceCategory, mode: 'add' | 'rename' | 'toggle' = 'toggle') => {
    if (busy) return
    setBusy(true)
    setError('')
    const result = await run({
      type: 'invoice.category.save',
      id: category.id,
      name: category.name,
      active: category.active,
      expectedVersion: category.version,
    })
    setBusy(false)
    if (result.ok) {
      if (mode === 'add') {
        setName('')
        setAddId(crypto.randomUUID())
      }
      if (mode === 'rename') setEditing(null)
    } else setError(result.message)
  }
  return (
    <Dialog
      open
      title="Fatura kategorileri"
      description="Adına tıklayarak düzenleyin. Faturası bulunan kategori silinmez; pasife alınabilir."
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <Button variant="secondary" isDisabled={busy} onPress={onClose}>
          Tamam
        </Button>
      }
    >
      <div className="margin-rule-form">
        <form
          className="invoice-category-add"
          onSubmit={(event) => {
            event.preventDefault()
            void save({ id: addId, name, active: true, version: 0 }, 'add')
          }}
        >
          <Field
            label="Yeni kategori adı"
            value={name}
            onChange={setName}
            maxLength={160}
            isDisabled={busy || !can('finance.write')}
          />
          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || !can('finance.write') || !name.trim()}
          >
            Ekle
          </Button>
        </form>
        {(state.invoiceCategories ?? []).map((category) => (
          <div key={category.id} className="invoice-category-row">
            {editing?.id === category.id ? (
              <form
                className="invoice-category-rename"
                onSubmit={(event) => {
                  event.preventDefault()
                  void save({ ...category, name: editing.name, version: editing.version }, 'rename')
                }}
              >
                <Field
                  label="Kategori adı düzenle"
                  value={editing.name}
                  onChange={(name) =>
                    setEditing((current) => (current ? { ...current, name } : null))
                  }
                  isDisabled={busy}
                  maxLength={160}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label="Kategori adını kaydet"
                  isDisabled={busy || !editing.name.trim()}
                >
                  <Check size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label="Kategori düzenlemesini iptal et"
                  isDisabled={busy}
                  onPress={() => setEditing(null)}
                >
                  <X size={15} />
                </Button>
              </form>
            ) : (
              <div className="invoice-category-copy">
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={busy || !can('finance.write')}
                  onPress={() =>
                    setEditing({ id: category.id, name: category.name, version: category.version })
                  }
                >
                  {category.name}
                </Button>
                <small>{invoiceCategoryUsage(state, category.id)} faturada kullanılıyor</small>
              </div>
            )}
            <Checkbox
              className="app-checkbox"
              isSelected={category.active}
              isDisabled={busy || !can('finance.write')}
              onChange={(active) => void save({ ...category, active })}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>{category.name} etkin</Label>
              </Checkbox.Content>
            </Checkbox>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label={`${category.name} kategorisini sil`}
              isDisabled={
                busy || !can('finance.write') || invoiceCategoryUsage(state, category.id) > 0
              }
              onPress={async () => {
                setBusy(true)
                setError('')
                const result = await run({
                  type: 'invoice.category.delete',
                  id: category.id,
                  expectedVersion: category.version,
                  expectedUsage: invoiceCategoryUsage(state, category.id),
                })
                setBusy(false)
                if (!result.ok) setError(result.message)
              }}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
