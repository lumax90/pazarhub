import type { Product } from '../src/domain/types'

export const catalogWorkspaceOwner = {
  name: 'Katalog Sorumlusu',
  workspaceName: 'Paket ve Tanım Testi',
  email: 'catalog-workspace@example.com',
  password: 'Catalog1234',
}
export function catalogParts(): Product[] {
  return [
    {
      id: 'part-a',
      name: 'Pamuklu havlu',
      category: 'Banyo',
      brand: 'Atölye',
      description: '',
      art: 'towel',
      color: '#d3c8b6',
      active: true,
      taxRate: 20,
      lowStock: 2,
      version: 1,
      variants: [
        {
          id: 'a',
          name: 'Krem',
          sku: 'HAVLU',
          barcode: '000001',
          stock: 15,
          stockByWarehouse: { main: 12, shop: 3 },
          price: 1001,
          cost: 101,
        },
      ],
    },
    {
      id: 'part-b',
      name: 'El yapımı sabun',
      category: 'Banyo',
      brand: 'Atölye',
      description: '',
      art: 'candle',
      color: '#c0cdb0',
      active: true,
      taxRate: 10,
      lowStock: 2,
      version: 1,
      variants: [
        {
          id: 'b',
          name: 'Zeytin',
          sku: 'SABUN',
          barcode: '000002',
          stock: 14,
          stockByWarehouse: { main: 6, shop: 8 },
          price: 2002,
          cost: 109,
        },
      ],
    },
  ]
}
export function catalogBundle(): Product {
  return {
    id: 'bundle',
    name: 'Banyo hediye paketi',
    category: 'Banyo',
    brand: 'Atölye',
    description: 'Özenle hazırlandı.',
    art: 'bag',
    color: '#d3c8b6',
    active: true,
    taxRate: 20,
    lowStock: 1,
    version: 1,
    bundle: {
      components: [
        { variantId: 'a', quantity: 2 },
        { variantId: 'b', quantity: 1 },
      ],
      priceMode: 'linked',
      discountBps: 1250,
      includeContents: true,
    },
    variants: [
      {
        id: 'pack',
        name: 'Paket',
        sku: 'BANYO-PAKET',
        barcode: '000010',
        price: 0,
        cost: 0,
        stock: 0,
      },
    ],
  }
}
