import { useState } from 'react'
import { Button } from '@heroui/react'
import { Printer } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useApp } from '../app/AppProvider'
import { MAX_PRODUCT_LABELS, productLabelFormats, productLabels } from '../domain/product-labels'
import type { ProductLabel, ProductLabelFormat } from '../domain/product-labels'
import { Barcode } from '../components/ui/Barcode'
import { DataTable } from '../components/ui/DataTable'
import { Field, SelectButton } from '../components/ui/shared'

const formatKey = 'pazarhub.productLabelFormat'
const paper: Record<ProductLabelFormat, string> = {
  '50x30': '50 × 30 mm',
  '60x40': '60 × 40 mm',
  a4: 'A4',
}
/** Barcode box per format: [width, height] in mm. */
const barcodeSize: Record<ProductLabelFormat, [number, number]> = {
  '50x30': [46, 10],
  '60x40': [55, 15],
  a4: [64, 13],
}

function storedFormat(): ProductLabelFormat {
  try {
    const value = localStorage.getItem(formatKey)
    return productLabelFormats.find((format) => format.id === value)?.id ?? '50x30'
  } catch {
    return '50x30'
  }
}

/** Product barcode stickers: name, stock code and barcode, any number of copies. */
export function ProductLabelPage() {
  const { state } = useApp(),
    [params] = useSearchParams(),
    [format, setFormat] = useState(storedFormat),
    [copies, setCopies] = useState<Record<string, number>>({})
  const ids = (params.get('ids') ?? '').split(',')
  const variantIds = params.get('variants')?.split(',')
  const products = state.products.filter((product) => ids.includes(product.id))
  const { labels, skipped } = productLabels(products, variantIds)
  const count = (label: ProductLabel) => copies[label.id] ?? 1
  const printed = labels.flatMap((label) =>
    Array.from({ length: count(label) }, (_, index) => ({ label, key: `${label.id}-${index}` })),
  )
  const tooMany = printed.length > MAX_PRODUCT_LABELS
  const sheets =
    format === 'a4'
      ? Array.from({ length: Math.ceil(printed.length / 24) }, (_, index) =>
          printed.slice(index * 24, index * 24 + 24),
        )
      : printed.map((item) => [item])
  const choose = (value: string) => {
    setFormat(value as ProductLabelFormat)
    try {
      localStorage.setItem(formatKey, value)
    } catch {
      // The choice simply is not remembered.
    }
  }
  return (
    <div className={`order-print-page product-labels product-labels--${format}`}>
      <header className="order-print-toolbar">
        <Link to={ids.length === 1 ? `/products/${ids[0]}` : '/products'}>Ürüne dön</Link>
        <strong>{printed.length} barkod etiketi</strong>
        <SelectButton
          label="Etiket boyutu"
          value={format}
          onChange={choose}
          options={productLabelFormats.map((item) => ({ id: item.id, label: item.label }))}
        />
        <Button
          variant="primary"
          onPress={() => window.print()}
          isDisabled={!printed.length || tooMany}
        >
          <Printer size={16} />
          Yazdır
        </Button>
      </header>
      <p className="order-print-label-hint">
        Yazdırma penceresinde kâğıt boyutunu {paper[format]}, kenar boşluğunu “Yok” ve ölçeği %100
        seçin.
        {tooMany && ` Bir seferde en fazla ${MAX_PRODUCT_LABELS} etiket basılabilir.`}
      </p>
      {labels.length > 0 && (
        <div className="product-label-copies variant-fields-table">
          <DataTable
            label="Etiket adetleri"
            items={labels}
            paginate={labels.length > 10}
            columns={[
              {
                id: 'variant',
                label: 'Ürün',
                rowHeader: true,
                cell: (label) => (
                  <div className="variant-table-title">
                    <strong>{label.product.name}</strong>
                    <span className="code-text">
                      {label.product.variants.length > 1 ? `${label.variant.name} · ` : ''}
                      {label.variant.sku}
                    </span>
                  </div>
                ),
              },
              {
                id: 'barcode',
                label: 'Barkod',
                cell: (label) => <span className="code-text">{label.variant.barcode}</span>,
              },
              {
                id: 'copies',
                label: 'Adet',
                cell: (label) => (
                  <Field
                    label={`${label.variant.sku} etiket adedi`}
                    type="number"
                    min={0}
                    max={MAX_PRODUCT_LABELS}
                    step={1}
                    value={String(count(label))}
                    onChange={(value) =>
                      setCopies((current) => ({
                        ...current,
                        [label.id]: Math.max(
                          0,
                          Math.min(MAX_PRODUCT_LABELS, Math.floor(Number(value)) || 0),
                        ),
                      }))
                    }
                  />
                ),
              },
            ]}
          />
        </div>
      )}
      {skipped.length > 0 && (
        <ul className="order-print-label-skipped">
          {skipped.map(({ product, variant, reason }) => (
            <li key={variant.id}>
              <Link to={`/products/${product.id}`}>{variant.sku || product.name}</Link>: {reason}
            </li>
          ))}
        </ul>
      )}
      {!labels.length && !skipped.length && <p>Ürün bulunamadı.</p>}
      {!tooMany &&
        sheets.map((sheet) => (
          <section className="product-label-sheet" key={sheet[0].key}>
            {sheet.map(({ label, key }) => (
              <article className="product-label" key={key}>
                <strong className="product-label-name">{label.product.name}</strong>
                <span className="product-label-meta">
                  {label.product.variants.length > 1 ? `${label.variant.name} · ` : ''}
                  {label.variant.sku}
                </span>
                <Barcode
                  value={label.variant.barcode}
                  symbology={label.symbology}
                  widthMm={barcodeSize[format][0]}
                  heightMm={barcodeSize[format][1]}
                  className="product-label-barcode"
                />
                <span className="product-label-code">{label.variant.barcode}</span>
              </article>
            ))}
          </section>
        ))}
    </div>
  )
}
