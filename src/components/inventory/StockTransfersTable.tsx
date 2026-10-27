import { useApp } from '../../app/AppProvider'
import { warehouses } from '../../domain/inventory'
import { findVariant } from '../../domain/selectors'
import { dateLabel, matches } from '../../lib/format'
import { DataTable } from '../ui/DataTable'

export function StockTransfersTable({
  warehouseId,
  query,
}: {
  warehouseId?: string
  query: string
}) {
  const { state } = useApp()
  return (
    <DataTable
      label="Depo transferleri"
      items={(state.stockTransfers ?? []).filter(
        (item) =>
          (!warehouseId || item.from === warehouseId || item.to === warehouseId) &&
          matches(
            `${findVariant(state, item.variantId)?.product.name} ${findVariant(state, item.variantId)?.variant.sku} ${item.note}`,
            query,
          ),
      )}
      columns={[
        {
          id: 'date',
          label: 'Tarih',
          rowHeader: true,
          cell: (item) => dateLabel(item.createdAt, true),
        },
        {
          id: 'product',
          label: 'Ürün',
          cell: (item) =>
            `${findVariant(state, item.variantId)?.product.name ?? ''} · ${findVariant(state, item.variantId)?.variant.sku ?? ''}`,
        },
        {
          id: 'from',
          label: 'Kaynak depo',
          cell: (item) => warehouses(state).find((warehouse) => warehouse.id === item.from)?.name,
        },
        {
          id: 'to',
          label: 'Hedef depo',
          cell: (item) => warehouses(state).find((warehouse) => warehouse.id === item.to)?.name,
        },
        {
          id: 'quantity',
          label: 'Miktar',
          className: 'align-right',
          cell: (item) => item.quantity,
        },
        { id: 'note', label: 'Açıklama', cell: (item) => item.note },
      ]}
      emptyTitle="Henüz transfer kaydı yok"
      emptyDescription="Depo transferi düğmesinden fiziksel stok kodunu ve depoları seçebilirsiniz. Önceki hareketler Hareketler sekmesinde izlenir."
    />
  )
}
