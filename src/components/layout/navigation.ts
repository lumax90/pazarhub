import {
  ArrowRightLeft,
  Boxes,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileText,
  FolderTree,
  Layers3,
  LayoutDashboard,
  MessageCircle,
  Package,
  Palette,
  PanelsTopLeft,
  Plug,
  RotateCcw,
  ScanLine,
  ShoppingBag,
  SlidersHorizontal,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavigationItem = {
  to: string
  label: string
  icon: LucideIcon
  children?: NavigationItem[]
}
type NavigationSection = { label: string; collapsible?: boolean; items: NavigationItem[] }

export const sections: NavigationSection[] = [
  {
    label: 'GENEL',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/orders', label: 'Siparişler', icon: ShoppingBag },
      { to: '/customers', label: 'Müşteriler', icon: Users },
    ],
  },
  {
    label: 'MAĞAZA YÖNETİMİ',
    collapsible: true,
    items: [
      { to: '/products', label: 'Ürünler', icon: Package },
      { to: '/listings', label: 'Platform Listelemeleri', icon: PanelsTopLeft },
      {
        to: '/definitions',
        label: 'Tanımlamalar',
        icon: Tags,
        children: [
          { to: '/definitions/categories', label: 'Ürün Kategorileri', icon: FolderTree },
          { to: '/definitions/variants', label: 'Varyantlar', icon: Layers3 },
          { to: '/definitions/colors', label: 'Renkler', icon: Palette },
          { to: '/definitions/warehouses', label: 'Depolar', icon: Warehouse },
          { to: '/definitions/suppliers', label: 'Tedarikçiler', icon: Truck },
          { to: '/definitions/brands', label: 'Markalar', icon: Tags },
          { to: '/definitions/specs', label: 'Teknik Özellikler', icon: SlidersHorizontal },
          { to: '/definitions/mappings', label: 'Eşleştirmeler', icon: ArrowRightLeft },
        ],
      },
      {
        to: '/inventory',
        label: 'Stok',
        icon: Boxes,
        children: [
          { to: '/inventory/levels', label: 'Stok durumu', icon: Boxes },
          { to: '/inventory/movements', label: 'Hareketler', icon: ArrowRightLeft },
          { to: '/inventory/transfers', label: 'Transferler', icon: Truck },
          { to: '/inventory/counts', label: 'Sayımlar', icon: ClipboardCheck },
        ],
      },
      { to: '/margins', label: 'Marj Ayarları', icon: ChartNoAxesCombined },
      { to: '/ecommerce-settings', label: 'E-Ticaret Ayarları', icon: SlidersHorizontal },
      { to: '/shipments', label: 'Kargo Gönderileri', icon: Truck },
    ],
  },
  {
    label: 'MÜŞTERİ TALEPLERİ',
    collapsible: true,
    items: [
      { to: '/questions', label: 'Müşteri Soruları', icon: MessageCircle },
      { to: '/returns?view=marketplace', label: 'İade Yönetimi', icon: RotateCcw },
    ],
  },
  {
    label: 'MUHASEBE YÖNETİMİ',
    collapsible: true,
    items: [
      { to: '/finance/invoices', label: 'Faturalar', icon: FileText },
      { to: '/finance/cash', label: 'Kasa Hareketleri', icon: Wallet },
      { to: '/finance/expenses', label: 'Giderler ve Alışlar', icon: FileText },
      { to: '/finance/customers', label: 'Cari Hesaplar', icon: Users },
      { to: '/finance/settlements', label: 'Hakedişler', icon: Wallet },
    ],
  },
  {
    label: 'ENTEGRASYONLAR',
    collapsible: true,
    items: [
      { to: '/connections', label: 'Bağlantılar', icon: Plug },
      { to: '/jobs', label: 'İşlem Merkezi', icon: Workflow },
    ],
  },
  {
    label: 'ANALİZ VE RAPORLAR',
    items: [{ to: '/reports', label: 'Satış Özeti', icon: ChartNoAxesCombined }],
  },
  { label: 'YÖNETİM', items: [{ to: '/team', label: 'Kullanıcılar ve Roller', icon: Users }] },
]

export const retailSections: NavigationSection[] = [
  {
    label: 'PERAKENDE',
    items: [
      { to: '/retail', label: 'Perakende', icon: LayoutDashboard },
      { to: '/retail/sale', label: 'Yeni Satış', icon: ScanLine },
      { to: '/retail/history', label: 'Eski Satışlar', icon: ShoppingBag },
      { to: '/retail/returns', label: 'İade İşlemleri', icon: RotateCcw },
    ],
  },
  {
    label: 'KASA VE STOK',
    items: [
      { to: '/retail/finance/expenses', label: 'Giderler ve Alışlar', icon: FileText },
      { to: '/retail/finance/cash', label: 'Kasa Hareketleri', icon: Wallet },
      { to: '/retail/finance/customers', label: 'Cari Hesaplar', icon: Users },
      { to: '/retail/inventory', label: 'Stok durumu', icon: Boxes },
    ],
  },
  {
    label: 'ORTAK KATALOG',
    items: [
      { to: '/products', label: 'Ürünler', icon: Package },
      { to: '/customers', label: 'Müşteriler', icon: Users },
    ],
  },
]

export const isCurrentPath = (pathname: string, to: string) => {
  const path = to.split('?')[0]
  return pathname === path || pathname.startsWith(`${path}/`)
}

/** Index of the item the page belongs to; the longest match wins (/retail vs /retail/sale). */
export function currentItemIndex(items: NavigationItem[], pathname: string) {
  return items.reduce(
    (best, item, index) =>
      isCurrentPath(pathname, item.to) && (best < 0 || item.to.length > items[best].to.length)
        ? index
        : best,
    -1,
  )
}

export const allLinks = [...sections, ...retailSections]
  .flatMap((section) => section.items.flatMap((item) => item.children ?? [item]))
  .filter((item, index, items) => items.findIndex((other) => other.to === item.to) === index)
