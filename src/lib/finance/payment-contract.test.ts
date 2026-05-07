import { describe, expect, it } from 'vitest'
import {
  allocateInstallmentPayment,
  APPLICATION_COMPONENT_ORDER,
  derivePaymentTotal,
  normalizePaymentApplications,
  PAYMENT_OPERATIONAL_REQUIREMENTS,
  PORTFOLIO_SEGMENTATION_POLICY,
} from '@/lib/finance/payment-contract.ts'

describe('payment contract', () => {
  it('keeps the V1 product contract visible for future maintainers', () => {
    expect(APPLICATION_COMPONENT_ORDER).toEqual([
      'fee_component',
      'interest_component',
      'principal_component',
    ])
    expect(PORTFOLIO_SEGMENTATION_POLICY).toEqual({
      loanScope: 'single_portfolio',
      investorSplit: 'deferred',
    })
    expect(PAYMENT_OPERATIONAL_REQUIREMENTS).toMatchObject({
      deviceLocalId: 'required',
      paidAt: 'required',
      applications: 'required',
      gps: 'capture_if_available',
    })
  })

  it('rejects duplicate installments in the same payment', () => {
    expect(() =>
      normalizePaymentApplications([
        {
          installmentId: 'installment-1',
          appliedAmount: '10',
          principalComponent: '10',
        },
        {
          installmentId: 'installment-1',
          appliedAmount: '5',
          principalComponent: '5',
        },
      ]),
    ).toThrowError('duplicate_installment_application')
  })

  it('rejects negative components', () => {
    expect(() =>
      normalizePaymentApplications([
        {
          installmentId: 'installment-1',
          appliedAmount: '10',
          principalComponent: '-1',
          interestComponent: '11',
        },
      ]),
    ).toThrowError('negative_component_not_allowed')
  })

  it('rejects applications whose components do not match the applied amount', () => {
    expect(() =>
      normalizePaymentApplications([
        {
          installmentId: 'installment-1',
          appliedAmount: '10',
          principalComponent: '4',
          interestComponent: '4',
          feeComponent: '1',
        },
      ]),
    ).toThrowError('application_components_mismatch')
  })

  it('derives the remote total from normalized applications', () => {
    expect(
      derivePaymentTotal([
        {
          installmentId: 'installment-1',
          appliedAmount: '10',
          principalComponent: '10',
        },
        {
          installmentId: 'installment-2',
          appliedAmount: '5.5',
          interestComponent: '5.5',
        },
      ]),
    ).toBe('15.50')
  })

  it('allocates fee before interest and principal inside an installment', () => {
    expect(
      allocateInstallmentPayment('20', {
        feeAmount: '8',
        interestAmount: '12',
        principalAmount: '30',
      }),
    ).toEqual({
      feeComponent: '8.00',
      interestComponent: '12.00',
      principalComponent: '0.00',
      appliedAmount: '20.00',
    })
  })

  it('rejects an installment payment that exceeds component balances', () => {
    expect(() =>
      allocateInstallmentPayment('51', {
        feeAmount: '8',
        interestAmount: '12',
        principalAmount: '30',
      }),
    ).toThrowError('application_exceeds_component_balance')
  })

  it('rejects negative component balances coming from an invalid caller state', () => {
    expect(() =>
      allocateInstallmentPayment('10', {
        feeAmount: '-1',
        interestAmount: '5',
        principalAmount: '6',
      }),
    ).toThrowError('installment_component_balance_invalid')
  })
})
