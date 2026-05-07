import { describe, expect, it } from 'vitest'
import { buildConfirmedReceiptPdfFilename, createConfirmedReceiptPdfBytes } from './receipt-pdf.ts'
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
  paymentReference: 'REC-123',
  status: 'posted',
  totalAmount: '70.00',
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
  ],
  latestPayment: undefined,
  loan: {
    collectorId: 'collector-1',
    currencyCode: 'COP',
    customerId: 'customer-1',
    id: 'loan-1',
    installmentAmount: '70.00',
    interestRateDaily: '0.00',
    principalAmount: '50.00',
    status: 'active',
    totalInstallments: 1,
    updatedAt: '2026-05-07T10:00:00.000Z',
  },
  nextDueDate: undefined,
  outstandingAmount: '0.00',
  overdueInstallmentCount: 0,
  payableInstallmentCount: 0,
  pendingSyncCount: 0,
}

describe('receipt pdf', () => {
  it('builds a deterministic filename from the payment reference', () => {
    expect(buildConfirmedReceiptPdfFilename(RECEIPT)).toBe('recibo-rec-123.pdf')
  })

  it('generates a real PDF byte stream for the confirmed receipt', async () => {
    const bytes = await createConfirmedReceiptPdfBytes({
      appName: 'Cobro Diario',
      receipt: RECEIPT,
      summary: deriveReceiptMetrics(RECEIPT, LOAN_CARD, {
        referenceDate: new Date('2026-05-07T12:00:00.000Z'),
      }),
    })

    const header = new TextDecoder().decode(bytes.slice(0, 5))

    expect(header).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(1_000)
  })
})
