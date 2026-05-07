import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CobroDiarioDb,
  localDb,
  type LocalInstallment,
  type LocalLoan,
  type LocalPayment,
  type SyncQueueItem,
} from '@/lib/db/local-db.ts'
import { FINANCIAL_BASELINE } from '@/lib/finance/financial-config.ts'
import {
  allocateInstallmentPayment,
  DEFAULT_PAYMENT_METHOD,
  derivePaymentTotal,
  isPayableLoanStatus,
  NON_PAYABLE_INSTALLMENT_STATUSES,
  normalizePaymentApplications,
  type NormalizedPaymentApplication,
} from '@/lib/finance/payment-contract.ts'
import { normalizeDirectedPaymentApplications } from '@/lib/finance/payment-contract-v2.ts'
import { sumMoney, toMoney } from '@/lib/finance/money.ts'
import type {
  InstallmentStatus,
  LoanPaymentApplicationMode,
  LoanStatus,
  PaymentDraft,
  SyncFailureKind,
  SyncQueueStatus,
} from '@/types/domain.ts'

export const PAYMENT_QUEUE_ENTITY = 'payment' as const

// Estos codigos representan conflictos de negocio o de alcance.
// Reintentarlos ciegamente no arregla el problema y puede esconder divergencias entre cache y servidor.
const SYNC_CONFLICT_CODES = new Set([
  'applied_amount_exceeds_outstanding',
  'application_components_mismatch',
  'application_exceeds_component_balance',
  'application_order_violation',
  'collector_not_allowed',
  'device_not_owned_by_collector',
  'device_local_id_conflict',
  'duplicate_installment_application',
  'installment_component_balance_invalid',
  'installment_component_balance_mismatch',
  'installment_id_required',
  'installment_not_found_for_loan',
  'installment_not_payable',
  'installment_order_violation',
  'invalid_applied_amount',
  'loan_collector_mismatch',
  'loan_customer_mismatch',
  'loan_not_found',
  'loan_status_not_payable',
  'loan_without_payable_installments',
  'negative_component_not_allowed',
  'paid_at_required',
  'payment_application_mode_not_supported',
  'payment_mode_component_violation',
  'payment_mode_without_target_balance',
  'payment_requires_applications',
  'payment_total_must_be_positive',
])

function isNonPayableInstallmentStatus(status: InstallmentStatus) {
  return NON_PAYABLE_INSTALLMENT_STATUSES.includes(
    status as (typeof NON_PAYABLE_INSTALLMENT_STATUSES)[number],
  )
}

export type NormalizedPaymentDraft = Omit<PaymentDraft, 'applications' | 'paymentMethod'> & {
  paymentApplicationMode: LoanPaymentApplicationMode
  paymentMethod: string
  applications: NormalizedPaymentApplication[]
}

export type PaymentSyncFailure = {
  code: string
  message: string
  kind: SyncFailureKind
}

export type PaymentSyncTransport = {
  recordPayment(payment: NormalizedPaymentDraft): Promise<{ paymentId: string }>
}

export type EnqueueOfflinePaymentResult = {
  clientEventId: string
  localPaymentId: string
  queueId: number
}

export type SyncQueueSnapshot = {
  failed: number
  pending: number
  processing: number
  synced: number
  total: number
}

export type FlushPaymentSyncQueueResult = {
  failed: number
  processed: number
  synced: number
}

type RecordPaymentRpcPayload = {
  p_applications: {
    applied_amount: string
    fee_component: string
    installment_id: string
    interest_component: string
    principal_component: string
  }[]
  p_collector_id: string
  p_customer_id: string
  p_device_id: string | null
  p_device_local_id: string
  p_latitude: number | null
  p_loan_id: string
  p_longitude: number | null
  p_notes: string | null
  p_paid_at: string
  p_payment_method: string
  p_payment_reference: string | null
}

function normalizeRequiredId(value: string, code: string) {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    throw new Error(code)
  }

  return normalizedValue
}

function normalizeOptionalText(value: string | undefined) {
  const normalizedValue = value?.trim()

  return normalizedValue ? normalizedValue : undefined
}

function normalizePaymentApplicationMode(
  paymentApplicationMode: PaymentDraft['paymentApplicationMode'],
): LoanPaymentApplicationMode {
  if (
    paymentApplicationMode === 'principal_only'
    || paymentApplicationMode === 'interest_only'
    || paymentApplicationMode === 'oldest_first'
  ) {
    return paymentApplicationMode
  }

  return 'oldest_first'
}

export function normalizePaymentDraft(payment: PaymentDraft): NormalizedPaymentDraft {
  const deviceLocalId = normalizeRequiredId(payment.deviceLocalId, 'device_local_id_required')
  const collectorId = normalizeRequiredId(payment.collectorId, 'collector_id_required')
  const customerId = normalizeRequiredId(payment.customerId, 'customer_id_required')
  const loanId = normalizeRequiredId(payment.loanId, 'loan_id_required')
  const paymentApplicationMode = normalizePaymentApplicationMode(payment.paymentApplicationMode)

  if (!payment.paidAt || Number.isNaN(new Date(payment.paidAt).getTime())) {
    throw new Error('paid_at_required')
  }

  return {
    deviceLocalId,
    collectorId,
    customerId,
    loanId,
    deviceId: normalizeOptionalText(payment.deviceId),
    paymentReference: normalizeOptionalText(payment.paymentReference),
    paymentMethod: normalizeOptionalText(payment.paymentMethod) ?? DEFAULT_PAYMENT_METHOD,
    paymentApplicationMode,
    paidAt: payment.paidAt,
    latitude: payment.latitude,
    longitude: payment.longitude,
    notes: normalizeOptionalText(payment.notes),
    applications:
      paymentApplicationMode === 'oldest_first'
        ? normalizePaymentApplications(payment.applications)
        : normalizeDirectedPaymentApplications(paymentApplicationMode, payment.applications),
  }
}

export function buildPaymentClientEventId(deviceLocalId: string) {
  // clientEventId vive solo en la cola local.
  // deviceLocalId sigue siendo la llave idempotente que entiende record_payment en servidor.
  return `payment:${deviceLocalId}:insert`
}

export function deriveBusinessDate(paidAt: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: FINANCIAL_BASELINE.businessTimezone,
    year: 'numeric',
  })
  const dateParts = formatter.formatToParts(new Date(paidAt))
  const year = dateParts.find((part) => part.type === 'year')?.value
  const month = dateParts.find((part) => part.type === 'month')?.value
  const day = dateParts.find((part) => part.type === 'day')?.value
  const businessDate = `${year}-${month}-${day}`

  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error('invalid_business_date')
  }

  return businessDate
}

export function buildRecordPaymentRpcPayload(payment: NormalizedPaymentDraft): RecordPaymentRpcPayload {
  // La cola persiste camelCase porque lo comparte con frontend.
  // El RPC exige snake_case y este adaptador es la unica traduccion autorizada.
  return {
    p_device_local_id: payment.deviceLocalId,
    p_payment_reference: payment.paymentReference ?? null,
    p_collector_id: payment.collectorId,
    p_customer_id: payment.customerId,
    p_loan_id: payment.loanId,
    p_device_id: payment.deviceId ?? null,
    p_payment_method: payment.paymentMethod,
    p_paid_at: payment.paidAt,
    p_latitude: payment.latitude ?? null,
    p_longitude: payment.longitude ?? null,
    p_notes: payment.notes ?? null,
    p_applications: payment.applications.map((application) => ({
      installment_id: application.installmentId,
      applied_amount: application.appliedAmount,
      principal_component: application.principalComponent,
      interest_component: application.interestComponent,
      fee_component: application.feeComponent,
    })),
  }
}

function buildPaymentIdempotencySnapshot(payment: NormalizedPaymentDraft) {
  // La idempotencia local debe seguir el mismo contrato visible que el RPC remoto.
  // Si cambia cualquier parte material del cobro, el mismo deviceLocalId deja de ser un reintento valido.
  return {
    paymentApplicationMode: payment.paymentApplicationMode,
    rpcPayload: buildRecordPaymentRpcPayload(payment),
  }
}

function isSameIdempotentPaymentPayload(
  existingPayment: NormalizedPaymentDraft,
  nextPayment: NormalizedPaymentDraft,
) {
  return JSON.stringify(buildPaymentIdempotencySnapshot(existingPayment))
    === JSON.stringify(buildPaymentIdempotencySnapshot(nextPayment))
}

export function createSupabasePaymentSyncTransport(
  supabaseClient: SupabaseClient,
): PaymentSyncTransport {
  return {
    async recordPayment(payment) {
      const payload = buildRecordPaymentRpcPayload(payment)
      const { data, error } = await supabaseClient.rpc('record_payment', payload)

      if (error) {
        throw normalizePaymentSyncFailure(error)
      }

      if (typeof data !== 'string' || !data) {
        throw {
          code: 'invalid_payment_id',
          kind: 'retryable',
          message: 'record_payment returned an invalid payment identifier',
        } satisfies PaymentSyncFailure
      }

      return { paymentId: data }
    },
  }
}

export async function enqueueOfflinePayment(
  payment: PaymentDraft,
  options: {
    db?: CobroDiarioDb
    now?: () => string
  } = {},
): Promise<EnqueueOfflinePaymentResult> {
  const db = options.db ?? localDb
  const now = options.now ?? (() => new Date().toISOString())
  const normalizedPayment = normalizePaymentDraft(payment)
  const totalAmount = derivePaymentTotal(normalizedPayment.applications)
  const clientEventId = buildPaymentClientEventId(normalizedPayment.deviceLocalId)
  const nowIso = now()
  const businessDate = deriveBusinessDate(normalizedPayment.paidAt)

  return db.transaction('rw', db.loans, db.installments, db.payments, db.syncQueue, async () => {
    // La misma idempotencia que existe en servidor se replica localmente para no duplicar
    // el efecto optimista cuando la UI o el usuario repiten la misma accion offline.
    const existingPayment = await db.payments.get(normalizedPayment.deviceLocalId)

    if (existingPayment) {
      if (
        existingPayment.loanId === normalizedPayment.loanId &&
        existingPayment.customerId === normalizedPayment.customerId &&
        existingPayment.collectorId === normalizedPayment.collectorId
      ) {
        const existingQueueItem = await db.syncQueue.where('clientEventId').equals(clientEventId).first()

        if (!existingQueueItem?.id) {
          throw new Error('missing_local_sync_queue_item')
        }

        const existingPayload = existingQueueItem.payload as NormalizedPaymentDraft

        if (!isSameIdempotentPaymentPayload(existingPayload, normalizedPayment)) {
          throw new Error('device_local_id_conflict')
        }

        return {
          clientEventId,
          localPaymentId: existingPayment.id,
          queueId: existingQueueItem.id,
        }
      }

      throw new Error('device_local_id_conflict')
    }

    const loan = await db.loans.get(normalizedPayment.loanId)

    if (!loan) {
      throw new Error('loan_not_found')
    }

    if (loan.customerId !== normalizedPayment.customerId) {
      throw new Error('loan_customer_mismatch')
    }

    if (loan.collectorId !== normalizedPayment.collectorId) {
      throw new Error('loan_collector_mismatch')
    }

    if (!isPayableLoanStatus(loan.status)) {
      throw new Error('loan_status_not_payable')
    }

    const installments = await db.installments.where('loanId').equals(normalizedPayment.loanId).toArray()
    const nextInstallments = applyPaymentDraftToLocalInstallments(
      installments,
      normalizedPayment,
      businessDate,
      nowIso,
    )
    const nextLoanStatus = deriveLocalLoanStatus(loan, nextInstallments, businessDate)

    await db.installments.bulkPut(nextInstallments)
    await db.loans.put({
      ...loan,
      status: nextLoanStatus,
      updatedAt: nowIso,
    })

    const localPayment: LocalPayment = {
      id: normalizedPayment.deviceLocalId,
      loanId: normalizedPayment.loanId,
      customerId: normalizedPayment.customerId,
      collectorId: normalizedPayment.collectorId,
      totalAmount,
      paidAt: normalizedPayment.paidAt,
      deviceLocalId: normalizedPayment.deviceLocalId,
      paymentMethod: normalizedPayment.paymentMethod,
      paymentReference: normalizedPayment.paymentReference,
      notes: normalizedPayment.notes,
      latitude: normalizedPayment.latitude,
      longitude: normalizedPayment.longitude,
      syncStatus: 'pending',
      updatedAt: nowIso,
    }

    const queueItem: SyncQueueItem = {
      clientEventId,
      entityName: PAYMENT_QUEUE_ENTITY,
      entityId: localPayment.id,
      operation: 'insert',
      payload: normalizedPayment as unknown as Record<string, unknown>,
      status: 'pending',
      attemptCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    await db.payments.put(localPayment)
    const queueId = await db.syncQueue.add(queueItem)

    return {
      clientEventId,
      localPaymentId: localPayment.id,
      queueId,
    }
  })
}

export async function flushPaymentSyncQueue(
  transport: PaymentSyncTransport,
  options: {
    db?: CobroDiarioDb
    limit?: number
    now?: () => string
  } = {},
): Promise<FlushPaymentSyncQueueResult> {
  const db = options.db ?? localDb
  const now = options.now ?? (() => new Date().toISOString())
  const limit = options.limit ?? 50
  const queueItems = await db.syncQueue.where('status').equals('pending').sortBy('createdAt')
  const itemsToProcess = queueItems.slice(0, limit)

  const result: FlushPaymentSyncQueueResult = {
    failed: 0,
    processed: itemsToProcess.length,
    synced: 0,
  }

  for (const queueItem of itemsToProcess) {
    await db.transaction('rw', db.payments, db.syncQueue, async () => {
      const startedAt = now()
      await updateQueueItemStatus(db, queueItem.id, {
        attemptCount: queueItem.attemptCount + 1,
        lastAttemptAt: startedAt,
        status: 'processing',
        updatedAt: startedAt,
      })
      await updateLocalPaymentStatus(db, queueItem.entityId, {
        lastSyncAttemptAt: startedAt,
        syncStatus: 'processing',
        updatedAt: startedAt,
      })
    })

    try {
      // La cola no recompone el pago desde cabeceras sueltas.
      // Reenvia exactamente el payload persistido para no perder idempotencia ni desglose financiero.
      const normalizedPayment = queueItem.payload as unknown as NormalizedPaymentDraft
      const remoteAck = await transport.recordPayment(normalizedPayment)
      const finishedAt = now()

      await db.transaction('rw', db.payments, db.syncQueue, async () => {
        await updateQueueItemStatus(db, queueItem.id, {
          lastErrorAt: undefined,
          lastErrorCode: undefined,
          lastErrorKind: undefined,
          lastErrorMessage: undefined,
          remoteRecordId: remoteAck.paymentId,
          status: 'synced',
          updatedAt: finishedAt,
        })
        await updateLocalPaymentStatus(db, queueItem.entityId, {
          remotePaymentId: remoteAck.paymentId,
          remotePaymentStatus: 'posted',
          syncErrorCode: undefined,
          syncErrorKind: undefined,
          syncErrorMessage: undefined,
          syncStatus: 'synced',
          syncedAt: finishedAt,
          updatedAt: finishedAt,
        })
      })

      result.synced += 1
    } catch (error) {
      // Un fallo no revierte el efecto local optimista.
      // En su lugar marcamos la divergencia para reintento o revision operativa posterior.
      const syncFailure = normalizePaymentSyncFailure(error)
      const failedAt = now()

      await db.transaction('rw', db.payments, db.syncQueue, async () => {
        await updateQueueItemStatus(db, queueItem.id, {
          lastErrorAt: failedAt,
          lastErrorCode: syncFailure.code,
          lastErrorKind: syncFailure.kind,
          lastErrorMessage: syncFailure.message,
          status: 'failed',
          updatedAt: failedAt,
        })
        await updateLocalPaymentStatus(db, queueItem.entityId, {
          syncErrorCode: syncFailure.code,
          syncErrorKind: syncFailure.kind,
          syncErrorMessage: syncFailure.message,
          syncStatus: 'failed',
          updatedAt: failedAt,
        })
      })

      result.failed += 1
    }
  }

  return result
}

export async function retryFailedSyncQueueItem(
  queueId: number,
  options: {
    db?: CobroDiarioDb
    now?: () => string
  } = {},
) {
  const db = options.db ?? localDb
  const now = options.now ?? (() => new Date().toISOString())
  const queueItem = await db.syncQueue.get(queueId)

  if (!queueItem) {
    throw new Error('sync_queue_item_not_found')
  }

  if (queueItem.status !== 'failed') {
    throw new Error('sync_queue_item_not_failed')
  }

  const retryAt = now()

  await db.transaction('rw', db.payments, db.syncQueue, async () => {
    await updateQueueItemStatus(db, queueItem.id, {
      status: 'pending',
      updatedAt: retryAt,
    })
    await updateLocalPaymentStatus(db, queueItem.entityId, {
      syncStatus: 'pending',
      updatedAt: retryAt,
    })
  })
}

export async function getSyncQueueSnapshot(db: CobroDiarioDb = localDb): Promise<SyncQueueSnapshot> {
  const [pending, processing, failed, synced] = await Promise.all([
    db.syncQueue.where('status').equals('pending').count(),
    db.syncQueue.where('status').equals('processing').count(),
    db.syncQueue.where('status').equals('failed').count(),
    db.syncQueue.where('status').equals('synced').count(),
  ])

  return {
    failed,
    pending,
    processing,
    synced,
    total: pending + processing + failed + synced,
  }
}

function applyPaymentDraftToLocalInstallments(
  installments: LocalInstallment[],
  payment: NormalizedPaymentDraft,
  businessDate: string,
  updatedAt: string,
) {
  // Esta simulacion local debe espejar exactamente el modo autorizado del préstamo.
  // Si la cola aplica oldest-first sobre un préstamo dirigido, el navegador mentiría
  // sobre el saldo local aun antes del primer roundtrip al RPC remoto.
  const installmentsById = new Map(installments.map((installment) => [installment.id, { ...installment }]))

  for (const application of payment.applications) {
    const expectedInstallment = getNextPayableInstallmentForMode(
      Array.from(installmentsById.values()),
      payment.paymentApplicationMode,
    )

    if (!expectedInstallment) {
      throw new Error(
        payment.paymentApplicationMode === 'oldest_first'
          ? 'loan_without_payable_installments'
          : 'payment_mode_without_target_balance',
      )
    }

    if (expectedInstallment.id !== application.installmentId) {
      throw new Error('installment_order_violation')
    }

    const installment = installmentsById.get(application.installmentId)

    if (!installment) {
      throw new Error('installment_not_found_for_loan')
    }

    if (isNonPayableInstallmentStatus(installment.status)) {
      throw new Error('installment_not_payable')
    }

    if (toMoney(installment.outstandingAmount).lte(0)) {
      throw new Error('installment_not_payable')
    }

    validateLocalPaymentApplicationForMode(payment.paymentApplicationMode, installment, application)

    const nextOutstandingPrincipalAmount = toMoney(installment.outstandingPrincipalAmount).minus(
      application.principalComponent,
    )
    const nextOutstandingInterestAmount = toMoney(installment.outstandingInterestAmount).minus(
      application.interestComponent,
    )
    const nextOutstandingFeeAmount = toMoney(installment.outstandingFeeAmount).minus(application.feeComponent)

    if (
      nextOutstandingPrincipalAmount.lt(0) ||
      nextOutstandingInterestAmount.lt(0) ||
      nextOutstandingFeeAmount.lt(0)
    ) {
      throw new Error('installment_component_balance_invalid')
    }

    const nextOutstandingAmount = sumMoney([
      nextOutstandingPrincipalAmount,
      nextOutstandingInterestAmount,
      nextOutstandingFeeAmount,
    ])

    if (!nextOutstandingAmount.equals(toMoney(installment.outstandingAmount).minus(application.appliedAmount))) {
      throw new Error('installment_component_balance_mismatch')
    }

    installmentsById.set(installment.id, {
      ...installment,
      outstandingPrincipalAmount: nextOutstandingPrincipalAmount.toFixed(2),
      outstandingInterestAmount: nextOutstandingInterestAmount.toFixed(2),
      outstandingFeeAmount: nextOutstandingFeeAmount.toFixed(2),
      outstandingAmount: nextOutstandingAmount.toFixed(2),
      updatedAt,
      status: deriveLocalInstallmentStatus(
        installment,
        nextOutstandingAmount.toFixed(2),
        businessDate,
      ),
    })
  }

  return Array.from(installmentsById.values())
}

function getNextPayableInstallmentForMode(
  installments: LocalInstallment[],
  paymentApplicationMode: LoanPaymentApplicationMode,
) {
  return installments
    .filter((installment) => isInstallmentPayableForMode(installment, paymentApplicationMode))
    .sort(compareInstallments)
    .at(0)
}

function isInstallmentPayableForMode(
  installment: LocalInstallment,
  paymentApplicationMode: LoanPaymentApplicationMode,
) {
  if (isNonPayableInstallmentStatus(installment.status)) {
    return false
  }

  switch (paymentApplicationMode) {
    case 'principal_only':
      return toMoney(installment.outstandingPrincipalAmount).gt(0)
    case 'interest_only':
      return toMoney(installment.outstandingInterestAmount).gt(0)
    case 'oldest_first':
      return toMoney(installment.outstandingAmount).gt(0)
  }
}

function validateLocalPaymentApplicationForMode(
  paymentApplicationMode: LoanPaymentApplicationMode,
  installment: LocalInstallment,
  application: NormalizedPaymentApplication,
) {
  switch (paymentApplicationMode) {
    case 'oldest_first': {
      const expectedComponentAllocation = allocateInstallmentPayment(application.appliedAmount, {
        feeAmount: installment.outstandingFeeAmount,
        interestAmount: installment.outstandingInterestAmount,
        principalAmount: installment.outstandingPrincipalAmount,
      })

      if (
        expectedComponentAllocation.feeComponent !== application.feeComponent
        || expectedComponentAllocation.interestComponent !== application.interestComponent
        || expectedComponentAllocation.principalComponent !== application.principalComponent
      ) {
        throw new Error('application_order_violation')
      }

      return
    }
    case 'principal_only':
      if (
        application.feeComponent !== '0.00'
        || application.interestComponent !== '0.00'
        || application.principalComponent !== application.appliedAmount
      ) {
        throw new Error('payment_mode_component_violation')
      }

      if (toMoney(application.principalComponent).gt(installment.outstandingPrincipalAmount)) {
        throw new Error('application_exceeds_component_balance')
      }

      return
    case 'interest_only':
      if (
        application.feeComponent !== '0.00'
        || application.principalComponent !== '0.00'
        || application.interestComponent !== application.appliedAmount
      ) {
        throw new Error('payment_mode_component_violation')
      }

      if (toMoney(application.interestComponent).gt(installment.outstandingInterestAmount)) {
        throw new Error('application_exceeds_component_balance')
      }
  }
}

function compareInstallments(leftInstallment: LocalInstallment, rightInstallment: LocalInstallment) {
  if (leftInstallment.dueDate !== rightInstallment.dueDate) {
    return leftInstallment.dueDate.localeCompare(rightInstallment.dueDate)
  }

  if (leftInstallment.installmentNumber !== rightInstallment.installmentNumber) {
    return leftInstallment.installmentNumber - rightInstallment.installmentNumber
  }

  return leftInstallment.id.localeCompare(rightInstallment.id)
}

function deriveLocalInstallmentStatus(
  installment: LocalInstallment,
  nextOutstandingAmount: string,
  businessDate: string,
): InstallmentStatus {
  if (toMoney(nextOutstandingAmount).equals(0)) {
    return 'paid'
  }

  if (installment.dueDate < businessDate) {
    return 'overdue'
  }

  if (toMoney(nextOutstandingAmount).lt(installment.scheduledAmount)) {
    return 'partial'
  }

  return 'pending'
}

function deriveLocalLoanStatus(
  loan: LocalLoan,
  installments: LocalInstallment[],
  businessDate: string,
): LoanStatus {
  if (!isPayableLoanStatus(loan.status)) {
    throw new Error('loan_status_not_payable')
  }

  const installmentsWithOutstanding = installments.filter((installment) => {
    return installment.loanId === loan.id && toMoney(installment.outstandingAmount).gt(0)
  })

  if (installmentsWithOutstanding.length === 0) {
    return 'settled'
  }

  if (installmentsWithOutstanding.some((installment) => installment.dueDate < businessDate)) {
    return 'delinquent'
  }

  return 'active'
}

async function updateQueueItemStatus(
  db: CobroDiarioDb,
  queueId: number | undefined,
  patch: Partial<SyncQueueItem>,
) {
  if (!queueId) {
    throw new Error('sync_queue_item_not_found')
  }

  const currentQueueItem = await db.syncQueue.get(queueId)

  if (!currentQueueItem) {
    throw new Error('sync_queue_item_not_found')
  }

  await db.syncQueue.put({
    ...currentQueueItem,
    ...patch,
  })
}

async function updateLocalPaymentStatus(
  db: CobroDiarioDb,
  localPaymentId: string,
  patch: Partial<LocalPayment>,
) {
  const currentPayment = await db.payments.get(localPaymentId)

  if (!currentPayment) {
    throw new Error('local_payment_not_found')
  }

  await db.payments.put({
    ...currentPayment,
    ...patch,
  })
}

function normalizePaymentSyncFailure(error: unknown): PaymentSyncFailure {
  // Clasificamos errores para no tratar conflictos de negocio como si fueran simples cortes de red.
  // La UI futura debera usar esta señal para diferenciar reintentos automaticos de revision manual.
  if (isPaymentSyncFailure(error)) {
    return error
  }

  const message = extractErrorMessage(error)
  const code = extractErrorCode(message)

  if (code && SYNC_CONFLICT_CODES.has(code)) {
    return {
      code,
      kind: 'conflict',
      message: code,
    }
  }

  if (/auth session missing/i.test(message)) {
    return {
      code: 'auth_session_missing',
      kind: 'retryable',
      message,
    }
  }

  if (/failed to fetch|network|fetch failed|load failed/i.test(message)) {
    return {
      code: 'network_error',
      kind: 'retryable',
      message,
    }
  }

  return {
    code: code ?? 'sync_transport_error',
    kind: 'retryable',
    message,
  }
}

function extractErrorCode(message: string) {
  const normalizedMessage = message.trim()

  if (/^[a-z0-9_]+$/i.test(normalizedMessage)) {
    return normalizedMessage
  }

  const match = normalizedMessage.match(/([a-z0-9_]+)$/i)

  return match?.[1]
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = Reflect.get(error, 'message')

    if (typeof message === 'string') {
      return message
    }
  }

  return 'sync_transport_error'
}

function isPaymentSyncFailure(error: unknown): error is PaymentSyncFailure {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  return (
    'code' in error &&
    'kind' in error &&
    'message' in error &&
    typeof Reflect.get(error, 'code') === 'string' &&
    typeof Reflect.get(error, 'kind') === 'string' &&
    typeof Reflect.get(error, 'message') === 'string'
  )
}

export function isFinalQueueStatus(status: SyncQueueStatus) {
  return status === 'failed' || status === 'synced'
}
