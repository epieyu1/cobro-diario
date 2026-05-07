import Decimal from 'decimal.js'

const MONEY_SCALE = 2
const MONEY_ROUNDING = Decimal.ROUND_HALF_UP
const VALID_FREQUENCIES = new Set(['daily', 'weekly', 'biweekly', 'monthly'])

export function buildOriginationSchedule(input) {
  const principalAmount = toMoney(input.principalAmount)
  const installmentAmount = toMoney(input.installmentAmount)
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

  const totalScheduledAmount = toMoney(installmentAmount.times(totalInstallments))

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
      dueDate: formatBusinessDate(dueDate),
      feeAmount: '0.00',
      installmentNumber,
      interestAmount: interestAmount.toFixed(MONEY_SCALE),
      outstandingAmount: installmentAmount.toFixed(MONEY_SCALE),
      principalAmount: principalComponent.toFixed(MONEY_SCALE),
      scheduledAmount: installmentAmount.toFixed(MONEY_SCALE),
      status: 'pending',
    }
  })

  return {
    disbursementDate: formatBusinessDate(disbursementDate),
    firstDueDate: formatBusinessDate(firstDueDate),
    installmentAmount: installmentAmount.toFixed(MONEY_SCALE),
    installments,
    paymentFrequency,
    totalInstallments,
    totalInterestAmount: totalInterestAmount.toFixed(MONEY_SCALE),
    totalPrincipalAmount: principalAmount.toFixed(MONEY_SCALE),
    totalScheduledAmount: totalScheduledAmount.toFixed(MONEY_SCALE),
  }
}

export function serializeOriginationScheduleForRpc(schedule) {
  return schedule.installments.map((installment) => ({
    due_date: installment.dueDate,
    fee_amount: installment.feeAmount,
    installment_number: installment.installmentNumber,
    interest_amount: installment.interestAmount,
    outstanding_amount: installment.outstandingAmount,
    principal_amount: installment.principalAmount,
    scheduled_amount: installment.scheduledAmount,
    status: installment.status,
  }))
}

export function formatBogotaBusinessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Bogota',
    year: 'numeric',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('business_date_format_failed')
  }

  return `${year}-${month}-${day}`
}

function toMoney(value) {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE, MONEY_ROUNDING)
}

function normalizeInstallmentCount(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('loan_total_installments_invalid')
  }

  return value
}

function normalizePaymentFrequency(value) {
  if (!VALID_FREQUENCIES.has(value)) {
    throw new Error('loan_payment_frequency_invalid')
  }

  return value
}

function parseBusinessDate(value, errorCode) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim())

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

  return { day, month, year }
}

function compareBusinessDates(leftDate, rightDate) {
  const leftTimestamp = Date.UTC(leftDate.year, leftDate.month - 1, leftDate.day)
  const rightTimestamp = Date.UTC(rightDate.year, rightDate.month - 1, rightDate.day)

  return Math.sign(leftTimestamp - rightTimestamp)
}

function addDueDateOffset(firstDueDate, paymentFrequency, installmentOffset) {
  switch (paymentFrequency) {
    case 'daily':
      return addCalendarDays(firstDueDate, installmentOffset)
    case 'weekly':
      return addCalendarDays(firstDueDate, installmentOffset * 7)
    case 'biweekly':
      return addCalendarDays(firstDueDate, installmentOffset * 15)
    case 'monthly':
      return addCalendarMonths(firstDueDate, installmentOffset)
    default:
      throw new Error('loan_payment_frequency_invalid')
  }
}

function addCalendarDays(date, dayOffset) {
  const utcDate = new Date(Date.UTC(date.year, date.month - 1, date.day + dayOffset))

  return {
    day: utcDate.getUTCDate(),
    month: utcDate.getUTCMonth() + 1,
    year: utcDate.getUTCFullYear(),
  }
}

function addCalendarMonths(date, monthOffset) {
  const monthIndex = date.month - 1 + monthOffset
  const targetYear = date.year + Math.floor(monthIndex / 12)
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12
  const targetMonth = targetMonthIndex + 1
  const targetDay = Math.min(date.day, daysInMonth(targetYear, targetMonth))

  return {
    day: targetDay,
    month: targetMonth,
    year: targetYear,
  }
}

function formatBusinessDate(date) {
  return [
    String(date.year).padStart(4, '0'),
    String(date.month).padStart(2, '0'),
    String(date.day).padStart(2, '0'),
  ].join('-')
}

function isValidBusinessDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }

  if (month < 1 || month > 12 || day < 1) {
    return false
  }

  return day <= daysInMonth(year, month)
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
