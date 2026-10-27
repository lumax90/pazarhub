import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Button, Dropdown, Header, Label, Tooltip } from '@heroui/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { Focusable } from 'react-aria-components'
import { NavLink, useLocation } from 'react-router'
import { motionTransitions } from '../../lib/motion'
import { currentItemIndex, isCurrentPath, type NavigationItem } from './navigation'

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
  const current = item.children?.find((child) => isCurrentPath(pathname, child.to))
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

/** Expanded sidebar group: its pages branch off the group icon. */
export function SidebarGroup({
  item,
  open,
  onToggle,
  onNavigate,
}: {
  item: NavigationItem
  open: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const { pathname } = useLocation()
  const reduced = useReducedMotion()
  const toggle = useRef<HTMLButtonElement>(null)
  const children = item.children ?? []
  // While open, the drawn branch marks the current page; a folded group carries it instead.
  const marked = pathname.startsWith(item.to) && !open
  return (
    <div className="nav-group">
      <button
        ref={toggle}
        type="button"
        className={`button button--md nav-item nav-group-toggle ${marked ? 'button--secondary is-current-group' : 'button--ghost'}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <item.icon size={18} strokeWidth={1.7} aria-hidden="true" />
        <span>{item.label}</span>
        <ChevronDown size={13} className={open ? '' : 'is-rotated'} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="group-links"
            className="nav-group-children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : motionTransitions.standard}
          >
            <div className="nav-branches">
              <BranchLines
                rows=":scope > .nav-item"
                current={currentItemIndex(children, pathname)}
                origin={toggle}
              />
              {children.map((child) => (
                <SidebarLink
                  key={child.to}
                  item={child}
                  small
                  compact={false}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Space between a branch's end and the row icon, and the largest bend. */
const BRANCH_GAP = 8
const BRANCH_RADIUS = 8

type BranchRow = { y: number; end: number }
type BranchGeometry = { trunk: number; rows: BranchRow[] }

/** Position inside a positioned ancestor, summed over offset parents so press scales don't skew it. */
function offsetIn(element: HTMLElement, ancestor: Element) {
  let x = 0
  let y = 0
  for (
    let node: HTMLElement | null = element;
    node && node !== ancestor;
    node = node.offsetParent as HTMLElement | null
  ) {
    x += node.offsetLeft
    y += node.offsetTop
  }
  return { x, y }
}

/** Left edge or centre of a row's icon inside `ancestor`. */
function iconX(row: HTMLElement, ancestor: Element, edge: 'start' | 'center') {
  const left = offsetIn(row, ancestor).x
  const outer = row.getBoundingClientRect()
  const icon = row.querySelector('svg')?.getBoundingClientRect()
  if (!icon || !outer.width) return left
  const x = edge === 'center' ? icon.left + icon.width / 2 : icon.left
  return left + ((x - outer.left) / outer.width) * row.offsetWidth
}

/**
 * A trunk under `origin`'s icon with one rounded branch per row. The branch to
 * the current row is drawn again in the accent colour and travels on change.
 * Render it as the first child of a positioned list.
 */
function BranchLines({
  rows: selector,
  current,
  origin,
}: {
  rows: string
  current: number
  origin: RefObject<HTMLElement | null>
}) {
  const reduced = useReducedMotion()
  const lines = useRef<SVGSVGElement>(null)
  const [geometry, setGeometry] = useState<BranchGeometry>()

  useLayoutEffect(() => {
    const list = lines.current?.parentElement
    const anchor = origin.current
    const common = anchor?.offsetParent
    if (!list || !anchor || !common) return
    const measure = () => {
      const next: BranchGeometry = {
        trunk: iconX(anchor, common, 'center') - offsetIn(list, common).x,
        rows: [...list.querySelectorAll<HTMLElement>(selector)].map((row) => ({
          y: offsetIn(row, list).y + row.offsetHeight / 2,
          end: iconX(row, list, 'start') - BRANCH_GAP,
        })),
      }
      // Folds resize the list every frame; only redraw when a row actually moved.
      setGeometry((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [selector, origin])

  const trunk = geometry?.trunk ?? 0
  const rows = geometry?.rows ?? []
  const bend = (row: BranchRow) => {
    const r = Math.max(0, Math.min(BRANCH_RADIUS, row.end - trunk - 2))
    return `V ${row.y - r} A ${r} ${r} 0 0 0 ${trunk + r} ${row.y} H ${row.end}`
  }
  const base = rows.length
    ? `M ${trunk} 0 ${bend(rows.at(-1)!)} ` +
      rows
        .slice(0, -1)
        .map((row) => `M ${trunk} ${row.y - BRANCH_RADIUS} ${bend(row)}`)
        .join(' ')
    : ''

  return (
    <motion.svg
      ref={lines}
      className="nav-branches__lines"
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : { ...motionTransitions.reveal, delay: 0.1 }}
    >
      {/* One path, so overlapping joints never darken. */}
      <path className="nav-branches__base" d={base} />
      {rows.map((row, index) => (
        <path
          key={index}
          className="nav-branches__reach"
          d={`M ${trunk} 0 ${bend(row)}`}
          pathLength={1}
          strokeDasharray="1 2"
          // Parked mid-gap: no dash edge touches the path, so round caps leave no dot.
          style={{ strokeDashoffset: index === current ? 0 : 1.5 }}
        />
      ))}
    </motion.svg>
  )
}
