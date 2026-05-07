import { describe, expect, it } from 'vitest'
import { deriveReceiptMetrics } from './receipt-analytics.ts'
import type { CollectorLoanCard } from '../collector/collector-workspace.ts'
import type { ConfirmedPaymentReceipt } from './receipt-types.ts'

const RECEIPT: ConfirmedPaymentReceipt = {
  applications: [
    {
      appliedAmount: '70.00',
      dueDate: '2026-05-01',
      feeComponent: '5.00',
      installmentId: 'installment-1',
      installmentNumber: 1,
      interestComponent: '15.00',
      principalComponent: '50.00',
    },
    {
      appliedAmount: '20.00',
      dueDate: '2026-05-10',
      feeComponent: '0.00',
      installmentId: 'installment-2',
      installmentNumber: 2,
      interestComponent: '5.00',
      principalComponent: '15.00',
    },
  ],
  collector: {
    fullName: 'Laura Diaz',
    id: 'collector-1',
  },
  collectorId: 'collector-1',
  createdAt: '2026-05-07T10:00:10.000Z',
  customer: {
    fullName: 'Ana Gomez',
    id: 'customer-1',
  },
  deviceLocalId: 'device-local-1',
  loan: {
    currencyCode: 'COP',
    externalLoanNumber: 'CD-001',
    id: 'loan-1',
  },
  paidAt: '2026-05-07T10:00:00.000Z',
  paymentId: 'payment-1',
  paymentMethod: 'cash',
  status: 'posted',
  totalAmount: '90.00',
}

const LOAN_CARD: CollectorLoanCard = {
  customer: {
    assignedCollectorId: 'collector-1',
    fullName: 'Ana Gomez',
    id: 'customer-1',
    updatedAt: '2026-05-07T10:00:00.000Z',
  },
  failedSyncCount: 0,
  installments: [
    {
      dueDate: '2026-05-01',
      feeAmount: '5.00',
      id: 'installment-1',
      installmentNumber: 1,
      interestAmount: '15.00',
      loanId: 'loan-1',
      outstandingAmount: '0.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '0.00',
      outstandingPrincipalAmount: '0.00',
      principalAmount: '50.00',
      scheduledAmount: '70.00',
      status: 'paid',
      updatedAt: '2026-05-07T10:00:00.000Z',
    },
    {
      dueDate: '2026-05-03',
      feeAmount: '2.00',
      id: 'installment-2',
      installmentNumber: 2,
      interestAmount: '8.00',
      loanId: 'loan-1',
      outstandingAmount: '10.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '0.00',
      outstandingPrincipalAmount: '10.00',
      principalAmount: '40.00',
      scheduledAmount: '50.00',
      status: 'overdue',
      updatedAt: '2026-05-07T10:00:00.000Z',
    },
    {
      dueDate: '2026-05-10',
      feeAmount: '0.00',
      id: 'installment-3',
      installmentNumber: 3,
      interestAmount: '10.00',
      loanId: 'loan-1',
      outstandingAmount: '30.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '10.00',
      outstandingPrincipalAmount: '20.00',
      principalAmount: '20.00',
      scheduledAmount: '30.00',
      status: 'pending',
      updatedAt: '2026-05-07T10:00:00.000Z',
    },
  ],
  latestPayment: undefined,
  loan: {
    collectorId: 'collector-1',
    currencyCode: 'COP',
    customerId: 'customer-1',
    id: 'loan-1',
    installmentAmount: '50.00',
    interestRateDaily: '0.00',
    principalAmount: '110.00',
    status: 'active',
    totalInstallments: 3,
    updatedAt: '2026-05-07T10:00:00.000Z',
  },
  nextDueDate: '2026-05-03',
  outstandingAmount: '40.00',
  overdueInstallmentCount: 1,
  payableInstallmentCount: 2,
  pendingSyncCount: 0,
}

describe('deriveReceiptMetrics', () => {
  it('derives payment and loan snapshot metrics for the enriched receipt', () => {
    const metrics = deriveReceiptMetrics(RECEIPT, LOAN_CARD, {
      referenceDate: new Date('2026-05-07T12:00:00.000Z'),
    })

    expect(metrics).toEqual({
      feeAppliedAmount: '5.00',
      interestAppliedAmount: '20.00',
      loanSnapshot: {
        agreedInstallmentCount: 3,
        currentOutstandingAmount: '40.00',
        nextDueDate: '2026-05-03',
        overdueBreakdown: {
          feeAmount: '0.00',
          interestAmount: '0.00',
          principalAmount: '10.00',
          totalAmount: '10.00',
        },
        overdueDays: 4,
        overdueInstallmentCount: 1,
        paidInstallmentCount: 1,
        pendingInstallmentCount: 1,
        totalHistoricalPaidAmount: '110.00',
      },
      overdueAppliedAmount: '70.00',
      principalAppliedAmount: '65.00',
    })
  })
})
