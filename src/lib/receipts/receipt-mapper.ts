import { MONEY_DECIMAL_SCALE, toMoney } from '@/lib/finance/money.ts'
import type { ConfirmedPaymentReceipt, ConfirmedPaymentReceiptApplication } from '@/lib/receipts/receipt-types.ts'

// Intencion: validar el shape del RPC antes de tocar la UI.
// Riesgo: si el recibo remoto cambia silenciosamente, el frontend podria presentar
// un comprobante incoherente. Este mapper falla rapido y obliga a revisar SQL + UI juntos.
export function mapConfirmedPaymentReceiptResponse(payload: unknown): ConfirmedPaymentReceipt {
  const root = expectObject(payload)
  const customer = expectObject(root.customer)
  const loan = expectObject(root.loan)
  const applications = expectArray(root.applications)

  return {
    applications: applications.map(mapReceiptApplication),
    collector: {
      fullName: expectOptionalString(expectObject(root.collector).fullName),
      id: expectString(expectObject(root.collector).id),
    },
    collectorId: expectString(root.collectorId),
    createdAt: expectIsoTimestamp(root.createdAt),
    customer: {
      fullName: expectString(customer.fullName),
      governmentId: expectOptionalString(customer.governmentId),
      id: expectString(customer.id),
      phone: expectOptionalString(customer.phone),
    },
    deviceLocalId: expectString(root.deviceLocalId),
    loan: {
      currencyCode: expectString(loan.currencyCode),
      externalLoanNumber: expectOptionalString(loan.externalLoanNumber),
      id: expectString(loan.id),
    },
    paidAt: expectIsoTimestamp(root.paidAt),
    paymentId: expectString(root.paymentId),
    paymentMethod: expectString(root.paymentMethod),
    paymentReference: expectOptionalString(root.paymentReference),
    reversal: expectOptionalReversal(root.reversal),
    status: expectPaymentStatus(root.status),
    totalAmount: expectMoney(root.totalAmount),
  }
}

function mapReceiptApplication(payload: unknown): ConfirmedPaymentReceiptApplication {
  const application = expectObject(payload)

  return {
    appliedAmount: expectMoney(application.appliedAmount),
    dueDate: expectDate(application.dueDate),
    feeComponent: expectMoney(application.feeComponent),
    installmentId: expectString(application.installmentId),
    installmentNumber: expectInteger(application.installmentNumber),
    interestComponent: expectMoney(application.interestComponent),
    principalComponent: expectMoney(application.principalComponent),
  }
}

function expectArray(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('invalid_payment_receipt')
  }

  return value
}

function expectObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_payment_receipt')
  }

  return value as Record<string, unknown>
}

function expectString(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('invalid_payment_receipt')
  }

  const normalizedValue = value.trim()

  if (!normalizedValue) {
    throw new Error('invalid_payment_receipt')
  }

  return normalizedValue
}

function expectOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined
  }

  return expectString(value)
}

function expectInteger(value: unknown) {
  const normalizedValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isInteger(normalizedValue)) {
    throw new Error('invalid_payment_receipt')
  }

  return normalizedValue
}

function expectMoney(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('invalid_payment_receipt')
  }

  return toMoney(value).toFixed(MONEY_DECIMAL_SCALE)
}

function expectDate(value: unknown) {
  const normalizedValue = expectString(value)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    throw new Error('invalid_payment_receipt')
  }

  return normalizedValue
}

function expectIsoTimestamp(value: unknown) {
  const normalizedValue = expectString(value)

  if (Number.isNaN(new Date(normalizedValue).getTime())) {
    throw new Error('invalid_payment_receipt')
  }

  return normalizedValue
}

function expectOptionalReversal(value: unknown): ConfirmedPaymentReceipt['reversal'] {
  if (value === null || value === undefined) {
    return undefined
  }

  const reversal = expectObject(value)
  const reversedBy = expectObject(reversal.reversedBy)

  return {
    reason: expectString(reversal.reason),
    reversedAt: expectIsoTimestamp(reversal.reversedAt),
    reversedBy: {
      fullName: expectOptionalString(reversedBy.fullName),
      id: expectString(reversedBy.id),
    },
  }
}

function expectPaymentStatus(value: unknown): ConfirmedPaymentReceipt['status'] {
  const normalizedValue = expectString(value)

  if (normalizedValue !== 'posted' && normalizedValue !== 'reversed') {
    throw new Error('invalid_payment_receipt')
  }

  return normalizedValue
}
