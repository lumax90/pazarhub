import { ArrowLeft } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router'

export function RetailWorkspace() {
  const { pathname } = useLocation()
  return (
    <>
      {pathname !== '/retail' && pathname !== '/retail/' && (
        <div className="retail-back-link">
          <Link to="/retail">
            <ArrowLeft size={14} />
            Perakende ana ekranı
          </Link>
        </div>
      )}
      <Outlet />
    </>
  )
}
