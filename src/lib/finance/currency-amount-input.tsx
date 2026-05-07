import { type ComponentPropsWithoutRef, useState } from 'react'
import { formatCurrencyInputDisplay, normalizeCurrencyInput } from '@/lib/finance/money.ts'

type CurrencyAmountInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'value' | 'onChange'> & {
  locale?: string
  onValueChange: (value: string) => void
  value: string
}

export function CurrencyAmountInput({
  className,
  locale = 'es-CO',
  onBlur,
  onValueChange,
  value,
  ...inputProps
}: CurrencyAmountInputProps) {
  const [draftDisplayValue, setDraftDisplayValue] = useState<string | null>(null)
  const displayValue = draftDisplayValue ?? formatCurrencyInputDisplay(value, locale)

  function handleChange(nextRawValue: string) {
    const normalized = normalizeCurrencyInput(nextRawValue, locale)

    setDraftDisplayValue(normalized.display)
    onValueChange(normalized.canonical)
  }

  return (
    <input
      {...inputProps}
      className={className}
      type="text"
      value={displayValue}
      onBlur={(event) => {
        handleChange(event.target.value)
        setDraftDisplayValue(null)
        onBlur?.(event)
      }}
      onChange={(event) => handleChange(event.target.value)}
    />
  )
}
