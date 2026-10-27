import { Description, Label, Radio, RadioGroup } from '@heroui/react'
import type { Order } from '../../domain/types'
import type { PublicIntegration } from '../../domain/integrations'
import { SelectButton } from '../ui/shared'

export function InvoicePreferenceFields({
  value,
  onChange,
  connectionId,
  onConnectionChange,
  accounts,
  disabled,
  allowImmediate,
}: {
  value: NonNullable<Order['invoicePreference']>
  onChange: (value: NonNullable<Order['invoicePreference']>) => void
  connectionId: string
  onConnectionChange: (value: string) => void
  accounts: PublicIntegration[]
  disabled?: boolean
  allowImmediate: boolean
}) {
  return (
    <div className="order-invoice-preferences">
      <RadioGroup
        aria-label="Fatura tercihi"
        value={value}
        onChange={(value) => onChange(value as NonNullable<Order['invoicePreference']>)}
        isDisabled={disabled}
      >
        {[
          {
            id: 'default',
            title: 'Ayara göre',
            description: 'Bağlantının otomatik fatura ve resmileştirme ayarları uygulanır.',
          },
          {
            id: 'immediate',
            title: 'Hemen',
            description:
              'Fatura taslağı oluşturulur ve seçilen Paraşüt hesabında resmileştirme başlatılır.',
          },
          {
            id: 'draft',
            title: 'Resmîleşmesin',
            description: 'Fatura taslak olarak kalır; otomatik resmileştirme yapılmaz.',
          },
        ].map((option) => (
          <Radio
            key={option.id}
            value={option.id}
            className="order-invoice-option"
            isDisabled={option.id === 'immediate' && !allowImmediate}
          >
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              <Label>{option.title}</Label>
            </Radio.Content>
            <Description>{option.description}</Description>
          </Radio>
        ))}
      </RadioGroup>
      {value === 'immediate' && (
        <div className="select-field">
          <label className="label">Paraşüt hesabı</label>
          <SelectButton
            label="Resmileştirme için Paraşüt hesabı"
            value={connectionId}
            onChange={onConnectionChange}
            isDisabled={disabled}
            options={accounts
              .filter((account) => account.enabled && account.status === 'verified')
              .map((account) => ({ id: account.id, label: account.name }))}
          />
        </div>
      )}
    </div>
  )
}
