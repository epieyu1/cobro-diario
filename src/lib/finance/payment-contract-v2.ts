import {
  derivePaymentTotal,
  normalizePaymentApplications,
  type NormalizedPaymentApplication,
} from '@/lib/finance/payment-contract.ts'
import type { PaymentApplicationDraft } from '@/types/domain.ts'

export const DIRECTED_PAYMENT_MODES = ['principal_only', 'interest_only'] as const

export type DirectedPaymentMode = (typeof DIRECTED_PAYMENT_MODES)[number]

export const FINANCIAL_V2_COMPATIBILITY_CHECKLIST = [
  'V2 no reemplaza V1 por inferencia; el modo del prestamo y el modo del abono deben declararse explicitamente.',
  'principal_only solo permite principalComponent > 0 con interestComponent y feeComponent en cero.',
  'interest_only solo permite interestComponent > 0 con principalComponent y feeComponent en cero.',
  'Mientras PostgreSQL no persista saldo pendiente por componente como fuente remota de verdad, V2 no debe habilitarse en RPC productivo.',
] as const

// Intencion: congelar las reglas de compatibilidad del payload V2 antes de tocar RPC o UI.
// Flujo: formulario o planner V2 -> normalizacion base V1 -> validacion del modo dirigido -> payload estable.
// Riesgo: si se mezclan componentes incompatibles en un pago dirigido, el frontend podria mentir sobre el modo real del abono.
export function normalizeDirectedPaymentApplications(
  paymentMode: DirectedPaymentMode,
  applications: PaymentApplicationDraft[],
): NormalizedPaymentApplication[] {
  const normalizedApplications = normalizePaymentApplications(applications)

  return normalizedApplications.map((application) => {
    switch (paymentMode) {
      case 'principal_only':
        if (
          application.principalComponent === '0.00'
          || application.interestComponent !== '0.00'
          || application.feeComponent !== '0.00'
        ) {
          throw new Error('payment_mode_component_violation')
        }
        return application
      case 'interest_only':
        if (
          application.interestComponent === '0.00'
          || application.principalComponent !== '0.00'
          || application.feeComponent !== '0.00'
        ) {
          throw new Error('payment_mode_component_violation')
        }
        return application
    }
  })
}

export function deriveDirectedPaymentTotal(
  paymentMode: DirectedPaymentMode,
  applications: PaymentApplicationDraft[],
) {
  normalizeDirectedPaymentApplications(paymentMode, applications)

  return derivePaymentTotal(applications)
}
