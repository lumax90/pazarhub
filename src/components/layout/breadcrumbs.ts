import type { AppState } from '../../domain/types'
import { allLinks, sections } from './navigation'

export interface HeaderCrumb {
  label: string
  href?: string
}
type Records = Pick<AppState, 'products' | 'orders' | 'invoices'>

function segment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Match route identities explicitly: `new` and `new/bundle` are not record IDs. */
export function headerCrumbs(pathname: string, records: Records): HeaderCrumb[] {
  const path = pathname.replace(/\/+$/, '') || '/dashboard'
  const retail = path === '/retail' || path.startsWith('/retail/')
  const home = {
    label: retail ? 'Perakende' : 'Dashboard',
    href: retail ? '/retail' : '/dashboard',
  }
  if (path === home.href) return [{ label: home.label }]
  const trail = (...items: HeaderCrumb[]) => [home, ...items]
  if (path === '/products/new')
    return trail({ label: 'Ürünler', href: '/products' }, { label: 'Yeni ürün' })
  if (path === '/products/new/bundle')
    return trail({ label: 'Ürünler', href: '/products' }, { label: 'Paket oluştur' })
  if (path === '/orders/new')
    return trail({ label: 'Siparişler', href: '/orders' }, { label: 'Sipariş oluştur' })
  if (path === '/finance/invoices/new')
    return trail({ label: 'Faturalar', href: '/finance/invoices' }, { label: 'Fatura oluştur' })
  const product = path.match(/^\/products\/([^/]+)$/)
  if (product)
    return trail(
      { label: 'Ürünler', href: '/products' },
      {
        label:
          records.products.find((item) => item.id === segment(product[1]))?.name || 'Ürün detayı',
      },
    )
  const order = path.match(/^\/orders\/([^/]+)$/)
  if (order)
    return trail(
      { label: 'Siparişler', href: '/orders' },
      {
        label:
          records.orders.find((item) => item.id === segment(order[1]))?.number || 'Sipariş detayı',
      },
    )
  const invoice = path.match(/^\/finance\/invoices\/([^/]+)(\/edit)?$/)
  if (invoice) {
    const label =
      records.invoices.find((item) => item.id === segment(invoice[1]))?.number || 'Fatura detayı'
    return invoice[2]
      ? trail(
          { label: 'Faturalar', href: '/finance/invoices' },
          { label, href: `/finance/invoices/${invoice[1]}` },
          { label: 'Düzenle' },
        )
      : trail({ label: 'Faturalar', href: '/finance/invoices' }, { label })
  }
  if (/^\/listings\/prepare\/[^/]+$/.test(path))
    return trail(
      { label: 'Platform Listelemeleri', href: '/listings' },
      { label: 'İlan hazırlama' },
    )
  if (/^\/listings\/content\/[^/]+$/.test(path))
    return trail({ label: 'Platform Listelemeleri', href: '/listings' }, { label: 'İlan içeriği' })
  // Connection tabs use page-local state; a route parameter only seeds the initial tab.
  if (/^\/connections(?:\/[^/]+)?$/.test(path)) return trail({ label: 'Bağlantılar' })
  if (path === '/settings') return trail({ label: 'Çalışma alanı ayarları' })
  if (path === '/finance') return trail({ label: 'Faturalar' })
  const stockPath = retail ? path.replace('/retail/inventory', '/inventory') : path
  const parent = sections
    .flatMap((section) => section.items)
    .find((item) => item.children?.some((child) => child.to === stockPath))
  if (parent)
    return trail(
      { label: parent.label, href: retail ? '/retail/inventory' : parent.to },
      { label: parent.children!.find((child) => child.to === stockPath)!.label },
    )
  const labelPath =
    retail && path.startsWith('/retail/finance/') ? path.slice('/retail'.length) : path
  const exact = allLinks.find((item) => item.to.split('?')[0] === labelPath)
  return trail({ label: exact?.label ?? 'Sayfa bulunamadı' })
}
