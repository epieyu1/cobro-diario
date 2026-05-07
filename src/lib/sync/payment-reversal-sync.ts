import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CobroDiarioDb,
  localDb,
  type LocalPayment,
} from '@/lib/db/local-db.ts'
import {
  normalizePaymentReversalDraft,
  type PaymentReversalDraft,
} from '@/lib/finance/payment-reversal.ts'
import { mapConfirmedPaymentReceiptResponse } from '@/lib/receipts/receipt-mapper.ts'
import type { ConfirmedPaymentReceipt } from '@/lib/receipts/receipt-types.ts'

export type PaymentReversalTransport = {
  reversePayment(paymentReversal: PaymentReversalDraft): Promise<ConfirmedPaymentReceipt>
}

// Intencion: encapsular el write path remoto del reverso sin fingir cola offline.
// Flujo: UI admin online -> contrato normalizado -> RPC reverse_payment -> mapper estricto.
// Riesgo: si otro panel llama el RPC directo y parchea IndexedDB por su cuenta, el shell
// pierde consistencia entre recibo confirmado, cache local y bootstrap remoto posterior.
export function createSupabasePaymentReversalTransport(
  supabaseClient: SupabaseClient,
): PaymentReversalTransport {
  return {
    async reversePayment(paymentReversal) {
      const normalizedReversal = normalizePaymentReversalDraft(paymentReversal)
      const { data, error } = await supabaseClient.rpc('reverse_payment', {
        p_payment_id: normalizedReversal.paymentId,
        p_reversal_reason: normalizedReversal.reversalReason,
      })

      if (error) {
        throw new Error(error.message)
      }

      return mapConfirmedPaymentReceiptResponse(data)
    },
  }
}

export async function reconcileLocalPaymentReceipt(
  localPaymentId: string,
  confirmedReceipt: ConfirmedPaymentReceipt,
  options: {
    db?: CobroDiarioDb
    now?: () => string
  } = {},
) {
  const db = options.db ?? localDb
  const now = options.now ?? (() => new Date().toISOString())
  const currentPayment = await db.payments.get(localPaymentId)

  if (!currentPayment) {
    return null
  }

  const nextPayment: LocalPayment = {
    ...currentPayment,
    remotePaymentId: confirmedReceipt.paymentId,
    remotePaymentStatus: confirmedReceipt.status,
    syncErrorCode: undefined,
    syncErrorKind: undefined,
    syncErrorMessage: undefined,
    syncStatus: 'synced',
    updatedAt: now(),
  }

  await db.payments.put(nextPayment)
  return nextPayment
}
