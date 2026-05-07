import { describe, expect, it } from 'vitest'
import { evaluateBluetoothReceiptStrategy } from '@/lib/receipts/bluetooth-printer.ts'

describe('evaluateBluetoothReceiptStrategy', () => {
  it('documents Bluetooth as a deferred Web Bluetooth validation gate', () => {
    expect(evaluateBluetoothReceiptStrategy()).toEqual({
      deliveryTarget: 'web_bluetooth',
      key: 'deferred_web_bluetooth',
      nextGate: 'manual_smoke_with_supported_printer',
      status: 'deferred',
      summary:
        'La integración Bluetooth queda preparada a nivel de decisión: el siguiente gate debe validar Web Bluetooth con una impresora real soportada antes de escribir el adapter definitivo.',
    })
  })
})
