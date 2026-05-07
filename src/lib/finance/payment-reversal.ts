import type { PaymentStatus } from '@/types/domain.ts'

export type PaymentReversalDraft = {
  paymentId: string
  reversalReason: string
}

export type NormalizedPaymentReversalDraft = {
  paymentId: string
  reversalReason: string
}

export type PaymentReversalAvailability = {
  canReverse: boolean
  key: 'already_reversed' | 'offline' | 'posted_ready' | 'role_not_allowed' | 'status_unknown'
  label: string
  summary: string
}

function normalizeRequiredText(value: string, code: string) {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    throw new Error(code)
  }

  return normalizedValue
}

// Intencion: congelar el contrato visible del reverso antes de tocar RPC o UI.
// Flujo: panel/transportes entregan id + motivo -> esta capa normaliza -> reverse_payment
// recibe un payload estable y trazable.
// Riesgo: si se vuelve opcional el motivo o se dispersa la validacion en cada pantalla,
// el reverso pierde auditabilidad y el frontend deja de converger con BR-5.
export function normalizePaymentReversalDraft(
  paymentReversal: PaymentReversalDraft,
): NormalizedPaymentReversalDraft {
  return {
    paymentId: normalizeRequiredText(paymentReversal.paymentId, 'payment_id_required'),
    reversalReason: normalizeRequiredText(paymentReversal.reversalReason, 'reversal_reason_required'),
  }
}

export function resolvePaymentReversalAvailability(options: {
  isAdmin: boolean
  isOnline: boolean
  paymentStatus?: PaymentStatus | null
}) {
  if (!options.isAdmin) {
    return {
      canReverse: false,
      key: 'role_not_allowed',
      label: 'Solo administrador',
      summary: 'El reverso operativo de BR-5 queda restringido a sesiones admin activas.',
    } satisfies PaymentReversalAvailability
  }

  if (!options.isOnline) {
    return {
      canReverse: false,
      key: 'offline',
      label: 'Requiere conexión',
      summary: 'El reverso es online-only porque PostgreSQL debe restaurar saldos en la misma transacción.',
    } satisfies PaymentReversalAvailability
  }

  if (options.paymentStatus === 'reversed') {
    return {
      canReverse: false,
      key: 'already_reversed',
      label: 'Ya reversado',
      summary: 'El pago ya fue compensado por servidor y no debe volver a mutarse desde la UI.',
    } satisfies PaymentReversalAvailability
  }

  if (options.paymentStatus === 'posted') {
    return {
      canReverse: true,
      key: 'posted_ready',
      label: 'Reverso disponible',
      summary: 'El pago sigue confirmado y puede restaurar saldos de inmediato bajo el RPC admin.',
    } satisfies PaymentReversalAvailability
  }

  return {
    canReverse: false,
    key: 'status_unknown',
    label: 'Estado no reversible',
    summary: 'La UI solo debe exponer reverso sobre un comprobante remoto confirmado con estado conocido.',
  } satisfies PaymentReversalAvailability
}
