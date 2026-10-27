import { Breadcrumbs } from '@heroui/react'
import { House } from 'lucide-react'
import { RouterProvider } from 'react-aria-components'
import { useHref, useNavigate } from 'react-router'
import { useMediaQuery } from '../../lib/useMediaQuery'
import type { HeaderCrumb } from './breadcrumbs'

export function HeaderBreadcrumbs({ items }: { items: HeaderCrumb[] }) {
  const navigate = useNavigate()
  const small = useMediaQuery('(max-width: 680px)')
  const visible = small ? items.slice(-2) : items
  return (
    <RouterProvider navigate={navigate} useHref={useHref}>
      <nav aria-label="Sayfa yolu" className="header-breadcrumbs">
        <Breadcrumbs>
          {visible.map((item, index) => (
            <Breadcrumbs.Item
              key={item.href ?? `current-${item.label}`}
              href={item.href}
              aria-label={item.label}
              className={
                index === visible.length - 1 ? 'header-crumb-current' : 'header-crumb-parent'
              }
            >
              {!small && index === 0 && items.length > 1 ? (
                <House size={15} aria-hidden="true" />
              ) : (
                <span className="header-crumb-label" title={item.label}>
                  {item.label}
                </span>
              )}
            </Breadcrumbs.Item>
          ))}
        </Breadcrumbs>
      </nav>
    </RouterProvider>
  )
}
