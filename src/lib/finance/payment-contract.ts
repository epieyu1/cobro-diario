import type {
  InstallmentStatus,
  LoanStatus,
  PaymentApplicationDraft,
} from '@/types/domain.ts'
import {
  MONEY_DECIMAL_SCALE,
} from '@/lib/finance/financial-config.ts'
import { sumMoney, toMoney } from '@/lib/finance/money.ts'

export { FINANCIAL_BASELINE, PAYMENT_OPERATIONAL_REQUIREMENTS } from '@/lib/finance/financial-config.ts'

// V1 solo permite cobrar prestamos ya en operacion.
// Si aparece otro estado pagable, debe actualizarse el contrato financiero y record_payment.
export const PAYABLE_LOAN_STATUSES = ['active', 'delinquent'] as const satisfies readonly LoanStatus[]

// Una cuota ya pagada o cancelada no debe volver a recibir aplicaciones.
export const NON_PAYABLE_INSTALLMENT_STATUSES = ['paid', 'canceled'] as const satisfies readonly InstallmentStatus[]

// V1 modela interes simple materializado en la cuota.
// Interes compuesto queda fuera del alcance operativo de record_payment hasta una fase posterior.
export const INTEREST_MODEL = 'simple_precomputed' as const

// El orden de cobro por componente es contrato de negocio y no debe alterarse solo desde UI.
export const APPLICATION_COMPONENT_ORDER = ['fee_component', 'interest_component', 'principal_component'] as const

// V1 opera un prestamo dentro de una sola cartera operativa.
// Repartir un mismo cobro entre varios inversionistas o carteras queda fuera del contrato actual.
export const PORTFOLIO_SEGMENTATION_POLICY = {
  loanScope: 'single_portfolio',
  investorSplit: 'deferred',
} as const

// El frontend puede omitir paymentMethod, pero el contrato operativo debe converger a cash
// hasta que existan catalogos y reglas por medio de pago.
export const DEFAULT_PAYMENT_METHOD = 'cash' as const

// Esta lista alimenta la UI de bootstrap y sirve como contrato legible para futuros asistentes.
export const paymentContractChecklist = [
  'El total remoto se deriva de la suma de aplicaciones y no de un total libre enviado por UI.',
  'deviceLocalId es la llave de idempotencia para reintentos offline del mismo cobro.',
  'Cada cuota puede aparecer solo una vez por pago y su desglose ya debe venir materializado.',
  'V1 aplica por componente en este orden: fee, interest, principal.',
  'feeComponent agrupa temporalmente mora y otros cargos hasta tener un modelo financiero dedicado.',
  'El interes soportado en V1 es simple y ya materializado por cuota; compound queda fuera del RPC actual.',
  'V1 no divide un mismo cobro entre inversionistas; cada prestamo se procesa en una sola cartera operativa.',
  'GPS, ruta y recibo no bloquean la atomicidad del RPC actual; deviceLocalId, paidAt y applications si son obligatorios.',
  'Solo prestamos active o delinquent deben llegar al RPC; draft, settled, written_off y canceled quedan fuera.',
] as const

export type NormalizedPaymentApplication = {
  installmentId: string
  appliedAmount: string
  principalComponent: string
  interestComponent: string
  feeComponent: string
}

export type InstallmentComponentBalance = {
  feeAmount: string
  interestAmount: string
  principalAmount: string
}

function normalizeOptionalMoney(value: string | undefined) {
  return toMoney(value ?? 0)
}

// Esta validacion espejo no reemplaza la validacion del servidor.
// Existe para que futuras capas de formulario o sync fallen temprano antes de ir a Supabase.
export function normalizePaymentApplications(
  applications: PaymentApplicationDraft[],
): NormalizedPaymentApplication[] {
  if (applications.length === 0) {
    throw new Error('payment_requires_applications')
  }

  const seenInstallments = new Set<string>()

  return applications.map((application) => {
    const installmentId = application.installmentId.trim()

    if (!installmentId) {
      throw new Error('installment_id_required')
    }

    if (seenInstallments.has(installmentId)) {
      throw new Error('duplicate_installment_application')
    }

    seenInstallments.add(installmentId)

    const appliedAmount = toMoney(application.appliedAmount)
    const principalComponent = normalizeOptionalMoney(application.principalComponent)
    const interestComponent = normalizeOptionalMoney(application.interestComponent)
    const feeComponent = normalizeOptionalMoney(application.feeComponent)

    if (appliedAmount.lte(0)) {
      throw new Error('invalid_applied_amount')
    }

    if (principalComponent.lt(0) || interestComponent.lt(0) || feeComponent.lt(0)) {
      throw new Error('negative_component_not_allowed')
    }

    const componentTotal = sumMoney([principalComponent, interestComponent, feeComponent])

    if (!componentTotal.equals(appliedAmount)) {
      throw new Error('application_components_mismatch')
    }

    return {
      installmentId,
      appliedAmount: appliedAmount.toFixed(MONEY_DECIMAL_SCALE),
      principalComponent: principalComponent.toFixed(MONEY_DECIMAL_SCALE),
      interestComponent: interestComponent.toFixed(MONEY_DECIMAL_SCALE),
      feeComponent: feeComponent.toFixed(MONEY_DECIMAL_SCALE),
    }
  })
}

export function derivePaymentTotal(applications: PaymentApplicationDraft[]) {
  const normalizedApplications = normalizePaymentApplications(applications)

  return sumMoney(normalizedApplications.map((application) => application.appliedAmount)).toFixed(
    MONEY_DECIMAL_SCALE,
  )
}

export function isPayableLoanStatus(status: LoanStatus) {
  return PAYABLE_LOAN_STATUSES.includes(status as (typeof PAYABLE_LOAN_STATUSES)[number])
}

// Este helper expresa la regla de negocio V1 para repartir un abono dentro de una cuota.
// Sirve como referencia para frontend, sync y pruebas; el backend debe reflejar exactamente esta semantica.
export function allocateInstallmentPayment(
  requestedAmount: string,
  balance: InstallmentComponentBalance,
) {
  const feeAmount = toMoney(balance.feeAmount)
  const interestAmount = toMoney(balance.interestAmount)
  const principalAmount = toMoney(balance.principalAmount)
  let remainingAmount = toMoney(requestedAmount)

  if (remainingAmount.lte(0)) {
    throw new Error('invalid_applied_amount')
  }

  if (feeAmount.lt(0) || interestAmount.lt(0) || principalAmount.lt(0)) {
    throw new Error('installment_component_balance_invalid')
  }

  const feeComponent = decimalMin(remainingAmount, feeAmount)
  remainingAmount = remainingAmount.minus(feeComponent)

  const interestComponent = decimalMin(remainingAmount, interestAmount)
  remainingAmount = remainingAmount.minus(interestComponent)

  const principalComponent = decimalMin(remainingAmount, principalAmount)
  remainingAmount = remainingAmount.minus(principalComponent)

  if (remainingAmount.gt(0)) {
    throw new Error('application_exceeds_component_balance')
  }

  return {
    feeComponent: feeComponent.toFixed(MONEY_DECIMAL_SCALE),
    interestComponent: interestComponent.toFixed(MONEY_DECIMAL_SCALE),
    principalComponent: principalComponent.toFixed(MONEY_DECIMAL_SCALE),
    appliedAmount: sumMoney([feeComponent, interestComponent, principalComponent]).toFixed(
      MONEY_DECIMAL_SCALE,
    ),
  }
}

function decimalMin(leftValue: ReturnType<typeof toMoney>, rightValue: ReturnType<typeof toMoney>) {
  return leftValue.lessThan(rightValue) ? leftValue : rightValue
}
