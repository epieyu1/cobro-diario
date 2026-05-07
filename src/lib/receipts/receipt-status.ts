import type { LocalPayment } from '@/lib/db/local-db.ts'
import type { PaymentReceiptAvailability } from '@/lib/receipts/receipt-types.ts'

// Esta capa interpreta el estado local de sync sin reemplazar la verdad remota.
// Solo decide si el navegador ya puede pedir el comprobante confirmado o si debe
// seguir presentando el recibo optimista local con su divergencia explícita.
export function resolvePaymentReceiptAvailability(
  payment: LocalPayment,
): PaymentReceiptAvailability {
  if (payment.syncStatus === 'synced' && payment.remotePaymentId && payment.remotePaymentStatus === 'reversed') {
    return {
      canRequestConfirmedReceipt: true,
      key: 'reversed',
      label: 'Reversado por servidor',
      summary: 'El pago ya fue compensado en PostgreSQL y debe tratarse como reverso trazable, no como recaudo vigente.',
      tone: 'warning',
    }
  }

  if (payment.syncStatus === 'synced' && payment.remotePaymentId) {
    return {
      canRequestConfirmedReceipt: true,
      key: 'confirmed',
      label: 'Confirmado por servidor',
      summary: 'El pago ya tiene remotePaymentId y puede mostrar un comprobante autoritativo.',
      tone: 'success',
    }
  }

  if (payment.syncStatus === 'synced') {
    return {
      canRequestConfirmedReceipt: false,
      key: 'sync_incomplete',
      label: 'Sin confirmación remota',
      summary: 'La cola local marcó el cobro como sincronizado, pero falta el id remoto del recibo.',
      tone: 'warning',
    }
  }

  if (payment.syncStatus === 'processing') {
    return {
      canRequestConfirmedReceipt: false,
      key: 'local_processing',
      label: 'Enviando al servidor',
      summary: 'El cobro ya salió de la cola local, pero el comprobante confirmado aún no existe.',
      tone: 'pending',
    }
  }

  if (payment.syncStatus === 'failed') {
    return {
      canRequestConfirmedReceipt: false,
      key: 'local_failed',
      label: 'Falló la sincronización',
      summary: 'El pago sigue visible localmente, pero no debe tratarse como comprobante confirmado.',
      tone: 'danger',
    }
  }

  return {
    canRequestConfirmedReceipt: false,
    key: 'local_pending',
    label: 'Pendiente en cola local',
    summary: 'El pago se guardó offline y todavía no ha sido confirmado por PostgreSQL.',
    tone: 'pending',
  }
}
