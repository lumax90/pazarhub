import { useState } from 'react'
import { ComboBox, Description, Input, Label, ListBox } from '@heroui/react'
import { matches } from '../../lib/format'
import { useFieldVariant } from './useFieldVariant'

export function SearchSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  options: { id: string; label: string; description?: string; search?: string }[]
  label: string
  placeholder?: string
  disabled?: boolean
}) {
  const variant = useFieldVariant()
  const [previousProp, setPreviousProp] = useState(value)
  const [selected, setSelected] = useState(value)
  const [input, setInput] = useState(options.find((option) => option.id === value)?.label ?? '')
  if (value !== previousProp) {
    setPreviousProp(value)
    setSelected(value)
    setInput(options.find((option) => option.id === value)?.label ?? '')
  }
  const current = options.find((option) => option.id === selected)
  const filtered = (
    input === current?.label
      ? options
      : options.filter((option) =>
          matches(`${option.label} ${option.description ?? ''} ${option.search ?? ''}`, input),
        )
  ).slice(0, 80)
  return (
    <ComboBox
      variant={variant}
      className="app-search-select"
      selectedKey={selected || null}
      inputValue={input}
      defaultFilter={() => true}
      menuTrigger="input"
      isDisabled={disabled}
      allowsEmptyCollection
      onInputChange={(text) => {
        setInput(text)
        if (selected && text !== current?.label) {
          setSelected('')
          setPreviousProp('')
          onChange('')
        }
      }}
      onSelectionChange={(key) => {
        if (key == null) return
        const id = String(key),
          option = options.find((option) => option.id === id)
        if (option) {
          setSelected(id)
          setInput(option.label)
          onChange(id)
        }
      }}
    >
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        <Input placeholder={placeholder ?? 'Yazarak arayın…'} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover className="app-dropdown search-select-popover">
        <ListBox
          aria-label={`${label} seçenekleri`}
          renderEmptyState={() => <div className="search-select-empty">Eşleşen kayıt yok.</div>}
        >
          {filtered.map((option) => (
            <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
              <div>
                <Label>{option.label}</Label>
                {option.description && <Description>{option.description}</Description>}
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
