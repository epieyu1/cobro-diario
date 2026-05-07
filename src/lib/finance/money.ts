import Decimal from 'decimal.js'
import { MONEY_DECIMAL_SCALE } from '@/lib/finance/financial-config.ts'

// Todo valor monetario nuevo debe pasar por este helper para mantener el mismo redondeo.
// Cambiar esta regla impacta calculo financiero y requiere documentacion adicional.
export { MONEY_DECIMAL_SCALE } from '@/lib/finance/financial-config.ts'
export const MONEY_ROUNDING_MODE = Decimal.ROUND_HALF_UP

type FormatCurrencyOptions = {
  currencyDisplay?: 'code' | 'symbol'
  trimTrailingZeroCents?: boolean
}

type NormalizedCurrencyInput = {
  canonical: string
  display: string
}

export function toMoney(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(MONEY_DECIMAL_SCALE, MONEY_ROUNDING_MODE)
}

export function sumMoney(values: Decimal.Value[]) {
  // Sumamos con Decimal y normalizamos al final para no depender del orden de operaciones
  // ni mezclar precision binaria del navegador en flujos financieros.
  return toMoney(
    values.reduce<Decimal>((accumulator, currentValue) => accumulator.plus(currentValue), new Decimal(0)),
  )
}

export function formatCurrency(
  value: Decimal.Value,
  currency = 'COP',
  locale = 'es-CO',
  options: FormatCurrencyOptions = {},
) {
  // El formateo visual no reemplaza la precision de almacenamiento.
  // Persistencia y calculo deben seguir usando Decimal/numeric.
  // El codigo visible se normaliza a mayusculas porque `Intl` trata `cop` como
  // simbolo `$` bajo `es-CO`; si no lo corregimos, la cartera puede mezclar
  // `COP` y `$` segun como venga el dato desde cache o transporte remoto.
  // COP se muestra como codigo para evitar el simbolo `$`, que en Colombia
  // es ambiguo para contexto financiero formal. Otras monedas conservan simbolo
  // salvo override explicito para no degradar lecturas internacionales existentes.
  const normalizedValue = toMoney(value)
  currency = currency.toUpperCase()
  const hasMinorUnits = !normalizedValue.mod(1).eq(0)
  const shouldTrimTrailingZeroCents = options.trimTrailingZeroCents ?? currency === 'COP'
  const currencyDisplay = options.currencyDisplay ?? (currency === 'COP' ? 'code' : 'symbol')
  const visibleFractionDigits = shouldTrimTrailingZeroCents && !hasMinorUnits ? 0 : MONEY_DECIMAL_SCALE

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay,
    minimumFractionDigits: visibleFractionDigits,
    maximumFractionDigits: visibleFractionDigits,
  }).format(normalizedValue.toNumber())
}

export function formatCurrencyInputDisplay(
  value: string,
  locale = 'es-CO',
) {
  const normalized = normalizeCurrencyInput(value, locale)

  if (!normalized.canonical) {
    return ''
  }

  if (normalized.canonical.endsWith('.00')) {
    return normalized.display.slice(0, -3)
  }

  return normalized.display
}

export function normalizeCurrencyInput(
  rawValue: string,
  locale = 'es-CO',
): NormalizedCurrencyInput {
  const sanitizedValue = rawValue.replace(/[^\d,.\s]/g, '').replace(/\s+/g, '')

  if (!sanitizedValue) {
    return {
      canonical: '',
      display: '',
    }
  }

  const separators = resolveLocaleNumberSeparators(locale)
  const decimalMarker = resolveInputDecimalMarker(sanitizedValue, separators.decimal)
  const hasTrailingDecimalMarker = decimalMarker ? sanitizedValue.endsWith(decimalMarker) : false
  let integerDigits = sanitizedValue
  let fractionalDigits = ''

  if (decimalMarker) {
    const decimalIndex = sanitizedValue.lastIndexOf(decimalMarker)
    integerDigits = sanitizedValue.slice(0, decimalIndex)
    fractionalDigits = sanitizedValue
      .slice(decimalIndex + 1)
      .replace(/\D/g, '')
      .slice(0, MONEY_DECIMAL_SCALE)
  }

  integerDigits = integerDigits.replace(/\D/g, '')
  integerDigits = integerDigits.replace(/^0+(?=\d)/, '')

  const normalizedIntegerDigits = integerDigits || (fractionalDigits ? '0' : '')
  const groupedIntegerDigits = normalizedIntegerDigits
    ? normalizedIntegerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, separators.group)
    : ''

  return {
    canonical: fractionalDigits
      ? `${normalizedIntegerDigits || '0'}.${fractionalDigits}`
      : normalizedIntegerDigits,
    display: hasTrailingDecimalMarker
      ? `${groupedIntegerDigits || '0'}${separators.decimal}`
      : fractionalDigits
        ? `${groupedIntegerDigits || '0'}${separators.decimal}${fractionalDigits}`
        : groupedIntegerDigits,
  }
}

function resolveLocaleNumberSeparators(locale: string) {
  const formatParts = new Intl.NumberFormat(locale).formatToParts(1000.5)
  const decimal = formatParts.find((part) => part.type === 'decimal')?.value ?? ','
  const group = formatParts.find((part) => part.type === 'group')?.value ?? '.'

  return {
    decimal,
    group,
  }
}

function resolveInputDecimalMarker(value: string, localeDecimalMarker: string) {
  const lastCommaIndex = value.lastIndexOf(',')
  const lastDotIndex = value.lastIndexOf('.')

  if (lastCommaIndex >= 0 && lastDotIndex >= 0) {
    return lastCommaIndex > lastDotIndex ? ',' : '.'
  }

  if (lastCommaIndex >= 0) {
    return shouldTreatSingleSeparatorAsDecimal(value, lastCommaIndex, localeDecimalMarker) ? ',' : null
  }

  if (lastDotIndex >= 0) {
    return shouldTreatSingleSeparatorAsDecimal(value, lastDotIndex, localeDecimalMarker) ? '.' : null
  }

  return null
}

function shouldTreatSingleSeparatorAsDecimal(
  value: string,
  separatorIndex: number,
  localeDecimalMarker: string,
) {
  const separator = value[separatorIndex]
  const digitsAfterSeparator = value.slice(separatorIndex + 1).replace(/\D/g, '').length
  const sameSeparatorCount = separator ? value.split(separator).length - 1 : 0

  if (!separator) {
    return false
  }

  if (digitsAfterSeparator === 0) {
    return sameSeparatorCount === 1 && separator === localeDecimalMarker
  }

  if (sameSeparatorCount > 1) {
    return digitsAfterSeparator <= MONEY_DECIMAL_SCALE
  }

  return digitsAfterSeparator <= MONEY_DECIMAL_SCALE
}
