import { useState } from 'react'
import { FolderTree, GripVertical } from 'lucide-react'
import type { CatalogDefinition } from '../../domain/types'
import { categoryPath, definitionOrderKey } from '../../domain/definitions'

export function CategoryNameCell({
  definition,
  all,
  disabled,
  onMove,
}: {
  definition: CatalogDefinition
  all: CatalogDefinition[]
  disabled: boolean
  onMove: (
    id: string,
    parentId: string | undefined,
    beforeId: string | undefined,
    expectedOrder: string,
  ) => void
}) {
  const [target, setTarget] = useState<'inside' | 'before' | null>(null)
  return (
    <div
      className={`definition-name category-drop-target ${target ? `is-drop-${target}` : ''}`}
      style={{
        paddingLeft: Math.min(96, (categoryPath(all, definition).split(' / ').length - 1) * 16),
      }}
      onDragOver={(event) => {
        if (disabled || !event.dataTransfer.types.includes('application/pazarhub-category')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setTarget(
          event.clientX - event.currentTarget.getBoundingClientRect().left > 80
            ? 'inside'
            : 'before',
        )
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setTarget(null)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setTarget(null)
        if (disabled) return
        try {
          const payload = JSON.parse(
            event.dataTransfer.getData('application/pazarhub-category'),
          ) as { id: string; expectedOrder: string }
          if (
            payload.id &&
            payload.id !== definition.id &&
            typeof payload.expectedOrder === 'string'
          )
            onMove(
              payload.id,
              target === 'inside' ? definition.id : definition.parentId,
              target === 'inside' ? undefined : definition.id,
              payload.expectedOrder,
            )
        } catch {
          /* Only catalog handles carry a move request. */
        }
      }}
    >
      <button
        type="button"
        className="button button--sm button--ghost category-drag-handle"
        aria-label={`${definition.name} taşı`}
        title="Sıralamak için sürükleyin; sağa bırakarak alt kategoriye taşıyın."
        draggable={!disabled}
        disabled={disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData(
            'application/pazarhub-category',
            JSON.stringify({
              id: definition.id,
              expectedOrder: definitionOrderKey(all, 'category'),
            }),
          )
          event.dataTransfer.effectAllowed = 'move'
        }}
      >
        <GripVertical size={15} />
      </button>
      <FolderTree size={17} />
      <span>
        <strong>{definition.name}</strong>
        <small>
          {target
            ? target === 'inside'
              ? 'Alt kategori olarak taşı'
              : 'Bu kategorinin önüne taşı'
            : categoryPath(all, definition)}
        </small>
      </span>
    </div>
  )
}
