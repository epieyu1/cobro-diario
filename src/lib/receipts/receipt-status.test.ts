import { describe, expect, it } from 'vitest'
import { resolvePaymentReceiptAvailability } from '@/lib/receipts/receipt-status.ts'
import type { LocalPayment } from '@/lib/db/local-db.ts'

function buildPayment(overrides: Partial<LocalPayment>): LocalPayment {
  return {
    collectorId: 'collector-1',
    customerId: 'customer-1',
    deviceLocalId: 'device-local-1',
    id: 'payment-local-1',
    loanId: 'loan-1',
    paidAt: '2026-05-06T13:00:00.000Z',
    paymentMethod: 'cash',
    syncStatus: 'pending',
    totalAmount: '70.00',
    updatedAt: '2026-05-06T13:00:00.000Z',
    ...overrides,
  }
}

describe('resolvePaymentReceiptAvailability', () => {
  it('recognizes a confirmed receipt when sync already returned remotePaymentId', () => {
    expect(
      resolvePaymentReceiptAvailability(
        buildPayment({
          remotePaymentStatus: 'posted',
          remotePaymentId: 'remote-payment-1',
          syncStatus: 'synced',
        }),
      ),
    ).toMatchObject({
      canRequestConfirmedReceipt: true,
      key: 'confirmed',
      tone: 'success',
    })
  })

  it('marks a reversed confirmed receipt explicitly', () => {
    expect(
      resolvePaymentReceiptAvailability(
        buildPayment({
          remotePaymentId: 'remote-payment-1',
          remotePaymentStatus: 'reversed',
          syncStatus: 'synced',
        }),
      ),
    ).toMatchObject({
      canRequestConfirmedReceipt: true,
      key: 'reversed',
      tone: 'warning',
    })
  })

  it('marks a synced payment without remotePaymentId as incomplete', () => {
    expect(
      resolvePaymentReceiptAvailability(
        buildPayment({
          syncStatus: 'synced',
        }),
      ),
    ).toMatchObject({
      canRequestConfirmedReceipt: false,
      key: 'sync_incomplete',
      tone: 'warning',
    })
  })

  it('keeps failed local receipts explicitly non-authoritative', () => {
    expect(
      resolvePaymentReceiptAvailability(
        buildPayment({
          syncErrorMessage: 'network_timeout_after_commit',
          syncStatus: 'failed',
        }),
      ),
    ).toMatchObject({
      canRequestConfirmedReceipt: false,
      key: 'local_failed',
      tone: 'danger',
    })
  })
})
