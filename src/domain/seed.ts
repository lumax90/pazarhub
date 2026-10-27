import type { AppState, Channel, Customer, Order, OrderStatus, Product } from './types'
import { orderTotal } from './selectors'

export function createSeedState(anchor = new Date()): AppState {
  const at = (days: number, hour = 10, minute = 0) => {
    const date = new Date(anchor)
    date.setDate(date.getDate() - days)
    date.setHours(hour, minute, 0, 0)
    return date.toISOString()
  }
  const products: Product[] = [
    {
      id: 'aura',
      name: 'Aura Seramik Vazo',
      category: 'Ev & Dekorasyon',
      brand: 'Kuzey Studio',
      description:
        'Organik formu ve mat dokusuyla yaşam alanlarına sakin bir dokunuş. El yapımı seramik, 22 cm.',
      art: 'vase',
      color: '#c1ad98',
      taxRate: 20,
      active: true,
      lowStock: 10,
      variants: [
        {
          id: 'aura-sand',
          name: 'Kum beji',
          sku: 'KS-001-KUM',
          barcode: '8690000000011',
          price: 64990,
          cost: 24800,
          stock: 86,
        },
        {
          id: 'aura-sage',
          name: 'Adaçayı',
          sku: 'KS-001-YES',
          barcode: '8690000000012',
          price: 64990,
          cost: 24800,
          stock: 34,
        },
      ],
    },
    {
      id: 'nord',
      name: 'Nord Kupa Seti',
      category: 'Sofra & Mutfak',
      brand: 'Kuzey Studio',
      description: 'Yavaş sabahlar için iki kişilik kupa seti. 300 ml, bulaşık makinesine uygun.',
      art: 'cup',
      color: '#99acaa',
      taxRate: 20,
      active: true,
      lowStock: 8,
      variants: [
        {
          id: 'nord-mint',
          name: 'Sis yeşili · 2’li',
          sku: 'KS-002-YES',
          barcode: '8690000000021',
          price: 49900,
          cost: 18700,
          stock: 62,
        },
      ],
    },
    {
      id: 'luna',
      name: 'Luna Masa Lambası',
      category: 'Aydınlatma',
      brand: 'Kuzey Studio',
      description:
        'Sıcak ışığı ve yumuşak siluetiyle çalışma alanınızın yeni favorisi. Dimmer kontrollü LED.',
      art: 'lamp',
      color: '#d7b093',
      taxRate: 20,
      active: true,
      lowStock: 5,
      variants: [
        {
          id: 'luna-cream',
          name: 'Krem',
          sku: 'KS-003-KRM',
          barcode: '8690000000031',
          price: 129900,
          cost: 54500,
          stock: 18,
        },
      ],
    },
    {
      id: 'everyday',
      name: 'Everyday Kanvas Çanta',
      category: 'Tekstil',
      brand: 'Kuzey Studio',
      description: 'Günlük hayatın tüm küçük ayrıntıları için, doğal pamuklu kanvas çanta.',
      art: 'bag',
      color: '#c2b296',
      taxRate: 10,
      active: true,
      lowStock: 10,
      variants: [
        {
          id: 'everyday-natural',
          name: 'Doğal',
          sku: 'KS-004-DGL',
          barcode: '8690000000041',
          price: 34900,
          cost: 11900,
          stock: 0,
        },
      ],
    },
    {
      id: 'mysa',
      name: 'Mysa Kokulu Mum',
      category: 'Ev & Dekorasyon',
      brand: 'Kuzey Studio',
      description: 'Sedir ve bergamot notaları. Doğal soya mumu, 40 saat yanma süresi.',
      art: 'candle',
      color: '#aa967e',
      taxRate: 20,
      active: true,
      lowStock: 8,
      variants: [
        {
          id: 'mysa-cedar',
          name: 'Sedir · 200 g',
          sku: 'KS-005-SDR',
          barcode: '8690000000051',
          price: 27900,
          cost: 9600,
          stock: 4,
        },
      ],
    },
    {
      id: 'terra',
      name: 'Terra Seramik Kase',
      category: 'Sofra & Mutfak',
      brand: 'Kuzey Studio',
      description: 'Her sofraya uyum sağlayan el yapımı taş seramik kase. 18 cm.',
      art: 'bowl',
      color: '#bd8c73',
      taxRate: 20,
      active: true,
      lowStock: 8,
      variants: [
        {
          id: 'terra-clay',
          name: 'Terracotta',
          sku: 'KS-006-TRK',
          barcode: '8690000000061',
          price: 42900,
          cost: 15200,
          stock: 56,
        },
      ],
    },
    {
      id: 'soft',
      name: 'Soft Dokulu El Havlusu',
      category: 'Tekstil',
      brand: 'Kuzey Studio',
      description: '%100 pamuk, yumuşak ve emici. 50 × 90 cm, doğal taş rengi.',
      art: 'towel',
      color: '#b4b9ab',
      taxRate: 10,
      active: true,
      lowStock: 12,
      variants: [
        {
          id: 'soft-stone',
          name: 'Taş',
          sku: 'KS-007-TAS',
          barcode: '8690000000071',
          price: 19900,
          cost: 7800,
          stock: 112,
        },
      ],
    },
    {
      id: 'arco',
      name: 'Arco Ahşap Tepsi',
      category: 'Ev & Dekorasyon',
      brand: 'Kuzey Studio',
      description: 'Masif meşe, doğal yağ ile tamamlanmış sade bir servis tepsisi. 32 × 20 cm.',
      art: 'tray',
      color: '#b58d60',
      taxRate: 20,
      active: true,
      lowStock: 10,
      variants: [
        {
          id: 'arco-oak',
          name: 'Doğal meşe',
          sku: 'KS-008-MES',
          barcode: '8690000000081',
          price: 74900,
          cost: 28500,
          stock: 7,
        },
      ],
    },
  ]
  const cities = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Eskişehir']
  const names = [
    'Selin Demir',
    'Mert Arslan',
    'Elif Aydın',
    'Ece Yılmaz',
    'Bora Aksoy',
    'İpek Ergin',
    'Ozan Yıldız',
    'Zeynep Koç',
    'Ada Bulut',
    'Can Eren',
    'Duru Şahin',
    'Arda Yalçın',
    'Defne Uzun',
    'Ege Acar',
    'İdil Güneş',
    'Alp Çelik',
  ]
  const customers: Customer[] = names.map((name, index) => ({
    id: `customer-${index + 1}`,
    name,
    email: `musteri${index + 1}@example.com`,
    phone: `0555 010 ${String(index).padStart(2, '0')} 00`,
    city: cities[index % cities.length],
    address: `Örnek Mahallesi, Demo Sokak No: ${index + 1}`,
  }))
  const available = products.flatMap((product) =>
    product.variants
      .filter((variant) => variant.stock > 15)
      .map((variant) => ({ product, variant })),
  )
  const channels: Channel[] = [
    'trendyol',
    'hepsiburada',
    'trendyol',
    'n11',
    'amazon',
    'trendyol',
    'hepsiburada',
    'manual',
  ]
  const orders: Order[] = Array.from({ length: 112 }, (_, index) => {
    const days =
      index < 16 ? (index === 2 ? 2 : 0) : index < 30 ? 1 : 2 + Math.floor((index - 30) / 4)
    const status: OrderStatus =
      index < 7
        ? 'pending'
        : index < 11
          ? 'approved'
          : index < 16
            ? 'shipped'
            : index % 19 === 0
              ? 'returned'
              : index % 13 === 0
                ? 'cancelled'
                : 'delivered'
    const selected = available[index % available.length]
    const line = {
      variantId: selected.variant.id,
      quantity: 1 + (index % 3),
      unitPrice: selected.variant.price,
      unitCost: selected.variant.cost,
      taxRate: selected.product.taxRate,
    }
    const createdAt = at(days, 14 - (index % 5), 52 - (index % 47))
    const processed = ['approved', 'shipped', 'delivered'].includes(status)
    return {
      id: `order-${index + 1}`,
      number: `SP-${String(1100 - index).padStart(6, '0')}`,
      customerId: customers[index % customers.length].id,
      channel: channels[index % channels.length],
      storeId:
        channels[index % channels.length] === 'manual'
          ? undefined
          : `store-${channels[index % channels.length]}`,
      status,
      createdAt,
      dueAt: at(days - 1, 17),
      lines:
        index % 5 === 0
          ? [
              line,
              {
                variantId: 'soft-stone',
                quantity: 1,
                unitPrice: 19900,
                unitCost: 7800,
                taxRate: 10,
              },
            ]
          : [line],
      shipping: 0,
      note: index === 0 ? 'Hediye paketi rica ediyor. Fiyat etiketi eklenmeyecek.' : '',
      paid: status === 'delivered',
      inventoryApplied: processed,
      invoiceId: processed ? `invoice-${index + 1}` : undefined,
      events: [
        { id: `event-${index}-created`, label: 'Sipariş alındı.', at: createdAt },
        ...(processed
          ? [
              {
                id: `event-${index}-approved`,
                label: 'Sipariş onaylandı, stok işlendi.',
                at: createdAt,
              },
            ]
          : []),
        ...(status === 'delivered'
          ? [
              {
                id: `event-${index}-delivered`,
                label: 'Müşteriye teslim edildi.',
                at: at(Math.max(0, days - 2), 11),
              },
            ]
          : []),
      ],
    }
  })
  return {
    version: 1,
    products,
    customers,
    orders,
    listings: products.flatMap((product, index) =>
      product.variants.flatMap((variant) =>
        (['trendyol', 'hepsiburada', 'n11'] as const).map((channel, channelIndex) => ({
          id: `listing-${variant.id}-${channel}`,
          productId: product.id,
          variantId: variant.id,
          storeId: `store-${channel}`,
          channel,
          status:
            index === 3
              ? ('archived' as const)
              : (index === 1 || index === 5) && channelIndex === 1
                ? ('rejected' as const)
                : index === 7 && channelIndex === 2
                  ? ('pending' as const)
                  : ('active' as const),
          error:
            (index === 1 || index === 5) && channelIndex === 1
              ? 'Görsel işleme sırasında zaman aşımı oluştu. İlanı yeniden gönderebilirsiniz.'
              : undefined,
          updatedAt: at(0, 14, 28),
          priceOverride: channelIndex === 1 && index % 3 === 0 ? variant.price + 5000 : undefined,
        })),
      ),
    ),
    movements: orders
      .filter((order) => order.inventoryApplied)
      .slice(0, 14)
      .flatMap((order) =>
        order.lines.map((line, index) => ({
          id: `movement-${order.id}-${index}`,
          variantId: line.variantId,
          quantity: -line.quantity,
          type: 'order' as const,
          reference: order.number,
          createdAt: order.createdAt,
        })),
      ),
    invoices: orders
      .filter((order) => order.invoiceId)
      .map((order, index) => ({
        id: order.invoiceId!,
        number: `FT-${String(1000 + index).padStart(6, '0')}`,
        orderId: order.id,
        createdAt: order.createdAt,
        status: 'draft' as const,
      })),
    cash: [
      ...orders
        .filter((order) => order.paid)
        .map((order) => ({
          id: `cash-${order.id}`,
          amount: orderTotal(order),
          kind: 'in' as const,
          description: `${order.number} · sipariş tahsilatı`,
          method: order.channel === 'manual' ? ('transfer' as const) : ('marketplace' as const),
          reference: order.id,
          createdAt: order.createdAt,
        })),
      {
        id: 'expense-packaging',
        amount: 245000,
        kind: 'out',
        description: 'Ambalaj ve paketleme gideri',
        method: 'transfer',
        reference: 'GD-001',
        createdAt: at(3, 10),
      },
      {
        id: 'expense-shipping',
        amount: 189000,
        kind: 'out',
        description: 'Kargo gider kaydı',
        method: 'transfer',
        reference: 'GD-002',
        createdAt: at(5, 14),
      },
    ],
    retailSales: [],
    connections: [
      { id: 'store-trendyol', channel: 'trendyol', name: 'Kuzey Studio · Trendyol', active: true },
      {
        id: 'store-hepsiburada',
        channel: 'hepsiburada',
        name: 'Kuzey Studio · Hepsiburada',
        active: true,
      },
      { id: 'store-n11', channel: 'n11', name: 'Kuzey Studio · n11', active: true },
      { id: 'store-amazon', channel: 'amazon', name: 'Kuzey Studio · Amazon', active: false },
    ],
    preferences: { businessName: 'Kuzey Studio', theme: 'light', density: 'comfortable' },
  }
}
