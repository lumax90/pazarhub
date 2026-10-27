import { Suspense, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { SelectionIndicator } from 'react-aria-components'
import {
  Button,
  Card,
  Dropdown,
  Header,
  Label,
  Surface,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@heroui/react'
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  Menu,
  Moon,
  ScanLine,
  Settings2,
  Store,
  Sun,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
} from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { lowStockProducts } from '../../domain/selectors'
import { Dialog, IconButton } from '../ui/shared'
import { UserAvatar } from '../ui/UserAvatar'
import { NotificationsMenu } from './NotificationsMenu'
import { motionTransitions, useRevealMotion } from '../../lib/motion'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { SidebarGroup, SidebarGroupMenu, SidebarLink } from './SidebarNav'
import { retailSections, sections } from './navigation'
import { headerCrumbs } from './breadcrumbs'
import { HeaderBreadcrumbs } from './HeaderBreadcrumbs'
import { HeaderSearch } from './HeaderSearch'

const SIDEBAR_COMPACT_KEY = 'pazarhub.ui.sidebar.compact.v1'
function readSidebarCompact() {
  try {
    return localStorage.getItem(SIDEBAR_COMPACT_KEY) === 'true'
  } catch {
    return false
  }
}
function BrandMark() {
  return (
    <span className="brand-mark">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="m16 4 10 5.7v11.6L16 27 6 21.3V9.7Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="m6 9.7 10 5.8 10-5.8M16 15.5V27M11 6.9l10 5.8v6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export function AppShell() {
  const pageReveal = useRevealMotion()
  const reduced = useReducedMotion()
  const {
    state,
    run,
    resolvedTheme,
    mode,
    session,
    changeMode,
    logout,
    switchWorkspace,
    notify,
    profile,
  } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ 'MUHASEBE YÖNETİMİ': true })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCompact, setSidebarCompact] = useState(readSidebarCompact)
  const isMobile = useMediaQuery('(max-width: 880px)')
  const compactHeader = useMediaQuery('(max-width: 1250px)')
  const compact = sidebarCompact && !isMobile
  const [helpOpen, setHelpOpen] = useState(false)
  const retail = location.pathname.startsWith('/retail')
  const waiting = state.orders.filter(
    (order) => order.status === 'pending' || order.status === 'approved',
  ).length
  const rejected = state.listings.filter((listing) => listing.status === 'rejected').length
  const lowStock = lowStockProducts(state).length
  const crumbs = headerCrumbs(location.pathname, state)
  const pageTitle = crumbs.at(-1)!.label
  const dark = resolvedTheme === 'dark'
  const environment = mode === 'demo' ? 'Örnek çalışma alanı' : 'Sunucuya bağlı'
  const companyInitial =
    Array.from(state.preferences.businessName.trim())[0]?.toLocaleUpperCase('tr-TR') ?? '—'

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COMPACT_KEY, String(sidebarCompact))
    } catch {
      /* Session UI still works when storage is unavailable. */
    }
  }, [sidebarCompact])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    document.title = `${pageTitle} · Pazarhub`
  }, [pageTitle])

  const go = (to: string) => {
    navigate(to)
    setMobileOpen(false)
  }

  return (
    <div className="app-shell" data-sidebar={compact ? 'compact' : 'expanded'}>
      <a href="#main-content" className="skip-link">
        İçeriğe geç
      </a>
      {isMobile && mobileOpen && (
        <button
          className="sidebar-scrim bg-backdrop"
          aria-label="Menüyü kapat"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="primary-sidebar"
        className={`app-sidebar ${isMobile && mobileOpen ? 'is-open' : ''}`}
        aria-label="Ana gezinme"
      >
        <Card className="sidebar-card">
          <Link
            to="/dashboard"
            className="brand"
            onClick={() => setMobileOpen(false)}
            aria-label="Pazarhub ana sayfa"
          >
            <BrandMark />
            <span className="brand-wordmark">
              pazarhub<span className="brand-dot">.</span>
            </span>
          </Link>
          <nav className="sidebar-navigation">
            {(retail ? retailSections : sections).map((section) => (
              <div className="nav-section" key={section.label}>
                {!compact &&
                  (section.collapsible ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="nav-section-toggle"
                      aria-expanded={!collapsed[section.label]}
                      onPress={() =>
                        setCollapsed((value) => ({
                          ...value,
                          [section.label]: !value[section.label],
                        }))
                      }
                    >
                      <span className="header nav-section-heading">
                        <span>{section.label}</span>
                        <ChevronDown
                          size={12}
                          className={collapsed[section.label] ? 'is-rotated' : ''}
                          aria-hidden="true"
                        />
                      </span>
                    </Button>
                  ) : (
                    <Header className="nav-section-heading">{section.label}</Header>
                  ))}
                <AnimatePresence initial={false}>
                  {(compact || !collapsed[section.label]) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={reduced ? { duration: 0 } : motionTransitions.standard}
                      className="nav-section-items"
                    >
                      {section.items.map((item) =>
                        item.children ? (
                          compact ? (
                            <SidebarGroupMenu key={item.to} item={item} onNavigate={go} />
                          ) : (
                            <SidebarGroup
                              key={item.to}
                              item={item}
                              open={expanded[item.to] ?? location.pathname.startsWith(item.to)}
                              onToggle={() =>
                                setExpanded((current) => ({
                                  ...current,
                                  [item.to]: !(
                                    current[item.to] ?? location.pathname.startsWith(item.to)
                                  ),
                                }))
                              }
                              onNavigate={() => setMobileOpen(false)}
                            />
                          )
                        ) : (
                          <SidebarLink
                            key={item.to}
                            item={item}
                            compact={compact}
                            onNavigate={() => setMobileOpen(false)}
                            count={item.to === '/orders' ? waiting : undefined}
                            notice={
                              item.to === '/listings' && rejected > 0
                                ? `${rejected} ilan işlem bekliyor`
                                : undefined
                            }
                          />
                        ),
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Tooltip isDisabled={!compact} delay={250} closeDelay={0}>
              <Button
                variant="ghost"
                className="sidebar-help"
                aria-label="Yardım ve kısayollar"
                onPress={() => setHelpOpen(true)}
              >
                <CircleHelp size={17} aria-hidden="true" />
                {!compact && <span>Yardım ve kısayollar</span>}
              </Button>
              <Tooltip.Content placement="right" offset={20}>
                Yardım ve kısayollar
              </Tooltip.Content>
            </Tooltip>
            <SidebarLink
              item={{ to: '/settings', label: 'Ayarlar', icon: Settings2 }}
              compact={compact}
              onNavigate={() => setMobileOpen(false)}
            />
            {/* Workspace and connection status share the foot of the card, below the pages. */}
            <div className="sidebar-workspace">
              <Dropdown>
                <Tooltip isDisabled={!compact} delay={250} closeDelay={0}>
                  <Button
                    variant="ghost"
                    className="workspace-company"
                    aria-label={`${state.preferences.businessName} Çalışma alanı`}
                  >
                    <span className="company-avatar" aria-hidden="true">
                      {companyInitial}
                    </span>
                    <span className="company-copy">
                      <strong title={state.preferences.businessName}>
                        {state.preferences.businessName}
                      </strong>
                      <span className="company-status">
                        <span className="demo-led" />
                        <span>{environment}</span>
                      </span>
                    </span>
                    <ChevronsUpDown size={14} aria-hidden="true" />
                  </Button>
                  <Tooltip.Content placement="right" offset={20}>
                    {state.preferences.businessName} · {environment}
                  </Tooltip.Content>
                </Tooltip>
                <Dropdown.Popover placement="top start" className="app-dropdown">
                  <Dropdown.Menu aria-label="Çalışma alanı">
                    <Dropdown.Section>
                      <Header>Pazarhub v0.3</Header>
                      {(session?.workspaces ?? [])
                        .filter((workspace) => workspace.id !== session?.workspace?.id)
                        .map((workspace) => (
                          <Dropdown.Item
                            key={workspace.id}
                            id={workspace.id}
                            textValue={workspace.name}
                            onAction={() => void switchWorkspace(workspace.id)}
                          >
                            <Store size={16} />
                            <Label>{workspace.name}</Label>
                          </Dropdown.Item>
                        ))}
                      <Dropdown.Item
                        id="settings"
                        textValue="Çalışma alanı ayarları"
                        onAction={() => go('/settings')}
                      >
                        <Settings2 size={16} />
                        <Label>Çalışma alanı ayarları</Label>
                      </Dropdown.Item>
                      <Dropdown.Item
                        id="retail"
                        textValue="Perakendeye geç"
                        onAction={() => go('/retail')}
                      >
                        <ScanLine size={16} />
                        <Label>Perakendeye geç</Label>
                      </Dropdown.Item>
                    </Dropdown.Section>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </div>
        </Card>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-location">
            <Tooltip delay={350} closeDelay={0}>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="sidebar-toggle"
                aria-label={compact ? 'Menüyü genişlet' : 'Menüyü daralt'}
                aria-controls="primary-sidebar"
                aria-expanded={!compact}
                onPress={() => setSidebarCompact((value) => !value)}
              >
                {compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </Button>
              <Tooltip.Content>{compact ? 'Menüyü genişlet' : 'Menüyü daralt'}</Tooltip.Content>
            </Tooltip>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="mobile-menu-button"
              aria-label="Menüyü aç"
              onPress={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </Button>
            <HeaderBreadcrumbs items={crumbs} />
          </div>
          <Card className="topbar-right">
            <HeaderSearch key={location.pathname} onNavigate={go} />
            <Surface variant="secondary" className="workspace-switch-surface rounded-3xl">
              <ToggleButtonGroup
                className="workspace-switch"
                aria-label="Çalışma alanı türü"
                size="sm"
                selectionMode="single"
                isDetached
                disallowEmptySelection
                selectedKeys={new Set([retail ? 'retail' : 'ecommerce'])}
                onSelectionChange={(keys) => {
                  const next = [...keys][0]
                  if (next === (retail ? 'retail' : 'ecommerce')) return
                  if (next === 'retail') go('/retail')
                  else if (next === 'ecommerce') go('/dashboard')
                }}
              >
                {[
                  { id: 'ecommerce', label: 'E-Ticaret', icon: Store },
                  { id: 'retail', label: 'Perakende', icon: ScanLine },
                ].map((mode) => (
                  <Tooltip key={mode.id} isDisabled={!compactHeader} delay={250} closeDelay={0}>
                    <ToggleButton
                      id={mode.id}
                      aria-label={mode.label}
                      isIconOnly={compactHeader}
                      variant="ghost"
                      className="data-[selected=true]:bg-transparent"
                    >
                      {({ isHovered, isPressed }) => (
                        <>
                          {/* Move the native selected fill, not the label or hit target. */}
                          <SelectionIndicator
                            aria-hidden="true"
                            className="toggle-button toggle-button--ghost workspace-switch-pill"
                            data-selected="true"
                            data-hovered={isHovered || undefined}
                            data-pressed={isPressed || undefined}
                          />
                          <mode.icon size={15} />
                          {!compactHeader && <span>{mode.label}</span>}
                        </>
                      )}
                    </ToggleButton>
                    <Tooltip.Content>{mode.label}</Tooltip.Content>
                  </Tooltip>
                ))}
              </ToggleButtonGroup>
            </Surface>
            <div className="topbar-divider" />
            <IconButton
              label={dark ? 'Açık temaya geç' : 'Koyu temaya geç'}
              onPress={() =>
                run({
                  type: 'preferences.update',
                  preferences: { ...state.preferences, theme: dark ? 'light' : 'dark' },
                })
              }
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
            <NotificationsMenu
              waiting={waiting}
              rejected={rejected}
              lowStock={lowStock}
              shown={state.preferences.notifications}
              onNavigate={go}
            />
            <Dropdown>
              <Button
                isIconOnly={compactHeader}
                variant="ghost"
                className="profile-button"
                aria-label="Hesap menüsü"
              >
                {!compactHeader && (
                  <>
                    <span className="profile-name">{profile.name}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </>
                )}
                <UserAvatar name={profile.name} seed={profile.seed} />
              </Button>
              <Dropdown.Popover className="app-dropdown">
                <Dropdown.Menu aria-label="Hesap menüsü">
                  <Dropdown.Item id="profile" textValue="Profilim" onAction={() => go('/profile')}>
                    <UserRound size={16} />
                    <Label>Profilim</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="settings"
                    textValue="Çalışma alanı ayarları"
                    onAction={() => go('/settings')}
                  >
                    <Settings2 size={16} />
                    <Label>Çalışma alanı ayarları</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="help"
                    textValue="Kullanım kısayolları"
                    onAction={() => setHelpOpen(true)}
                  >
                    <CircleHelp size={16} />
                    <Label>Kullanım kısayolları</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="session"
                    textValue={mode === 'demo' ? 'Hesaba giriş yap' : 'Oturumu kapat'}
                    onAction={() => {
                      if (mode === 'demo') changeMode('live')
                      else void logout().catch((error) => notify(error.message, 'error'))
                    }}
                  >
                    <LogOut size={16} />
                    <Label>{mode === 'demo' ? 'Hesaba giriş yap' : 'Oturumu kapat'}</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </Card>
        </header>
        <main id="main-content" className="main-content">
          <motion.div key={location.pathname} className="page-frame" {...pageReveal}>
            <Suspense
              fallback={
                <div className="page-loading" role="status" aria-label="Sayfa yükleniyor">
                  <span />
                  <span />
                  <span />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </motion.div>
          <footer className="page-footer">
            <span>Her şey yerli yerinde.</span>
            <span>
              Pazarhub <span>·</span>{' '}
              {mode === 'demo' ? 'Örnek verilerle çalışıyorsunuz' : state.preferences.businessName}
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Çalışma alanınıza hoş geldiniz"
        description="Ürün, sipariş, stok ve tahsilat için ortak çalışma düzeni."
        footer={
          <Button variant="primary" onPress={() => setHelpOpen(false)}>
            <Check size={16} />
            Anladım
          </Button>
        }
      >
        <div className="help-content">
          <p>
            Sipariş onayladığınızda stok ve fatura taslağı birlikte güncellenir. Perakende satışında
            aynı stok kullanılır ve kasa kaydı oluşur.{' '}
            {mode === 'demo'
              ? 'Örnek kayıtlar bu tarayıcıda saklanır.'
              : 'Kayıtlar çalışma alanınızın sunucu veritabanına yazılır.'}
          </p>
          <div className="help-shortcut">
            <span>Genel aramayı aç</span>
            <kbd>Ctrl / ⌘ + K</kbd>
          </div>
          <div className="help-shortcut">
            <span>Pencereyi kapat</span>
            <kbd>Esc</kbd>
          </div>
          <p className="subtle">
            {mode === 'demo'
              ? 'Pazaryeri bağlantıları örnektir.'
              : 'Bağlantıları test ettikten sonra otomasyonu açın. Gönderim sonuçlarını İşlem Merkezi’nde izleyin.'}
          </p>
        </div>
      </Dialog>
    </div>
  )
}
