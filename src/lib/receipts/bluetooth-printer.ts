import type { BluetoothReceiptStrategy } from '@/lib/receipts/receipt-types.ts'

// BR-3 solo debe dejar una decision explícita de impresión, no un adapter falso.
// Se documenta Web Bluetooth como candidato a validar en smoke manual con hardware
// soportado antes de comprometer una integración de producción.
export function evaluateBluetoothReceiptStrategy(): BluetoothReceiptStrategy {
  return {
    deliveryTarget: 'web_bluetooth',
    key: 'deferred_web_bluetooth',
    nextGate: 'manual_smoke_with_supported_printer',
    status: 'deferred',
    summary:
      'La integración Bluetooth queda preparada a nivel de decisión: el siguiente gate debe validar Web Bluetooth con una impresora real soportada antes de escribir el adapter definitivo.',
  }
}
