import { useState } from 'react'
import { Button } from '@heroui/react'
import { ExternalLink, Link2, Unlink } from 'lucide-react'
import type { Invoice } from '../../domain/types'
import { useApp } from '../../app/AppProvider'
import { invoiceManualSourceKey, manualInvoiceUrl } from '../../domain/invoice-document'
import { invoiceSource } from '../../domain/invoice-source'
import { dateLabel } from '../../lib/format'
import { Dialog, Field, Panel, SectionTitle } from '../ui/shared'

export function InvoiceManualDocument({
  invoice,
  embedded = false,
}: {
  invoice: Invoice
  embedded?: boolean
}) {
  const { state, run, can } = useApp(),
    [url, setUrl] = useState(''),
    [number, setNumber] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState<{
      kind: 'link' | 'unlink'
      version: number
      source: string
    } | null>(null)
  const source = invoiceSource(state, invoice),
    manual = invoice.manualDocument,
    blocked =
      !can('finance.write') ||
      !!invoice.connectionId ||
      !!invoice.externalId ||
      !!invoice.documentId ||
      !!invoice.uncertainJobId ||
      ['cancelled', 'queued', 'processing'].includes(invoice.status) ||
      (!manual && invoice.status === 'issued'),
    localOnly = invoice.localOnly || source?.invoicePreference === 'draft'
  const confirm = async () => {
    if (!confirmation || busy) return
    setBusy(true)
    setError('')
    const result = await run(
      confirmation.kind === 'link'
        ? {
            type: 'invoice.document.link',
            id: invoice.id,
            expectedVersion: confirmation.version,
            expectedSource: confirmation.source,
            url,
            number,
          }
        : {
            type: 'invoice.document.unlink',
            id: invoice.id,
            expectedVersion: confirmation.version,
          },
    )
    setBusy(false)
    if (result.ok) {
      setConfirmation(null)
      setUrl('')
      setNumber('')
    } else setError(result.message)
  }
  const content = (
    <div className="margin-rule-form">
      <p className="cell-secondary">
        Bu işlem fatura kesmez veya GİB doğrulaması yapmaz; başka yerde kesilmiş belgeyi bu kayda
        bağlar. Yeni stok çıkışı ya da tahsilat oluşturmaz.
      </p>
      {manual ? (
        <>
          <dl className="detail-list">
            <div>
              <dt>Belge numarası</dt>
              <dd>{manual.number || 'Belirtilmedi'}</dd>
            </div>
            <div>
              <dt>Elle bağlandı</dt>
              <dd>
                {dateLabel(manual.linkedAt, true)}
                {manual.linkedBy ? ` · ${manual.linkedBy}` : ''}
              </dd>
            </div>
          </dl>
          <div className="order-status-actions">
            <a
              className="button button--secondary"
              href={manual.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} />
              Dış faturayı aç
            </a>
            <Button
              variant="secondary"
              isDisabled={blocked || busy}
              onPress={() => {
                setError('')
                setConfirmation({ kind: 'unlink', version: invoice.version ?? 0, source: '' })
              }}
            >
              <Unlink size={15} />
              Belge bağlantısını kaldır
            </Button>
          </div>
          <p className="cell-secondary">
            Dış belge bağlı olduğu sürece kalem/müşteri düzenlemesi, silme ve Paraşüt’te yeni fatura
            oluşturma kapalıdır. Yerel iptal, dışarıdaki resmî belgeyi iptal etmez.
          </p>
        </>
      ) : (
        <>
          <Field
            label="Fatura linki"
            value={url}
            onChange={setUrl}
            placeholder="https://…/fatura.pdf"
            maxLength={2048}
            isDisabled={blocked || !!localOnly || busy}
          />
          <Field
            label="Fatura numarası (isteğe bağlı)"
            value={number}
            onChange={setNumber}
            maxLength={64}
            isDisabled={blocked || !!localOnly || busy}
          />
          {localOnly && (
            <p className="cell-secondary">
              Yalnız iç kayıt seçili. Dış belge bağlamak için önce faturanın resmileştirme tercihini
              değiştirin.
            </p>
          )}
          {invoice.connectionId && (
            <p className="cell-secondary">
              Belge sağlayıcı hesabına bağlıdır; ikinci fatura bağlanmadan önce mevcut sağlayıcı
              sonucu uzlaştırılmalıdır.
            </p>
          )}
          <Button
            variant="secondary"
            isDisabled={blocked || !!localOnly || busy || !manualInvoiceUrl(url)}
            onPress={() => {
              setError('')
              setConfirmation({
                kind: 'link',
                version: invoice.version ?? 0,
                source: invoiceManualSourceKey(state, invoice),
              })
            }}
          >
            <Link2 size={15} />
            Dış faturayı bağla
          </Button>
          <p className="cell-secondary">
            Link genel erişimli HTTPS adresi olmalıdır. Desteklenen etkin mağazada pazaryerine
            iletim ayrı kuyruk işi olarak izlenir.
          </p>
        </>
      )}
      {confirmation && (
        <Dialog
          open
          title={
            confirmation.kind === 'link'
              ? 'Dışarıda kesilmiş faturayı bağla'
              : 'Dış belge bağlantısını kaldır'
          }
          onClose={() => {
            if (!busy) setConfirmation(null)
          }}
          footer={
            <>
              <Button variant="secondary" isDisabled={busy} onPress={() => setConfirmation(null)}>
                Vazgeç
              </Button>
              <Button variant="primary" isDisabled={busy} onPress={() => void confirm()}>
                Onayla
              </Button>
            </>
          }
        >
          <p>
            {confirmation.kind === 'link'
              ? 'Bu faturanın başka yerde kesildiğini belirtiyorsunuz. Belge bağlantısı kaydedilir; kalem ve müşteri bilgileri kilitlenir, Paraşüt’te ikinci fatura oluşturulmaz. Etkin mağazanın desteklediği link iletimi kuyruğa alınır.'
              : 'Yalnız bu kayıtla dış belgenin ilişkisi kaldırılır. Dışarıda kesilen resmî belge iptal edilmez ve pazaryerinden belge silinmez. Pazaryerine iletilmiş veya sonucu belirsiz bağlantı önce doğrulanmalıdır.'}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  )
  return embedded ? (
    <SectionTitle title="Başka yerde kesilen fatura">{content}</SectionTitle>
  ) : (
    <Panel className="order-form-card" title="Resmileştirme · dış belge">
      {content}
    </Panel>
  )
}
