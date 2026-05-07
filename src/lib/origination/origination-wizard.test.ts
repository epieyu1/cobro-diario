import { describe, expect, it } from 'vitest'
import type { SessionProfile } from '@/lib/db/local-db.ts'
import {
  createInitialOriginationDraft,
  validateOriginationDraft,
} from '@/lib/origination/origination-validation.ts'
import { createOriginationWizardViewModel, getOriginationAccess } from '@/lib/origination/origination-wizard.ts'

const ADMIN_PROFILE: SessionProfile = {
  fullName: 'Admin Operativo',
  id: 'admin-1',
  role: 'admin',
}

const COLLECTOR_PROFILE: SessionProfile = {
  fullName: 'Cobrador Bloqueado',
  id: 'collector-1',
  role: 'collector',
}

describe('origination wizard view model', () => {
  it('denies access in UI for collectors before touching the RPC', () => {
    const access = getOriginationAccess(COLLECTOR_PROFILE)

    expect(access.canAccess).toBe(false)
    expect(access.reason).toContain('cobrador')
  })

  it('marks submit as unavailable while the device is offline even with valid data', () => {
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

    const validation = validateOriginationDraft(draft, {
      collectors: [{ fullName: 'Cobrador Centro', id: 'collector-1' }],
      selectedExistingCustomer: null,
    })
    const viewModel = createOriginationWizardViewModel({
      collectors: [{ fullName: 'Cobrador Centro', id: 'collector-1' }],
      currentStep: 'confirm',
      hasTransport: true,
      isOnline: false,
      isSubmitting: false,
      profile: ADMIN_PROFILE,
      selectedExistingCustomer: null,
      validation,
    })

    expect(viewModel.access.canAccess).toBe(true)
    expect(viewModel.previewVisible).toBe(true)
    expect(viewModel.canSubmit).toBe(false)
    expect(viewModel.requiresConnectionMessage).toContain('LANDING')
  })

  it('enables the confirm step for admin once customer and loan validations are complete', () => {
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

    const validation = validateOriginationDraft(draft, {
      collectors: [{ fullName: 'Cobrador Centro', id: 'collector-1' }],
      selectedExistingCustomer: null,
    })
    const viewModel = createOriginationWizardViewModel({
      collectors: [{ fullName: 'Cobrador Centro', id: 'collector-1' }],
      currentStep: 'confirm',
      hasTransport: true,
      isOnline: true,
      isSubmitting: false,
      profile: ADMIN_PROFILE,
      selectedExistingCustomer: null,
      validation,
    })

    expect(viewModel.canGoToLoan).toBe(true)
    expect(viewModel.canGoToConfirm).toBe(true)
    expect(viewModel.canSubmit).toBe(true)
    expect(viewModel.steps).toEqual([
      expect.objectContaining({ key: 'customer', status: 'complete' }),
      expect.objectContaining({ key: 'loan', status: 'complete' }),
      expect.objectContaining({ key: 'confirm', status: 'current' }),
    ])
  })
})
