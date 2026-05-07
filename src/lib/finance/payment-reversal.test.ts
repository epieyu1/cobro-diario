import { describe, expect, it } from 'vitest'
import {
  normalizePaymentReversalDraft,
  resolvePaymentReversalAvailability,
} from '@/lib/finance/payment-reversal.ts'

describe('payment reversal contract', () => {
  it('requires payment id and non-empty reason', () => {
    expect(() =>
      normalizePaymentReversalDraft({
        paymentId: '   ',
        reversalReason: 'Duplicado de caja',
      }),
    ).toThrow('payment_id_required')

    expect(() =>
      normalizePaymentReversalDraft({
        paymentId: 'payment-1',
        reversalReason: '   ',
      }),
    ).toThrow('reversal_reason_required')
  })

  it('normalizes the visible reversal payload', () => {
    expect(
      normalizePaymentReversalDraft({
        paymentId: ' payment-1 ',
        reversalReason: ' Cobro duplicado ',
      }),
    ).toEqual({
      paymentId: 'payment-1',
      reversalReason: 'Cobro duplicado',
    })
  })

  it('blocks reversal outside admin online posted state', () => {
    expect(
      resolvePaymentReversalAvailability({
        isAdmin: false,
        isOnline: true,
        paymentStatus: 'posted',
      }),
    ).toMatchObject({
      canReverse: false,
      key: 'role_not_allowed',
    })

    expect(
      resolvePaymentReversalAvailability({
        isAdmin: true,
        isOnline: false,
        paymentStatus: 'posted',
      }),
    ).toMatchObject({
      canReverse: false,
      key: 'offline',
    })

    expect(
      resolvePaymentReversalAvailability({
        isAdmin: true,
        isOnline: true,
        paymentStatus: 'reversed',
      }),
    ).toMatchObject({
      canReverse: false,
      key: 'already_reversed',
    })
  })

  it('marks a posted confirmed payment as reversible for admin online', () => {
    expect(
      resolvePaymentReversalAvailability({
        isAdmin: true,
        isOnline: true,
        paymentStatus: 'posted',
      }),
    ).toMatchObject({
      canReverse: true,
      key: 'posted_ready',
    })
  })
})
