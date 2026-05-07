import type { SupabaseClient } from '@supabase/supabase-js'
import { mapConfirmedPaymentReceiptResponse } from '@/lib/receipts/receipt-mapper.ts'
import type { ConfirmedPaymentReceipt } from '@/lib/receipts/receipt-types.ts'

export type PaymentReceiptTransport = {
  getPaymentReceipt(paymentId: string): Promise<ConfirmedPaymentReceipt>
}

function normalizePaymentId(paymentId: string) {
  const normalizedValue = paymentId.trim()

  if (!normalizedValue) {
    throw new Error('payment_id_required')
  }

  return normalizedValue
}

// Intencion: encapsular el read path oficial del comprobante remoto.
// Flujo: remotePaymentId confirmado -> RPC protegido por RLS -> mapper estricto -> UI.
// Riesgo: si se consulta `payments` directo desde la UI, se pierde el contrato estable
// del comprobante y cada pantalla podria reinterpretar el recibo de forma distinta.
export function createSupabaseReceiptTransport(
  supabaseClient: SupabaseClient,
): PaymentReceiptTransport {
  return {
    async getPaymentReceipt(paymentId) {
      const normalizedPaymentId = normalizePaymentId(paymentId)
      const { data, error } = await supabaseClient.rpc('get_payment_receipt', {
        p_payment_id: normalizedPaymentId,
      })

      if (error) {
        throw new Error(error.message)
      }

      return mapConfirmedPaymentReceiptResponse(data)
    },
  }
}
