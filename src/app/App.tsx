import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '../components/layout/AppShell'
import { DashboardPage } from '../pages/DashboardPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { RetailWorkspace } from '../components/layout/RetailWorkspace'

const OrdersPage = lazy(() =>
  import('../pages/OrdersPage').then((module) => ({ default: module.OrdersPage })),
)
const NewOrderPage = lazy(() =>
  import('../pages/NewOrderPage').then((module) => ({ default: module.NewOrderPage })),
)
const OrderDetailPage = lazy(() =>
  import('../pages/OrderDetailPage').then((module) => ({ default: module.OrderDetailPage })),
)
const OrderPrintPage = lazy(() =>
  import('../pages/OrderPrintPage').then((module) => ({ default: module.OrderPrintPage })),
)
const CargoLabelPage = lazy(() =>
  import('../pages/CargoLabelPage').then((module) => ({ default: module.CargoLabelPage })),
)
const ProductLabelPage = lazy(() =>
  import('../pages/ProductLabelPage').then((module) => ({ default: module.ProductLabelPage })),
)
const ProductsPage = lazy(() =>
  import('../pages/ProductsPage').then((module) => ({ default: module.ProductsPage })),
)
const NewProductPage = lazy(() =>
  import('../pages/NewProductPage').then((module) => ({ default: module.NewProductPage })),
)
const NewBundlePage = lazy(() =>
  import('../pages/NewBundlePage').then((module) => ({ default: module.NewBundlePage })),
)
const ProductDetailPage = lazy(() =>
  import('../pages/ProductDetailPage').then((module) => ({ default: module.ProductDetailPage })),
)
const CustomersPage = lazy(() =>
  import('../pages/CustomersPage').then((module) => ({ default: module.CustomersPage })),
)
const InventoryPage = lazy(() =>
  import('../pages/InventoryPage').then((module) => ({ default: module.InventoryPage })),
)
const DefinitionsPage = lazy(() =>
  import('../pages/DefinitionsPage').then((module) => ({ default: module.DefinitionsPage })),
)
const ListingsPage = lazy(() =>
  import('../pages/ListingsPage').then((module) => ({ default: module.ListingsPage })),
)
const PublishingPage = lazy(() =>
  import('../pages/PublishingPage').then((module) => ({ default: module.PublishingPage })),
)
const ListingContentPage = lazy(() =>
  import('../pages/ListingContentPage').then((module) => ({ default: module.ListingContentPage })),
)
const RetailPage = lazy(() =>
  import('../pages/RetailPage').then((module) => ({ default: module.RetailPage })),
)
const RetailHomePage = lazy(() =>
  import('../pages/RetailHomePage').then((module) => ({ default: module.RetailHomePage })),
)
const ConnectionsPage = lazy(() =>
  import('../pages/IntegrationsPage').then((module) => ({ default: module.IntegrationsPage })),
)
const JobsPage = lazy(() =>
  import('../pages/JobsPage').then((module) => ({ default: module.JobsPage })),
)
const ShipmentsPage = lazy(() =>
  import('../pages/ShipmentsPage').then((module) => ({ default: module.ShipmentsPage })),
)
const FinancePage = lazy(() =>
  import('../pages/FinancePage').then((module) => ({ default: module.FinancePage })),
)
const InvoiceEditorPage = lazy(() =>
  import('../pages/InvoicePages').then((module) => ({ default: module.InvoiceEditorPage })),
)
const InvoiceDetailPage = lazy(() =>
  import('../pages/InvoicePages').then((module) => ({ default: module.InvoiceDetailPage })),
)
const ReportsPage = lazy(() =>
  import('../pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
)
const SettingsPage = lazy(() =>
  import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const ProfilePage = lazy(() =>
  import('../pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
)
const MarginsPage = lazy(() =>
  import('../pages/MarginsPage').then((module) => ({ default: module.MarginsPage })),
)
const EcommerceSettingsPage = lazy(() =>
  import('../pages/EcommerceSettingsPage').then((module) => ({
    default: module.EcommerceSettingsPage,
  })),
)
const TeamPage = lazy(() =>
  import('../pages/TeamPage').then((module) => ({ default: module.TeamPage })),
)
const ReturnsPage = lazy(() =>
  import('../pages/ReturnsPage').then((module) => ({ default: module.ReturnsPage })),
)
const QuestionsPage = lazy(() =>
  import('../pages/QuestionsPage').then((module) => ({ default: module.QuestionsPage })),
)

export function App() {
  return (
    <Routes>
      <Route
        path="orders/print"
        element={
          <Suspense
            fallback={
              <div className="page-loading" role="status">
                Yazdırma görünümü hazırlanıyor…
              </div>
            }
          >
            <OrderPrintPage />
          </Suspense>
        }
      />
      <Route
        path="orders/labels"
        element={
          <Suspense
            fallback={
              <div className="page-loading" role="status">
                Kargo etiketleri hazırlanıyor…
              </div>
            }
          >
            <CargoLabelPage />
          </Suspense>
        }
      />
      <Route
        path="products/labels"
        element={
          <Suspense
            fallback={
              <div className="page-loading" role="status">
                Barkod etiketleri hazırlanıyor…
              </div>
            }
          >
            <ProductLabelPage />
          </Suspense>
        }
      />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<NewProductPage />} />
        <Route path="products/new/bundle" element={<NewBundlePage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="inventory" element={<Navigate to="/inventory/levels" replace />} />
        <Route path="inventory/:view" element={<InventoryPage />} />
        <Route path="definitions" element={<Navigate to="/definitions/categories" replace />} />
        <Route path="definitions/:kind" element={<DefinitionsPage />} />
        <Route path="listings" element={<ListingsPage />} />
        <Route path="listings/prepare/:id" element={<PublishingPage />} />
        <Route path="listings/content/:id" element={<ListingContentPage />} />
        <Route path="retail" element={<RetailWorkspace />}>
          <Route index element={<RetailHomePage />} />
          <Route path="sale" element={<RetailPage view="sale" />} />
          <Route path="history" element={<RetailPage view="history" />} />
          <Route path="returns" element={<ReturnsPage />} />
          <Route path="inventory" element={<Navigate to="/retail/inventory/levels" replace />} />
          <Route path="inventory/:view" element={<InventoryPage />} />
          <Route path="finance/:view" element={<FinancePage />} />
        </Route>
        <Route path="connections/:kind?" element={<ConnectionsPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="finance/:view?" element={<FinancePage />} />
        <Route path="finance/invoices/new" element={<InvoiceEditorPage />} />
        <Route path="finance/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="finance/invoices/:id/edit" element={<InvoiceEditorPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings/:section?" element={<SettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="margins" element={<MarginsPage />} />
        <Route path="ecommerce-settings" element={<EcommerceSettingsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="returns" element={<ReturnsPage />} />
        <Route path="questions" element={<QuestionsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
