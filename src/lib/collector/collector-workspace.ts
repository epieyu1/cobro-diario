import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CobroDiarioDb,
  type LocalCollectionAction,
  localDb,
  type LocalCustomer,
  type LocalInstallment,
  type LocalLoan,
  type LocalPayment,
  type SessionProfile,
  type SyncQueueItem,
} from '@/lib/db/local-db.ts'
import { sortInstallmentsForCollection, deriveOutstandingInstallmentComponents } from '@/lib/finance/payment-planning.ts'
import { sumMoney, toMoney } from '@/lib/finance/money.ts'
import type { CollectorRole, SyncQueueStatus } from '@/types/domain.ts'

const WORKSPACE_SETTING_KEYS = {
  lastBootstrapAt: 'workspace:lastBootstrapAt',
  lastBootstrapSource: 'workspace:lastBootstrapSource',
} as const

type RemoteProfileRow = {
  id: string
  full_name: string
  role: CollectorRole
}

type RemoteCustomerRow = {
  id: string
  assigned_collector_id: string
  full_name: string
  government_id: string | null
  phone: string | null
  address_line: string | null
  route_label?: string | null
  neighborhood: string | null
  latitude: number | string | null
  longitude: number | string | null
  updated_at: string
}

type RemoteLoanRow = {
  id: string
  collector_id: string
  currency_code: string
  customer_id: string
  disbursement_date: string | null
  external_loan_number: string | null
  first_due_date: string | null
  installment_amount: number | string
  interest_mode: LocalLoan['interestMode'] | null
  interest_rate_daily: number | string
  notes: string | null
  principal_amount: number | string
  originated_at: string | null
  payment_application_mode: LocalLoan['paymentApplicationMode'] | null
  payment_frequency: LocalLoan['paymentFrequency'] | null
  status: LocalLoan['status']
  total_installments: number | null
  updated_at: string
}

type RemoteInstallmentRow = {
  id: string
  due_date: string
  fee_amount: number | string
  installment_number: number
  interest_amount: number | string
  loan_id: string
  outstanding_amount: number | string
  outstanding_fee_amount?: number | string | null
  outstanding_interest_amount?: number | string | null
  outstanding_principal_amount?: number | string | null
  principal_amount: number | string
  scheduled_amount: number | string
  status: LocalInstallment['status']
  updated_at: string
}

type RemoteCollectionActionRow = {
  id: string
  collector_id: string
  customer_id: string
  device_local_id: string
  follow_up_at: string | null
  latitude: number | string | null
  loan_id: string
  longitude: number | string | null
  notes: string | null
  outcome: LocalCollectionAction['outcome']
  recorded_at: string
  updated_at: string
}

export type RemoteCollectorWorkspaceSnapshot = {
  collectionActions?: RemoteCollectionActionRow[]
  customers: RemoteCustomerRow[]
  fetchedAt: string
  installments: RemoteInstallmentRow[]
  loans: RemoteLoanRow[]
  profile: RemoteProfileRow | null
}

export type CollectorWorkspaceRemoteSource = {
  fetchWorkspace(collectorId: string): Promise<RemoteCollectorWorkspaceSnapshot>
}

export type CollectorQueueEntry = {
  collectionAction?: LocalCollectionAction
  customer?: LocalCustomer
  loan?: LocalLoan
  payment?: LocalPayment
  queueItem: SyncQueueItem
}

export type LocalCollectionActionDraft = {
  collectorId: string
  customerId: string
  loanId: string
  outcome: LocalCollectionAction['outcome']
  notes?: string
  followUpAt?: string
  latitude?: number
  longitude?: number
  deviceLocalId?: string
  remoteCollectionActionId?: string
  syncStatus?: SyncQueueStatus
  syncedAt?: string
}

export type CollectorLoanCard = {
  customer: LocalCustomer
  installments: LocalInstallment[]
  latestCollectionAction?: LocalCollectionAction
  latestPayment?: LocalPayment
  loan: LocalLoan
  nextDueDate?: string
  outstandingAmount: string
  overdueInstallmentCount: number
  payableInstallmentCount: number
  pendingSyncCount: number
  failedSyncCount: number
}

export type CollectorWorkspaceSnapshot = {
  activeLoanCount: number
  customerCount: number
  lastBootstrapAt?: string
  lastBootstrapSource?: string
  loanCards: CollectorLoanCard[]
  openLoanCount: number
  profile?: SessionProfile
  queueEntries: CollectorQueueEntry[]
  recentCollectionActions: LocalCollectionAction[]
  recentPayments: LocalPayment[]
}

export function createSupabaseCollectorWorkspaceSource(
  supabaseClient: SupabaseClient,
): CollectorWorkspaceRemoteSource {
  return {
    async fetchWorkspace(collectorId) {
      const profile = expectSupabaseData<RemoteProfileRow | null>(
        await supabaseClient.from('profiles').select('id, full_name, role').eq('id', collectorId).maybeSingle(),
        null,
      )
      await refreshSessionRoleClaimIfNeeded(supabaseClient, profile)
      const canReadAggregateWorkspace = profile?.role === 'admin'
      const [customersResult, loansResult] = await Promise.all([
        // Intencion: collector sigue viendo solo su propia cartera operativa.
        // Admin reutiliza la misma shell para supervision y necesita leer todos los
        // rows que RLS ya le permite ver, sin reinventar un dashboard separado en cliente.
        canReadAggregateWorkspace
          ? supabaseClient
              .from('customers')
              .select(
                'id, assigned_collector_id, full_name, government_id, phone, address_line, route_label, neighborhood, latitude, longitude, updated_at',
              )
              .is('archived_at', null)
              .order('full_name', { ascending: true })
          : supabaseClient
              .from('customers')
              .select(
                'id, assigned_collector_id, full_name, government_id, phone, address_line, route_label, neighborhood, latitude, longitude, updated_at',
              )
              .eq('assigned_collector_id', collectorId)
              .is('archived_at', null)
              .order('full_name', { ascending: true }),
        canReadAggregateWorkspace
          ? supabaseClient
              .from('loans')
              .select(
                'id, collector_id, currency_code, customer_id, disbursement_date, external_loan_number, first_due_date, installment_amount, interest_mode, interest_rate_daily, notes, originated_at, payment_application_mode, payment_frequency, principal_amount, status, total_installments, updated_at',
              )
              .order('updated_at', { ascending: false })
          : supabaseClient
              .from('loans')
              .select(
                'id, collector_id, currency_code, customer_id, disbursement_date, external_loan_number, first_due_date, installment_amount, interest_mode, interest_rate_daily, notes, originated_at, payment_application_mode, payment_frequency, principal_amount, status, total_installments, updated_at',
              )
              .eq('collector_id', collectorId)
              .order('updated_at', { ascending: false }),
      ])
      const customers = expectSupabaseData<RemoteCustomerRow[]>(customersResult, [])
      const loans = expectSupabaseData<RemoteLoanRow[]>(loansResult, [])
      const loanIds = loans.map((loan) => loan.id)
      const installments =
        loanIds.length === 0
          ? []
          : expectSupabaseData<RemoteInstallmentRow[]>(
              await supabaseClient
                .from('installments')
                .select(
                  'id, due_date, fee_amount, installment_number, interest_amount, loan_id, outstanding_amount, outstanding_fee_amount, outstanding_interest_amount, outstanding_principal_amount, principal_amount, scheduled_amount, status, updated_at',
                )
                // Intencion: bootstrapear solo las cuotas de la cartera activa del cobrador.
                // Riesgo: si admin cachea cuotas fuera de sus loans locales, la UI mezcla metadatos
                // de originacion y cartera bajo una falsa segunda fuente de verdad.
                .in('loan_id', loanIds)
                .order('due_date', { ascending: true })
                .order('installment_number', { ascending: true }),
              [],
            )
      const collectionActions =
        loanIds.length === 0
          ? []
          : expectSupabaseData<RemoteCollectionActionRow[]>(
              await supabaseClient
                .from('collection_actions')
                .select(
                  'id, collector_id, customer_id, device_local_id, follow_up_at, latitude, loan_id, longitude, notes, outcome, recorded_at, updated_at',
                )
                .in('loan_id', loanIds)
                .order('recorded_at', { ascending: false }),
              [],
            )

      return {
        collectionActions,
        customers,
        fetchedAt: new Date().toISOString(),
        installments,
        loans,
        profile,
      }
    },
  }
}

export async function bootstrapCollectorWorkspace(
  source: CollectorWorkspaceRemoteSource,
  collectorId: string,
  options: {
    db?: CobroDiarioDb
  } = {},
) {
  const db = options.db ?? localDb
  const remoteSnapshot = await source.fetchWorkspace(collectorId)
  const localProfile = mapRemoteProfile(remoteSnapshot.profile)
  const localCustomers = remoteSnapshot.customers.map(mapRemoteCustomer)
  const localLoans = remoteSnapshot.loans.map(mapRemoteLoan)
  const localLoanIds = new Set(localLoans.map((loan) => loan.id))
  const localInstallments = remoteSnapshot.installments
    .filter((installment) => localLoanIds.has(installment.loan_id))
    .map(mapRemoteInstallment)
  const remoteCollectionActions = (remoteSnapshot.collectionActions ?? []).map(mapRemoteCollectionAction)
  const pendingLocalCollectionActions = await db.collectionActions
    .filter((collectionAction) => collectionAction.syncStatus !== 'synced')
    .toArray()

  // Este refresh remoto solo es seguro cuando la cola no tiene divergencias pendientes.
  // Por eso la UI debe sincronizar o bloquear antes de llamar a este bootstrap.
  // collectionActions remotas se rehidratan aqui, preservando cualquier evento local aun no confirmado.
  await db.transaction('rw', [db.collectionActions, db.customers, db.loans, db.installments, db.profiles, db.settings], async () => {
    await db.collectionActions.clear()
    await db.customers.clear()
    await db.loans.clear()
    await db.installments.clear()
    await db.profiles.clear()

    if (remoteCollectionActions.length > 0) {
      await db.collectionActions.bulkPut(remoteCollectionActions)
    }

    if (pendingLocalCollectionActions.length > 0) {
      await db.collectionActions.bulkPut(pendingLocalCollectionActions)
    }

    if (localCustomers.length > 0) {
      await db.customers.bulkPut(localCustomers)
    }

    if (localLoans.length > 0) {
      await db.loans.bulkPut(localLoans)
    }

    if (localInstallments.length > 0) {
      await db.installments.bulkPut(localInstallments)
    }

    if (localProfile) {
      await db.profiles.put(localProfile)
    }

    await db.settings.bulkPut([
      {
        key: WORKSPACE_SETTING_KEYS.lastBootstrapAt,
        value: remoteSnapshot.fetchedAt,
      },
      {
        key: WORKSPACE_SETTING_KEYS.lastBootstrapSource,
        value: 'remote',
      },
    ])
  })

  return {
    customerCount: localCustomers.length,
    installmentCount: localInstallments.length,
    loanCount: localLoans.length,
    profilePresent: Boolean(localProfile),
  }
}

export async function loadCollectorWorkspaceSnapshot(
  collectorId: string,
  options: {
    db?: CobroDiarioDb
  } = {},
): Promise<CollectorWorkspaceSnapshot> {
  const db = options.db ?? localDb
  const [installments, payments, queueItems, profile, settings] =
    await Promise.all([
      db.installments.toArray(),
      db.payments.toArray(),
      db.syncQueue.toArray(),
      db.profiles.get(collectorId),
      db.settings.toArray(),
    ])
  const canReadAggregateWorkspace = profile?.role === 'admin'
  const [customers, loans, collectionActions] = await Promise.all([
    canReadAggregateWorkspace
      ? db.customers.toArray().then(sortCustomersByFullName)
      : db.customers.where('assignedCollectorId').equals(collectorId).sortBy('fullName'),
    canReadAggregateWorkspace ? db.loans.toArray() : db.loans.where('collectorId').equals(collectorId).toArray(),
    canReadAggregateWorkspace ? db.collectionActions.toArray() : db.collectionActions.where('collectorId').equals(collectorId).toArray(),
  ])

  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const latestCollectionActionByLoanId = buildLatestCollectionActionMap(collectionActions)
  const paymentsByLoanId = buildLatestPaymentMap(payments)
  const queueEntries = buildQueueEntries(queueItems, collectionActions, payments, loans, customers)
  const queueCountsByLoanId = buildQueueCountsByLoanId(queueEntries)
  const settingsMap = new Map(settings.map((setting) => [setting.key, setting.value]))
  const loanCards: CollectorLoanCard[] = []

  for (const loan of loans) {
    const customer = customerById.get(loan.customerId)

    if (!customer) {
      continue
    }

    const loanInstallments = sortInstallmentsForCollection(
      installments.filter((installment) => installment.loanId === loan.id),
    )
    const outstandingAmount = sumMoney(
      loanInstallments.map((installment) => installment.outstandingAmount),
    ).toFixed(2)
    const nextDueInstallment = loanInstallments.find(
      (installment) =>
        installment.status !== 'paid' &&
        installment.status !== 'canceled' &&
        toMoney(installment.outstandingAmount).gt(0),
    )
    const queueCounts = queueCountsByLoanId.get(loan.id)

    loanCards.push({
      customer,
      installments: loanInstallments,
      latestCollectionAction: latestCollectionActionByLoanId.get(loan.id),
      latestPayment: paymentsByLoanId.get(loan.id),
      loan,
      nextDueDate: nextDueInstallment?.dueDate,
      outstandingAmount,
      overdueInstallmentCount: loanInstallments.filter((installment) => installment.status === 'overdue').length,
      payableInstallmentCount: loanInstallments.filter(
        (installment) =>
          installment.status !== 'paid' &&
          installment.status !== 'canceled' &&
          toMoney(installment.outstandingAmount).gt(0),
      ).length,
      pendingSyncCount: queueCounts?.pending ?? 0,
      failedSyncCount: queueCounts?.failed ?? 0,
    })
  }

  loanCards.sort(compareLoanCards)

  return {
    activeLoanCount: loans.filter((loan) => loan.status === 'active' || loan.status === 'delinquent').length,
    customerCount: customers.length,
    lastBootstrapAt: settingsMap.get(WORKSPACE_SETTING_KEYS.lastBootstrapAt),
    lastBootstrapSource: settingsMap.get(WORKSPACE_SETTING_KEYS.lastBootstrapSource),
    loanCards,
    openLoanCount: loanCards.filter((loanCard) => toMoney(loanCard.outstandingAmount).gt(0)).length,
    profile,
    queueEntries,
    recentCollectionActions: [...collectionActions]
      .sort((leftAction, rightAction) => rightAction.createdAt.localeCompare(leftAction.createdAt))
      .slice(0, 10),
    recentPayments: [...payments].sort((leftPayment, rightPayment) =>
      rightPayment.paidAt.localeCompare(leftPayment.paidAt),
    ).slice(0, 10),
  }
}

function sortCustomersByFullName(customers: LocalCustomer[]) {
  return [...customers].sort((leftCustomer, rightCustomer) => leftCustomer.fullName.localeCompare(rightCustomer.fullName))
}

export function shouldRefreshSessionRoleClaim(
  profileRole: CollectorRole | null | undefined,
  sessionRoleClaim: CollectorRole | null,
) {
  if (!profileRole || !sessionRoleClaim) {
    return false
  }

  return profileRole !== sessionRoleClaim
}

async function refreshSessionRoleClaimIfNeeded(
  supabaseClient: SupabaseClient,
  profile: RemoteProfileRow | null,
) {
  if (!profile) {
    // Una cuenta Auth sin fila en public.profiles no puede reconciliar role claim aqui.
    // La shell web debe tratar ese caso como bloqueo operativo y resolverlo con
    // alineacion manual de la cuenta, no inventando un fallback local de privilegios.
    return
  }

  const { data, error } = await supabaseClient.auth.getSession()

  if (error) {
    throw error
  }

  const sessionRoleClaim = readSessionRoleClaim(data.session)

  if (!shouldRefreshSessionRoleClaim(profile.role, sessionRoleClaim)) {
    return
  }

  // Fuente de verdad: RLS decide con el claim del JWT y no con el perfil cacheado en IndexedDB.
  // Si el perfil remoto ya cambió de collector a admin (o viceversa) pero el navegador reingresa
  // con un access token viejo, el shell local y Supabase divergen: la UI cree una cosa y RLS otra.
  // Forzamos refresh una sola vez antes del bootstrap para realinear claims sin exigir logout manual.
  const { error: refreshError } = await supabaseClient.auth.refreshSession()

  if (refreshError) {
    throw refreshError
  }
}

function readSessionRoleClaim(
  session: {
    user?: {
      app_metadata?: Record<string, unknown>
    }
  } | null,
): CollectorRole | null {
  const rawRole = session?.user?.app_metadata?.role

  return rawRole === 'admin' || rawRole === 'collector' ? rawRole : null
}

export async function recordLocalCollectionAction(
  action: LocalCollectionActionDraft,
  options: {
    db?: CobroDiarioDb
    now?: () => string
  } = {},
) {
  const db = options.db ?? localDb
  const createdAt = options.now?.() ?? new Date().toISOString()
  const deviceLocalId = action.deviceLocalId ?? crypto.randomUUID()
  const localAction: LocalCollectionAction = {
    collectorId: action.collectorId,
    createdAt,
    customerId: action.customerId,
    deviceLocalId,
    followUpAt: action.followUpAt,
    id: deviceLocalId,
    latitude: action.latitude,
    loanId: action.loanId,
    longitude: action.longitude,
    notes: action.notes,
    outcome: action.outcome,
    remoteCollectionActionId: action.remoteCollectionActionId,
    syncStatus: action.syncStatus ?? 'synced',
    syncedAt: action.syncedAt,
    updatedAt: createdAt,
  }

  // Intencion: sembrar o persistir una gestion en el cache local sin romper pruebas ni bootstrap.
  // Flujo principal de UI: enqueueOfflineCollectionAction() -> cola offline -> RPC remoto -> cache reconciliado.
  // Riesgo: usar este helper como write path interactivo saltaria la cola e impediria idempotencia remota.
  await db.collectionActions.put(localAction)

  return localAction
}

export async function clearCollectorOperationalCache(db: CobroDiarioDb = localDb) {
  await db.transaction(
    'rw',
    [
      db.collectionActions,
      db.customers,
      db.installments,
      db.loans,
      db.payments,
      db.profiles,
      db.settings,
      db.syncQueue,
    ],
    async () => {
      await Promise.all([
        db.collectionActions.clear(),
        db.customers.clear(),
        db.installments.clear(),
        db.loans.clear(),
        db.payments.clear(),
        db.profiles.clear(),
        db.settings.clear(),
        db.syncQueue.clear(),
      ])
    },
  )
}

function buildLatestPaymentMap(payments: LocalPayment[]) {
  const latestPaymentsByLoanId = new Map<string, LocalPayment>()

  for (const payment of [...payments].sort((leftPayment, rightPayment) =>
    rightPayment.paidAt.localeCompare(leftPayment.paidAt),
  )) {
    if (!latestPaymentsByLoanId.has(payment.loanId)) {
      latestPaymentsByLoanId.set(payment.loanId, payment)
    }
  }

  return latestPaymentsByLoanId
}

function buildLatestCollectionActionMap(collectionActions: LocalCollectionAction[]) {
  const latestActionsByLoanId = new Map<string, LocalCollectionAction>()

  for (const collectionAction of [...collectionActions].sort((leftAction, rightAction) =>
    rightAction.createdAt.localeCompare(leftAction.createdAt),
  )) {
    if (!latestActionsByLoanId.has(collectionAction.loanId)) {
      latestActionsByLoanId.set(collectionAction.loanId, collectionAction)
    }
  }

  return latestActionsByLoanId
}

function buildQueueEntries(
  queueItems: SyncQueueItem[],
  collectionActions: LocalCollectionAction[],
  payments: LocalPayment[],
  loans: LocalLoan[],
  customers: LocalCustomer[],
) {
  const collectionActionById = new Map(collectionActions.map((collectionAction) => [collectionAction.id, collectionAction]))
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]))
  const loanById = new Map(loans.map((loan) => [loan.id, loan]))
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))

  return [...queueItems]
    .filter((queueItem) => queueItem.status !== 'synced')
    .sort((leftQueueItem, rightQueueItem) => rightQueueItem.createdAt.localeCompare(leftQueueItem.createdAt))
    .map((queueItem) => {
      const payment = queueItem.entityName === 'payment' ? paymentById.get(queueItem.entityId) : undefined
      const collectionAction =
        queueItem.entityName === 'collection_action'
          ? collectionActionById.get(queueItem.entityId)
          : undefined
      const loan = payment
        ? loanById.get(payment.loanId)
        : collectionAction
          ? loanById.get(collectionAction.loanId)
          : undefined
      const customer = payment
        ? customerById.get(payment.customerId)
        : collectionAction
          ? customerById.get(collectionAction.customerId)
          : undefined

      return {
        collectionAction,
        customer,
        loan,
        payment,
        queueItem,
      } satisfies CollectorQueueEntry
    })
}

function buildQueueCountsByLoanId(queueEntries: CollectorQueueEntry[]) {
  const countsByLoanId = new Map<string, { failed: number; pending: number }>()

  for (const queueEntry of queueEntries) {
    if (!queueEntry.loan) {
      continue
    }

    const currentCounts = countsByLoanId.get(queueEntry.loan.id) ?? {
      failed: 0,
      pending: 0,
    }

    if (queueEntry.queueItem.status === 'failed') {
      currentCounts.failed += 1
    } else {
      currentCounts.pending += 1
    }

    countsByLoanId.set(queueEntry.loan.id, currentCounts)
  }

  return countsByLoanId
}

function compareLoanCards(leftLoanCard: CollectorLoanCard, rightLoanCard: CollectorLoanCard) {
  if (leftLoanCard.failedSyncCount !== rightLoanCard.failedSyncCount) {
    return rightLoanCard.failedSyncCount - leftLoanCard.failedSyncCount
  }

  if (leftLoanCard.pendingSyncCount !== rightLoanCard.pendingSyncCount) {
    return rightLoanCard.pendingSyncCount - leftLoanCard.pendingSyncCount
  }

  const leftOpen = toMoney(leftLoanCard.outstandingAmount).gt(0)
  const rightOpen = toMoney(rightLoanCard.outstandingAmount).gt(0)

  if (leftOpen !== rightOpen) {
    return leftOpen ? -1 : 1
  }

  if (leftLoanCard.nextDueDate && rightLoanCard.nextDueDate) {
    const dueDateComparison = leftLoanCard.nextDueDate.localeCompare(rightLoanCard.nextDueDate)

    if (dueDateComparison !== 0) {
      return dueDateComparison
    }
  }

  if (leftLoanCard.nextDueDate) {
    return -1
  }

  if (rightLoanCard.nextDueDate) {
    return 1
  }

  return leftLoanCard.customer.fullName.localeCompare(rightLoanCard.customer.fullName)
}

function expectSupabaseData<T>(
  result: {
    data: T | null
    error: { message: string } | null
  },
  fallbackValue: T,
) {
  const { data, error } = result

  if (error) {
    throw new Error(error.message)
  }

  return data ?? fallbackValue
}

function mapRemoteProfile(profile: RemoteProfileRow | null): SessionProfile | undefined {
  if (!profile) {
    return undefined
  }

  return {
    fullName: profile.full_name,
    id: profile.id,
    role: profile.role,
  }
}

function mapRemoteCustomer(customer: RemoteCustomerRow): LocalCustomer {
  const address = [customer.address_line?.trim(), customer.neighborhood?.trim()]
    .filter((addressPart): addressPart is string => Boolean(addressPart))
    .join(' · ')

  return {
    address: address || undefined,
    assignedCollectorId: customer.assigned_collector_id,
    fullName: customer.full_name,
    governmentId: customer.government_id ?? undefined,
    id: customer.id,
    latitude: toOptionalNumber(customer.latitude),
    longitude: toOptionalNumber(customer.longitude),
    routeLabel: customer.route_label?.trim() || undefined,
    neighborhood: customer.neighborhood?.trim() || undefined,
    phone: customer.phone ?? undefined,
    updatedAt: customer.updated_at,
  }
}

function mapRemoteLoan(loan: RemoteLoanRow): LocalLoan {
  return {
    collectorId: loan.collector_id,
    currencyCode: loan.currency_code,
    customerId: loan.customer_id,
    disbursementDate: loan.disbursement_date ?? undefined,
    externalLoanNumber: loan.external_loan_number ?? undefined,
    firstDueDate: loan.first_due_date ?? undefined,
    id: loan.id,
    installmentAmount: coerceNumeric(loan.installment_amount),
    interestMode: loan.interest_mode ?? undefined,
    interestRateDaily: coerceNumeric(loan.interest_rate_daily),
    notes: loan.notes ?? undefined,
    paymentApplicationMode: loan.payment_application_mode ?? undefined,
    principalAmount: coerceNumeric(loan.principal_amount),
    originatedAt: loan.originated_at ?? undefined,
    paymentFrequency: loan.payment_frequency ?? undefined,
    status: loan.status,
    totalInstallments: loan.total_installments ?? undefined,
    updatedAt: loan.updated_at,
  }
}

function mapRemoteInstallment(installment: RemoteInstallmentRow): LocalInstallment {
  const feeAmount = coerceNumeric(installment.fee_amount)
  const interestAmount = coerceNumeric(installment.interest_amount)
  const principalAmount = coerceNumeric(installment.principal_amount)
  const outstandingAmount = coerceNumeric(installment.outstanding_amount)
  const hasRemoteOutstandingComponents =
    installment.outstanding_fee_amount !== null
    && installment.outstanding_fee_amount !== undefined
    && installment.outstanding_interest_amount !== null
    && installment.outstanding_interest_amount !== undefined
    && installment.outstanding_principal_amount !== null
    && installment.outstanding_principal_amount !== undefined
  const outstandingComponents = hasRemoteOutstandingComponents
    ? {
        feeAmount: coerceNumeric(installment.outstanding_fee_amount!),
        interestAmount: coerceNumeric(installment.outstanding_interest_amount!),
        principalAmount: coerceNumeric(installment.outstanding_principal_amount!),
      }
    : deriveOutstandingInstallmentComponents({
        feeAmount,
        interestAmount,
        outstandingAmount,
        principalAmount,
      })

  return {
    dueDate: installment.due_date,
    feeAmount,
    id: installment.id,
    installmentNumber: installment.installment_number,
    interestAmount,
    loanId: installment.loan_id,
    outstandingAmount,
    outstandingFeeAmount: outstandingComponents.feeAmount,
    outstandingInterestAmount: outstandingComponents.interestAmount,
    outstandingPrincipalAmount: outstandingComponents.principalAmount,
    principalAmount,
    scheduledAmount: coerceNumeric(installment.scheduled_amount),
    status: installment.status,
    updatedAt: installment.updated_at,
  }
}

function mapRemoteCollectionAction(collectionAction: RemoteCollectionActionRow): LocalCollectionAction {
  return {
    collectorId: collectionAction.collector_id,
    createdAt: collectionAction.recorded_at,
    customerId: collectionAction.customer_id,
    deviceLocalId: collectionAction.device_local_id,
    followUpAt: collectionAction.follow_up_at ?? undefined,
    id: collectionAction.device_local_id,
    latitude: toOptionalNumber(collectionAction.latitude),
    loanId: collectionAction.loan_id,
    longitude: toOptionalNumber(collectionAction.longitude),
    notes: collectionAction.notes?.trim() || undefined,
    outcome: collectionAction.outcome,
    remoteCollectionActionId: collectionAction.id,
    syncStatus: 'synced',
    syncedAt: collectionAction.updated_at,
    updatedAt: collectionAction.updated_at,
  }
}

function coerceNumeric(value: number | string) {
  return toMoney(value).toFixed(2)
}

function toOptionalNumber(value: number | string | null) {
  if (value === null || value === '') {
    return undefined
  }

  const numericValue = Number(value)

  return Number.isFinite(numericValue) ? numericValue : undefined
}
