import Decimal from 'decimal.js'
import type { OriginationPaymentFrequency } from '@/types/domain.ts'
import { MONEY_DECIMAL_SCALE, sumMoney, toMoney } from '@/lib/finance/money.ts'

export const COMPOUND_INTEREST_MODE = 'compound_fixed_installment' as const
export const COMPOUND_ZERO_FEE_AMOUNT = '0.00' as const

export type CompoundFixedInstallmentScheduleInput = {
  principalAmount: string
  totalInstallments: number
  paymentFrequency: OriginationPaymentFrequency
  disbursementDate: string
  firstDueDate: string
  interestRateDaily: string
}

export type CompoundFixedInstallmentRow = {
  installmentNumber: number
  dueDate: string
  daysAccrued: number
  periodRate: string
  scheduledAmount: string
  principalAmount: string
  interestAmount: string
  feeAmount: typeof COMPOUND_ZERO_FEE_AMOUNT
  outstandingAmount: string
  status: 'pending'
}

export type CompoundFixedInstallmentSchedule = {
  interestMode: typeof COMPOUND_INTEREST_MODE
  installmentAmount: string
  totalScheduledAmount: string
  totalPrincipalAmount: string
  totalInterestAmount: string
  totalInstallments: number
  paymentFrequency: OriginationPaymentFrequency
  disbursementDate: string
  firstDueDate: string
  installments: CompoundFixedInstallmentRow[]
}

type BusinessDate = {
  year: number
  month: number
  day: number
}

// Intencion: fijar el algoritmo local del cronograma compuesto antes de tocar SQL o UI.
// Flujo: fechas + tasa diaria + capital -> factores por periodo -> cuota base fija -> ultima cuota absorbe residuo.
// Riesgo: si backend y frontend divergen aqui cuando V2 se active en Supabase, se romperan originacion y cobro.
// Fuente de verdad futura: una migracion dedicada de BR-6 debe reflejar exactamente este contrato o rechazarlo.
export function buildCompoundFixedInstallmentSchedule(
  input: CompoundFixedInstallmentScheduleInput,
): CompoundFixedInstallmentSchedule {
  const principalAmount = toMoney(input.principalAmount)
  const totalInstallments = normalizeInstallmentCount(input.totalInstallments)
  const paymentFrequency = normalizePaymentFrequency(input.paymentFrequency)
  const disbursementDate = parseBusinessDate(input.disbursementDate, 'loan_disbursement_date_required')
  const firstDueDate = parseBusinessDate(input.firstDueDate, 'loan_first_due_date_required')
  const dailyRate = normalizeDailyRate(input.interestRateDaily)

  if (principalAmount.lte(0)) {
    throw new Error('loan_principal_amount_invalid')
  }

  if (compareBusinessDates(firstDueDate, disbursementDate) < 0) {
    throw new Error('loan_first_due_date_before_disbursement')
  }

  const dueDates = Array.from({ length: totalInstallments }, (_, installmentIndex) =>
    addDueDateOffset(firstDueDate, paymentFrequency, installmentIndex),
  )
  const growthFactors = dueDates.map((dueDate, installmentIndex) => {
    const previousDate = installmentIndex === 0 ? disbursementDate : dueDates[installmentIndex - 1]
    const daysAccrued = diffBusinessDates(previousDate, dueDate)

    return {
      daysAccrued,
      dueDate,
      growthFactor: calculateCompoundGrowthFactor(dailyRate, daysAccrued),
      installmentNumber: installmentIndex + 1,
    }
  })

  const baseInstallmentAmount = calculateFixedInstallmentAmount(principalAmount, growthFactors)
  const installments: CompoundFixedInstallmentRow[] = []
  let outstandingPrincipalAmount = principalAmount

  for (const [index, period] of growthFactors.entries()) {
    const periodRate = period.growthFactor.minus(1)
    const interestAmount = toMoney(outstandingPrincipalAmount.mul(periodRate))
    const isLastInstallment = index === growthFactors.length - 1
    const principalComponent = isLastInstallment
      ? outstandingPrincipalAmount
      : toMoney(baseInstallmentAmount.minus(interestAmount))

    if (principalComponent.lte(0)) {
      throw new Error('compound_installment_not_covering_interest')
    }

    const scheduledAmount = isLastInstallment
      ? toMoney(interestAmount.plus(outstandingPrincipalAmount))
      : toMoney(interestAmount.plus(principalComponent))

    installments.push({
      installmentNumber: period.installmentNumber,
      dueDate: formatBusinessDate(period.dueDate),
      daysAccrued: period.daysAccrued,
      periodRate: periodRate.toFixed(8),
      scheduledAmount: scheduledAmount.toFixed(MONEY_DECIMAL_SCALE),
      principalAmount: principalComponent.toFixed(MONEY_DECIMAL_SCALE),
      interestAmount: interestAmount.toFixed(MONEY_DECIMAL_SCALE),
      feeAmount: COMPOUND_ZERO_FEE_AMOUNT,
      outstandingAmount: scheduledAmount.toFixed(MONEY_DECIMAL_SCALE),
      status: 'pending',
    })

    outstandingPrincipalAmount = toMoney(outstandingPrincipalAmount.minus(principalComponent))
  }

  if (!outstandingPrincipalAmount.eq(0)) {
    throw new Error('compound_schedule_residual_balance')
  }

  const totalScheduledAmount = sumMoney(installments.map((installment) => installment.scheduledAmount))
  const totalInterestAmount = sumMoney(installments.map((installment) => installment.interestAmount))

  return {
    interestMode: COMPOUND_INTEREST_MODE,
    installmentAmount: baseInstallmentAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalScheduledAmount: totalScheduledAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalPrincipalAmount: principalAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalInterestAmount: totalInterestAmount.toFixed(MONEY_DECIMAL_SCALE),
    totalInstallments,
    paymentFrequency,
    disbursementDate: formatBusinessDate(disbursementDate),
    firstDueDate: formatBusinessDate(firstDueDate),
    installments,
  }
}

function calculateFixedInstallmentAmount(
  principalAmount: Decimal,
  growthFactors: {
    growthFactor: Decimal
  }[],
) {
  let cumulativeGrowthFactor = new Decimal(1)
  let discountFactorSum = new Decimal(0)

  for (const period of growthFactors) {
    cumulativeGrowthFactor = cumulativeGrowthFactor.mul(period.growthFactor)
    discountFactorSum = discountFactorSum.plus(new Decimal(1).div(cumulativeGrowthFactor))
  }

  if (discountFactorSum.lte(0)) {
    throw new Error('compound_discount_factor_invalid')
  }

  return toMoney(principalAmount.div(discountFactorSum))
}

function calculateCompoundGrowthFactor(dailyRate: Decimal, daysAccrued: number) {
  if (daysAccrued < 0) {
    throw new Error('loan_first_due_date_before_disbursement')
  }

  if (dailyRate.eq(0) || daysAccrued === 0) {
    return new Decimal(1)
  }

  return new Decimal(1).plus(dailyRate).pow(daysAccrued)
}

function normalizeInstallmentCount(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('loan_total_installments_invalid')
  }

  return value
}

function normalizePaymentFrequency(value: OriginationPaymentFrequency) {
  if (value !== 'daily' && value !== 'weekly' && value !== 'biweekly' && value !== 'monthly') {
    throw new Error('loan_payment_frequency_invalid')
  }

  return value
}

function normalizeDailyRate(value: string) {
  let normalizedRate: Decimal

  try {
    normalizedRate = new Decimal(value.trim())
  } catch {
    throw new Error('loan_interest_rate_daily_invalid')
  }

  if (normalizedRate.lt(0)) {
    throw new Error('loan_interest_rate_daily_invalid')
  }

  return normalizedRate
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
  return Math.sign(toBusinessTimestamp(leftDate) - toBusinessTimestamp(rightDate))
}

function diffBusinessDates(leftDate: BusinessDate, rightDate: BusinessDate) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000

  return Math.round((toBusinessTimestamp(rightDate) - toBusinessTimestamp(leftDate)) / millisecondsPerDay)
}

function toBusinessTimestamp(date: BusinessDate) {
  return Date.UTC(date.year, date.month - 1, date.day)
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
