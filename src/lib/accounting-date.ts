export const paymentDateInput = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .replace(' ', 'T')
export const validPaymentDate = (value: string) => Number.isFinite(Date.parse(`${value}:00+03:00`))
export const paymentTimestamp = (value: string) => new Date(`${value}:00+03:00`).toISOString()
