import type { LocalInstallment } from '@/lib/db/local-db.ts'
import { allocateInstallmentPayment } from '@/lib/finance/payment-contract.ts'
import { MONEY_DECIMAL_SCALE, sumMoney, toMoney } from '@/lib/finance/money.ts'
import type { PaymentApplicationDraft } from '@/types/domain.ts'

type CollectibleInstallment = Pick<
  LocalInstallment,
  | 'id'
  | 'dueDate'
  | 'feeAmount'
  | 'installmentNumber'
  | 'interestAmount'
  | 'outstandingAmount'
  | 'principalAmount'
  | 'status'
>

export type OutstandingInstallmentComponents = {
  feeAmount: string
  interestAmount: string
  principalAmount: string
}

export function isCollectibleInstallment(installment: CollectibleInstallment) {
  return installment.status !== 'paid' && installment.status !== 'canceled' && toMoney(installment.outstandingAmount).gt(0)
}

export function sortInstallmentsForCollection<T extends CollectibleInstallment>(installments: T[]) {
  // Todo flujo de cobro debe respetar este orden para que UI, cache y RPC converjan.
  // Si un asistente cambia este sort sin tocar SQL y tests, rompe la regla de cuota mas antigua primero.
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

export function deriveOutstandingInstallmentComponents(installment: Pick<
  LocalInstallment,
  'feeAmount' | 'interestAmount' | 'outstandingAmount' | 'principalAmount'
>): OutstandingInstallmentComponents {
  const feeAmount = toMoney(installment.feeAmount)
  const interestAmount = toMoney(installment.interestAmount)
  const principalAmount = toMoney(installment.principalAmount)
  const outstandingAmount = toMoney(installment.outstandingAmount)
  const scheduledAmount = sumMoney([feeAmount, interestAmount, principalAmount])

  if (outstandingAmount.lt(0) || outstandingAmount.gt(scheduledAmount)) {
    throw new Error('installment_outstanding_amount_invalid')
  }

  // Como V1 siempre paga fee -> interest -> principal, el saldo por componente
  // puede reconstruirse solo con el total pendiente actual y el desglose original.
  // Esto evita depender de historicos completos en cada bootstrap remoto.
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

export function buildOldestFirstPaymentApplications(
  requestedAmount: string,
  installments: CollectibleInstallment[],
) {
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

  const applications: PaymentApplicationDraft[] = []
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

function decimalMax(value: ReturnType<typeof toMoney>, floorValue: number) {
  const normalizedFloor = toMoney(floorValue)

  return value.greaterThan(normalizedFloor) ? value : normalizedFloor
}

function decimalMin(leftValue: ReturnType<typeof toMoney>, rightValue: ReturnType<typeof toMoney>) {
  return leftValue.lessThan(rightValue) ? leftValue : rightValue
}
