import { describe, expect, it } from 'vitest'
import {
  buildOldestFirstPaymentApplications,
  deriveOutstandingInstallmentComponents,
} from '@/lib/finance/payment-planning.ts'

describe('deriveOutstandingInstallmentComponents', () => {
  it('reconstructs component balances from the outstanding total', () => {
    expect(
      deriveOutstandingInstallmentComponents({
        feeAmount: '10.00',
        interestAmount: '20.00',
        outstandingAmount: '85.00',
        principalAmount: '70.00',
      }),
    ).toEqual({
      feeAmount: '0.00',
      interestAmount: '15.00',
      principalAmount: '70.00',
    })
  })

  it('rejects an installment with outstanding amount above the scheduled total', () => {
    expect(() =>
      deriveOutstandingInstallmentComponents({
        feeAmount: '10.00',
        interestAmount: '20.00',
        outstandingAmount: '110.00',
        principalAmount: '70.00',
      }),
    ).toThrowError('installment_outstanding_amount_invalid')
  })
})

describe('buildOldestFirstPaymentApplications', () => {
  const installments = [
    {
      dueDate: '2026-05-01',
      feeAmount: '5.00',
      id: 'installment-1',
      installmentNumber: 1,
      interestAmount: '10.00',
      outstandingAmount: '30.00',
      principalAmount: '15.00',
      status: 'pending' as const,
    },
    {
      dueDate: '2026-05-02',
      feeAmount: '0.00',
      id: 'installment-2',
      installmentNumber: 2,
      interestAmount: '8.00',
      outstandingAmount: '20.00',
      principalAmount: '12.00',
      status: 'pending' as const,
    },
  ]

  it('allocates a partial payment inside the oldest installment first', () => {
    expect(buildOldestFirstPaymentApplications('12.00', installments)).toEqual([
      {
        installmentId: 'installment-1',
        appliedAmount: '12.00',
        feeComponent: '5.00',
        interestComponent: '7.00',
        principalComponent: '0.00',
      },
    ])
  })

  it('spills over to the next installment only after settling the previous one', () => {
    expect(buildOldestFirstPaymentApplications('40.00', installments)).toEqual([
      {
        installmentId: 'installment-1',
        appliedAmount: '30.00',
        feeComponent: '5.00',
        interestComponent: '10.00',
        principalComponent: '15.00',
      },
      {
        installmentId: 'installment-2',
        appliedAmount: '10.00',
        feeComponent: '0.00',
        interestComponent: '8.00',
        principalComponent: '2.00',
      },
    ])
  })

  it('rejects a requested amount above the loan outstanding total', () => {
    expect(() => buildOldestFirstPaymentApplications('100.00', installments)).toThrowError(
      'payment_amount_exceeds_loan_outstanding',
    )
  })
})
