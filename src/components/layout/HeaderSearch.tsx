import { useContext, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { CloseButton, ComboBox, Description, Input, Label, ListBox } from '@heroui/react'
import { ComboBoxStateContext } from 'react-aria-components'
import { ArrowRight, Package, Search, ShoppingBag } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { matches } from '../../lib/format'
import { EmptyState } from '../ui/shared'
import { allLinks } from './navigation'

export function HeaderSearch({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { state } = useApp()
  const reduced = useReducedMotion()
  const [query, setQuery] = useState('')
  const items = [
    ...allLinks
      .filter((item) => matches(item.label, query))
      .map((item) => ({ ...item, detail: 'Sayfa' })),
    ...state.products
      .filter((product) =>
        matches(
          `${product.name} ${product.variants.map((variant) => `${variant.sku} ${variant.barcode}`).join(' ')}`,
          query,
        ),
      )
      .slice(0, 5)
      .map((product) => ({
        to: `/products/${product.id}`,
        label: product.name,
        detail: 'Ürün',
        icon: Package,
      })),
    ...state.orders
      .filter((order) => matches(order.number, query))
      .slice(0, 3)
      .map((order) => ({
        to: `/orders/${order.id}`,
        label: order.number,
        detail: 'Sipariş',
        icon: ShoppingBag,
      })),
  ]
    .slice(0, 10)
    .map((item) => ({ ...item, id: `${item.detail}-${item.to}` }))

  return (
    <ComboBox
      aria-label="Genel arama"
      className="global-search"
      variant="secondary"
      fullWidth
      allowsCustomValue
      allowsEmptyCollection
      menuTrigger="focus"
      selectedKey={null}
      inputValue={query}
      defaultFilter={() => true}
      onInputChange={setQuery}
      onSelectionChange={(key) => {
        const item = items.find((item) => item.id === key)
        if (!item) return
        setQuery('')
        onNavigate(item.to)
      }}
    >
      <QuickSearchField />
      <ComboBox.Popover
        placement="bottom start"
        offset={6}
        shouldSkipAnimation={!!reduced}
        className="command-popover"
      >
        <ListBox
          aria-label="Arama sonuçları"
          className="command-results"
          renderEmptyState={() => (
            <EmptyState
              title="Sonuç bulunamadı"
              description="Farklı bir kelimeyle aramayı deneyin."
            />
          )}
        >
          {items.map((item) => (
            <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
              <span className="command-result-icon" aria-hidden="true">
                <item.icon size={18} />
              </span>
              <span className="command-result-copy">
                <Label>{item.label}</Label>
                <Description>{item.detail}</Description>
              </span>
              <ArrowRight size={16} className="text-muted" aria-hidden="true" />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}

function QuickSearchField() {
  const state = useContext(ComboBoxStateContext)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!state) return
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (event.repeat) return
        inputRef.current?.focus()
        inputRef.current?.select()
        state.open()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [state])

  // HeroUI first visits children in a hidden collection pass without ComboBox state.
  if (!state) return null

  return (
    <div className="combo-box__input-group" data-slot="combo-box-input-group">
      <Search size={16} className="quick-search-icon text-muted" aria-hidden="true" />
      <Input
        ref={inputRef}
        // Same pill as the workspace switch and icon buttons beside it in the header card.
        className="rounded-3xl"
        placeholder="Ara…"
        autoComplete="off"
        aria-keyshortcuts="Control+k Meta+k"
        onKeyDownCapture={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          state.close()
        }}
      />
      {state.inputValue ? (
        <CloseButton
          slot={null}
          preventFocusOnPress
          aria-label="Aramayı temizle"
          className="quick-search-clear"
          onPress={() => {
            state.setInputValue('')
            inputRef.current?.focus()
            state.open()
          }}
        />
      ) : (
        <kbd className="quick-search-shortcut" aria-hidden="true">
          Ctrl K
        </kbd>
      )}
    </div>
  )
}
