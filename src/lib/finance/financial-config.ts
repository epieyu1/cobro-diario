// Estas constantes de lectura no deben arrastrar el contrato financiero completo
// ni la dependencia de Decimal al primer render del shell.
// Fuente de verdad: calculo y validacion siguen viviendo en `money.ts` y `payment-contract.ts`.
export const MONEY_DECIMAL_SCALE = 2 as const

export const FINANCIAL_BASELINE = {
  currencyCode: 'COP',
  decimalScale: MONEY_DECIMAL_SCALE,
  roundingMode: 'HALF_UP',
  businessTimezone: 'America/Bogota',
} as const

// Estos requisitos son texto operativo visible. Si cambian, deben seguir alineados
// con el contrato de negocio, pero no requieren cargar toda la logica financiera.
export const PAYMENT_OPERATIONAL_REQUIREMENTS = {
  deviceLocalId: 'required',
  paidAt: 'required',
  applications: 'required',
  collectorScope: 'required',
  deviceId: 'recommended',
  gps: 'capture_if_available',
  route: 'deferred',
  paymentReference: 'optional',
  receipt: 'remote_confirmed_after_sync',
} as const
