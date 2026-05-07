import { canAccessOrigination } from '@/lib/auth/role-guards.ts'
import type { SessionProfile } from '@/lib/db/local-db.ts'
import type {
  OriginationCollectorOption,
  OriginationExistingCustomerOption,
  OriginationValidationResult,
} from '@/lib/origination/origination-validation.ts'

export type OriginationWizardStep = 'customer' | 'loan' | 'confirm'

export type OriginationWizardViewModel = {
  access: {
    canAccess: boolean
    reason?: string
  }
  canGoToConfirm: boolean
  canGoToLoan: boolean
  canSubmit: boolean
  collectorSummary: string
  previewVisible: boolean
  requiresConnectionMessage?: string
  selectedCustomerSummary: string
  steps: Array<{
    key: OriginationWizardStep
    label: string
    status: 'complete' | 'current' | 'upcoming'
  }>
}

type OriginationWizardViewModelInput = {
  collectors: OriginationCollectorOption[]
  currentStep: OriginationWizardStep
  hasTransport: boolean
  isOnline: boolean
  isSubmitting: boolean
  profile?: SessionProfile
  selectedExistingCustomer: OriginationExistingCustomerOption | null
  validation: OriginationValidationResult
}

export function createOriginationWizardViewModel(
  input: OriginationWizardViewModelInput,
): OriginationWizardViewModel {
  const access = getOriginationAccess(input.profile)
  const collectorSummary =
    input.validation.submission
      ? resolveCollectorName(input.validation.submission.assignedCollectorId, input.collectors)
      : 'Sin cobrador asignado'
  const selectedCustomerSummary = input.selectedExistingCustomer
    ? `${input.selectedExistingCustomer.fullName} · ${input.selectedExistingCustomer.governmentId ?? 'Sin documento'}`
    : 'Sin deudor seleccionado'

  return {
    access,
    canGoToConfirm: access.canAccess && input.validation.loanStepValid,
    canGoToLoan: access.canAccess && input.validation.customerStepValid,
    canSubmit:
      access.canAccess &&
      input.isOnline &&
      input.hasTransport &&
      input.validation.canSubmit &&
      !input.isSubmitting,
    collectorSummary,
    previewVisible: Boolean(input.validation.schedule?.installments.length),
    requiresConnectionMessage:
      input.isOnline && input.hasTransport
        ? undefined
        : 'La originación V1 requiere conexión a LANDING antes de confirmar.',
    selectedCustomerSummary,
    steps: ORIGINATION_WIZARD_STEPS.map((step, stepIndex) => ({
      key: step.key,
      label: step.label,
      status:
        step.key === input.currentStep
          ? 'current'
          : stepIndex < ORIGINATION_WIZARD_STEPS.findIndex((candidateStep) => candidateStep.key === input.currentStep)
            ? 'complete'
            : 'upcoming',
    })),
  }
}

export function getOriginationAccess(profile?: SessionProfile) {
  if (!profile) {
    return {
      canAccess: false,
      reason: 'La originación requiere un perfil remoto válido antes de abrir el flujo.',
    }
  }

  if (!canAccessOrigination(profile)) {
    return {
      canAccess: false,
      reason: 'Tu rol actual es cobrador. En V1 solo el administrador puede originar.',
    }
  }

  return {
    canAccess: true,
  }
}

function resolveCollectorName(collectorId: string, collectors: OriginationCollectorOption[]) {
  return collectors.find((collector) => collector.id === collectorId)?.fullName ?? 'Cobrador no resuelto'
}

const ORIGINATION_WIZARD_STEPS = [
  { key: 'customer' as const, label: 'Deudor' },
  { key: 'loan' as const, label: 'Préstamo' },
  { key: 'confirm' as const, label: 'Confirmar' },
]
