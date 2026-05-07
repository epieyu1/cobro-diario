import { FINANCIAL_BASELINE } from '@/lib/finance/financial-config.ts'
import {
  buildCompoundFixedInstallmentSchedule,
  COMPOUND_INTEREST_MODE,
} from '@/lib/finance/compound-interest.ts'
import { MONEY_DECIMAL_SCALE, sumMoney, toMoney } from '@/lib/finance/money.ts'
import { INTEREST_MODEL } from '@/lib/finance/payment-contract.ts'
import type {
  InstallmentStatus,
  LoanInterestMode,
  LoanPaymentApplicationMode,
  LoanStatus,
  OriginationPaymentFrequency,
} from '@/types/domain.ts'

export const ORIGINATION_PAYMENT_FREQUENCIES = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
] as const satisfies readonly OriginationPaymentFrequency[]

export const ORIGINATION_INITIAL_INSTALLMENT_STATUS = 'pending' as const satisfies InstallmentStatus
export const ORIGINATION_INITIAL_LOAN_STATUS = 'active' as const satisfies LoanStatus
export const ORIGINATION_INTEREST_MODE = INTEREST_MODEL as LoanInterestMode
export const ORIGINATION_PAYMENT_APPLICATION_MODE = 'oldest_first' as const satisfies LoanPaymentApplicationMode

export type OriginationScheduleInput = {
  principalAmount: string
  totalInstallments: number
  paymentFrequency: OriginationPaymentFrequency
  disbursementDate: string
  firstDueDate: string
  installmentAmount?: string
  interestMode?: LoanInterestMode
  interestRateDaily?: string
  paymentApplicationMode?: LoanPaymentApplicationMode
}

export type OriginationScheduleInstallment = {
  installmentNumber: number
  dueDate: string
  scheduledAmount: string
  principalAmount: string
  interestAmount: string
  feeAmount: string
  outstandingPrincipalAmount: string
  outstandingInterestAmount: string
  outstandingFeeAmount: string
  outstandingAmount: string
  status: typeof ORIGINATION_INITIAL_INSTALLMENT_STATUS
}

export type OriginationSchedule = {
  installmentAmount: string
  totalScheduledAmount: string
  totalPrincipalAmount: string
  totalInterestAmount: string
  totalInstallments: number
  paymentFrequency: OriginationPaymentFrequency
  disbursementDate: string
  firstDueDate: string
  interestMode: LoanInterestMode
  paymentApplicationMode: LoanPaymentApplicationMode
  loanStatus: typeof ORIGINATION_INITIAL_LOAN_STATUS
  installments: OriginationScheduleInstallment[]
}

// Intencion: construir el cronograma canonico que backend y preview deben compartir.
// Flujo: entrada del operador -> seleccion de modo financiero -> cuotas materializadas -> RPC.
// Riesgo: si frontend y SQL divergen aqui, se rompen altas, cobro dirigido y futura cartera bootstrap.
// Fuente de verdad: PostgreSQL debe validar el mismo contrato antes de persistir el prestamo en Supabase.
export function buildOriginationSchedule(input: OriginationScheduleInput): OriginationSchedule {
  const interestMode = normalizeInterestMode(input.interestMode)
  const paymentApplicationMode = normalizePaymentApplicationMode(input.paymentApplicationMode, interestMode)

  if (interestMode === COMPOUND_INTEREST_MODE) {
    const compoundSchedule = buildCompoundFixedInstallmentSchedule({
      disbursementDate: input.disbursementDate,
      firstDueDate: input.firstDueDate,
      interestRateDaily: input.interestRateDaily ?? '0.000000',
      paymentFrequency: input.paymentFrequency,
      principalAmount: input.principalAmount,
      totalInstallments: input.totalInstallments,
    })

    return {
      disbursementDate: compoundSchedule.disbursementDate,
      firstDueDate: compoundSchedule.firstDueDate,
      installmentAmount: compoundSchedule.installmentAmount,
      installments: compoundSchedule.installments.map((installment) => ({
        installmentNumber: installment.installmentNumber,
        dueDate: installment.dueDate,
        scheduledAmount: installment.scheduledAmount,
        principalAmount: installment.principalAmount,
        interestAmount: installment.interestAmount,
        feeAmount: installment.feeAmount,
        outstandingPrincipalAmount: installment.principalAmount,
        outstandingInterestAmount: installment.interestAmount,
        outstandingFeeAmount: installment.feeAmount,
        outstandingAmount: installment.outstandingAmount,
        status: installment.status,
      })),
      interestMode,
      loanStatus: ORIGINATION_INITIAL_LOAN_STATUS,
      paymentApplicationMode,
      paymentFrequency: compoundSchedule.paymentFrequency,
      totalInstallments: compoundSchedule.totalInstallments,
      totalInterestAmount: compoundSchedule.totalInterestAmount,
      totalPrincipalAmount: compoundSchedule.totalPrincipalAmount,
      totalScheduledAmount: compoundSchedule.totalScheduledAmount,
    }
  }

  const principalAmount = toMoney(input.principalAmount)
  const installmentAmount = toMoney(input.installmentAmount ?? 0)
  const totalInstallments = normalizeInstallmentCount(input.totalInstallments)
  const paymentFrequency = normalizePaymentFrequency(input.paymentFrequency)
  const disbursementDate = parseBusinessDate(input.disbursementDate, 'loan_disbursement_date_required')
  const firstDueDate = parseBusinessDate(input.firstDueDate, 'loan_first_due_date_required')

  if (principalAmount.lte(0)) {
    throw new Error('loan_principal_amount_invalid')
  }

  if (installmentAmount.lte(0)) {
    throw new Error('loan_installment_amount_invalid')
  }

  if (compareBusinessDates(firstDueDate, disbursementDate) < 0) {
    throw new Error('loan_first_due_date_before_disbursement')
  }

  const totalScheduledAmount = sumMoney(
    Array.from({ length: totalInstallments }, () => installmentAmount),
  )

  if (totalScheduledAmount.lt(principalAmount)) {
    throw new Error('loan_total_scheduled_below_principal')
  }

  const totalInterestAmount = toMoney(totalScheduledAmount.minus(principalAmount))
  const regularInterestAmount = toMoney(totalInterestAmount.div(totalInstallments))
  const installments = Array.from({ length: totalInstallments }, (_, installmentIndex) => {
    const installmentNumber = installmentIndex + 1
    const dueDate = addDueDateOffset(firstDueDate, paymentFrequency, installmentIndex)
    const interestAmount =
      installmentIndex === totalInstallments - 1
        ? toMoney(totalInterestAmount.minus(regularInterestAmount.times(totalInstallments - 1)))
        : regularInterestAmount
    const principalComponent = toMoney(installmentAmount.minus(interestAmount))

    if (interestAmount.lt(0) || principalComponent.lt(0)) {
      throw new Error('loan_installment_component_invalid')
    }

    return {
      installmentNumber,
      dueDate: formatBusinessDate(dueDate),
      scheduledAmount: installmentAmount.toFixed(MONEY_DECIMAL_SCALE),
      principalAmount: principalComponent.toFixed(MONEY_DECIMAL_SCALE),
      interestAmount: interestAmount.toFixed(MONEY_DECIMAL_SCALE),
      feeAmount: '0.00',
      outstandingPrincipalAmount: principalComponent.toFixed(MONEY_DECIMAL_SCALE),
      outstandingInterestAmount: interestAmount.toFixed(MONEY_DECIMAL_SCALE),
      outstandingFeeAmount: '0.00',
      outstandingAmount: installmentAmount.toFixed(MONEY_DECIMAL_SCALE),
      status: ORIGINATION_INITIAL_INSTALLMENT_STATUS,
    } satisfies OriginationScheduleInstallment
  })

  return {
    installmentAmount: installmentAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalScheduledAmount: totalScheduledAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalPrincipalAmount: principalAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalInterestAmount: totalInterestAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalInstallments,
    paymentFrequency,
    disbursementDate: formatBusinessDate(disbursementDate),
    firstDueDate: formatBusinessDate(firstDueDate),
    interestMode,
    paymentApplicationMode,
    loanStatus: ORIGINATION_INITIAL_LOAN_STATUS,
    installments,
  }
}

export function serializeOriginationScheduleForRpc(schedule: OriginationSchedule) {
  return schedule.installments.map((installment) => ({
    installment_number: installment.installmentNumber,
    due_date: installment.dueDate,
    scheduled_amount: installment.scheduledAmount,
    principal_amount: installment.principalAmount,
    interest_amount: installment.interestAmount,
    fee_amount: installment.feeAmount,
    outstanding_principal_amount: installment.outstandingPrincipalAmount,
    outstanding_interest_amount: installment.outstandingInterestAmount,
    outstanding_fee_amount: installment.outstandingFeeAmount,
    outstanding_amount: installment.outstandingAmount,
    status: installment.status,
  }))
}

function normalizeInterestMode(value: LoanInterestMode | undefined) {
  return value ?? ORIGINATION_INTEREST_MODE
}

function normalizePaymentApplicationMode(
  value: LoanPaymentApplicationMode | undefined,
  interestMode: LoanInterestMode,
) {
  const normalizedMode = value ?? ORIGINATION_PAYMENT_APPLICATION_MODE

  if (
    normalizedMode !== 'oldest_first'
    && normalizedMode !== 'principal_only'
    && normalizedMode !== 'interest_only'
  ) {
    throw new Error('loan_payment_application_mode_invalid')
  }

  if (interestMode === ORIGINATION_INTEREST_MODE && normalizedMode !== 'oldest_first') {
    throw new Error('loan_payment_application_mode_not_supported')
  }

  return normalizedMode
}

function normalizeInstallmentCount(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('loan_total_installments_invalid')
  }

  return value
}

function normalizePaymentFrequency(value: OriginationPaymentFrequency) {
  if (!ORIGINATION_PAYMENT_FREQUENCIES.includes(value)) {
    throw new Error('loan_payment_frequency_invalid')
  }

  return value
}

type BusinessDate = {
  year: number
  month: number
  day: number
}

function parseBusinessDate(value: string, errorCode: string): BusinessDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())

  if (!match) {
    throw new Error(errorCode)
  }

  const [, yearPart, monthPart, dayPart] = match
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)

  if (!isValidBusinessDate(year, month, day)) {
    throw new Error(errorCode)
  }

  return { year, month, day }
}

function compareBusinessDates(leftDate: BusinessDate, rightDate: BusinessDate) {
  const leftTimestamp = Date.UTC(leftDate.year, leftDate.month - 1, leftDate.day)
  const rightTimestamp = Date.UTC(rightDate.year, rightDate.month - 1, rightDate.day)

  return Math.sign(leftTimestamp - rightTimestamp)
}

function addDueDateOffset(
  firstDueDate: BusinessDate,
  paymentFrequency: OriginationPaymentFrequency,
  installmentOffset: number,
) {
  switch (paymentFrequency) {
    case 'daily':
      return addCalendarDays(firstDueDate, installmentOffset)
    case 'weekly':
      return addCalendarDays(firstDueDate, installmentOffset * 7)
    case 'biweekly':
      return addCalendarDays(firstDueDate, installmentOffset * 15)
    case 'monthly':
      return addCalendarMonths(firstDueDate, installmentOffset)
  }
}

function addCalendarDays(date: BusinessDate, dayOffset: number): BusinessDate {
  const utcDate = new Date(Date.UTC(date.year, date.month - 1, date.day + dayOffset))

  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  }
}

function addCalendarMonths(date: BusinessDate, monthOffset: number): BusinessDate {
  const monthIndex = date.month - 1 + monthOffset
  const targetYear = date.year + Math.floor(monthIndex / 12)
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12
  const targetMonth = targetMonthIndex + 1
  const targetDay = Math.min(date.day, daysInMonth(targetYear, targetMonth))

  return {
    year: targetYear,
    month: targetMonth,
    day: targetDay,
  }
}

function formatBusinessDate(date: BusinessDate) {
  return [
    String(date.year).padStart(4, '0'),
    String(date.month).padStart(2, '0'),
    String(date.day).padStart(2, '0'),
  ].join('-')
}

function isValidBusinessDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }

  if (month < 1 || month > 12 || day < 1) {
    return false
  }

  return day <= daysInMonth(year, month)
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export const ORIGINATION_SCHEDULE_BASELINE = {
  ...FINANCIAL_BASELINE,
  interestMode: ORIGINATION_INTEREST_MODE,
  paymentApplicationMode: ORIGINATION_PAYMENT_APPLICATION_MODE,
  feePolicy: 'all_installments_start_with_zero_fee',
  installmentAmountPolicy: 'operator_input_for_v1_or_discounted_for_v2',
  scheduleSourceOfTruth: 'postgresql_validates_same_schedule_before_insert',
} as const
