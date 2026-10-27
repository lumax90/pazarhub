import { useState } from 'react'
import { Button } from '@heroui/react'
import { Plus } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import type { DefinitionKind } from '../../domain/types'
import {
  categoryPath,
  categoryTree,
  definitionActive,
  definitionKey,
  definitionSingular,
} from '../../domain/definitions'
import { SearchSelect } from '../ui/SearchSelect'
import { DefinitionEditor } from './DefinitionEditor'

export function DefinitionField({
  kind,
  value,
  definitionId,
  onChange,
  label,
  disabled,
}: {
  kind: 'category' | 'brand' | 'supplier'
  value: string
  definitionId?: string
  onChange: (value: string, definitionId?: string) => void
  label: string
  disabled?: boolean
}) {
  const { state, can, getState } = useApp(),
    [open, setOpen] = useState(false)
  const all = state.definitions ?? []
  const definitions =
    kind === 'category'
      ? categoryTree(all)
      : all
          .filter((item) => item.kind === kind)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'))
  const name = (definition: (typeof definitions)[number]) =>
    kind === 'category' ? categoryPath(all, definition) : definition.name
  const selected = definitions.find((item) =>
    definitionId ? item.id === definitionId : definitionKey(name(item)) === definitionKey(value),
  )
  const options = definitions
    .filter((item) => definitionActive(all, item) || item.id === selected?.id)
    .map((item) => ({
      id: item.id,
      label: name(item),
      description: definitionActive(all, item) ? undefined : 'Pasif · mevcut seçim',
    }))
  if (!selected && value)
    options.push({ id: 'current-value', label: value, description: undefined })
  return (
    <div className="definition-field">
      <SearchSelect
        label={label}
        value={selected?.id ?? (value ? 'current-value' : '')}
        onChange={(id) =>
          onChange(
            options.find((item) => item.id === id)?.label ?? '',
            id === 'current-value' ? definitionId : id || undefined,
          )
        }
        options={options}
        disabled={disabled}
      />
      <Button
        variant="secondary"
        size="sm"
        isIconOnly
        aria-label={`Yeni ${definitionSingular[kind]} ekle`}
        isDisabled={disabled || !can('catalog.write')}
        onPress={() => setOpen(true)}
      >
        <Plus size={15} />
      </Button>
      {open && (
        <DefinitionEditor
          kind={kind as DefinitionKind}
          onClose={() => setOpen(false)}
          onSaved={(definition) =>
            onChange(
              kind === 'category'
                ? categoryPath(getState().definitions ?? [], definition)
                : definition.name,
              definition.id,
            )
          }
        />
      )}
    </div>
  )
}
