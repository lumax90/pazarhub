import { Button, Dropdown, Header, Label, Tooltip } from '@heroui/react'
import { Focusable } from 'react-aria-components'
import { NavLink, useLocation } from 'react-router'
import type { NavigationItem } from './navigation'

export function SidebarLink({
  item,
  compact,
  onNavigate,
  small = false,
  count,
  notice,
}: {
  item: NavigationItem
  compact: boolean
  onNavigate: () => void
  small?: boolean
  count?: number
  notice?: string
}) {
  const hint = notice
    ? `${item.label} · ${notice}`
    : count
      ? `${item.label} · ${count} gönderim bekliyor`
      : item.label
  return (
    <Tooltip isDisabled={!compact} delay={250} closeDelay={0}>
      <Focusable>
        <NavLink
          to={item.to}
          end={item.to === '/retail'}
          aria-label={compact ? item.label : undefined}
          className={({ isActive }) =>
            `button ${small ? 'button--sm nav-child' : 'button--md'} ${compact ? 'button--icon-only' : ''} nav-item ${isActive ? 'button--secondary is-active' : 'button--ghost'}`
          }
          onClick={onNavigate}
        >
          <item.icon size={small ? 15 : 18} strokeWidth={1.7} aria-hidden="true" />
          {!compact && <span>{item.label}</span>}
          {!compact && !!count && <span className="nav-count">{count}</span>}
          {!compact && notice && <span className="nav-alert-dot" aria-label={notice} />}
          {compact && (!!count || notice) && (
            <span className="nav-rail-indicator" aria-hidden="true" />
          )}
        </NavLink>
      </Focusable>
      <Tooltip.Content placement="right" offset={20}>
        {hint}
      </Tooltip.Content>
    </Tooltip>
  )
}

/** The same section destinations remain reachable from an icon-only rail. */
export function SidebarGroupMenu({
  item,
  onNavigate,
}: {
  item: NavigationItem
  onNavigate: (to: string) => void
}) {
  const { pathname } = useLocation()
  const current = item.children?.find((child) => {
    const path = child.to.split('?')[0]
    return pathname === path || pathname.startsWith(`${path}/`)
  })
  return (
    <Dropdown>
      <Tooltip delay={250} closeDelay={0}>
        <Button
          isIconOnly
          variant={current ? 'secondary' : 'ghost'}
          className={`nav-item nav-group-toggle ${current ? 'is-current-group is-active' : ''}`}
          aria-label={item.label}
        >
          <item.icon size={18} strokeWidth={1.7} aria-hidden="true" />
        </Button>
        <Tooltip.Content placement="right" offset={20}>
          {item.label}
        </Tooltip.Content>
      </Tooltip>
      <Dropdown.Popover
        placement="right top"
        offset={24}
        className="app-dropdown sidebar-group-popover"
      >
        <Dropdown.Menu
          aria-label={`${item.label} alt menüsü`}
          selectionMode="single"
          selectedKeys={new Set(current ? [current.to] : [])}
          onAction={(key) => onNavigate(String(key))}
        >
          <Dropdown.Section>
            <Header>{item.label}</Header>
            {item.children?.map((child) => (
              <Dropdown.Item key={child.to} id={child.to} textValue={child.label}>
                <child.icon size={16} aria-hidden="true" />
                <Label>{child.label}</Label>
                <Dropdown.ItemIndicator />
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
