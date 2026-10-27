import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { apiRequest } from '../../lib/api'
import { Field, SelectButton } from '../ui/shared'
import type { Product } from '../../domain/types'

export function ProductImages({
  name,
  images,
  onChange,
  disabled,
  onBusyChange,
  metadata,
  onMetadataChange,
  colorOptions = [],
}: {
  name: string
  images: string[]
  onChange: (images: string[]) => void
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  metadata?: Product['imageMetadata']
  onMetadataChange?: (metadata: NonNullable<Product['imageMetadata']>) => void
  colorOptions?: { id: string; label: string; axisId: string; valueId: string }[]
}) {
  const { mode } = useApp()
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [uploading, setUploading] = useState(false)
  const locked = disabled || uploading
  const setMetadata = (image: string, value: NonNullable<Product['imageMetadata']>[string]) =>
    onMetadataChange?.({ ...metadata, [image]: value })
  const addUrl = () => {
    try {
      const value = url.trim(),
        parsed = new URL(value)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || value.length > 2048)
        throw new Error()
      if (images.includes(value)) {
        setError('Bu görsel zaten eklenmiş.')
        return
      }
      onChange([...images, value])
      setUrl('')
      setError('')
    } catch {
      setError('Geçerli bir HTTPS görsel adresi girin.')
    }
  }
  const upload = async (file: File) => {
    if (locked || images.length >= 12) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Görsel en fazla 5 MB olabilir.')
      return
    }
    setUploading(true)
    onBusyChange?.(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const saved = await apiRequest<{ url: string }>('/api/files/images', { method: 'POST', body })
      onChange([...images, saved.url])
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Görsel yüklenemedi.')
    } finally {
      setUploading(false)
      onBusyChange?.(false)
    }
  }
  const move = (from: number, to: number) => {
    const next = [...images]
    next.splice(to, 0, next.splice(from, 1)[0])
    onChange(next)
  }
  return (
    <div className="product-image-editor">
      {!images.length && (
        <div className="product-image-empty">
          <ImagePlus size={32} strokeWidth={1.4} />
          <strong>Ürününüze bir kapak ekleyin</strong>
          <p>İlk görsel kapaktır. En fazla 12 görsel ekleyebilirsiniz.</p>
        </div>
      )}
      <div className="product-image-cards">
        {images.map((image, index) => (
          <div className="product-image-card" key={`${image}-${index}`}>
            <div className="product-image-frame">
              <img
                src={image}
                alt={metadata?.[image]?.alt || `${name || 'Ürün'} · görsel ${index + 1}`}
                referrerPolicy="no-referrer"
                loading="lazy"
              />
              {index === 0 && (
                <Chip size="sm" variant="soft">
                  <Star size={12} />
                  Kapak
                </Chip>
              )}
            </div>
            <div className="product-image-actions">
              <Button
                variant="ghost"
                isIconOnly
                size="sm"
                isDisabled={locked || index === 0}
                aria-label={`Görsel ${index + 1} sola taşı`}
                onPress={() => move(index, index - 1)}
              >
                <ArrowLeft size={14} />
              </Button>
              <Button
                variant="ghost"
                isIconOnly
                size="sm"
                isDisabled={locked || index === images.length - 1}
                aria-label={`Görsel ${index + 1} sağa taşı`}
                onPress={() => move(index, index + 1)}
              >
                <ArrowRight size={14} />
              </Button>
              <Button
                variant="ghost"
                isIconOnly
                size="sm"
                isDisabled={locked}
                aria-label={`Görsel ${index + 1} kaldır`}
                onPress={() => {
                  onChange(images.filter((_, i) => i !== index))
                  onMetadataChange?.(
                    Object.fromEntries(
                      Object.entries(metadata ?? {}).filter(([url]) => url !== image),
                    ),
                  )
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            {onMetadataChange && (
              <div className="product-image-metadata">
                <Field
                  label={`Görsel ${index + 1} alternatif metni`}
                  value={metadata?.[image]?.alt ?? ''}
                  onChange={(alt) => setMetadata(image, { ...metadata?.[image], alt })}
                  maxLength={300}
                  isDisabled={locked}
                />
                {colorOptions.length > 0 && (
                  <SelectButton
                    label={`Görsel ${index + 1} rengi`}
                    value={
                      metadata?.[image]?.axisId
                        ? JSON.stringify([metadata[image].axisId, metadata[image].valueId])
                        : 'common'
                    }
                    onChange={(value) => {
                      const color = colorOptions.find((option) => option.id === value)
                      setMetadata(image, {
                        alt: metadata?.[image]?.alt,
                        ...(color ? { axisId: color.axisId, valueId: color.valueId } : {}),
                      })
                    }}
                    options={[{ id: 'common', label: 'Tüm renklerde ortak' }, ...colorOptions]}
                    isDisabled={locked}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {images.length < 12 && (
        <div className="product-image-add">
          <Field
            label="Görsel adresi (HTTPS)"
            type="url"
            value={url}
            onChange={setUrl}
            placeholder="https://…"
            maxLength={2048}
            isDisabled={locked}
          />
          <Button variant="secondary" isDisabled={locked || !url.trim()} onPress={addUrl}>
            Adresten ekle
          </Button>
          {mode === 'live' && (
            <label className={`label ${`file-upload-button ${locked ? 'is-disabled' : ''}`}`}>
              <ImagePlus size={16} />
              {uploading ? 'Yükleniyor…' : 'Dosyadan yükle'}
              <input
                className="input input--secondary"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={locked}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void upload(file)
                  event.target.value = ''
                }}
              />
            </label>
          )}
          <p className="description field-description">
            PNG, JPEG, WebP veya GIF · dosya başına en fazla 5 MB.
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
