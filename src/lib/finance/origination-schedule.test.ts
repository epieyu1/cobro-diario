import { describe, expect, it } from 'vitest'

import {
  buildOriginationSchedule,
  serializeOriginationScheduleForRpc,
} from '@/lib/finance/origination-schedule.ts'

describe('buildOriginationSchedule', () => {
  it('builds a daily schedule and splits simple_precomputed interest deterministically', () => {
    const schedule = buildOriginationSchedule({
      principalAmount: '270',
      installmentAmount: '100',
      totalInstallments: 3,
      paymentFrequency: 'daily',
      disbursementDate: '2026-05-06',
      firstDueDate: '2026-05-07',
    })

    expect(schedule.totalScheduledAmount).toBe('300.00')
    expect(schedule.totalInterestAmount).toBe('30.00')
    expect(schedule.installments).toEqual([
      {
        installmentNumber: 1,
        dueDate: '2026-05-07',
        scheduledAmount: '100.00',
        principalAmount: '90.00',
        interestAmount: '10.00',
        feeAmount: '0.00',
        outstandingPrincipalAmount: '90.00',
        outstandingInterestAmount: '10.00',
        outstandingFeeAmount: '0.00',
        outstandingAmount: '100.00',
        status: 'pending',
      },
      {
        installmentNumber: 2,
        dueDate: '2026-05-08',
        scheduledAmount: '100.00',
        principalAmount: '90.00',
        interestAmount: '10.00',
        feeAmount: '0.00',
        outstandingPrincipalAmount: '90.00',
        outstandingInterestAmount: '10.00',
        outstandingFeeAmount: '0.00',
        outstandingAmount: '100.00',
        status: 'pending',
      },
      {
        installmentNumber: 3,
        dueDate: '2026-05-09',
        scheduledAmount: '100.00',
        principalAmount: '90.00',
        interestAmount: '10.00',
        feeAmount: '0.00',
        outstandingPrincipalAmount: '90.00',
        outstandingInterestAmount: '10.00',
        outstandingFeeAmount: '0.00',
        outstandingAmount: '100.00',
        status: 'pending',
      },
    ])
  })

  it('builds a weekly schedule with 7-day offsets from the first due date', () => {
    const schedule = buildOriginationSchedule({
      principalAmount: '120',
      installmentAmount: '70',
      totalInstallments: 2,
      paymentFrequency: 'weekly',
      disbursementDate: '2026-05-06',
      firstDueDate: '2026-05-13',
    })

    expect(schedule.installments.map((installment) => installment.dueDate)).toEqual([
      '2026-05-13',
      '2026-05-20',
    ])
    expect(schedule.installments.map((installment) => installment.interestAmount)).toEqual([
      '10.00',
      '10.00',
    ])
    expect(schedule.installments.map((installment) => installment.principalAmount)).toEqual([
      '60.00',
      '60.00',
    ])
  })

  it('builds a compound V2 schedule and preserves the declared payment mode', () => {
    const schedule = buildOriginationSchedule({
      principalAmount: '100.00',
      totalInstallments: 2,
      paymentFrequency: 'daily',
      disbursementDate: '2026-01-01',
      firstDueDate: '2026-01-02',
      interestMode: 'compound_fixed_installment',
      interestRateDaily: '0.10',
      paymentApplicationMode: 'principal_only',
    })

    expect(schedule.interestMode).toBe('compound_fixed_installment')
    expect(schedule.paymentApplicationMode).toBe('principal_only')
    expect(schedule.installmentAmount).toBe('57.62')
    expect(schedule.installments[0]).toMatchObject({
      principalAmount: '47.62',
      interestAmount: '10.00',
      outstandingPrincipalAmount: '47.62',
      outstandingInterestAmount: '10.00',
    })
  })

  it('builds a biweekly schedule with 15-day offsets from the first due date', () => {
    const schedule = buildOriginationSchedule({
      principalAmount: '150',
      installmentAmount: '60',
      totalInstallments: 3,
      paymentFrequency: 'biweekly',
      disbursementDate: '2026-05-01',
      firstDueDate: '2026-05-16',
    })

    expect(schedule.installments.map((installment) => installment.dueDate)).toEqual([
      '2026-05-16',
      '2026-05-31',
      '2026-06-15',
    ])
  })

  it('anchors monthly schedules to the original day and clamps invalid month ends', () => {
    const schedule = buildOriginationSchedule({
      principalAmount: '100',
      installmentAmount: '33.34',
      totalInstallments: 3,
      paymentFrequency: 'monthly',
      disbursementDate: '2026-01-10',
      firstDueDate: '2026-01-31',
    })

    expect(schedule.totalInterestAmount).toBe('0.02')
    expect(schedule.installments).toEqual([
      expect.objectContaining({
        installmentNumber: 1,
        dueDate: '2026-01-31',
        principalAmount: '33.33',
        interestAmount: '0.01',
      }),
      expect.objectContaining({
        installmentNumber: 2,
        dueDate: '2026-02-28',
        principalAmount: '33.33',
        interestAmount: '0.01',
      }),
      expect.objectContaining({
        installmentNumber: 3,
        dueDate: '2026-03-31',
        principalAmount: '33.34',
        interestAmount: '0.00',
      }),
    ])
  })

  it('serializes the preview schedule to the RPC payload shape', () => {
    const schedule = buildOriginationSchedule({
      principalAmount: '50',
      installmentAmount: '55',
      totalInstallments: 1,
      paymentFrequency: 'daily',
      disbursementDate: '2026-05-06',
      firstDueDate: '2026-05-07',
    })

    expect(serializeOriginationScheduleForRpc(schedule)).toEqual([
      {
        installment_number: 1,
        due_date: '2026-05-07',
        scheduled_amount: '55.00',
        principal_amount: '50.00',
        interest_amount: '5.00',
        fee_amount: '0.00',
        outstanding_principal_amount: '50.00',
        outstanding_interest_amount: '5.00',
        outstanding_fee_amount: '0.00',
        outstanding_amount: '55.00',
        status: 'pending',
      },
    ])
  })

  it('rejects invalid values and impossible totals before reaching Supabase', () => {
    expect(() =>
      buildOriginationSchedule({
        principalAmount: '100',
        installmentAmount: '30',
        totalInstallments: 3,
        paymentFrequency: 'daily',
        disbursementDate: '2026-05-06',
        firstDueDate: '2026-05-07',
      }),
    ).toThrowError('loan_total_scheduled_below_principal')

    expect(() =>
      buildOriginationSchedule({
        principalAmount: '-1',
        installmentAmount: '30',
        totalInstallments: 3,
        paymentFrequency: 'daily',
        disbursementDate: '2026-05-06',
        firstDueDate: '2026-05-07',
      }),
    ).toThrowError('loan_principal_amount_invalid')

    expect(() =>
      buildOriginationSchedule({
        principalAmount: '100',
        installmentAmount: '30',
        totalInstallments: 0,
        paymentFrequency: 'daily',
        disbursementDate: '2026-05-06',
        firstDueDate: '2026-05-07',
      }),
    ).toThrowError('loan_total_installments_invalid')

    expect(() =>
      buildOriginationSchedule({
        principalAmount: '100',
        installmentAmount: '30',
        totalInstallments: 3,
        paymentFrequency: 'monthly',
        disbursementDate: '2026-05-06',
        firstDueDate: '2026-05-01',
      }),
    ).toThrowError('loan_first_due_date_before_disbursement')
  })
})
