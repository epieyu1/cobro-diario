import Decimal from 'decimal.js'

// Todo valor monetario nuevo debe pasar por este helper para mantener el mismo redondeo.
// Cambiar esta regla impacta calculo financiero y requiere documentacion adicional.
export function toMoney(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

export function sumMoney(values: Decimal.Value[]) {
  return values.reduce<Decimal>(
    (accumulator, currentValue) => accumulator.plus(currentValue),
    new Decimal(0),
  )
}

export function formatCurrency(
  value: Decimal.Value,
  currency = 'COP',
  locale = 'es-CO',
) {
  // El formateo visual no reemplaza la precision de almacenamiento.
  // Persistencia y calculo deben seguir usando Decimal/numeric.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toMoney(value).toNumber())
}
