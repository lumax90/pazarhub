import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  Card,
  Chip,
  Description,
  Dropdown,
  FieldError,
  Input,
  Label,
  Modal,
  SearchField,
  TextField,
  Tooltip,
} from '@heroui/react'
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, ChevronDown, Inbox, X } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import type { Channel, OrderStatus } from '../../domain/types'
import { statusLabels } from '../../domain/operations'
import { channelNames } from '../../domain/channels'
import { parseMoney } from '../../lib/format'
import { exclusivePrice, inclusivePrice } from '../../domain/money'
import { useRevealMotion } from '../../lib/motion'
import { useFieldVariant } from './useFieldVariant'
import { ProviderLogo } from './ProviderLogo'

const MotionCard = motion.create(Card)

export function PageHeader({
  eyebrow,
  back,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  /** Detail pages: link back to the list, with an optional record reference. */
  back?: { to: string; label: string; context?: string }
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        {back && (
          <nav className="page-back" aria-label="Üst sayfa">
            <Link to={back.to}>
              <ArrowLeft size={14} aria-hidden="true" />
              {back.label}
            </Link>
            {back.context && (
              <>
                <span aria-hidden="true">/</span>
                <span>{back.context}</span>
              </>
            )}
          </nav>
        )}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  flush = false,
  entryIndex = 0,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
  entryIndex?: number
}) {
  const reveal = useRevealMotion(entryIndex)
  return (
    <MotionCard
      {...reveal}
      className={`app-panel ${flush ? 'app-panel--flush' : ''} ${className}`}
      data-panel-layout={flush ? 'flush' : 'inset'}
      data-motion-panel="true"
    >
      {title && (
        <Card.Header className="panel-heading">
          <div className="panel-heading-copy">
            <Card.Title className="text-base">{title}</Card.Title>
            {description && <Card.Description>{description}</Card.Description>}
          </div>
          {actions}
        </Card.Header>
      )}
      <Card.Content className="panel-content">{children}</Card.Content>
    </MotionCard>
  )
}

export function Metric({
  label,
  value,
  change,
  detail,
  icon,
  highlighted = false,
  index = 0,
}: {
  label: string
  value: string
  change?: number
  detail?: string
  icon: ReactNode
  highlighted?: boolean
  index?: number
}) {
  const reveal = useRevealMotion(index)
  return (
    <MotionCard
      {...reveal}
      data-motion-panel="true"
      className={`metric-card ${highlighted ? 'metric-card--highlighted' : ''}`}
    >
      <Card.Header className="metric-top">
        <Card.Description>{label}</Card.Description>
        <span className="metric-icon" aria-hidden="true">
          {icon}
        </span>
      </Card.Header>
      <Card.Content>
        <div className="metric-main">
          <strong className="metric-value">{value}</strong>
          {change !== undefined && (
            <Chip
              size="sm"
              variant="soft"
              color={change < 0 ? 'danger' : change > 0 ? 'success' : 'default'}
            >
              {change < 0 ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
              {Math.abs(change).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%
            </Chip>
          )}
        </div>
        <Description>{detail ?? 'önceki döneme göre'}</Description>
      </Card.Content>
    </MotionCard>
  )
}

export function ChannelIcon({ channel, size = 'sm' }: { channel: Channel; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`channel-icon channel-icon--${channel} channel-icon--${size}`}
      aria-hidden="true"
    >
      {channel === 'manual' ? 'm' : <ProviderLogo provider={channel} />}
    </span>
  )
}

export function ChannelBadge({
  channel,
  compact = false,
}: {
  channel: Channel
  compact?: boolean
}) {
  return (
    <span className="channel-badge">
      <ChannelIcon channel={channel} />
      {!compact && <span>{channelNames[channel]}</span>}
    </span>
  )
}

const statusTones: Record<OrderStatus, 'warning' | 'accent' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  approved: 'accent',
  shipped: 'accent',
  delivered: 'success',
  cancelled: 'default',
  returned: 'danger',
}
export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Chip
      size="sm"
      variant="soft"
      color={statusTones[status]}
      className={`status-chip status-chip--${status}`}
    >
      <span className="status-dot" />
      {statusLabels[status]}
    </Chip>
  )
}

export function EmptyState({
  title = 'Henüz kayıt yok',
  description = 'İlk kaydınızı ekleyerek başlayın.',
  action,
  icon,
}: {
  title?: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon ?? <Inbox size={26} strokeWidth={1.5} />}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
  error,
  description,
  className = '',
  readOnly = false,
  isDisabled = false,
  min,
  max,
  step,
  maxLength,
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  type?: 'text' | 'email' | 'number' | 'tel' | 'url' | 'password'
  required?: boolean
  error?: string
  description?: string
  className?: string
  readOnly?: boolean
  isDisabled?: boolean
  min?: number
  max?: number
  step?: number | 'any'
  maxLength?: number
}) {
  const variant = useFieldVariant()
  return (
    <TextField
      variant={variant}
      className={`app-field ${className}`}
      isRequired={required}
      isInvalid={!!error}
      isReadOnly={readOnly}
      isDisabled={isDisabled}
    >
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        type={type}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
      />
      {description && <span className="description field-description">{description}</span>}
      {error && <FieldError>{error}</FieldError>}
    </TextField>
  )
}

export function SelectButton({
  value,
  onChange,
  options,
  label,
  className = '',
  isDisabled = false,
}: {
  value: string
  onChange: (value: string) => void
  options: { id: string; label: string; icon?: ReactNode }[]
  label: string
  className?: string
  isDisabled?: boolean
}) {
  const current = options.find((option) => option.id === value)
  const variant = useFieldVariant()
  return (
    <div className={`select select--${variant} select-surface`}>
      <Dropdown>
        <Dropdown.Trigger
          className={`select__trigger select-button ${className}`}
          aria-label={label}
          isDisabled={isDisabled}
        >
          {current?.icon}
          <span className="select__value">{current?.label ?? label}</span>
          <ChevronDown size={16} className="select__indicator" aria-hidden="true" />
        </Dropdown.Trigger>
        <Dropdown.Popover className="app-dropdown">
          <Dropdown.Menu
            aria-label={label}
            selectionMode="single"
            selectedKeys={new Set([value])}
            onAction={(key) => onChange(String(key))}
          >
            {options.map((option) => (
              <Dropdown.Item id={option.id} key={option.id} textValue={option.label}>
                {option.icon}
                <Label>{option.label}</Label>
                {value === option.id && <Check size={14} className="menu-check" />}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  )
}

export function IconButton({
  label,
  children,
  onPress,
  className = '',
}: {
  label: string
  children: ReactNode
  onPress?: () => void
  className?: string
}) {
  return (
    <Tooltip delay={450}>
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        aria-label={label}
        onPress={onPress}
        className={`icon-button ${className}`}
      >
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
  drawer = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  drawer?: boolean
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      variant="blur"
      className="app-backdrop"
    >
      <Modal.Container
        className={`${drawer ? 'app-modal-container--drawer' : ''}`}
        size={wide || drawer ? 'lg' : 'md'}
        scroll="inside"
      >
        <Modal.Dialog
          className={`app-dialog ${drawer ? 'app-dialog--drawer' : wide ? 'app-dialog--wide' : ''}`}
        >
          <Modal.Header className="dialog-header">
            <div>
              <Modal.Heading>{title}</Modal.Heading>
              {description && <p className="dialog-description">{description}</p>}
            </div>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              aria-label="Pencereyi kapat"
              onPress={onClose}
            >
              <X size={19} />
            </Button>
          </Modal.Header>
          <Modal.Body className="dialog-body">{children}</Modal.Body>
          {footer && <Modal.Footer className="dialog-footer">{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

export function SectionTitle({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Ara...',
  label = 'Kayıtlarda ara',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}) {
  const variant = useFieldVariant()
  return (
    <SearchField
      aria-label={label}
      className="list-search"
      variant={variant}
      value={value}
      onChange={onChange}
      fullWidth
    >
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder={placeholder} />
        <SearchField.ClearButton aria-label="Aramayı temizle" />
      </SearchField.Group>
    </SearchField>
  )
}

export function FilterTabs({
  value,
  onChange,
  items,
  label = 'Kayıt durumu',
}: {
  value: string
  onChange: (value: string) => void
  items: { id: string; label: string; count?: number }[]
  label?: string
}) {
  return (
    <div className="filter-tabs" role="group" aria-label={label}>
      {items.map((item) => (
        <Button
          key={item.id}
          variant={value === item.id ? 'secondary' : 'ghost'}
          aria-pressed={value === item.id}
          className={`filter-tab ${value === item.id ? 'is-active' : ''}`}
          onPress={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && <span className="filter-tab-count">{item.count}</span>}
        </Button>
      ))}
    </div>
  )
}

export function MoneyField({
  label,
  initialValue,
  onChange,
  description,
  isDisabled = false,
  netTaxRate,
}: {
  label: string
  initialValue: number
  onChange: (value: number) => void
  description?: string
  isDisabled?: boolean
  netTaxRate?: number
}) {
  const [text, setText] = useState(
    ((netTaxRate === undefined ? initialValue : exclusivePrice(initialValue, netTaxRate)) / 100)
      .toFixed(2)
      .replace('.', ','),
  )
  const invalid = !Number.isFinite(parseMoney(text))
  return (
    <Field
      label={label}
      value={text}
      onChange={(value) => {
        setText(value)
        const amount = parseMoney(value)
        onChange(netTaxRate === undefined ? amount : inclusivePrice(amount, netTaxRate))
      }}
      error={invalid ? 'Örn. 149,90 biçiminde geçerli bir tutar girin.' : undefined}
      description={description}
      isDisabled={isDisabled}
    />
  )
}
