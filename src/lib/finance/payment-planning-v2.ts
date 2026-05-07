import type { LocalInstallment } from '@/lib/db/local-db.ts'
import { MONEY_DECIMAL_SCALE, sumMoney, toMoney } from '@/lib/finance/money.ts'
import { DIRECTED_PAYMENT_MODES, type DirectedPaymentMode } from '@/lib/finance/payment-contract-v2.ts'
import type { PaymentApplicationDraft } from '@/types/domain.ts'

type DirectedCollectibleInstallment = Pick<
  LocalInstallment,
  | 'id'
  | 'dueDate'
  | 'installmentNumber'
  | 'outstandingAmount'
  | 'outstandingFeeAmount'
  | 'outstandingInterestAmount'
  | 'outstandingPrincipalAmount'
  | 'status'
>

// Intencion: expresar la planeacion local V2 sin contaminar el planner V1 ya validado.
// Flujo: operador elige modo dirigido -> planner toma saldo pendiente por componente -> genera aplicaciones oldest-first.
// Riesgo: si se vuelve a derivar el saldo por componente solo desde outstandingAmount, principal_only e interest_only dejan de ser confiables.
export function buildDirectedPaymentApplications(
  paymentMode: DirectedPaymentMode,
  requestedAmount: string,
  installments: DirectedCollectibleInstallment[],
) {
  if (!DIRECTED_PAYMENT_MODES.includes(paymentMode)) {
    throw new Error('payment_mode_not_supported')
  }

  const normalizedRequestedAmount = toMoney(requestedAmount)

  if (normalizedRequestedAmount.lte(0)) {
    throw new Error('invalid_applied_amount')
  }

  const payableInstallments = sortDirectedInstallmentsForCollection(installments).filter(
    isDirectedCollectibleInstallment,
  )
  const targetOutstandingTotal = sumMoney(
    payableInstallments.map((installment) => resolveTargetOutstandingAmount(paymentMode, installment)),
  )

  if (targetOutstandingTotal.lte(0)) {
    throw new Error('payment_mode_without_target_balance')
  }

  if (normalizedRequestedAmount.gt(targetOutstandingTotal)) {
    throw new Error('payment_amount_exceeds_target_component_outstanding')
  }

  const applications: PaymentApplicationDraft[] = []
  let remainingAmount = normalizedRequestedAmount

  for (const installment of payableInstallments) {
    if (remainingAmount.lte(0)) {
      break
    }

    const targetOutstandingAmount = resolveTargetOutstandingAmount(paymentMode, installment)

    if (targetOutstandingAmount.lte(0)) {
      continue
    }

    const appliedAmount = decimalMin(remainingAmount, targetOutstandingAmount)

    applications.push({
      installmentId: installment.id,
      appliedAmount: appliedAmount.toFixed(MONEY_DECIMAL_SCALE),
      feeComponent: '0.00',
      interestComponent: paymentMode === 'interest_only' ? appliedAmount.toFixed(MONEY_DECIMAL_SCALE) : '0.00',
      principalComponent: paymentMode === 'principal_only' ? appliedAmount.toFixed(MONEY_DECIMAL_SCALE) : '0.00',
    })

    remainingAmount = remainingAmount.minus(appliedAmount)
  }

  if (remainingAmount.gt(0)) {
    throw new Error('payment_amount_exceeds_target_component_outstanding')
  }

  return applications
}

function resolveTargetOutstandingAmount(
  paymentMode: DirectedPaymentMode,
  installment: DirectedCollectibleInstallment,
) {
  switch (paymentMode) {
    case 'principal_only':
      return toMoney(installment.outstandingPrincipalAmount)
    case 'interest_only':
      return toMoney(installment.outstandingInterestAmount)
  }
}

function isDirectedCollectibleInstallment(installment: DirectedCollectibleInstallment) {
  return installment.status !== 'paid' && installment.status !== 'canceled' && toMoney(installment.outstandingAmount).gt(0)
}

function sortDirectedInstallmentsForCollection<T extends DirectedCollectibleInstallment>(installments: T[]) {
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

function decimalMin(leftValue: ReturnType<typeof toMoney>, rightValue: ReturnType<typeof toMoney>) {
  return leftValue.lessThan(rightValue) ? leftValue : rightValue
}
