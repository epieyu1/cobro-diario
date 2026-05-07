import { describe, expect, it } from 'vitest'
import {
  deriveDirectedPaymentTotal,
  DIRECTED_PAYMENT_MODES,
  FINANCIAL_V2_COMPATIBILITY_CHECKLIST,
  normalizeDirectedPaymentApplications,
} from '@/lib/finance/payment-contract-v2.ts'

describe('payment contract v2', () => {
  it('keeps the directed-payment contract visible for future maintainers', () => {
    expect(DIRECTED_PAYMENT_MODES).toEqual(['principal_only', 'interest_only'])
    expect(FINANCIAL_V2_COMPATIBILITY_CHECKLIST).toContain(
      'principal_only solo permite principalComponent > 0 con interestComponent y feeComponent en cero.',
    )
  })

  it('accepts principal-only applications that do not mix components', () => {
    expect(
      normalizeDirectedPaymentApplications('principal_only', [
        {
          installmentId: 'installment-1',
          appliedAmount: '12.5',
          principalComponent: '12.5',
        },
      ]),
    ).toEqual([
      {
        installmentId: 'installment-1',
        appliedAmount: '12.50',
        principalComponent: '12.50',
        interestComponent: '0.00',
        feeComponent: '0.00',
      },
    ])
  })

  it('rejects principal-only applications that try to mix interest or fee', () => {
    expect(() =>
      normalizeDirectedPaymentApplications('principal_only', [
        {
          installmentId: 'installment-1',
          appliedAmount: '10',
          principalComponent: '8',
          interestComponent: '2',
        },
      ]),
    ).toThrowError('payment_mode_component_violation')
  })

  it('rejects interest-only applications that try to mix principal or fee', () => {
    expect(() =>
      normalizeDirectedPaymentApplications('interest_only', [
        {
          installmentId: 'installment-1',
          appliedAmount: '10',
          interestComponent: '8',
          principalComponent: '2',
        },
      ]),
    ).toThrowError('payment_mode_component_violation')
  })

  it('derives the total from a valid interest-only payload', () => {
    expect(
      deriveDirectedPaymentTotal('interest_only', [
        {
          installmentId: 'installment-1',
          appliedAmount: '5',
          interestComponent: '5',
        },
        {
          installmentId: 'installment-2',
          appliedAmount: '4.5',
          interestComponent: '4.5',
        },
      ]),
    ).toBe('9.50')
  })
})
