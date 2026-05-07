import { describe, expect, it } from 'vitest'
import { mapConfirmedPaymentReceiptResponse } from '@/lib/receipts/receipt-mapper.ts'

describe('mapConfirmedPaymentReceiptResponse', () => {
  it('normalizes a confirmed receipt payload from the RPC', () => {
    const receipt = mapConfirmedPaymentReceiptResponse({
      applications: [
        {
          appliedAmount: 70,
          dueDate: '2026-05-06',
          feeComponent: 5,
          installmentId: 'installment-1',
          installmentNumber: 1,
          interestComponent: 15,
          principalComponent: 50,
        },
      ],
      collector: {
        fullName: 'Laura Diaz',
        id: 'collector-1',
      },
      collectorId: 'collector-1',
      createdAt: '2026-05-06T13:00:05.000Z',
      customer: {
        fullName: 'Cliente 1',
        governmentId: '901200300',
        id: 'customer-1',
        phone: '3001234567',
      },
      deviceLocalId: 'device-local-1',
      loan: {
        currencyCode: 'COP',
        externalLoanNumber: 'CD-001',
        id: 'loan-1',
      },
      paidAt: '2026-05-06T13:00:00.000Z',
      paymentId: 'payment-1',
      paymentMethod: 'cash',
      paymentReference: 'REC-1',
      reversal: null,
      status: 'posted',
      totalAmount: '70',
    })

    expect(receipt).toEqual({
      applications: [
        {
          appliedAmount: '70.00',
          dueDate: '2026-05-06',
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
      createdAt: '2026-05-06T13:00:05.000Z',
      customer: {
        fullName: 'Cliente 1',
        governmentId: '901200300',
        id: 'customer-1',
        phone: '3001234567',
      },
      deviceLocalId: 'device-local-1',
      loan: {
        currencyCode: 'COP',
        externalLoanNumber: 'CD-001',
        id: 'loan-1',
      },
      paidAt: '2026-05-06T13:00:00.000Z',
      paymentId: 'payment-1',
      paymentMethod: 'cash',
      paymentReference: 'REC-1',
      reversal: undefined,
      status: 'posted',
      totalAmount: '70.00',
    })
  })

  it('normalizes reversal metadata when the server already compensated the payment', () => {
    const receipt = mapConfirmedPaymentReceiptResponse({
      applications: [],
      collector: {
        fullName: 'Laura Diaz',
        id: 'collector-1',
      },
      collectorId: 'collector-1',
      createdAt: '2026-05-06T13:00:05.000Z',
      customer: {
        fullName: 'Cliente 1',
        id: 'customer-1',
      },
      deviceLocalId: 'device-local-1',
      loan: {
        currencyCode: 'COP',
        id: 'loan-1',
      },
      paidAt: '2026-05-06T13:00:00.000Z',
      paymentId: 'payment-1',
      paymentMethod: 'cash',
      reversal: {
        reason: 'Cobro duplicado',
        reversedAt: '2026-05-06T14:00:00.000Z',
        reversedBy: {
          fullName: 'Admin Uno',
          id: 'admin-1',
        },
      },
      status: 'reversed',
      totalAmount: '70',
    })

    expect(receipt).toMatchObject({
      reversal: {
        reason: 'Cobro duplicado',
        reversedAt: '2026-05-06T14:00:00.000Z',
        reversedBy: {
          fullName: 'Admin Uno',
          id: 'admin-1',
        },
      },
      status: 'reversed',
    })
  })

  it('fails fast when the payload shape is invalid', () => {
    expect(() =>
      mapConfirmedPaymentReceiptResponse({
        applications: 'not-an-array',
        collectorId: 'collector-1',
      }),
    ).toThrow('invalid_payment_receipt')
  })
})
