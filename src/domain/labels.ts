import type { Invoice } from './types'
export const invoiceStatusLabels: Record<Invoice['status'], string> = {
  draft: 'Taslak',
  queued: 'Gönderim sırasında',
  processing: 'Resmileştiriliyor',
  issued: 'Resmî belge',
  failed: 'Kontrol gerekiyor',
  cancelled: 'İptal',
}
export const paymentLabels = {
  cash: 'Nakit',
  card: 'Kart',
  transfer: 'Havale / EFT',
  marketplace: 'Pazaryeri',
}
