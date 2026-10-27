import { useState } from 'react'
import { Button } from '@heroui/react'
import type { Invoice } from '../../domain/types'
import { useApp } from '../../app/AppProvider'
import { invoicePayment } from '../../domain/invoice-source'
import { Panel, SelectButton } from '../ui/shared'

export function InvoiceCategoryAssignment({ invoice }: { invoice: Invoice }) {
  const { state, run, can } = useApp(),
    [categoryId, setCategoryId] = useState(invoice.categoryId ?? ''),
    [baseVersion, setBaseVersion] = useState(invoice.version ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const locked =
      !can('finance.write') ||
      !!invoice.externalId ||
      invoicePayment(state, invoice).paid ||
      !!invoice.uncertainJobId ||
      ['issued', 'cancelled', 'queued', 'processing'].includes(invoice.status),
    stale = (invoice.version ?? 0) !== baseVersion
  return (
    <Panel className="order-form-card" title="Fatura kategorisi">
      <div className="invoice-category-add">
        <SelectButton
          label="Kayıtlı fatura kategorisi"
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { id: '', label: 'Kategori seçilmedi' },
            ...(state.invoiceCategories ?? [])
              .filter((category) => category.active || category.id === categoryId)
              .map((category) => ({
                id: category.id,
                label: `${category.name}${category.active ? '' : ' (pasif)'}`,
              })),
          ]}
          isDisabled={locked || busy || stale}
        />
        <Button
          variant="secondary"
          size="sm"
          isDisabled={locked || busy || stale || categoryId === (invoice.categoryId ?? '')}
          onPress={async () => {
            setBusy(true)
            setError('')
            const result = await run({
              type: 'invoice.category.set',
              id: invoice.id,
              categoryId: categoryId || null,
              expectedVersion: baseVersion,
            })
            setBusy(false)
            if (result.ok) setBaseVersion(result.entityVersion ?? baseVersion + 1)
            else setError(result.message)
          }}
        >
          Kategoriyi kaydet
        </Button>
      </div>
      {stale && !locked && (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            setCategoryId(invoice.categoryId ?? '')
            setBaseVersion(invoice.version ?? 0)
            setError('')
          }}
        >
          Güncel kategori kaydını yükle
        </Button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  )
}
