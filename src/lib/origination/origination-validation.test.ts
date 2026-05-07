import { describe, expect, it } from 'vitest'
import {
  createInitialOriginationDraft,
  describeOriginationError,
  validateOriginationDraft,
  type OriginationCollectorOption,
  type OriginationExistingCustomerOption,
} from '@/lib/origination/origination-validation.ts'

const COLLECTORS: OriginationCollectorOption[] = [
  { fullName: 'Cobrador Centro', id: 'collector-1' },
  { fullName: 'Cobrador Norte', id: 'collector-2' },
]

const EXISTING_CUSTOMER: OriginationExistingCustomerOption = {
  addressLine: 'Calle 10 # 4-22',
  assignedCollectorId: 'collector-2',
  fullName: 'Mariana Perez',
  governmentId: '100200300',
  id: 'customer-1',
  neighborhood: 'Centro',
  phone: '3001234567',
  routeLabel: 'Ruta Centro',
}

describe('validateOriginationDraft', () => {
  it('builds a valid submission for a new customer and serializes the RPC payload contract', () => {
    const draft = createInitialOriginationDraft()

    draft.newCustomer.assignedCollectorId = 'collector-1'
    draft.newCustomer.fullName = 'Ana Torres'
    draft.newCustomer.governmentId = '123456789'
    draft.newCustomer.phone = '3001112233'
    draft.newCustomer.addressLine = 'Cra 8 # 12-34'
    draft.newCustomer.neighborhood = 'Centro'
    draft.newCustomer.routeLabel = 'Ruta Centro Lunes'
    draft.newCustomer.notes = 'Visita de alta'
    draft.loan.principalAmount = '120'
    draft.loan.installmentAmount = '70'
    draft.loan.totalInstallments = '2'
    draft.loan.paymentFrequency = 'weekly'
    draft.loan.disbursementDate = '2026-05-06'
    draft.loan.firstDueDate = '2026-05-13'
    draft.loan.interestRateDaily = '0.050000'
    draft.loan.notes = 'Prestamo inaugural'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(validation.canSubmit).toBe(true)
    expect(validation.customerStepValid).toBe(true)
    expect(validation.loanStepValid).toBe(true)
    expect(validation.schedule?.installments).toHaveLength(2)
    expect(validation.submission).toMatchObject({
      assignedCollectorId: 'collector-1',
      customerPayload: {
        assigned_collector_id: 'collector-1',
        full_name: 'Ana Torres',
        government_id: '123456789',
        route_label: 'Ruta Centro Lunes',
      },
      existingCustomerId: null,
      loanPayload: {
        collector_id: 'collector-1',
        currency_code: 'COP',
        interest_mode: 'simple_precomputed',
        interest_rate_daily: '0.050000',
        payment_application_mode: 'oldest_first',
        total_installments: 2,
      },
    })
    expect(validation.submission?.installmentsPayload[0]).toMatchObject({
      due_date: '2026-05-13',
      installment_number: 1,
      scheduled_amount: '70.00',
    })
  })

  it('requires an existing customer selection before advancing that mode', () => {
    const draft = createInitialOriginationDraft()
    draft.mode = 'existing_customer'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(validation.canSubmit).toBe(false)
    expect(validation.customerStepValid).toBe(false)
    expect(validation.customerFieldErrors.existing_customer_id).toBe('existing_customer_selection_required')
    expect(describeOriginationError(validation.customerFieldErrors.existing_customer_id!)).toContain('selecciona')
  })

  it('reuses an existing customer and keeps the collector derived from that remote row', () => {
    const draft = createInitialOriginationDraft()
    draft.mode = 'existing_customer'
    draft.loan.principalAmount = '50'
    draft.loan.installmentAmount = '55'
    draft.loan.totalInstallments = '1'
    draft.loan.paymentFrequency = 'daily'
    draft.loan.disbursementDate = '2026-05-06'
    draft.loan.firstDueDate = '2026-05-07'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: EXISTING_CUSTOMER,
    })

    expect(validation.canSubmit).toBe(true)
    expect(validation.submission).toMatchObject({
      assignedCollectorId: 'collector-2',
      customerPayload: null,
      existingCustomerId: 'customer-1',
      loanPayload: {
        collector_id: 'collector-2',
      },
    })
  })

  it('treats the daily rate as optional input and normalizes locale decimals when present', () => {
    const draft = createInitialOriginationDraft()

    draft.newCustomer.assignedCollectorId = 'collector-1'
    draft.newCustomer.fullName = 'Ana Torres'
    draft.newCustomer.governmentId = '123456789'
    draft.newCustomer.phone = '3001112233'
    draft.newCustomer.addressLine = 'Cra 8 # 12-34'
    draft.newCustomer.neighborhood = 'Centro'
    draft.newCustomer.routeLabel = 'Ruta Centro Lunes'
    draft.loan.principalAmount = '120'
    draft.loan.installmentAmount = '70'
    draft.loan.totalInstallments = '2'
    draft.loan.paymentFrequency = 'weekly'
    draft.loan.disbursementDate = '2026-05-06'
    draft.loan.firstDueDate = '2026-05-13'

    const blankRateValidation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(blankRateValidation.canSubmit).toBe(true)
    expect(blankRateValidation.submission?.loanPayload).toMatchObject({
      interest_rate_daily: '0.000000',
    })

    draft.loan.interestRateDaily = '0,050000'

    const localizedRateValidation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(localizedRateValidation.canSubmit).toBe(true)
    expect(localizedRateValidation.submission?.loanPayload).toMatchObject({
      interest_rate_daily: '0.050000',
    })
  })

  it('builds a compound V2 submission with an explicit directed payment mode', () => {
    const draft = createInitialOriginationDraft()

    draft.newCustomer.assignedCollectorId = 'collector-1'
    draft.newCustomer.fullName = 'Ana Torres'
    draft.newCustomer.governmentId = '123456789'
    draft.newCustomer.phone = '3001112233'
    draft.newCustomer.addressLine = 'Cra 8 # 12-34'
    draft.newCustomer.neighborhood = 'Centro'
    draft.newCustomer.routeLabel = 'Ruta Centro Lunes'
    draft.loan.interestMode = 'compound_fixed_installment'
    draft.loan.paymentApplicationMode = 'principal_only'
    draft.loan.principalAmount = '100.00'
    draft.loan.totalInstallments = '2'
    draft.loan.paymentFrequency = 'daily'
    draft.loan.disbursementDate = '2026-01-01'
    draft.loan.firstDueDate = '2026-01-02'
    draft.loan.interestRateDaily = '0.10'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(validation.canSubmit).toBe(true)
    expect(validation.submission?.loanPayload).toMatchObject({
      interest_mode: 'compound_fixed_installment',
      payment_application_mode: 'principal_only',
      installment_amount: '57.62',
    })
    expect(validation.submission?.installmentsPayload[0]).toMatchObject({
      outstanding_principal_amount: '47.62',
      outstanding_interest_amount: '10.00',
    })
  })

  it('surfaces the financial contract error when the scheduled total stays below principal', () => {
    const draft = createInitialOriginationDraft()

    draft.newCustomer.assignedCollectorId = 'collector-1'
    draft.newCustomer.fullName = 'Ana Torres'
    draft.newCustomer.governmentId = '123456789'
    draft.newCustomer.phone = '3001112233'
    draft.newCustomer.addressLine = 'Cra 8 # 12-34'
    draft.newCustomer.neighborhood = 'Centro'
    draft.newCustomer.routeLabel = 'Ruta Centro Lunes'
    draft.loan.principalAmount = '100'
    draft.loan.installmentAmount = '30'
    draft.loan.totalInstallments = '3'
    draft.loan.paymentFrequency = 'daily'
    draft.loan.disbursementDate = '2026-05-06'
    draft.loan.firstDueDate = '2026-05-07'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(validation.canSubmit).toBe(false)
    expect(validation.loanFieldErrors.installment_amount).toBe('loan_total_scheduled_below_principal')
  })

  it('blocks directed payment modes on simple_precomputed loans', () => {
    const draft = createInitialOriginationDraft()

    draft.newCustomer.assignedCollectorId = 'collector-1'
    draft.newCustomer.fullName = 'Ana Torres'
    draft.newCustomer.governmentId = '123456789'
    draft.newCustomer.phone = '3001112233'
    draft.newCustomer.addressLine = 'Cra 8 # 12-34'
    draft.newCustomer.neighborhood = 'Centro'
    draft.newCustomer.routeLabel = 'Ruta Centro Lunes'
    draft.loan.paymentApplicationMode = 'principal_only'
    draft.loan.principalAmount = '120'
    draft.loan.installmentAmount = '70'
    draft.loan.totalInstallments = '2'
    draft.loan.paymentFrequency = 'weekly'
    draft.loan.disbursementDate = '2026-05-06'
    draft.loan.firstDueDate = '2026-05-13'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(validation.canSubmit).toBe(false)
    expect(validation.loanFieldErrors.payment_application_mode).toBe('loan_payment_application_mode_not_supported')
  })

  it('falls back to the neighborhood when the dedicated route label stays blank', () => {
    const draft = createInitialOriginationDraft()

    draft.newCustomer.assignedCollectorId = 'collector-1'
    draft.newCustomer.fullName = 'Ana Torres'
    draft.newCustomer.governmentId = '123456789'
    draft.newCustomer.phone = '3001112233'
    draft.newCustomer.addressLine = 'Cra 8 # 12-34'
    draft.newCustomer.neighborhood = 'Centro'
    draft.loan.principalAmount = '120'
    draft.loan.installmentAmount = '70'
    draft.loan.totalInstallments = '2'
    draft.loan.paymentFrequency = 'weekly'
    draft.loan.disbursementDate = '2026-05-06'
    draft.loan.firstDueDate = '2026-05-13'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(validation.canSubmit).toBe(true)
    expect(validation.submission?.customerPayload).toMatchObject({
      route_label: 'Centro',
    })
  })

  it('treats a whitespace-only route label as empty and still falls back to the neighborhood', () => {
    const draft = createInitialOriginationDraft()

    draft.newCustomer.assignedCollectorId = 'collector-1'
    draft.newCustomer.fullName = 'Ana Torres'
    draft.newCustomer.governmentId = '123456789'
    draft.newCustomer.phone = '3001112233'
    draft.newCustomer.addressLine = 'Cra 8 # 12-34'
    draft.newCustomer.neighborhood = 'Centro'
    draft.newCustomer.routeLabel = '   '
    draft.loan.principalAmount = '120'
    draft.loan.installmentAmount = '70'
    draft.loan.totalInstallments = '2'
    draft.loan.paymentFrequency = 'weekly'
    draft.loan.disbursementDate = '2026-05-06'
    draft.loan.firstDueDate = '2026-05-13'

    const validation = validateOriginationDraft(draft, {
      collectors: COLLECTORS,
      selectedExistingCustomer: null,
    })

    expect(validation.canSubmit).toBe(true)
    expect(validation.submission?.customerPayload).toMatchObject({
      route_label: 'Centro',
    })
  })
})
