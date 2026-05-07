import {
  buildOriginationSchedule,
  ORIGINATION_INTEREST_MODE,
  ORIGINATION_PAYMENT_APPLICATION_MODE,
  serializeOriginationScheduleForRpc,
  type OriginationSchedule,
} from '@/lib/finance/origination-schedule.ts'
import type {
  LoanInterestMode,
  LoanPaymentApplicationMode,
  OriginationPaymentFrequency,
} from '@/types/domain.ts'

export type OriginationWizardMode = 'new_customer' | 'existing_customer'

export type OriginationCollectorOption = {
  id: string
  fullName: string
  phone?: string
}

export type OriginationExistingCustomerOption = {
  id: string
  assignedCollectorId: string
  fullName: string
  governmentId?: string
  phone?: string
  addressLine?: string
  routeLabel?: string
  neighborhood?: string
}

export type OriginationNewCustomerDraft = {
  assignedCollectorId: string
  fullName: string
  governmentId: string
  phone: string
  addressLine: string
  routeLabel: string
  neighborhood: string
  notes: string
}

export type OriginationLoanDraft = {
  principalAmount: string
  installmentAmount: string
  totalInstallments: string
  paymentFrequency: OriginationPaymentFrequency
  disbursementDate: string
  firstDueDate: string
  interestMode: LoanInterestMode
  paymentApplicationMode: LoanPaymentApplicationMode
  interestRateDaily: string
  notes: string
}

export type OriginationWizardDraft = {
  mode: OriginationWizardMode
  newCustomer: OriginationNewCustomerDraft
  loan: OriginationLoanDraft
}

export type OriginationFieldKey =
  | 'assigned_collector_id'
  | 'existing_customer_id'
  | 'full_name'
  | 'government_id'
  | 'phone'
  | 'address_line'
  | 'route_label'
  | 'neighborhood'
  | 'principal_amount'
  | 'installment_amount'
  | 'total_installments'
  | 'payment_frequency'
  | 'interest_mode'
  | 'payment_application_mode'
  | 'disbursement_date'
  | 'first_due_date'
  | 'interest_rate_daily'
  | 'form'

export type OriginationFieldErrors = Partial<Record<OriginationFieldKey, string>>

export type ValidatedOriginationSubmission = {
  assignedCollectorId: string
  customerPayload: Record<string, unknown> | null
  existingCustomerId: string | null
  installmentsPayload: Record<string, unknown>[]
  loanPayload: Record<string, unknown>
  schedule: OriginationSchedule
}

export type OriginationValidationResult = {
  canSubmit: boolean
  customerFieldErrors: OriginationFieldErrors
  customerStepValid: boolean
  loanFieldErrors: OriginationFieldErrors
  loanStepValid: boolean
  schedule: OriginationSchedule | null
  submission: ValidatedOriginationSubmission | null
}

type OriginationValidationOptions = {
  collectors: OriginationCollectorOption[]
  selectedExistingCustomer: OriginationExistingCustomerOption | null
}

export function createInitialOriginationDraft(): OriginationWizardDraft {
  return {
    loan: {
      disbursementDate: '',
      firstDueDate: '',
      interestMode: ORIGINATION_INTEREST_MODE,
      installmentAmount: '',
      interestRateDaily: '',
      notes: '',
      paymentApplicationMode: ORIGINATION_PAYMENT_APPLICATION_MODE,
      paymentFrequency: 'weekly',
      principalAmount: '',
      totalInstallments: '',
    },
    mode: 'new_customer',
    newCustomer: {
      addressLine: '',
      assignedCollectorId: '',
      fullName: '',
      governmentId: '',
      neighborhood: '',
      notes: '',
      phone: '',
      routeLabel: '',
    },
  }
}

export function validateOriginationDraft(
  draft: OriginationWizardDraft,
  options: OriginationValidationOptions,
): OriginationValidationResult {
  const customerFieldErrors: OriginationFieldErrors = {}
  const loanFieldErrors: OriginationFieldErrors = {}

  let assignedCollectorId = ''
  let customerPayload: Record<string, unknown> | null = null
  let existingCustomerId: string | null = null

  if (draft.mode === 'new_customer') {
    assignedCollectorId = normalizeText(draft.newCustomer.assignedCollectorId)
    // El payload final exige una ruta operativa no vacia.
    // Si el usuario no personaliza la etiqueta dedicada, la UI conserva neighborhood
    // como fallback de compatibilidad para no desalinearse del contrato RPC.
    const normalizedRouteLabel =
      normalizeText(draft.newCustomer.routeLabel) || normalizeText(draft.newCustomer.neighborhood)

    if (!assignedCollectorId || !options.collectors.some((collector) => collector.id === assignedCollectorId)) {
      customerFieldErrors.assigned_collector_id = 'assigned_collector_id_required'
    }

    if (!normalizeText(draft.newCustomer.fullName)) {
      customerFieldErrors.full_name = 'customer_full_name_required'
    }

    if (!normalizeText(draft.newCustomer.governmentId)) {
      customerFieldErrors.government_id = 'customer_government_id_required'
    }

    if (!normalizeText(draft.newCustomer.phone)) {
      customerFieldErrors.phone = 'customer_phone_required'
    }

    if (!normalizeText(draft.newCustomer.addressLine)) {
      customerFieldErrors.address_line = 'customer_address_line_required'
    }

    if (!normalizeText(draft.newCustomer.neighborhood)) {
      customerFieldErrors.neighborhood = 'customer_neighborhood_required'
    }

    if (!normalizedRouteLabel) {
      customerFieldErrors.route_label = 'customer_route_label_required'
    }

    if (Object.keys(customerFieldErrors).length === 0) {
      customerPayload = {
        address_line: normalizeText(draft.newCustomer.addressLine),
        assigned_collector_id: assignedCollectorId,
        full_name: normalizeText(draft.newCustomer.fullName),
        government_id: normalizeText(draft.newCustomer.governmentId),
        neighborhood: normalizeText(draft.newCustomer.neighborhood),
        notes: normalizeOptionalText(draft.newCustomer.notes),
        phone: normalizeText(draft.newCustomer.phone),
        route_label: normalizedRouteLabel,
      }
    }
  } else {
    existingCustomerId = options.selectedExistingCustomer?.id ?? null
    assignedCollectorId = options.selectedExistingCustomer?.assignedCollectorId ?? ''

    if (!existingCustomerId) {
      customerFieldErrors.existing_customer_id = 'existing_customer_selection_required'
    }
  }

  const normalizedInstallments = Number.parseInt(normalizeText(draft.loan.totalInstallments), 10)
  const normalizedInterestRateDaily = normalizeInterestRateDaily(draft.loan.interestRateDaily)
  const normalizedInterestMode = normalizeInterestMode(draft.loan.interestMode)
  const normalizedPaymentApplicationMode = normalizePaymentApplicationMode(draft.loan.paymentApplicationMode)

  if (!normalizedInterestRateDaily) {
    loanFieldErrors.interest_rate_daily = 'loan_interest_rate_daily_invalid'
  }

  if (!normalizedInterestMode) {
    loanFieldErrors.interest_mode = 'loan_interest_mode_invalid'
  }

  if (!normalizedPaymentApplicationMode) {
    loanFieldErrors.payment_application_mode = 'loan_payment_application_mode_invalid'
  }

  if (
    normalizedInterestMode === ORIGINATION_INTEREST_MODE
    && normalizedPaymentApplicationMode
    && normalizedPaymentApplicationMode !== ORIGINATION_PAYMENT_APPLICATION_MODE
  ) {
    loanFieldErrors.payment_application_mode = 'loan_payment_application_mode_not_supported'
  }

  let schedule: OriginationSchedule | null = null

  if (Object.keys(customerFieldErrors).length === 0 && Object.keys(loanFieldErrors).length === 0) {
    try {
      schedule = buildOriginationSchedule({
        disbursementDate: draft.loan.disbursementDate,
        firstDueDate: draft.loan.firstDueDate,
        installmentAmount: draft.loan.installmentAmount,
        interestMode: normalizedInterestMode ?? undefined,
        interestRateDaily: normalizedInterestRateDaily ?? undefined,
        paymentApplicationMode: normalizedPaymentApplicationMode ?? undefined,
        paymentFrequency: draft.loan.paymentFrequency,
        principalAmount: draft.loan.principalAmount,
        totalInstallments: normalizedInstallments,
      })
    } catch (error) {
      const errorCode = extractOriginationErrorCode(error)
      const fieldKey = ORIGINATION_ERROR_FIELD_MAP[errorCode] ?? 'form'
      loanFieldErrors[fieldKey] = errorCode
    }
  }

  const customerStepValid = Object.keys(customerFieldErrors).length === 0
  const loanStepValid = customerStepValid && Object.keys(loanFieldErrors).length === 0 && Boolean(schedule)

  if (!loanStepValid || !schedule || !normalizedInterestRateDaily) {
    return {
      canSubmit: false,
      customerFieldErrors,
      customerStepValid,
      loanFieldErrors,
      loanStepValid,
      schedule,
      submission: null,
    }
  }

  return {
    canSubmit: true,
    customerFieldErrors,
    customerStepValid,
    loanFieldErrors,
    loanStepValid,
    schedule,
    submission: {
      assignedCollectorId,
      customerPayload,
      existingCustomerId,
      installmentsPayload: serializeOriginationScheduleForRpc(schedule),
      loanPayload: {
        collector_id: assignedCollectorId,
        currency_code: 'COP',
        disbursement_date: schedule.disbursementDate,
        first_due_date: schedule.firstDueDate,
        installment_amount: schedule.installmentAmount,
        interest_mode: schedule.interestMode,
        interest_rate_daily: normalizedInterestRateDaily,
        notes: normalizeOptionalText(draft.loan.notes),
        payment_application_mode: schedule.paymentApplicationMode,
        payment_frequency: schedule.paymentFrequency,
        principal_amount: schedule.totalPrincipalAmount,
        total_installments: schedule.totalInstallments,
      },
      schedule,
    },
  }
}

export function describeOriginationError(errorCode: string) {
  return ORIGINATION_ERROR_MESSAGES[errorCode] ?? 'No se pudo procesar la originación con el contrato actual.'
}

function normalizeText(value: string) {
  return value.trim()
}

function normalizeOptionalText(value: string) {
  const normalized = normalizeText(value)

  return normalized || null
}

function normalizeInterestRateDaily(value: string) {
  const normalized = normalizeText(value).replace(/\s+/g, '')

  if (!normalized) {
    return '0.000000'
  }

  if (!/^\d*(?:[.,]\d+)?$/.test(normalized) || normalized === '.' || normalized === ',') {
    return null
  }

  const parsedValue = Number.parseFloat(normalized.replace(',', '.'))

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null
  }

  return parsedValue.toFixed(6)
}

function normalizeInterestMode(value: LoanInterestMode) {
  if (value === 'simple_precomputed' || value === 'compound_fixed_installment') {
    return value
  }

  return null
}

function normalizePaymentApplicationMode(value: LoanPaymentApplicationMode) {
  if (value === 'oldest_first' || value === 'principal_only' || value === 'interest_only') {
    return value
  }

  return null
}

function extractOriginationErrorCode(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'form_validation_failed'
}

const ORIGINATION_ERROR_FIELD_MAP: Record<string, OriginationFieldKey> = {
  customer_route_label_required: 'route_label',
  loan_disbursement_date_required: 'disbursement_date',
  loan_first_due_date_before_disbursement: 'first_due_date',
  loan_first_due_date_required: 'first_due_date',
  loan_installment_amount_invalid: 'installment_amount',
  loan_installment_component_invalid: 'installment_amount',
  loan_interest_mode_invalid: 'interest_mode',
  loan_payment_frequency_invalid: 'payment_frequency',
  loan_payment_application_mode_invalid: 'payment_application_mode',
  loan_payment_application_mode_not_supported: 'payment_application_mode',
  loan_principal_amount_invalid: 'principal_amount',
  loan_total_installments_invalid: 'total_installments',
  loan_total_scheduled_below_principal: 'installment_amount',
}

const ORIGINATION_ERROR_MESSAGES: Record<string, string> = {
  assigned_collector_id_required: 'Selecciona el cobrador responsable del deudor.',
  assigned_collector_must_be_active_collector:
    'El deudor debe quedar asignado a un cobrador activo antes de confirmar la originación.',
  assigned_collector_not_allowed: 'Tu alcance actual no permite originar para ese cobrador.',
  authentication_required: 'Debes iniciar sesión antes de originar un préstamo.',
  collector_auth_user_missing: 'Auth no devolvio el identificador del cobrador nuevo. Repite el alta.',
  collector_email_already_registered: 'Ese correo ya existe en Auth. Usa otro o recupera ese acceso.',
  collector_email_invalid: 'El correo del cobrador debe tener un formato valido.',
  collector_manager_inactive: 'Tu perfil esta inactivo y no puede crear cobradores.',
  collector_manager_role_not_allowed: 'Solo un administrador puede crear cobradores.',
  collector_email_required: 'El correo del cobrador es obligatorio.',
  collector_full_name_required: 'El nombre del cobrador es obligatorio.',
  collector_password_too_short: 'La clave del cobrador debe tener al menos 6 caracteres.',
  customer_address_line_required: 'La direccion es obligatoria para ubicar la ruta del cobrador.',
  customer_full_name_required: 'El nombre completo del deudor es obligatorio.',
  customer_government_id_conflict: 'Ya existe un deudor con ese documento en el dominio operativo.',
  customer_government_id_required: 'El documento es obligatorio para prevenir duplicados.',
  customer_mode_conflict: 'Elige entre crear un deudor nuevo o reutilizar uno existente.',
  customer_neighborhood_required: 'El barrio es obligatorio para sostener la ruta operativa.',
  customer_route_label_required:
    'La ruta operativa es obligatoria; puedes usar el barrio o personalizar una etiqueta de ruta.',
  customer_open_loan_exists: 'Ese deudor ya tiene un préstamo abierto y no puede originarse otro con el contrato actual.',
  customer_payload_required: 'Completa primero los datos del deudor.',
  customer_phone_required: 'El teléfono es obligatorio para seguimiento operativo.',
  existing_customer_archived: 'El deudor seleccionado ya fue archivado y no puede reutilizarse.',
  existing_customer_id_required: 'Selecciona un deudor existente antes de continuar.',
  existing_customer_not_found: 'El deudor seleccionado ya no esta disponible en remoto.',
  existing_customer_selection_required: 'Busca y selecciona un deudor existente antes de continuar.',
  form_validation_failed: 'Revisa los datos del formulario antes de continuar.',
  installment_schedule_mismatch:
    'La vista previa ya no coincide con la regla remota. Revisa los datos y vuelve a generar el cronograma.',
  installments_count_mismatch: 'La cantidad de cuotas del preview no coincide con el contrato del prestamo.',
  installments_payload_required: 'Genera primero un cronograma valido antes de confirmar.',
  invalid_installment_payload: 'La vista previa de cuotas quedo incompleta. Revisa el cronograma.',
  invalid_collector_provision_response:
    'El alta del cobrador no devolvio la identidad esperada. Repite la operacion.',
  loan_collector_mismatch: 'El prestamo debe conservar el mismo cobrador asignado al deudor.',
  loan_currency_not_supported: 'La originación actual solo soporta COP.',
  loan_disbursement_date_required: 'Define la fecha de desembolso.',
  loan_first_due_date_before_disbursement:
    'La primera fecha de cobro no puede quedar antes del desembolso.',
  loan_first_due_date_required: 'Define la primera fecha de cobro.',
  loan_installment_amount_invalid: 'El valor de la cuota debe ser mayor que cero.',
  loan_installment_component_invalid: 'La combinacion de capital e interes genero una cuota invalida.',
  loan_interest_mode_invalid: 'Selecciona un motor financiero válido.',
  loan_interest_mode_not_supported: 'El modo financiero elegido todavía no está permitido por el contrato remoto.',
  loan_interest_rate_daily_invalid: 'La tasa diaria informativa debe ser un numero igual o mayor a cero.',
  loan_payload_required: 'Completa primero los datos del prestamo.',
  loan_payment_application_mode_invalid: 'Selecciona una regla valida para aplicar los abonos.',
  loan_payment_application_mode_not_supported:
    'El interés simple V1 solo permite repartir el pago por antigüedad.',
  loan_payment_frequency_invalid: 'Selecciona una frecuencia valida.',
  loan_principal_amount_invalid: 'El capital debe ser mayor que cero.',
  loan_total_installments_invalid: 'El numero de cuotas debe ser un entero mayor que cero.',
  loan_total_scheduled_below_principal:
    'La suma de cuotas no puede quedar por debajo del capital desembolsado.',
  originator_inactive: 'Tu perfil esta inactivo y no puede originar prestamos en este momento.',
  originator_role_not_allowed: 'Solo el administrador puede originar préstamos en este flujo.',
  requires_connection: 'La originación requiere conexión para persistir clientes, préstamos y cuotas en LANDING.',
}
