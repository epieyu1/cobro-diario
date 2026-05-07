import Decimal from 'decimal.js'

export const MONEY_DECIMAL_SCALE = 2
export const MONEY_ROUNDING_MODE = Decimal.ROUND_HALF_UP

export function toMoney(value) {
  return new Decimal(value).toDecimalPlaces(MONEY_DECIMAL_SCALE, MONEY_ROUNDING_MODE)
}

export function sumMoney(values) {
  return toMoney(values.reduce((accumulator, currentValue) => accumulator.plus(currentValue), new Decimal(0)))
}

export function isCollectibleInstallment(installment) {
  return installment.status !== 'paid' && installment.status !== 'canceled' && toMoney(installment.outstandingAmount).gt(0)
}

export function sortInstallmentsForCollection(installments) {
  return [...installments].sort((leftInstallment, rightInstallment) => {
    const dueDateComparison = leftInstallment.dueDate.localeCompare(rightInstallment.dueDate)

    if (dueDateComparison !== 0) {
      return dueDateComparison
    }

    if (leftInstallment.installmentNumber !== rightInstallment.installmentNumber) {
      return leftInstallment.installmentNumber - rightInstallment.installmentNumber
    }

    return leftInstallment.id.localeCompare(rightInstallment.id)
  })
}

export function deriveOutstandingInstallmentComponents(installment) {
  const feeAmount = toMoney(installment.feeAmount)
  const interestAmount = toMoney(installment.interestAmount)
  const principalAmount = toMoney(installment.principalAmount)
  const outstandingAmount = toMoney(installment.outstandingAmount)
  const scheduledAmount = sumMoney([feeAmount, interestAmount, principalAmount])

  if (outstandingAmount.lt(0) || outstandingAmount.gt(scheduledAmount)) {
    throw new Error('installment_outstanding_amount_invalid')
  }

  // Este espejo JS debe permanecer alineado con `payment-contract.ts`, `payment-planning.ts`
  // y `record_payment()`. Su unica razon de existir es verificar el contrato V1 desde Node.
  const paidAmount = scheduledAmount.minus(outstandingAmount)
  const feePaid = decimalMin(paidAmount, feeAmount)
  const interestPaid = decimalMin(decimalMax(paidAmount.minus(feeAmount), 0), interestAmount)
  const principalPaid = decimalMin(
    decimalMax(paidAmount.minus(feeAmount).minus(interestAmount), 0),
    principalAmount,
  )

  return {
    feeAmount: feeAmount.minus(feePaid).toFixed(MONEY_DECIMAL_SCALE),
    interestAmount: interestAmount.minus(interestPaid).toFixed(MONEY_DECIMAL_SCALE),
    principalAmount: principalAmount.minus(principalPaid).toFixed(MONEY_DECIMAL_SCALE),
  }
}

export function allocateInstallmentPayment(requestedAmount, balance) {
  const feeAmount = toMoney(balance.feeAmount)
  const interestAmount = toMoney(balance.interestAmount)
  const principalAmount = toMoney(balance.principalAmount)
  let remainingAmount = toMoney(requestedAmount)

  if (remainingAmount.lte(0)) {
    throw new Error('invalid_applied_amount')
  }

  if (feeAmount.lt(0) || interestAmount.lt(0) || principalAmount.lt(0)) {
    throw new Error('installment_component_balance_invalid')
  }

  const feeComponent = decimalMin(remainingAmount, feeAmount)
  remainingAmount = remainingAmount.minus(feeComponent)

  const interestComponent = decimalMin(remainingAmount, interestAmount)
  remainingAmount = remainingAmount.minus(interestComponent)

  const principalComponent = decimalMin(remainingAmount, principalAmount)
  remainingAmount = remainingAmount.minus(principalComponent)

  if (remainingAmount.gt(0)) {
    throw new Error('application_exceeds_component_balance')
  }

  return {
    feeComponent: feeComponent.toFixed(MONEY_DECIMAL_SCALE),
    interestComponent: interestComponent.toFixed(MONEY_DECIMAL_SCALE),
    principalComponent: principalComponent.toFixed(MONEY_DECIMAL_SCALE),
    appliedAmount: sumMoney([feeComponent, interestComponent, principalComponent]).toFixed(
      MONEY_DECIMAL_SCALE,
    ),
  }
}

export function buildOldestFirstPaymentApplications(requestedAmount, installments) {
  const normalizedRequestedAmount = toMoney(requestedAmount)

  if (normalizedRequestedAmount.lte(0)) {
    throw new Error('invalid_applied_amount')
  }

  const payableInstallments = sortInstallmentsForCollection(installments).filter(isCollectibleInstallment)

  if (payableInstallments.length === 0) {
    throw new Error('loan_without_payable_installments')
  }

  const outstandingTotal = sumMoney(payableInstallments.map((installment) => installment.outstandingAmount))

  if (normalizedRequestedAmount.gt(outstandingTotal)) {
    throw new Error('payment_amount_exceeds_loan_outstanding')
  }

  const applications = []
  let remainingAmount = normalizedRequestedAmount

  for (const installment of payableInstallments) {
    if (remainingAmount.lte(0)) {
      break
    }

    const outstandingComponents = deriveOutstandingInstallmentComponents(installment)
    const installmentOutstandingAmount = sumMoney([
      outstandingComponents.feeAmount,
      outstandingComponents.interestAmount,
      outstandingComponents.principalAmount,
    ])
    const installmentAmount = decimalMin(remainingAmount, installmentOutstandingAmount)

    if (installmentAmount.lte(0)) {
      continue
    }

    const application = allocateInstallmentPayment(installmentAmount.toFixed(MONEY_DECIMAL_SCALE), {
      feeAmount: outstandingComponents.feeAmount,
      interestAmount: outstandingComponents.interestAmount,
      principalAmount: outstandingComponents.principalAmount,
    })

    applications.push({
      installmentId: installment.id,
      appliedAmount: application.appliedAmount,
      feeComponent: application.feeComponent,
      interestComponent: application.interestComponent,
      principalComponent: application.principalComponent,
    })

    remainingAmount = remainingAmount.minus(application.appliedAmount)
  }

  if (remainingAmount.gt(0)) {
    throw new Error('payment_amount_exceeds_loan_outstanding')
  }

  return applications
}

function decimalMax(value, floorValue) {
  const normalizedFloor = toMoney(floorValue)

  return value.greaterThan(normalizedFloor) ? value : normalizedFloor
}

function decimalMin(leftValue, rightValue) {
  return leftValue.lessThan(rightValue) ? leftValue : rightValue
}
