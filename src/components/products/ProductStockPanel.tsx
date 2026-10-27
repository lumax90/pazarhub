import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { Pencil, Warehouse } from 'lucide-react'
import { useApp } from '../../app/AppProvider'
import { MAIN_WAREHOUSE, stockAt, warehouseReserved, warehouses } from '../../domain/inventory'
import type { Product, Variant } from '../../domain/types'
import { dateLabel } from '../../lib/format'
import { DataTable } from '../ui/DataTable'
import { Panel, SelectButton } from '../ui/shared'
import { StockAdjustment } from '../inventory/StockAdjustment'
import { InventoryTools } from '../inventory/InventoryTools'
import { stockMovementLabels } from '../../domain/inventory-base'

export function ProductStockPanel({ product }: { product: Product }) {
  const { state, can } = useApp()
  const [warehouseId, setWarehouse] = useState(MAIN_WAREHOUSE)
  const [adjusting, setAdjusting] = useState<Variant | null>(null)
  const locations = warehouses(state)
  const movements = state.movements.filter(
    (m) =>
      product.variants.some((v) => v.id === m.variantId) &&
      (m.warehouseId ?? MAIN_WAREHOUSE) === warehouseId,
  )
  return (
    <div className="product-stock-workspace">
      <Panel
        className="product-form-card"
        title="Depo stokları"
        description="Fiziksel stok, siparişlere ayrılan miktar ve satılabilir bakiye."
        actions={
          <SelectButton
            label="Ürün stok deposu"
            value={warehouseId}
            onChange={setWarehouse}
            options={locations.map((w) => ({
              id: w.id,
              label: w.name,
              icon: <Warehouse size={15} />,
            }))}
          />
        }
      >
        <DataTable
          label="Ürünün depo stokları"
          items={product.variants}
          columns={[
            {
              id: 'variant',
              label: 'Varyant',
              rowHeader: true,
              cell: (v) => (
                <div>
                  <strong>{v.name}</strong>
                  <span className="cell-secondary code-text">{v.sku}</span>
                </div>
              ),
            },
            {
              id: 'stock',
              label: 'Mevcut stok',
              className: 'align-right',
              cell: (v) => <strong>{stockAt(v, warehouseId)}</strong>,
            },
            {
              id: 'reserved',
              label: 'Rezerve',
              className: 'align-right',
              cell: (v) => warehouseReserved(state, v.id, warehouseId),
            },
            {
              id: 'available',
              label: 'Satılabilir',
              className: 'align-right',
              cell: (v) => (
                <Chip
                  size="sm"
                  variant="soft"
                  color={
                    stockAt(v, warehouseId) - warehouseReserved(state, v.id, warehouseId) <=
                    product.lowStock
                      ? 'warning'
                      : 'success'
                  }
                >
                  {stockAt(v, warehouseId) - warehouseReserved(state, v.id, warehouseId)}
                </Chip>
              ),
            },
            {
              id: 'action',
              label: '',
              cell: (v) => (
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={
                    !can('stock.write') || !locations.find((w) => w.id === warehouseId)?.active
                  }
                  onPress={() => setAdjusting(v)}
                  aria-label={`${v.sku} stok düzelt`}
                >
                  <Pencil size={14} />
                  Düzelt
                </Button>
              ),
            },
          ]}
          paginate={product.variants.length > 10}
        />
      </Panel>
      <InventoryTools variantIds={product.variants.map((v) => v.id)} />
      <Panel
        className="product-form-card"
        title="Stok hareketleri"
        description={`${locations.find((w) => w.id === warehouseId)?.name ?? 'Depo'} · bu ürüne ait hareketler`}
      >
        <DataTable
          label="Ürünün stok hareketleri"
          items={movements}
          columns={[
            {
              id: 'date',
              label: 'Tarih',
              rowHeader: true,
              cell: (m) => dateLabel(m.createdAt, true),
              sortValue: (m) => m.createdAt,
            },
            {
              id: 'sku',
              label: 'Stok kodu',
              cell: (m) => product.variants.find((v) => v.id === m.variantId)?.sku,
            },
            {
              id: 'type',
              label: 'İşlem',
              cell: (m) => stockMovementLabels[m.type],
            },
            { id: 'reference', label: 'Açıklama', cell: (m) => m.reference },
            {
              id: 'quantity',
              label: 'Değişim',
              className: 'align-right',
              cell: (m) => (
                <strong className={m.quantity > 0 ? 'text-success' : ''}>
                  {m.quantity > 0 ? '+' : ''}
                  {m.quantity}
                </strong>
              ),
            },
          ]}
          emptyTitle="Henüz stok hareketi yok"
          emptyDescription="Bu depodaki satış, alış, iade ve düzeltmeler burada görünür."
        />
      </Panel>
      {adjusting && (
        <StockAdjustment
          key={`${adjusting.id}:${warehouseId}`}
          product={product}
          variant={adjusting}
          initialWarehouseId={warehouseId}
          onClose={() => setAdjusting(null)}
        />
      )}
    </div>
  )
}
