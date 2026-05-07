import { describe, expect, it } from 'vitest'
import { buildDirectedPaymentApplications } from '@/lib/finance/payment-planning-v2.ts'

describe('buildDirectedPaymentApplications', () => {
  const installments = [
    {
      id: 'installment-1',
      dueDate: '2026-05-01',
      installmentNumber: 1,
      outstandingAmount: '15.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '5.00',
      outstandingPrincipalAmount: '10.00',
      status: 'pending' as const,
    },
    {
      id: 'installment-2',
      dueDate: '2026-05-02',
      installmentNumber: 2,
      outstandingAmount: '28.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '8.00',
      outstandingPrincipalAmount: '20.00',
      status: 'pending' as const,
    },
  ]

  it('allocates principal_only oldest-first over principal balances only', () => {
    expect(buildDirectedPaymentApplications('principal_only', '12.00', installments)).toEqual([
      {
        installmentId: 'installment-1',
        appliedAmount: '10.00',
        feeComponent: '0.00',
        interestComponent: '0.00',
        principalComponent: '10.00',
      },
      {
        installmentId: 'installment-2',
        appliedAmount: '2.00',
        feeComponent: '0.00',
        interestComponent: '0.00',
        principalComponent: '2.00',
      },
    ])
  })

  it('allocates interest_only oldest-first over interest balances only', () => {
    expect(buildDirectedPaymentApplications('interest_only', '7.00', installments)).toEqual([
      {
        installmentId: 'installment-1',
        appliedAmount: '5.00',
        feeComponent: '0.00',
        interestComponent: '5.00',
        principalComponent: '0.00',
      },
      {
        installmentId: 'installment-2',
        appliedAmount: '2.00',
        feeComponent: '0.00',
        interestComponent: '2.00',
        principalComponent: '0.00',
      },
    ])
  })

  it('rejects a directed payment above the target component outstanding total', () => {
    expect(() =>
      buildDirectedPaymentApplications('interest_only', '20.00', installments),
    ).toThrowError('payment_amount_exceeds_target_component_outstanding')
  })
})
