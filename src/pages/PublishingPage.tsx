import { useState } from 'react'
import { Button, Checkbox, Chip, Label } from '@heroui/react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Link2,
  Plus,
  RefreshCw,
  Send,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import type { Listing, Product } from '../domain/types'
import type { PublicIntegration } from '../domain/integrations'
import type {
  CategoryMapping,
  PublicationDefinition,
  PublishConfig,
  PublishPreview,
} from '../domain/publishing'
import { publicationLabels } from '../domain/publishing'
import { apiMutation, apiRequest } from '../lib/api'
import { useResource } from '../lib/useResource'
import { money } from '../lib/format'
import { AsyncState } from '../components/ui/AsyncState'
import { ProductArt } from '../components/ui/ProductArt'
import { CatalogPicker, CategoryAttributes } from '../components/integrations/CatalogFields'
import { DataTable } from '../components/ui/DataTable'
import { contentDefinitions } from '../domain/listing-content'
import { imagesForVariant } from '../domain/product-images'
import {
  Dialog,
  EmptyState,
  Field,
  FilterTabs,
  PageHeader,
  Panel,
  SectionTitle,
  SelectButton,
} from '../components/ui/shared'

interface DraftDetail {
  listing: Listing
  product: Product
  connection: Pick<PublicIntegration, 'id' | 'name' | 'provider' | 'enabled' | 'status'>
  definition: PublicationDefinition
  mapping: CategoryMapping | null
  defaults?: Partial<PublishConfig>
}
export function NewListingButton({ storeId, productId }: { storeId?: string; productId?: string }) {
  const { mode, can } = useApp(),
    [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="primary"
        isDisabled={mode !== 'live' || !can('catalog.write')}
        onPress={() => setOpen(true)}
      >
        <Plus size={16} />
        İlan hazırla
      </Button>
      {open && (
        <NewListingDialog
          initialStoreId={storeId}
          initialProductId={productId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
function NewListingDialog({
  initialStoreId,
  initialProductId,
  onClose,
}: {
  initialStoreId?: string
  initialProductId?: string
  onClose: () => void
}) {
  const { state, notify, refresh } = useApp(),
    navigate = useNavigate()
  const stores = useResource<{ connections: PublicIntegration[] }>(
    '/api/integration-options?kind=marketplace',
  )
  const [storeId, setStore] = useState(initialStoreId ?? ''),
    [productId, setProduct] = useState(initialProductId ?? ''),
    [variants, setVariants] = useState<string[]>(
      () => state.products.find((p) => p.id === initialProductId)?.variants.map((v) => v.id) ?? [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const product = state.products.find((p) => p.id === productId)
  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await apiRequest<{ ids: string[] }>('/api/listing-drafts', {
        method: 'POST',
        body: { storeId, productId, variantIds: variants },
      })
      await refresh()
      notify(`${response.ids.length} varyantın ilan hazırlığı açıldı.`)
      onClose()
      navigate(`/listings/prepare/${response.ids[0]}`)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Taslak oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title="Mağaza ilanı hazırlayın"
      description="Ürün ve varyantları seçin; kategori ve özellikleri bir sonraki adımda tamamlayın."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            isDisabled={busy || !storeId || !variants.length}
            onPress={() => void create()}
          >
            Hazırlamaya başla
            <ArrowRight size={15} />
          </Button>
        </>
      }
    >
      <AsyncState loading={stores.loading} error={stores.error} />
      <div className="form-section">
        <SelectButton
          label="Yayınlanacak mağaza"
          value={storeId}
          onChange={setStore}
          options={(stores.data?.connections ?? [])
            .filter((c) => c.capabilities.includes('listing.publish'))
            .map((c) => ({ id: c.id, label: c.name }))}
        />
        <SelectButton
          label="Yayınlanacak ürün"
          value={productId}
          onChange={(id) => {
            setProduct(id)
            setVariants(state.products.find((p) => p.id === id)?.variants.map((v) => v.id) ?? [])
          }}
          options={state.products.filter((p) => p.active).map((p) => ({ id: p.id, label: p.name }))}
        />
        <div className="draft-variant-choices">
          {product?.variants.map((v) => (
            <Checkbox
              key={v.id}
              className="app-checkbox"
              isSelected={variants.includes(v.id)}
              onChange={(selected) =>
                setVariants((ids) => (selected ? [...ids, v.id] : ids.filter((id) => id !== v.id)))
              }
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>
                  {v.name} · {v.sku}
                </Label>
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
export function PublishingPage() {
  const { id } = useParams(),
    { mode, can } = useApp()
  const resource = useResource<DraftDetail>(
    id && mode === 'live' && can('catalog.write') ? `/api/listing-drafts/${id}` : null,
    5000,
  )
  const [editorKey, setEditorKey] = useState(0)
  if (mode !== 'live' || !can('catalog.write'))
    return (
      <Panel>
        <EmptyState
          title="İlan hazırlığı için gerçek çalışma alanına giriş yapın"
          description="Yayınlama, mağaza API bağlantısına ve katalog düzenleme yetkisine bağlıdır."
        />
      </Panel>
    )
  return (
    <>
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {resource.data && (
        <PublicationEditor
          key={`${id}:${editorKey}`}
          detail={resource.data}
          reload={resource.reload}
          reset={async () => {
            await resource.reload()
            setEditorKey((v) => v + 1)
          }}
        />
      )}
    </>
  )
}
function PublicationEditor({
  detail,
  reload,
  reset,
}: {
  detail: DraftDetail
  reload: () => Promise<void>
  reset: () => Promise<void>
}) {
  const { state, notify, refresh } = useApp()
  const { listing, product, connection, definition, mapping } = detail
  const [draft, setDraft] = useState<PublishConfig>(() =>
      structuredClone(listing.publishConfig ?? { attributes: {} }),
    ),
    [version, setVersion] = useState(listing.version ?? 0),
    [tab, setTab] = useState('details'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<PublishPreview | null>(null)
  const [inherit, setInherit] = useState(!draft.title && !draft.description && !draft.images)
  const variant = product.variants.find((v) => v.id === listing.variantId)!
  const inheritedImages = imagesForVariant(product, definition.grouped ? undefined : variant)
  const [imageText, setImageText] = useState((draft.images ?? inheritedImages).join('\n'))
  const phase = listing.publication?.phase ?? (listing.externalId ? 'live' : 'draft')
  const editable = !listing.externalId && ['draft', 'rejected'].includes(phase)
  const siblings = state.listings.filter(
    (l) =>
      l.storeId === listing.storeId &&
      (definition.grouped
        ? l.id === listing.id ||
          (l.publishConfig?.productMainId || l.productId) === (draft.productMainId || product.id)
        : l.productId === listing.productId),
  )
  const set = <K extends keyof PublishConfig>(key: K, value: PublishConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setPreview(null)
  }
  const save = async () => {
    const result = await apiRequest<DraftDetail>(`/api/listing-drafts/${listing.id}`, {
      method: 'PATCH',
      body: { version, config: draft },
    })
    setVersion(result.listing.version ?? 0)
    setDraft(result.listing.publishConfig!)
    return result
  }
  const perform = async (action: 'save' | 'preview' | 'publish' | 'status' | 'reconcile') => {
    if (busy) return
    setBusy(action)
    setError('')
    try {
      if (action === 'save') {
        await save()
        notify('İlan taslağı kaydedildi.')
        await reload()
      }
      if (action === 'preview') {
        await save()
        const result = await apiRequest<PublishPreview>(
          `/api/listing-drafts/${listing.id}/preview`,
          { method: 'POST', body: {} },
        )
        setPreview(result)
        setTab('preview')
        await reload()
      }
      if (action === 'publish' && preview) {
        await apiMutation(`/api/listing-drafts/${listing.id}/publish`, { previewId: preview.id })
        notify('Yayın isteği sıraya alındı; platform onayı burada izlenecek.')
        setPreview(null)
        await refresh()
        await reload()
      }
      if (action === 'status' || action === 'reconcile') {
        await apiMutation(`/api/listing-drafts/${listing.id}/${action}`, {})
        notify('İlan durumu sorgulaması sıraya alındı.')
        await reload()
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusy('')
    }
  }
  const categoryId = draft.categoryId ?? detail.defaults?.categoryId ?? mapping?.categoryId,
    categoryName = draft.categoryName ?? detail.defaults?.categoryName ?? mapping?.categoryName
  return (
    <>
      <PageHeader
        eyebrow={connection.name}
        title={definition.mode === 'offer' ? 'Amazon teklif hazırlığı' : 'İlan hazırlama'}
        description={`${product.name} · ${variant.name} · ${variant.sku}`}
        actions={
          <>
            {listing.externalId && contentDefinitions[listing.channel] && (
              <Link className="button button--secondary" to={`/listings/content/${listing.id}`}>
                İçeriği güncelle
              </Link>
            )}
            <Link to="/listings" className="button button--secondary">
              <ArrowLeft size={15} />
              İlanlara dön
            </Link>
            {editable && (
              <>
                <Button
                  variant="secondary"
                  isDisabled={!!busy}
                  onPress={() => void perform('save')}
                >
                  <Check size={15} />
                  Taslağı kaydet
                </Button>
                <Button
                  variant="primary"
                  isDisabled={!!busy}
                  onPress={() => void perform('preview')}
                >
                  <Eye size={15} />
                  Önizleme oluştur
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="publication-layout">
        <div className="publication-main">
          <Panel className="publication-status">
            <div>
              <span className={`publication-dot publication-dot--${phase}`} />
              <div>
                <strong>{publicationLabels[phase]}</strong>
                <p>
                  {listing.publication?.message ??
                    'Kaydetme yerel taslağı oluşturur. Gönderim önizlemeden başlatılır.'}
                </p>
              </div>
            </div>
            <div className="row-actions">
              {(listing.publication?.reference || listing.publication?.reconciledByIdentity) && (
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={!!busy}
                  onPress={() => void perform('status')}
                >
                  <RefreshCw size={14} />
                  Durumu sorgula
                </Button>
              )}
              {phase === 'uncertain' && (
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={!!busy}
                  onPress={() => void perform('reconcile')}
                >
                  <Search size={14} />
                  Barkod/SKU ile doğrula
                </Button>
              )}
              <Link to="/jobs" className="provider-doc-link">
                İşlem merkezi
                <ArrowRight size={14} />
              </Link>
            </div>
          </Panel>
          {error && (
            <div className="resource-error" role="alert">
              <span>{error}</span>
              <Button variant="secondary" size="sm" onPress={() => void reset()}>
                Güncel kaydı aç
              </Button>
            </div>
          )}
          {!!listing.publication?.errors?.length && (
            <Panel title="Sağlayıcının bildirdiği alanlar">
              <ul className="publication-errors">
                {listing.publication.errors.map((e, i) => (
                  <li key={i}>
                    {e.field && <strong>{e.field}: </strong>}
                    {e.message}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel>
            <FilterTabs
              label="İlan hazırlama adımları"
              value={tab}
              onChange={setTab}
              items={[
                {
                  id: 'details',
                  label: definition.mode === 'offer' ? 'ASIN ve teklif' : 'Ürün ve teslimat',
                },
                { id: 'attributes', label: 'Kategori ve özellikler' },
                { id: 'preview', label: 'Gönderim önizlemesi' },
              ]}
            />
            {tab === 'details' && (
              <div className="publication-form">
                <SectionTitle
                  title={
                    definition.mode === 'offer' ? 'Türkiye kataloğundaki ürün' : 'İlan içeriği'
                  }
                >
                  {definition.mode === 'offer' ? (
                    <>
                      <CatalogPicker
                        storeId={connection.id}
                        resource="asin"
                        label="ASIN seçin"
                        disabled={!editable}
                        value={draft.asin ? [{ id: draft.asin, name: draft.asin }] : []}
                        onChange={(options) => set('asin', options[0]?.id)}
                      />
                      <SelectButton
                        label="Ürün kondisyonu"
                        isDisabled={!editable}
                        value={draft.condition ?? 'new_new'}
                        onChange={(value) => set('condition', value as PublishConfig['condition'])}
                        options={[
                          { id: 'new_new', label: 'Yeni' },
                          { id: 'used_like_new', label: 'Kullanılmış · yeni gibi' },
                          { id: 'used_very_good', label: 'Kullanılmış · çok iyi' },
                          { id: 'used_good', label: 'Kullanılmış · iyi' },
                          { id: 'used_acceptable', label: 'Kullanılmış · kabul edilebilir' },
                        ]}
                      />
                      <p className="description field-description">
                        Başlık ve görseller Amazon kataloğundan gelir. SKU, stok, fiyat ve kondisyon
                        sizin teklifinize aittir.
                      </p>
                    </>
                  ) : (
                    <>
                      <Checkbox
                        className="app-checkbox"
                        isDisabled={!editable}
                        isSelected={inherit}
                        onChange={(value) => {
                          setInherit(value)
                          setImageText(inheritedImages.join('\n'))
                          if (value)
                            setDraft((d) => ({
                              ...d,
                              title: undefined,
                              description: undefined,
                              images: undefined,
                            }))
                          else
                            setDraft((d) => ({
                              ...d,
                              title: product.name,
                              description: product.description,
                              images: inheritedImages,
                            }))
                          setPreview(null)
                        }}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label>Ürün kartındaki başlık, açıklama ve görselleri kullan</Label>
                        </Checkbox.Content>
                      </Checkbox>
                      <Field
                        label="İlan başlığı"
                        value={inherit ? product.name : (draft.title ?? '')}
                        onChange={(value) => set('title', value)}
                        readOnly={inherit || !editable}
                      />
                      <div className="native-textarea-field">
                        <label className="label" htmlFor="publication-description">
                          Ürün açıklaması
                        </label>
                        <textarea
                          className="textarea textarea--secondary"
                          id="publication-description"
                          rows={6}
                          value={inherit ? product.description : (draft.description ?? '')}
                          readOnly={inherit || !editable}
                          onChange={(event) => set('description', event.target.value)}
                        />
                      </div>
                      <div className="publication-images">
                        {(inherit ? inheritedImages : (draft.images ?? [])).map((url, index) => (
                          <img
                            key={url + index}
                            src={url}
                            alt={`Ürün görseli ${index + 1}`}
                            referrerPolicy="no-referrer"
                          />
                        ))}
                      </div>
                      {!inherit && (
                        <div className="native-textarea-field">
                          <label className="label" htmlFor="publication-images">
                            Görseller · her satırda bir HTTPS adresi
                          </label>
                          <textarea
                            className="textarea textarea--secondary"
                            id="publication-images"
                            rows={3}
                            value={imageText}
                            readOnly={!editable}
                            onChange={(event) => {
                              setImageText(event.target.value)
                              set(
                                'images',
                                event.target.value
                                  .split('\n')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              )
                            }}
                          />
                        </div>
                      )}
                      <p className="description field-description">
                        En fazla {definition.maxImages} görsel · {definition.maxTitle} karakter
                        başlık.
                      </p>
                    </>
                  )}
                </SectionTitle>
                {definition.mode === 'product' && (
                  <SectionTitle title="Model ve teslimat">
                    {(product.origin || product.dimensions?.desi !== undefined) && (
                      <p className="field-source">
                        <Link2 size={13} />
                        Boş mağaza değerleri ürün kartındaki menşei ve desiden alınır.
                      </p>
                    )}
                    <div className="form-grid">
                      <Field
                        label="Ortak model kodu"
                        value={draft.productMainId ?? product.id}
                        onChange={(value) => set('productMainId', value)}
                        readOnly={!editable || definition.immutableMainId}
                        description="Aynı ürünün varyantlarında aynı kodu kullanın."
                      />
                      {definition.provider === 'toptantr' && (
                        <Field
                          label="Paket içindeki adet"
                          type="number"
                          min={1}
                          max={100000}
                          step={1}
                          value={String(draft.itemPerPackage ?? 1)}
                          onChange={(value) => set('itemPerPackage', Number(value))}
                          readOnly={!editable}
                          description="Sipariş miktarı paket sayısıdır. Adet/Paket/Koli ortak stokta yerel bileşen oranı aynı olmalı."
                        />
                      )}
                      {definition.grouped && (
                        <p className="description field-description span-2">
                          Aynı mağaza ve ortak model kodundaki hazırlıklar tek üst ürün olarak
                          birlikte gönderilir. Her varyantı doldurun; önizlemede grubun tamamını
                          kontrol edin.
                        </p>
                      )}
                      {definition.provider === 'pazarama' ? (
                        <Field
                          label="Pazarama desi"
                          type="number"
                          value={String(draft.dimensionalWeight ?? product.dimensions?.desi ?? '')}
                          onChange={(v) =>
                            set('dimensionalWeight', v === '' ? undefined : Number(v))
                          }
                          readOnly={!editable}
                          required
                        />
                      ) : definition.provider === 'trendyol' ? (
                        <>
                          <Field
                            label="Desi"
                            type="number"
                            value={String(
                              draft.dimensionalWeight ?? product.dimensions?.desi ?? '',
                            )}
                            onChange={(v) =>
                              set('dimensionalWeight', v === '' ? undefined : Number(v))
                            }
                            readOnly={!editable}
                          />
                          <Field
                            label="Menşei (örn. TR)"
                            value={draft.origin ?? product.origin ?? ''}
                            onChange={(v) => set('origin', v ? v.toUpperCase() : undefined)}
                            readOnly={!editable}
                          />
                          <Field
                            label="Sevkiyat adres ID (isteğe bağlı)"
                            value={draft.shipmentAddressId ?? ''}
                            onChange={(v) => set('shipmentAddressId', v || undefined)}
                            readOnly={!editable}
                          />
                          <Field
                            label="İade adres ID (isteğe bağlı)"
                            value={draft.returningAddressId ?? ''}
                            onChange={(v) => set('returningAddressId', v || undefined)}
                            readOnly={!editable}
                          />
                          <Field
                            label="Termin (gün, isteğe bağlı)"
                            type="number"
                            value={String(draft.deliveryDuration ?? '')}
                            onChange={(v) =>
                              set('deliveryDuration', v === '' ? undefined : Number(v))
                            }
                            readOnly={!editable}
                          />
                        </>
                      ) : definition.provider === 'n11' ? (
                        <>
                          <div className="select-field">
                            <label className="label">n11 teslimat şablonu</label>
                            <CatalogPicker
                              storeId={listing.storeId}
                              resource="shipmentTemplates"
                              label="n11 teslimat şablonu"
                              value={
                                draft.shipmentTemplate
                                  ? [{ id: draft.shipmentTemplate, name: draft.shipmentTemplate }]
                                  : []
                              }
                              onChange={(options) => set('shipmentTemplate', options[0]?.name)}
                              disabled={!editable}
                            />
                          </div>
                          <Field
                            label="Hazırlık süresi (gün)"
                            type="number"
                            value={String(draft.preparingDay ?? '')}
                            onChange={(v) => set('preparingDay', v === '' ? undefined : Number(v))}
                            readOnly={!editable}
                            required
                          />
                        </>
                      ) : (
                        <>
                          <div className="select-field">
                            <label className="label">Teslimat tipi</label>
                            <SelectButton
                              label="Çiçeksepeti teslimat tipi"
                              value={String(draft.deliveryType ?? 2)}
                              onChange={(v) => set('deliveryType', Number(v))}
                              isDisabled={!editable}
                              options={[
                                { id: '1', label: 'Servis aracı' },
                                { id: '2', label: 'Kargo' },
                                { id: '3', label: 'Kargo + servis aracı' },
                              ]}
                            />
                          </div>
                          <div className="select-field">
                            <label className="label">Teslimat aralığı</label>
                            <SelectButton
                              label="Çiçeksepeti teslimat aralığı"
                              value={String(draft.deliveryMessageType ?? 5)}
                              onChange={(v) => set('deliveryMessageType', Number(v))}
                              isDisabled={!editable}
                              options={[
                                { id: '1', label: 'Çiçek servis' },
                                { id: '4', label: 'Aynı gün kargo' },
                                { id: '18', label: '1–2 iş günü' },
                                { id: '5', label: '1–3 iş günü' },
                                { id: '6', label: '1–5 iş günü' },
                                { id: '7', label: '1–7 iş günü' },
                                { id: '13', label: '3–5 iş günü' },
                                { id: '19', label: '1–10 iş günü' },
                              ]}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </SectionTitle>
                )}
              </div>
            )}
            {tab === 'attributes' && (
              <div className="publication-form">
                {definition.mode === 'offer' ? (
                  <EmptyState
                    title="ASIN teklifinde kategori eşleme gerekmez"
                    description="Amazon mevcut katalog ürününün kategori ve içerik bilgilerini kullanır."
                  />
                ) : (
                  <>
                    <SectionTitle title="Pazaryeri kategorisi">
                      <CatalogPicker
                        storeId={connection.id}
                        resource="categories"
                        label="Son seviye kategori seçin"
                        value={
                          categoryId ? [{ id: categoryId, name: categoryName || categoryId }] : []
                        }
                        disabled={!editable}
                        onChange={(options) => {
                          setDraft((d) => ({
                            ...d,
                            categoryId: options[0]?.id,
                            categoryName: options[0]?.path || options[0]?.name,
                            attributes: {},
                          }))
                          setPreview(null)
                        }}
                      />
                      {!draft.categoryId && mapping && (
                        <p className="field-source">
                          <Link2 size={13} />
                          Yerel “{product.category}” kategorisinin mağaza eşlemesinden.
                        </p>
                      )}
                    </SectionTitle>
                    {['trendyol', 'pazarama', 'toptantr'].includes(definition.provider) && (
                      <SectionTitle title="Marka">
                        <CatalogPicker
                          storeId={connection.id}
                          resource="brands"
                          label={`${definition.name} markası seçin`}
                          value={
                            (draft.brandId ?? detail.defaults?.brandId)
                              ? [
                                  {
                                    id: (draft.brandId ?? detail.defaults?.brandId)!,
                                    name:
                                      draft.brandName ||
                                      detail.defaults?.brandName ||
                                      (draft.brandId ?? detail.defaults?.brandId)!,
                                  },
                                ]
                              : []
                          }
                          disabled={!editable}
                          onChange={(options) => {
                            set('brandId', options[0]?.id)
                            set('brandName', options[0]?.name)
                          }}
                        />
                      </SectionTitle>
                    )}
                    <SectionTitle
                      title="Kategori özellikleri"
                      description="Yıldızlı alanlar zorunludur. Varyant değerleri her ilan için ayrı seçilir."
                    >
                      <CategoryAttributes
                        key={`${connection.id}:${categoryId}:${product.version ?? 0}:${variant.id}`}
                        storeId={connection.id}
                        product={product}
                        variant={variant}
                        categoryId={categoryId}
                        values={draft.attributes}
                        inherited={{
                          ...(mapping && mapping.categoryId === categoryId
                            ? mapping.attributes
                            : {}),
                          ...(!draft.categoryId || draft.categoryId === detail.defaults?.categoryId
                            ? detail.defaults?.attributes
                            : {}),
                        }}
                        onChange={(values) => set('attributes', values)}
                        disabled={!editable || !!busy}
                      />
                    </SectionTitle>
                  </>
                )}
              </div>
            )}
            {tab === 'preview' && (
              <div className="publication-form">
                {preview ? (
                  <>
                    <div className="publication-preview-header">
                      <ShieldCheck size={22} />
                      <div>
                        <h2>Gönderilecek bilgiler hazır</h2>
                        <p>
                          Sunucu kategori, zorunlu özellikler, fiyat ve stok bilgisini doğruladı.
                        </p>
                      </div>
                    </div>
                    <dl className="detail-list">
                      <div>
                        <dt>Başlık</dt>
                        <dd>{preview.title}</dd>
                      </div>
                      <div>
                        <dt>SKU / barkod</dt>
                        <dd>
                          {preview.sku} · {preview.barcode || 'ASIN teklifi'}
                        </dd>
                      </div>
                      <div>
                        <dt>Fiyat / adet</dt>
                        <dd>
                          {money(preview.price)} · {preview.quantity} adet
                        </dd>
                      </div>
                      {preview.categoryName && (
                        <div>
                          <dt>Kategori</dt>
                          <dd>{preview.categoryName}</dd>
                        </div>
                      )}
                      {preview.attributes.map((a) => (
                        <div key={a.name}>
                          <dt>{a.name}</dt>
                          <dd>
                            {a.value}
                            <small className="cell-secondary">
                              {a.source === 'mapping'
                                ? 'Kategori varsayılanından'
                                : 'İlan üzerinden'}
                            </small>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {preview.members && (
                      <DataTable
                        label="Birlikte gönderilecek varyantlar"
                        items={preview.members.map((member) => ({
                          ...member,
                          id: member.listingId,
                        }))}
                        columns={[
                          {
                            id: 'sku',
                            label: 'Stok kodu',
                            rowHeader: true,
                            cell: (member) => member.sku,
                          },
                          { id: 'barcode', label: 'Barkod', cell: (member) => member.barcode },
                          {
                            id: 'price',
                            label: 'Satış fiyatı',
                            className: 'align-right',
                            cell: (member) => money(member.price),
                          },
                          {
                            id: 'quantity',
                            label: 'Stok',
                            className: 'align-right',
                            cell: (member) => member.quantity,
                          },
                        ]}
                      />
                    )}
                    {preview.warnings.map((warning) => (
                      <p className="inline-notice" key={warning}>
                        {warning}
                      </p>
                    ))}
                    <details className="publication-payload">
                      <summary>Sağlayıcıya gönderilecek veri</summary>
                      <pre>{JSON.stringify(preview.body, null, 2)}</pre>
                    </details>
                    <Button
                      variant="primary"
                      isDisabled={!!busy || !editable}
                      onPress={() => void perform('publish')}
                    >
                      <Send size={16} />
                      {busy === 'publish' ? 'Sıraya alınıyor…' : 'Bu önizlemeyi pazaryerine gönder'}
                    </Button>
                    <p className="description field-description">
                      Kaynak veriler değişirse bu önizleme gönderilmez; yenilemeniz istenir.
                    </p>
                  </>
                ) : (
                  <EmptyState
                    title="Önce gönderim önizlemesini oluşturun"
                    description="Taslak kaydedilir; sağlayıcının zorunlu alanları ve güncel stok/fiyat kontrol edilir."
                    action={
                      editable ? (
                        <Button
                          variant="primary"
                          isDisabled={!!busy}
                          onPress={() => void perform('preview')}
                        >
                          Önizleme oluştur
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </div>
            )}
          </Panel>
        </div>
        <aside className="publication-aside">
          <Panel>
            <div className="publication-product">
              <ProductArt product={product} variant={variant} />
              <h2>{product.name}</h2>
              <p>
                {variant.name} · {variant.sku}
              </p>
              <Chip variant="soft" size="sm">
                {definition.name}
              </Chip>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Yerel kategori</dt>
                <dd>{product.category}</dd>
              </div>
              <div>
                <dt>İlan durumu</dt>
                <dd>{publicationLabels[phase]}</dd>
              </div>
              <div>
                <dt>Mağaza</dt>
                <dd>{connection.name}</dd>
              </div>
            </dl>
            {!connection.enabled && (
              <p className="inline-notice">Gönderimden önce bağlantıyı etkinleştirin.</p>
            )}
            <Link to="/connections" className="provider-doc-link">
              Bağlantı ayarları
              <ArrowRight size={14} />
            </Link>
          </Panel>
          {siblings.length > 1 && (
            <Panel title={definition.grouped ? 'Üst ürün grubu' : 'Ürünün varyant ilanları'}>
              <div className="publication-siblings">
                {siblings.map((s) => (
                  <Link
                    key={s.id}
                    className={s.id === listing.id ? 'is-current' : ''}
                    to={`/listings/prepare/${s.id}`}
                  >
                    <span>
                      {definition.grouped
                        ? state.products
                            .flatMap((product) => product.variants)
                            .find((variant) => variant.id === s.variantId)?.sku
                        : product.variants.find((variant) => variant.id === s.variantId)?.name}
                    </span>
                    <small>{publicationLabels[s.publication?.phase ?? 'draft']}</small>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  )
}
