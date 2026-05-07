import Decimal from 'decimal.js'
import { FINANCIAL_BASELINE } from '../finance/financial-config.ts'
import type { CollectorLoanCard } from '../collector/collector-workspace.ts'
import type { ConfirmedPaymentReceipt } from './receipt-types.ts'

export type ReceiptLoanSnapshotMetrics = {
  agreedInstallmentCount: number
  currentOutstandingAmount: string
  nextDueDate?: string
  overdueBreakdown: {
    feeAmount: string
    interestAmount: string
    principalAmount: string
    totalAmount: string
  }
  overdueDays: number
  overdueInstallmentCount: number
  paidInstallmentCount: number
  pendingInstallmentCount: number
  totalHistoricalPaidAmount: string
}

export type ReceiptDerivedMetrics = {
  feeAppliedAmount: string
  interestAppliedAmount: string
  loanSnapshot?: ReceiptLoanSnapshotMetrics
  overdueAppliedAmount: string
  principalAppliedAmount: string
}

// Intencion: centralizar las metricas operativas que enriquecen el recibo sin confundir
// el comprobante autoritativo del pago con el estado actual del prestamo.
// Flujo: recibo confirmado por RPC + snapshot local del prestamo -> metricas derivadas
// para UI/PDF. La fuente de verdad del pago sigue siendo PostgreSQL; el estado de cartera
// actual solo se usa como contexto complementario del mismo expediente.
// Riesgo: si se mezclan estas formulas dentro del panel o del generador PDF, el recibo
// y el documento exportado pueden divergir aunque lean el mismo pago confirmado.
export function deriveReceiptMetrics(
  receipt: ConfirmedPaymentReceipt,
  loanCard?: CollectorLoanCard | null,
  options: {
    referenceDate?: Date
  } = {},
): ReceiptDerivedMetrics {
  const paidAtDate = receipt.paidAt.slice(0, 10)

  const principalAppliedAmount = sumMoney(
    receipt.applications.map((application) => application.principalComponent),
  ).toFixed(2)
  const interestAppliedAmount = sumMoney(
    receipt.applications.map((application) => application.interestComponent),
  ).toFixed(2)
  const feeAppliedAmount = sumMoney(
    receipt.applications.map((application) => application.feeComponent),
  ).toFixed(2)
  const overdueAppliedAmount = sumMoney(
    receipt.applications
      .filter((application) => application.dueDate < paidAtDate)
      .map((application) => application.appliedAmount),
  ).toFixed(2)

  return {
    feeAppliedAmount,
    interestAppliedAmount,
    loanSnapshot: loanCard
      ? deriveReceiptLoanSnapshotMetrics(loanCard, options.referenceDate ?? new Date())
      : undefined,
    overdueAppliedAmount,
    principalAppliedAmount,
  }
}

function deriveReceiptLoanSnapshotMetrics(
  loanCard: CollectorLoanCard,
  referenceDate: Date,
): ReceiptLoanSnapshotMetrics {
  const collectibleInstallments = loanCard.installments.filter(isOutstandingInstallment)
  const overdueInstallments = collectibleInstallments.filter((installment) => installment.status === 'overdue')
  const pendingInstallments = collectibleInstallments.filter((installment) => installment.status !== 'overdue')
  const businessDate = formatBusinessDate(referenceDate)
  const earliestOverdueDueDate = overdueInstallments
    .map((installment) => installment.dueDate)
    .sort()[0]
  const overduePrincipalAmount = sumMoney(
    overdueInstallments.map((installment) => installment.outstandingPrincipalAmount),
  ).toFixed(2)
  const overdueInterestAmount = sumMoney(
    overdueInstallments.map((installment) => installment.outstandingInterestAmount),
  ).toFixed(2)
  const overdueFeeAmount = sumMoney(
    overdueInstallments.map((installment) => installment.outstandingFeeAmount),
  ).toFixed(2)

  return {
    agreedInstallmentCount: loanCard.loan.totalInstallments ?? loanCard.installments.length,
    currentOutstandingAmount: loanCard.outstandingAmount,
    nextDueDate: loanCard.nextDueDate,
    overdueBreakdown: {
      feeAmount: overdueFeeAmount,
      interestAmount: overdueInterestAmount,
      principalAmount: overduePrincipalAmount,
      totalAmount: sumMoney([overduePrincipalAmount, overdueInterestAmount, overdueFeeAmount]).toFixed(2),
    },
    overdueDays: earliestOverdueDueDate ? diffCalendarDays(earliestOverdueDueDate, businessDate) : 0,
    overdueInstallmentCount: overdueInstallments.length,
    paidInstallmentCount: loanCard.installments.filter(isPaidInstallment).length,
    pendingInstallmentCount: pendingInstallments.length,
    totalHistoricalPaidAmount: sumMoney(
      loanCard.installments.map((installment) =>
        toMoney(installment.scheduledAmount).minus(installment.outstandingAmount),
      ),
    ).toFixed(2),
  }
}

function isOutstandingInstallment(installment: CollectorLoanCard['installments'][number]) {
  return installment.status !== 'canceled' && toMoney(installment.outstandingAmount).gt(0)
}

function isPaidInstallment(installment: CollectorLoanCard['installments'][number]) {
  return installment.status === 'paid' || toMoney(installment.outstandingAmount).eq(0)
}

function diffCalendarDays(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  const millisecondsPerDay = 24 * 60 * 60 * 1000

  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay))
}

function formatBusinessDate(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: FINANCIAL_BASELINE.businessTimezone,
    year: 'numeric',
  })
  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('invalid_business_date')
  }

  return `${year}-${month}-${day}`
}

function parseDateOnly(date: string) {
  const [year, month, day] = date.split('-').map((value) => Number(value))

  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1))
}

function toMoney(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(FINANCIAL_BASELINE.decimalScale, Decimal.ROUND_HALF_UP)
}

function sumMoney(values: Decimal.Value[]) {
  return toMoney(
    values.reduce<Decimal>((accumulator, currentValue) => accumulator.plus(currentValue), new Decimal(0)),
  )
}
