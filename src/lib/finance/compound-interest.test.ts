import { describe, expect, it } from 'vitest'
import {
  buildCompoundFixedInstallmentSchedule,
  COMPOUND_INTEREST_MODE,
} from '@/lib/finance/compound-interest.ts'

describe('buildCompoundFixedInstallmentSchedule', () => {
  it('builds a fixed-installment compound schedule from the daily rate and real period gaps', () => {
    const schedule = buildCompoundFixedInstallmentSchedule({
      disbursementDate: '2026-01-01',
      firstDueDate: '2026-01-02',
      interestRateDaily: '0.10',
      paymentFrequency: 'daily',
      principalAmount: '100.00',
      totalInstallments: 2,
    })

    expect(schedule.interestMode).toBe(COMPOUND_INTEREST_MODE)
    expect(schedule.installmentAmount).toBe('57.62')
    expect(schedule.totalPrincipalAmount).toBe('100.00')
    expect(schedule.totalInterestAmount).toBe('15.24')
    expect(schedule.installments).toEqual([
      {
        installmentNumber: 1,
        dueDate: '2026-01-02',
        daysAccrued: 1,
        periodRate: '0.10000000',
        scheduledAmount: '57.62',
        principalAmount: '47.62',
        interestAmount: '10.00',
        feeAmount: '0.00',
        outstandingAmount: '57.62',
        status: 'pending',
      },
      {
        installmentNumber: 2,
        dueDate: '2026-01-03',
        daysAccrued: 1,
        periodRate: '0.10000000',
        scheduledAmount: '57.62',
        principalAmount: '52.38',
        interestAmount: '5.24',
        feeAmount: '0.00',
        outstandingAmount: '57.62',
        status: 'pending',
      },
    ])
  })

  it('collapses to straight-line principal when the daily rate is zero', () => {
    const schedule = buildCompoundFixedInstallmentSchedule({
      disbursementDate: '2026-01-01',
      firstDueDate: '2026-01-08',
      interestRateDaily: '0',
      paymentFrequency: 'weekly',
      principalAmount: '120.00',
      totalInstallments: 3,
    })

    expect(schedule.installmentAmount).toBe('40.00')
    expect(schedule.totalInterestAmount).toBe('0.00')
    expect(schedule.installments.map((installment) => installment.principalAmount)).toEqual([
      '40.00',
      '40.00',
      '40.00',
    ])
  })

  it('rejects a first due date before disbursement', () => {
    expect(() =>
      buildCompoundFixedInstallmentSchedule({
        disbursementDate: '2026-01-03',
        firstDueDate: '2026-01-02',
        interestRateDaily: '0.02',
        paymentFrequency: 'daily',
        principalAmount: '100.00',
        totalInstallments: 2,
      }),
    ).toThrowError('loan_first_due_date_before_disbursement')
  })
})
