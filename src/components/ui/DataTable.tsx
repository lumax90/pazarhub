import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Checkbox, Table } from '@heroui/react'
import type { Selection, SortDescriptor } from '@heroui/react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState, SelectButton } from './shared'

export interface Column<T> {
  id: string
  label: string
  cell: (item: T) => ReactNode
  sortValue?: (item: T) => string | number
  className?: string
  rowHeader?: boolean
}

export function DataTable<T extends { id: string }>({
  items,
  columns,
  label,
  selection,
  onSelectionChange,
  disabledSelectionIds = [],
  selectionLabel,
  selectionRowLabel,
  emptyTitle,
  emptyDescription,
  pageSize: initialPageSize = 10,
  paginate = true,
}: {
  items: T[]
  columns: Column<T>[]
  label: string
  selection?: Selection
  onSelectionChange?: (selection: Selection) => void
  disabledSelectionIds?: string[]
  selectionLabel?: string
  selectionRowLabel?: (item: T) => string
  emptyTitle?: string
  emptyDescription?: string
  pageSize?: number
  paginate?: boolean
}) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(initialPageSize)
  const [sort, setSort] = useState<SortDescriptor>()
  const sorted = useMemo(() => {
    if (!sort) return items
    const column = columns.find((item) => item.id === sort.column)
    if (!column?.sortValue) return items
    const getValue = column.sortValue
    return [...items].sort((a, b) => {
      const x = getValue(a),
        y = getValue(b)
      const result =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), 'tr')
      return sort.direction === 'descending' ? -result : result
    })
  }, [items, columns, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / size))
  const current = Math.min(page, pages)
  const displayed = paginate ? sorted.slice((current - 1) * size, current * size) : sorted
  const changePage = (next: number) => {
    setPage(next)
    onSelectionChange?.(new Set())
  }

  if (!items.length)
    return (
      <EmptyState
        title={emptyTitle ?? 'Sonuç bulunamadı'}
        description={emptyDescription ?? 'Aramayı veya filtreleri değiştirerek tekrar deneyin.'}
      />
    )

  return (
    <div className="data-table-wrap">
      <Table className="app-data-table">
        <Table.ScrollContainer>
          <Table.Content
            aria-label={label}
            selectionMode={onSelectionChange ? 'multiple' : undefined}
            selectedKeys={selection}
            disabledKeys={disabledSelectionIds}
            disabledBehavior="selection"
            onSelectionChange={(next) =>
              onSelectionChange?.(
                next === 'all'
                  ? new Set(
                      displayed
                        .filter((item) => !disabledSelectionIds.includes(item.id))
                        .map((item) => item.id),
                    )
                  : next,
              )
            }
            sortDescriptor={sort}
            onSortChange={setSort}
          >
            <Table.Header>
              {onSelectionChange && (
                <Table.Column className="checkbox-column">
                  <Checkbox
                    slot="selection"
                    aria-label={selectionLabel ?? 'Bu sayfadaki tüm kayıtları seç'}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>
                </Table.Column>
              )}
              {columns.map((column) => (
                <Table.Column
                  key={column.id}
                  id={column.id}
                  isRowHeader={column.rowHeader}
                  allowsSorting={!!column.sortValue}
                  className={column.className}
                >
                  {column.sortValue ? (
                    <Table.SortableColumnHeader>
                      {column.label}
                      {sort?.column === column.id &&
                        (sort.direction === 'ascending' ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        ))}
                    </Table.SortableColumnHeader>
                  ) : (
                    column.label
                  )}
                </Table.Column>
              ))}
            </Table.Header>
            <Table.Body>
              {displayed.map((item) => (
                <Table.Row key={item.id} id={item.id}>
                  {onSelectionChange && (
                    <Table.Cell className="checkbox-column">
                      <Checkbox
                        slot="selection"
                        aria-label={selectionRowLabel?.(item) ?? `${item.id} seç`}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                    </Table.Cell>
                  )}
                  {columns.map((column) => (
                    <Table.Cell key={column.id} className={column.className}>
                      {column.cell(item)}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {paginate && (
        <div className="table-pagination">
          <span>
            <strong>
              {(current - 1) * size + 1}–{Math.min(current * size, sorted.length)}
            </strong>{' '}
            / {sorted.length} kayıt
          </span>
          <div className="pagination-actions">
            <span className="pagination-size-label">Sayfada</span>
            <SelectButton
              value={String(size)}
              label="Sayfa başına kayıt"
              options={[10, 20, 50].map((value) => ({ id: String(value), label: String(value) }))}
              onChange={(value) => {
                setSize(Number(value))
                changePage(1)
              }}
            />
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={current === 1}
              aria-label="Önceki sayfa"
              onPress={() => changePage(current - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="page-counter">
              {current} <span>/ {pages}</span>
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={current === pages}
              aria-label="Sonraki sayfa"
              onPress={() => changePage(current + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
