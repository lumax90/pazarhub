import { useState } from 'react'
import { Button, Description, Dropdown, Label } from '@heroui/react'
import { Bell, Boxes, ChevronRight, PanelsTopLeft, ShoppingBag, Workflow } from 'lucide-react'
import type { NotificationPreferences } from '../../domain/types'

export function NotificationsMenu({
  waiting,
  rejected,
  lowStock,
  shown = { orders: true, listings: true, stock: true },
  onNavigate,
}: {
  waiting: number
  rejected: number
  lowStock: number
  /** The member's choice from Ayarlar → Bildirimler; every alert shows by default. */
  shown?: NotificationPreferences
  onNavigate: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const items = [
    {
      kind: 'orders' as const,
      count: waiting,
      title: `${waiting} sipariş gönderim bekliyor`,
      description: 'Onaylayın, hazırlayın ve kargoya çıkarın.',
      icon: ShoppingBag,
      to: '/orders',
    },
    {
      kind: 'listings' as const,
      count: rejected,
      title: `${rejected} ilan kontrol bekliyor`,
      description: 'İlan durumunu ve son işlem açıklamasını inceleyin.',
      icon: PanelsTopLeft,
      to: '/listings',
    },
    {
      kind: 'stock' as const,
      count: lowStock,
      title: `${lowStock} ürün düşük stokta`,
      description: 'Satılabilir stok ve hareketleri görüntüleyin.',
      icon: Boxes,
      to: '/inventory',
    },
  ].filter((item) => item.count > 0 && shown[item.kind])
  const go = (path: string) => {
    setOpen(false)
    onNavigate(path)
  }
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="icon-button notification-button"
        aria-label="Bildirimler"
      >
        <Bell size={18} />
        {items.length > 0 && <span className="notification-dot" />}
      </Button>
      <Dropdown.Popover
        placement="bottom end"
        offset={12}
        className="app-dropdown notification-dropdown"
      >
        <div className="notification-dropdown-heading">
          <h2>Bildirimler</h2>
          <p>Çalışma alanınızdaki öncelikli işler</p>
        </div>
        {items.length === 0 && (
          <div className="notification-empty" role="status">
            <Bell size={22} />
            <strong>Şimdilik her şey yolunda</strong>
            <p>İşlem bekleyen bir bildirim bulunmuyor.</p>
          </div>
        )}
        <Dropdown.Menu aria-label="Bildirimler menüsü">
          {items.map((item) => (
            <Dropdown.Item
              key={item.to}
              id={item.to}
              textValue={item.title}
              className="notification-item"
              onAction={() => go(item.to)}
            >
              <span className="notification-item-icon">
                <item.icon size={18} />
              </span>
              <span className="notification-item-copy">
                <Label>{item.title}</Label>
                <Description>{item.description}</Description>
              </span>
              <ChevronRight size={14} />
            </Dropdown.Item>
          ))}
          <Dropdown.Item
            id="jobs"
            textValue="İşlem merkezini aç"
            className="notification-footer"
            onAction={() => go('/jobs')}
          >
            <Workflow size={15} />
            <Label>İşlem merkezini aç</Label>
            <ChevronRight size={14} />
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
