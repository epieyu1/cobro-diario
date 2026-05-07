import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { env } from '@/lib/env.ts'
import { CurrencyAmountInput } from '@/lib/finance/currency-amount-input.tsx'
import { formatCurrency } from '@/lib/finance/money.ts'
import { createSupabaseOriginationTransport } from '@/lib/origination/origination-transport.ts'
import {
  createInitialOriginationDraft,
  describeOriginationError,
  type OriginationFieldErrors,
  type OriginationCollectorOption,
  type OriginationExistingCustomerOption,
  validateOriginationDraft,
  type OriginationWizardDraft,
} from '@/lib/origination/origination-validation.ts'
import { createOriginationWizardViewModel, type OriginationWizardStep } from '@/lib/origination/origination-wizard.ts'
import type { SessionProfile } from '@/lib/db/local-db.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

export type OriginationCompletedPayload = {
  assignedCollectorId: string
  assignedCollectorName: string
  createdCustomer: boolean
  customerDisplayName: string
  externalLoanNumber: string
  loanId: string
  message: string
}

type OriginationWizardPanelProps = {
  isOnline: boolean
  profile?: SessionProfile
  supabaseClient: SupabaseClient | null
  onOriginated?: (payload: OriginationCompletedPayload) => void
}

type CollectorCreationDraft = {
  email: string
  fullName: string
  password: string
  phone: string
}

export function OriginationWizardPanel({
  isOnline,
  onOriginated,
  profile,
  supabaseClient,
}: OriginationWizardPanelProps) {
  const [draft, setDraft] = useState<OriginationWizardDraft>(createInitialOriginationDraft)
  const [currentStep, setCurrentStep] = useState<OriginationWizardStep>('customer')
  const [collectors, setCollectors] = useState<OriginationCollectorOption[]>([])
  const [collectorsError, setCollectorsError] = useState<string | null>(null)
  const [isLoadingCollectors, setIsLoadingCollectors] = useState(false)
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [customerSearchResults, setCustomerSearchResults] = useState<OriginationExistingCustomerOption[]>([])
  const [selectedExistingCustomer, setSelectedExistingCustomer] = useState<OriginationExistingCustomerOption | null>(null)
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false)
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null)
  const [collectorCreationDraft, setCollectorCreationDraft] = useState<CollectorCreationDraft>(createInitialCollectorCreationDraft)
  const [collectorCreationError, setCollectorCreationError] = useState<string | null>(null)
  const [collectorCreationSuccess, setCollectorCreationSuccess] = useState<string | null>(null)
  const [isCreatingCollector, setIsCreatingCollector] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(null)
  const [showCollectorCreation, setShowCollectorCreation] = useState(false)
  const [showCustomerErrors, setShowCustomerErrors] = useState(false)
  const [showLoanErrors, setShowLoanErrors] = useState(false)
  const transport = useMemo(
    () => (supabaseClient ? createSupabaseOriginationTransport(supabaseClient) : null),
    [supabaseClient],
  )
  const validation = useMemo(
    () =>
      validateCurrentDraft(draft, {
        collectors,
        selectedExistingCustomer,
      }),
    [collectors, draft, selectedExistingCustomer],
  )
  const viewModel = useMemo(
    () =>
      createOriginationWizardViewModel({
        collectors,
        currentStep,
        hasTransport: Boolean(transport),
        isOnline,
        isSubmitting,
        profile,
        selectedExistingCustomer,
        validation,
      }),
    [collectors, currentStep, isOnline, isSubmitting, profile, selectedExistingCustomer, transport, validation],
  )
  const customerStepBlockingError =
    currentStep === 'customer' && showCustomerErrors && !viewModel.canGoToLoan
      ? resolveStepBlockingError(validation.customerFieldErrors)
      : null
  const loanStepBlockingError =
    currentStep === 'loan' && showLoanErrors && !viewModel.canGoToConfirm
      ? resolveStepBlockingError(validation.loanFieldErrors)
      : null

  useEffect(() => {
    if (!viewModel.access.canAccess || !transport) {
      return
    }

    const activeTransport = transport
    let active = true

    async function loadCollectors() {
      setIsLoadingCollectors(true)
      setCollectorsError(null)

      try {
        const nextCollectors = await activeTransport.listActiveCollectors()

        if (!active) {
          return
        }

        setCollectors(nextCollectors)
      } catch (error) {
        if (!active) {
          return
        }

        setCollectorsError(describeOriginationError(extractErrorCode(error)))
      } finally {
        if (active) {
          setIsLoadingCollectors(false)
        }
      }
    }

    void loadCollectors()

    return () => {
      active = false
    }
  }, [transport, viewModel.access.canAccess])

  function updateNewCustomerField(field: keyof OriginationWizardDraft['newCustomer'], value: string) {
    setSubmissionError(null)
    setSubmissionSuccess(null)
    setCollectorCreationError(null)
    setCollectorCreationSuccess(null)
    setDraft((currentDraft) => ({
      ...currentDraft,
      newCustomer: {
        ...currentDraft.newCustomer,
        routeLabel:
          field === 'neighborhood' && !currentDraft.newCustomer.routeLabel.trim()
            ? value
            : currentDraft.newCustomer.routeLabel,
        [field]: value,
      },
    }))
  }

  function updateLoanField(field: keyof OriginationWizardDraft['loan'], value: string) {
    setSubmissionError(null)
    setSubmissionSuccess(null)
    setCollectorCreationError(null)
    setDraft((currentDraft) => ({
      ...currentDraft,
      loan: {
        ...currentDraft.loan,
        [field]: value,
      },
    }))
  }

  function handleSelectMode(nextMode: OriginationWizardDraft['mode']) {
    setSubmissionError(null)
    setSubmissionSuccess(null)
    setCollectorCreationError(null)
    setCollectorCreationSuccess(null)
    setShowCustomerErrors(false)
    setShowLoanErrors(false)
    setCurrentStep('customer')
    setCustomerSearchError(null)
    setCustomerSearchResults([])
    setSelectedExistingCustomer(null)
    setCustomerSearchQuery('')
    setShowCollectorCreation(false)
    setDraft((currentDraft) => ({
      ...currentDraft,
      mode: nextMode,
    }))
  }

  function updateCollectorCreationField(field: keyof CollectorCreationDraft, value: string) {
    setCollectorCreationError(null)
    setCollectorCreationSuccess(null)
    setCollectorCreationDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
  }

  async function handleSearchExistingCustomers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!transport) {
      setCustomerSearchError(describeOriginationError('requires_connection'))
      return
    }

    if (customerSearchQuery.trim().length < 2) {
      setCustomerSearchError('Escribe al menos dos caracteres para buscar por documento, nombre o teléfono.')
      setCustomerSearchResults([])
      return
    }

    setIsSearchingCustomers(true)
    setCustomerSearchError(null)

    try {
      const nextResults = await transport.searchExistingCustomers(customerSearchQuery)
      setCustomerSearchResults(nextResults)

      if (nextResults.length === 0) {
        setCustomerSearchError('No se encontraron deudores remotos con ese criterio.')
      }
    } catch (error) {
      setCustomerSearchError(describeOriginationError(extractErrorCode(error)))
    } finally {
      setIsSearchingCustomers(false)
    }
  }

  function handleContinueToLoan() {
    setShowCustomerErrors(true)

    if (!viewModel.canGoToLoan) {
      return
    }

    setCurrentStep('loan')
  }

  function handleContinueToConfirm() {
    setShowLoanErrors(true)

    if (!viewModel.canGoToConfirm) {
      return
    }

    setCurrentStep('confirm')
  }

  function handleSelectStep(step: OriginationWizardStep) {
    if (step === 'loan' && !viewModel.canGoToLoan) {
      setShowCustomerErrors(true)
      return
    }

    if (step === 'confirm' && !viewModel.canGoToConfirm) {
      setShowCustomerErrors(true)
      setShowLoanErrors(true)
      return
    }

    setCurrentStep(step)
  }

  async function handleCreateCollector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!transport) {
      setCollectorCreationError(describeOriginationError('requires_connection'))
      return
    }

    setIsCreatingCollector(true)
    setCollectorCreationError(null)
    setCollectorCreationSuccess(null)

    try {
      const createdCollector = await transport.createCollectorAccount(collectorCreationDraft)
      const nextCollectors = await transport.listActiveCollectors()

      setCollectors(nextCollectors)
      setDraft((currentDraft) => ({
        ...currentDraft,
        newCustomer: {
          ...currentDraft.newCustomer,
          assignedCollectorId: createdCollector.id,
        },
      }))
      setCollectorCreationDraft(createInitialCollectorCreationDraft())
      setShowCollectorCreation(false)
      setCollectorCreationSuccess(`Cobrador ${createdCollector.fullName} creado y listo para asignar en este prestamo.`)
    } catch (error) {
      setCollectorCreationError(describeOriginationError(extractErrorCode(error)))
    } finally {
      setIsCreatingCollector(false)
    }
  }

  async function handleSubmitOrigination() {
    setShowCustomerErrors(true)
    setShowLoanErrors(true)

    if (!viewModel.canSubmit || !validation.submission || !transport) {
      setSubmissionError(
        viewModel.requiresConnectionMessage ?? describeOriginationError(validation.loanFieldErrors.form ?? 'form_validation_failed'),
      )
      return
    }

    setIsSubmitting(true)
    setSubmissionError(null)
    setSubmissionSuccess(null)

    try {
      const result = await transport.originateLoan(validation.submission)
      const successMessage = result.createdCustomer
        ? `Préstamo ${result.externalLoanNumber} creado y cliente nuevo registrado en Cobro Diario.`
        : `Préstamo ${result.externalLoanNumber} creado sobre cliente existente en Cobro Diario.`
      const completionPayload = {
        assignedCollectorId: validation.submission.assignedCollectorId,
        assignedCollectorName: resolveCollectorSummary(validation.submission.assignedCollectorId, collectors),
        createdCustomer: result.createdCustomer,
        customerDisplayName: resolveCustomerDisplayName(draft, selectedExistingCustomer),
        externalLoanNumber: result.externalLoanNumber,
        loanId: result.loanId,
        message: successMessage,
      } satisfies OriginationCompletedPayload

      setSubmissionSuccess(successMessage)
      onOriginated?.(completionPayload)
      resetWizardAfterSuccess()
    } catch (error) {
      setSubmissionError(describeOriginationError(extractErrorCode(error)))
    } finally {
      setIsSubmitting(false)
    }
  }

  function resetWizardAfterSuccess() {
    setCurrentStep('customer')
    setShowCustomerErrors(false)
    setShowLoanErrors(false)
    setCustomerSearchError(null)
    setCustomerSearchQuery('')
    setCustomerSearchResults([])
    setSelectedExistingCustomer(null)
    setDraft((currentDraft) => ({
      ...createInitialOriginationDraft(),
      newCustomer: {
        ...createInitialOriginationDraft().newCustomer,
        assignedCollectorId: currentDraft.newCustomer.assignedCollectorId,
      },
    }))
  }

  return (
    <article className="panel origination-panel">
      {submissionSuccess ? (
        <div className="origination-success-card" role="status">
          <strong>Alta confirmada</strong>
          <p>{submissionSuccess}</p>
        </div>
      ) : null}

      {!viewModel.access.canAccess ? (
        <div className="warn-box" role="alert">
          <strong>Originación bloqueada</strong>
          <p>{viewModel.access.reason}</p>
        </div>
      ) : (
        <>
          {viewModel.requiresConnectionMessage ? (
            <div className="warn-box inline" role="alert">
              <strong>Requiere conexión</strong>
              <p>{viewModel.requiresConnectionMessage}</p>
            </div>
          ) : null}

          {collectorsError ? (
            <div className="warn-box inline" role="alert">
              <strong>Cobradores</strong>
              <p>{collectorsError}</p>
            </div>
          ) : null}

          {submissionError ? (
            <div className="warn-box inline" role="alert">
              <strong>No se pudo originar</strong>
              <p>{submissionError}</p>
            </div>
          ) : null}

          <div className="origination-stepper" aria-label="Pasos de originación">
            {viewModel.steps.map((step) => (
              <button
                key={step.key}
                disabled={(step.key === 'loan' && !viewModel.canGoToLoan) || (step.key === 'confirm' && !viewModel.canGoToConfirm)}
                className={`origination-step-button ${step.status}`}
                onClick={() => handleSelectStep(step.key)}
                type="button"
              >
                <span>{step.label}</span>
                <strong>{step.status === 'complete' ? 'Completado' : step.status === 'current' ? 'Actual' : 'Próximo'}</strong>
              </button>
            ))}
          </div>

          <div className="origination-mode-switch" role="tablist" aria-label="Tipo de vinculación">
            <button
              aria-selected={draft.mode === 'new_customer'}
              className={`route-chip ${draft.mode === 'new_customer' ? 'selected' : ''}`}
              onClick={() => handleSelectMode('new_customer')}
              role="tab"
              type="button"
            >
              <strong>Nuevo Cliente</strong>
              <span>Alta completa con vinculación de cobrador.</span>
            </button>
            <button
              aria-selected={draft.mode === 'existing_customer'}
              className={`route-chip ${draft.mode === 'existing_customer' ? 'selected' : ''}`}
              onClick={() => handleSelectMode('existing_customer')}
              role="tab"
              type="button"
            >
              <strong>Cliente Existente</strong>
              <span>Buscar por documento, nombre o teléfono.</span>
            </button>
          </div>

          {currentStep === 'customer' && (
            <div className="origination-section">
              {draft.mode === 'new_customer' ? (
                <div className="login-form">
                  <label className="field">
                    <span>Cobrador responsable</span>
                    <select
                      className="input"
                      disabled={isLoadingCollectors}
                      value={draft.newCustomer.assignedCollectorId}
                      onChange={(event) => updateNewCustomerField('assignedCollectorId', event.target.value)}
                    >
                      <option value="">Selecciona un cobrador activo</option>
                      {collectors.map((collector) => (
                        <option key={collector.id} value={collector.id}>
                          {collector.fullName}
                        </option>
                      ))}
                    </select>
                    <FieldError
                      errorCode={showCustomerErrors ? validation.customerFieldErrors.assigned_collector_id : undefined}
                    />
                  </label>

                  {collectorCreationSuccess ? (
                    <div className="origination-success-card" role="status">
                      <strong>Cobrador creado</strong>
                      <p>{collectorCreationSuccess}</p>
                    </div>
                  ) : null}

                  {!isLoadingCollectors && collectors.length === 0 ? (
                    <div className="warn-box inline" role="alert">
                      <strong>No hay cobradores activos</strong>
                      <p>La originación necesita un cobrador activo. Crea uno aquí mismo antes de continuar.</p>
                    </div>
                  ) : null}

                  <div className="origination-inline-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setCollectorCreationError(null)
                        setCollectorCreationSuccess(null)
                        setShowCollectorCreation((currentValue) => !currentValue)
                      }}
                      type="button"
                    >
                      {showCollectorCreation ? 'Cancelar registro' : 'Registrar Cobrador'}
                    </button>
                    <p className="origination-helper">
                      El cliente nuevo siempre debe quedar vinculado a un cobrador activo del dominio operativo.
                    </p>
                  </div>

                  {showCollectorCreation ? (
                    <form className="preview-box" onSubmit={handleCreateCollector}>
                      <strong>Alta rápida de cobrador</strong>
                      <p>
                        Esta alta viaja por una llamada remota (RPC) segura que provisiona la autenticación y el perfil desde el
                        servidor, sin reemplazar tu inicio de sesión de administrador actual.
                      </p>

                      <label className="field">
                        <span>Nombre completo del cobrador</span>
                        <input
                          className="input"
                          placeholder="Ej. Laura Diaz"
                          required
                          value={collectorCreationDraft.fullName}
                          onChange={(event) => updateCollectorCreationField('fullName', event.target.value)}
                        />
                      </label>

                      <label className="field">
                        <span>Correo del cobrador</span>
                        <input
                          className="input"
                          autoComplete="email"
                          inputMode="email"
                          placeholder="Ej. laura@cobrodiario.dev"
                          required
                          type="email"
                          value={collectorCreationDraft.email}
                          onChange={(event) => updateCollectorCreationField('email', event.target.value)}
                        />
                      </label>

                      <label className="field">
                        <span>Clave inicial</span>
                        <input
                          className="input"
                          autoComplete="new-password"
                          minLength={6}
                          placeholder="Mínimo 6 caracteres"
                          required
                          type="password"
                          value={collectorCreationDraft.password}
                          onChange={(event) => updateCollectorCreationField('password', event.target.value)}
                        />
                      </label>

                      <label className="field">
                        <span>Teléfono opcional</span>
                        <input
                          className="input"
                          inputMode="tel"
                          placeholder="Ej. 3001234567"
                          value={collectorCreationDraft.phone}
                          onChange={(event) => updateCollectorCreationField('phone', event.target.value)}
                        />
                      </label>

                      {collectorCreationError ? (
                        <div className="warn-box inline" role="alert">
                          <strong>No se pudo crear el cobrador</strong>
                          <p>{collectorCreationError}</p>
                        </div>
                      ) : null}

                      <div className="origination-actions compact">
                        <button className="button ghost" onClick={() => setShowCollectorCreation(false)} type="button">
                          Cerrar
                        </button>
                        <button className="button primary" disabled={isCreatingCollector} type="submit">
                          {isCreatingCollector ? 'Creando cobrador...' : 'Crear y asignar'}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <label className="field">
                    <span>Nombre completo</span>
                    <input
                      className="input"
                      placeholder="Ej. Mariana Perez"
                      value={draft.newCustomer.fullName}
                      onChange={(event) => updateNewCustomerField('fullName', event.target.value)}
                    />
                    <FieldError errorCode={showCustomerErrors ? validation.customerFieldErrors.full_name : undefined} />
                  </label>

                  <label className="field">
                    <span>Documento</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      placeholder="Ej. 100200300"
                      value={draft.newCustomer.governmentId}
                      onChange={(event) => updateNewCustomerField('governmentId', event.target.value)}
                    />
                    <FieldError errorCode={showCustomerErrors ? validation.customerFieldErrors.government_id : undefined} />
                  </label>

                  <label className="field">
                    <span>Teléfono</span>
                    <input
                      className="input"
                      inputMode="tel"
                      placeholder="Ej. 3001234567"
                      value={draft.newCustomer.phone}
                      onChange={(event) => updateNewCustomerField('phone', event.target.value)}
                    />
                    <FieldError errorCode={showCustomerErrors ? validation.customerFieldErrors.phone : undefined} />
                  </label>

                  <label className="field">
                    <span>Dirección</span>
                    <input
                      className="input"
                      placeholder="Ej. Calle 10 # 4-22"
                      value={draft.newCustomer.addressLine}
                      onChange={(event) => updateNewCustomerField('addressLine', event.target.value)}
                    />
                    <FieldError errorCode={showCustomerErrors ? validation.customerFieldErrors.address_line : undefined} />
                  </label>

                  <label className="field">
                    <span>Barrio</span>
                    <input
                      className="input"
                      placeholder="Ej. Centro"
                      value={draft.newCustomer.neighborhood}
                      onChange={(event) => updateNewCustomerField('neighborhood', event.target.value)}
                    />
                    <FieldError errorCode={showCustomerErrors ? validation.customerFieldErrors.neighborhood : undefined} />
                  </label>

                  <label className="field">
                    <span>Ruta operativa</span>
                    <input
                      className="input"
                      placeholder="Ej. Ruta Centro Martes"
                      value={draft.newCustomer.routeLabel}
                      onChange={(event) => updateNewCustomerField('routeLabel', event.target.value)}
                    />
                    <FieldError errorCode={showCustomerErrors ? validation.customerFieldErrors.route_label : undefined} />
                  </label>

                  <label className="field">
                    <span>Nota opcional</span>
                    <textarea
                      className="input textarea"
                      placeholder="Dato operativo adicional del cliente..."
                      value={draft.newCustomer.notes}
                      onChange={(event) => updateNewCustomerField('notes', event.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div className="login-form">
                  <form className="origination-search-form" onSubmit={handleSearchExistingCustomers}>
                    <label className="field">
                      <span>Buscar cliente en base de datos</span>
                      <input
                        className="input"
                        placeholder="Documento, nombre o teléfono"
                        value={customerSearchQuery}
                        onChange={(event) => setCustomerSearchQuery(event.target.value)}
                      />
                      <FieldError
                        errorCode={showCustomerErrors ? validation.customerFieldErrors.existing_customer_id : undefined}
                      />
                    </label>

                    <button className="button secondary" disabled={isSearchingCustomers} type="submit">
                      {isSearchingCustomers ? 'Buscando...' : 'Buscar'}
                    </button>
                  </form>

                  {customerSearchError ? <p className="origination-helper error">{customerSearchError}</p> : null}

                  {selectedExistingCustomer ? (
                    <div className="origination-selected-card">
                      <strong>{selectedExistingCustomer.fullName}</strong>
                      <span>{selectedExistingCustomer.governmentId ?? 'Sin documento'} · {selectedExistingCustomer.phone ?? 'Sin teléfono'}</span>
                      <small>
                        Cobrador responsable: {resolveCollectorSummary(selectedExistingCustomer.assignedCollectorId, collectors)}
                      </small>
                      <small>Ruta: {selectedExistingCustomer.routeLabel ?? selectedExistingCustomer.neighborhood ?? 'Ruta sin asignar'}</small>
                    </div>
                  ) : null}

                  <div className="origination-search-results" role="list" aria-label="Resultados de deudores">
                    {customerSearchResults.map((customer) => (
                      <button
                        key={customer.id}
                        className={`origination-search-result ${selectedExistingCustomer?.id === customer.id ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedExistingCustomer(customer)
                          setSubmissionError(null)
                          setSubmissionSuccess(null)
                        }}
                        type="button"
                      >
                        <strong>{customer.fullName}</strong>
                        <span>{customer.governmentId ?? 'Sin documento'} · {customer.phone ?? 'Sin teléfono'}</span>
                        <small>{resolveCollectorSummary(customer.assignedCollectorId, collectors)}</small>
                        <small>{customer.routeLabel ?? customer.neighborhood ?? 'Ruta sin asignar'}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {customerStepBlockingError ? (
                <div className="warn-box inline" role="alert">
                  <strong>Información del cliente incompleta</strong>
                  <p>{customerStepBlockingError}</p>
                </div>
              ) : null}

              <div className="origination-actions">
                <button className="button primary" onClick={handleContinueToLoan} type="button">
                  Continuar al préstamo
                </button>
              </div>
            </div>
          )}

          {currentStep === 'loan' && (
            <div className="origination-section">
              <div className="login-form">
                <label className="field">
                  <span>Modalidad de Crédito</span>
                  <select
                    className="input"
                    value={draft.loan.interestMode}
                    onChange={(event) => {
                      const nextInterestMode = event.target.value as OriginationWizardDraft['loan']['interestMode']

                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        loan: {
                          ...currentDraft.loan,
                          interestMode: nextInterestMode,
                          paymentApplicationMode:
                            nextInterestMode === 'simple_precomputed'
                              ? 'oldest_first'
                              : currentDraft.loan.paymentApplicationMode,
                        },
                      }))
                    }}
                  >
                    <option value="simple_precomputed">Microcrédito Simple (V1)</option>
                    <option value="compound_fixed_installment">Crédito Interés Compuesto (V2)</option>
                  </select>
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.interest_mode : undefined} />
                </label>

                <label className="field">
                  <span>Capital</span>
                  <CurrencyAmountInput
                    inputMode="decimal"
                    locale={env.defaultLocale}
                    placeholder="0"
                    value={draft.loan.principalAmount}
                    onValueChange={(value) => updateLoanField('principalAmount', value)}
                  />
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.principal_amount : undefined} />
                </label>

                <label className="field">
                  <span>Monto de la Cuota</span>
                  <CurrencyAmountInput
                    inputMode="decimal"
                    locale={env.defaultLocale}
                    placeholder={draft.loan.interestMode === 'compound_fixed_installment' ? 'Se calcula automáticamente' : '0'}
                    value={draft.loan.installmentAmount}
                    onValueChange={(value) => updateLoanField('installmentAmount', value)}
                  />
                  {draft.loan.interestMode === 'compound_fixed_installment' ? (
                    <small className="origination-helper">
                      En V2 la cuota fija se calcula con capital, tasa diaria y calendario real.
                    </small>
                  ) : null}
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.installment_amount : undefined} />
                </label>

                <label className="field">
                  <span>Número de cuotas</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="Ej. 12"
                    value={draft.loan.totalInstallments}
                    onChange={(event) => updateLoanField('totalInstallments', event.target.value)}
                  />
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.total_installments : undefined} />
                </label>

                <label className="field">
                  <span>Frecuencia</span>
                  <select
                    className="input"
                    value={draft.loan.paymentFrequency}
                    onChange={(event) => updateLoanField('paymentFrequency', event.target.value as OriginationWizardDraft['loan']['paymentFrequency'])}
                  >
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="biweekly">Quincenal</option>
                    <option value="monthly">Mensual</option>
                  </select>
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.payment_frequency : undefined} />
                </label>

                <label className="field">
                  <span>Modo de abono</span>
                  <select
                    className="input"
                    value={draft.loan.paymentApplicationMode}
                    onChange={(event) =>
                      updateLoanField(
                        'paymentApplicationMode',
                        event.target.value as OriginationWizardDraft['loan']['paymentApplicationMode'],
                      )}
                  >
                    <option value="oldest_first">Por antigüedad</option>
                    <option value="principal_only">Solo capital</option>
                    <option value="interest_only">Solo interés</option>
                  </select>
                  <small className="origination-helper">
                    {draft.loan.interestMode === 'simple_precomputed'
                      ? 'V1 conserva abono por antigüedad; los modos dirigidos solo se habilitan en V2.'
                      : 'El préstamo V2 quedará bloqueado al modo de abono elegido.'}
                  </small>
                  <FieldError
                    errorCode={showLoanErrors ? validation.loanFieldErrors.payment_application_mode : undefined}
                  />
                </label>

                <label className="field">
                  <span>Desembolso</span>
                  <input
                    className="input"
                    type="date"
                    value={draft.loan.disbursementDate}
                    onChange={(event) => updateLoanField('disbursementDate', event.target.value)}
                  />
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.disbursement_date : undefined} />
                </label>

                <label className="field">
                  <span>Primera fecha de cobro</span>
                  <input
                    className="input"
                    type="date"
                    value={draft.loan.firstDueDate}
                    onChange={(event) => updateLoanField('firstDueDate', event.target.value)}
                  />
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.first_due_date : undefined} />
                </label>

                <label className="field">
                  <span>Tasa diaria informativa</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={draft.loan.interestMode === 'compound_fixed_installment' ? 'Ej. 0,050000' : 'Opcional. Ej. 0,050000'}
                    value={draft.loan.interestRateDaily}
                    onChange={(event) => updateLoanField('interestRateDaily', event.target.value)}
                  />
                  <small className="origination-helper">
                    {draft.loan.interestMode === 'compound_fixed_installment'
                      ? 'V2 usa esta tasa para calcular la cuota fija y el interés real por periodo.'
                      : 'Solo se guarda como referencia contractual. V1 calcula la cuota con capital, valor de cuota y número de cuotas, no con esta tasa.'}
                  </small>
                  <FieldError errorCode={showLoanErrors ? validation.loanFieldErrors.interest_rate_daily : undefined} />
                </label>

                <label className="field">
                  <span>Nota opcional</span>
                  <textarea
                    className="input textarea"
                    placeholder="Condicion operativa del prestamo..."
                    value={draft.loan.notes}
                    onChange={(event) => updateLoanField('notes', event.target.value)}
                  />
                </label>
              </div>

              {validation.schedule ? (
                <div className="preview-box">
                  <strong>Vista previa contractual</strong>
                  <p>
                    {validation.schedule.totalInstallments} cuota(s) por{' '}
                    {formatCurrency(validation.schedule.installmentAmount, 'COP', env.defaultLocale)}.
                  </p>
                  <small className="origination-helper">
                    {validation.schedule.interestMode === 'compound_fixed_installment'
                      ? `V2 compuesto · abono ${describePaymentApplicationMode(validation.schedule.paymentApplicationMode)}.`
                      : 'V1 simple · abono por antigüedad.'}
                  </small>
                </div>
              ) : null}

              {loanStepBlockingError ? (
                <div className="warn-box inline" role="alert">
                  <strong>No se puede revisar la confirmación</strong>
                  <p>{loanStepBlockingError}</p>
                </div>
              ) : null}

              <div className="origination-actions">
                <button className="button ghost" onClick={() => setCurrentStep('customer')} type="button">
                  Volver al deudor
                </button>
                <button className="button primary" onClick={handleContinueToConfirm} type="button">
                  Revisar confirmación
                </button>
              </div>
            </div>
          )}

          {currentStep === 'confirm' && validation.schedule && (
            <div className="origination-section">
              <div className="detail-grid">
                <article className="detail-card">
                  <span>Deudor</span>
                  <strong>
                    {draft.mode === 'new_customer' ? draft.newCustomer.fullName || 'Nuevo deudor' : viewModel.selectedCustomerSummary}
                  </strong>
                </article>
                <article className="detail-card">
                  <span>Cobrador</span>
                  <strong>{viewModel.collectorSummary}</strong>
                </article>
                <article className="detail-card">
                  <span>Capital</span>
                  <strong>{formatCurrency(validation.schedule.totalPrincipalAmount, 'COP', env.defaultLocale)}</strong>
                </article>
                <article className="detail-card">
                  <span>Total programado</span>
                  <strong>{formatCurrency(validation.schedule.totalScheduledAmount, 'COP', env.defaultLocale)}</strong>
                </article>
                <article className="detail-card">
                  <span>Contrato</span>
                  <strong>
                    {validation.schedule.interestMode === 'compound_fixed_installment' ? 'V2 compuesto' : 'V1 simple'}
                  </strong>
                </article>
                <article className="detail-card">
                  <span>Abono</span>
                  <strong>{describePaymentApplicationMode(validation.schedule.paymentApplicationMode)}</strong>
                </article>
              </div>

              <div className="preview-box">
                <strong>Cronograma a persistir</strong>
                <p>
                  PostgreSQL validará exactamente estas cuotas antes de crear el préstamo en `Cobro Diario`.
                </p>
              </div>

              <div className="installment-list" aria-label="Cronograma de originación">
                {validation.schedule.installments.map((installment) => (
                  <article key={installment.installmentNumber} className="installment-row">
                    <div>
                      <strong>Cuota {installment.installmentNumber}</strong>
                      <span>{installment.dueDate}</span>
                    </div>
                    <div className="installment-amounts">
                      <strong>{formatCurrency(installment.scheduledAmount, 'COP', env.defaultLocale)}</strong>
                      <small>
                        Capital {formatCurrency(installment.principalAmount, 'COP', env.defaultLocale)} · Interés{' '}
                        {formatCurrency(installment.interestAmount, 'COP', env.defaultLocale)}
                      </small>
                    </div>
                  </article>
                ))}
              </div>

              <div className="origination-actions">
                <button className="button ghost" onClick={() => setCurrentStep('loan')} type="button">
                  Ajustar datos
                </button>
                <button
                  className="button primary"
                  disabled={!viewModel.canSubmit}
                  onClick={() => void handleSubmitOrigination()}
                  type="button"
                >
                  {isSubmitting ? 'Originando...' : 'Confirmar originación'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  )
}

function FieldError({ errorCode }: { errorCode?: string }) {
  if (!errorCode) {
    return null
  }

  return <small className="field-error">{describeOriginationError(errorCode)}</small>
}

function resolveCollectorSummary(collectorId: string, collectors: OriginationCollectorOption[]) {
  return collectors.find((collector) => collector.id === collectorId)?.fullName ?? 'Cobrador no resuelto'
}

function describePaymentApplicationMode(paymentApplicationMode: OriginationWizardDraft['loan']['paymentApplicationMode']) {
  const paymentApplicationModeMap = {
    oldest_first: 'Por antigüedad',
    principal_only: 'Solo capital',
    interest_only: 'Solo interés',
  } as const

  return paymentApplicationModeMap[paymentApplicationMode] ?? paymentApplicationMode
}

function resolveCustomerDisplayName(
  draft: OriginationWizardDraft,
  selectedExistingCustomer: OriginationExistingCustomerOption | null,
) {
  if (draft.mode === 'new_customer') {
    return draft.newCustomer.fullName.trim() || 'Nuevo deudor'
  }

  return selectedExistingCustomer?.fullName ?? 'Deudor existente'
}

function extractErrorCode(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'form_validation_failed'
}

function resolveStepBlockingError(fieldErrors: OriginationFieldErrors) {
  // Mantener un resumen junto al CTA evita que un error valido quede fuera del viewport
  // y se perciba como un click muerto en mobile.
  const firstErrorCode = fieldErrors.form ?? Object.values(fieldErrors).find((errorCode) => Boolean(errorCode))

  return firstErrorCode ? describeOriginationError(firstErrorCode) : 'Revisa los datos obligatorios antes de continuar.'
}

function validateCurrentDraft(
  draft: OriginationWizardDraft,
  input: {
    collectors: OriginationCollectorOption[]
    selectedExistingCustomer: OriginationExistingCustomerOption | null
  },
) {
  return validateOriginationDraft(draft, input)
}

function createInitialCollectorCreationDraft(): CollectorCreationDraft {
  return {
    email: '',
    fullName: '',
    password: '',
    phone: '',
  }
}
