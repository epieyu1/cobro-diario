import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalDb, type CobroDiarioDb } from '@/lib/db/local-db.ts'
import { buildOldestFirstPaymentApplications } from '@/lib/finance/payment-planning.ts'
import { buildCollectorRouteBoard } from '@/lib/collector/collector-route-board.ts'
import {
  bootstrapCollectorWorkspace,
  loadCollectorWorkspaceSnapshot,
  recordLocalCollectionAction,
  type CollectorWorkspaceRemoteSource,
} from '@/lib/collector/collector-workspace.ts'
import {
  enqueueOfflinePayment,
  flushPaymentSyncQueue,
  type NormalizedPaymentDraft,
  type PaymentSyncFailure,
  type PaymentSyncTransport,
} from '@/lib/sync/payment-sync.ts'
import type { PaymentDraft } from '@/types/domain.ts'

const FIXTURE_COLLECTOR_ID = 'collector-1'
const FIXTURE_BUSINESS_DATE = '2026-05-06'
const openDatabases: CobroDiarioDb[] = []

afterEach(async () => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop()

    if (!database) {
      continue
    }

    database.close()
    await database.delete()
  }
})

describe('collector operational flow', () => {
  it('hydrates a richer collector fixture and reconstructs partial overdue balances correctly', async () => {
    const database = await createTestDb()
    const source = createCollectorFixtureSource()

    await bootstrapCollectorWorkspace(source, FIXTURE_COLLECTOR_ID, {
      db: database,
    })

    const snapshot = await loadCollectorWorkspaceSnapshot(FIXTURE_COLLECTOR_ID, {
      db: database,
    })
    const brayanLoanCard = snapshot.loanCards.find((loanCard) => loanCard.loan.id === 'loan-bra-1')

    expect(snapshot.customerCount).toBe(4)
    expect(snapshot.openLoanCount).toBe(3)
    expect(snapshot.activeLoanCount).toBe(3)
    expect(brayanLoanCard?.installments[0]).toMatchObject({
      id: 'installment-bra-1',
      outstandingAmount: '15.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '0.00',
      outstandingPrincipalAmount: '15.00',
      status: 'overdue',
    })
  })

  it('replays a full collector workday without breaking route priority, queue state or formulas', async () => {
    const database = await createTestDb()
    const source = createCollectorFixtureSource()

    await bootstrapCollectorWorkspace(source, FIXTURE_COLLECTOR_ID, {
      db: database,
    })

    let snapshot = await loadCollectorWorkspaceSnapshot(FIXTURE_COLLECTOR_ID, {
      db: database,
    })
    const initialRouteBoard = buildCollectorRouteBoard(snapshot.loanCards, {
      businessDate: FIXTURE_BUSINESS_DATE,
    })

    expect(initialRouteBoard.cards.map((loanCard) => [loanCard.loan.id, loanCard.priority])).toEqual([
      ['loan-bra-1', 'overdue'],
      ['loan-ana-1', 'due-today'],
      ['loan-dia-1', 'scheduled'],
      ['loan-car-1', 'settled'],
    ])
    expect(initialRouteBoard.metrics).toEqual({
      dueTodayLoanCount: 1,
      failedSyncLoanCount: 0,
      openLoanCount: 3,
      overdueLoanCount: 1,
    })

    await recordLocalCollectionAction(
      {
        collectorId: FIXTURE_COLLECTOR_ID,
        customerId: 'customer-dia-1',
        followUpAt: '2026-05-07',
        loanId: 'loan-dia-1',
        notes: 'Pedir confirmacion antes de salir a ruta.',
        outcome: 'return_visit',
      },
      {
        db: database,
        now: () => '2026-05-06T13:00:00.000Z',
      },
    )

    snapshot = await loadCollectorWorkspaceSnapshot(FIXTURE_COLLECTOR_ID, {
      db: database,
    })

    expect(snapshot.loanCards.find((loanCard) => loanCard.loan.id === 'loan-dia-1')?.latestCollectionAction).toMatchObject(
      {
        followUpAt: '2026-05-07',
        notes: 'Pedir confirmacion antes de salir a ruta.',
        outcome: 'return_visit',
      },
    )

    const anaLoanCard = snapshot.loanCards.find((loanCard) => loanCard.loan.id === 'loan-ana-1')

    expect(anaLoanCard).toBeDefined()

    const applications = buildOldestFirstPaymentApplications('65.00', anaLoanCard?.installments ?? [])

    expect(applications).toEqual([
      {
        installmentId: 'installment-ana-1',
        appliedAmount: '50.00',
        feeComponent: '5.00',
        interestComponent: '10.00',
        principalComponent: '35.00',
      },
      {
        installmentId: 'installment-ana-2',
        appliedAmount: '15.00',
        feeComponent: '0.00',
        interestComponent: '10.00',
        principalComponent: '5.00',
      },
    ])

    const transport = createRemoteLedgerTransport()

    await enqueueOfflinePayment(
      buildFixturePaymentDraft(applications),
      {
        db: database,
        now: () => '2026-05-06T13:05:00.000Z',
      },
    )

    snapshot = await loadCollectorWorkspaceSnapshot(FIXTURE_COLLECTOR_ID, {
      db: database,
    })

    const locallyQueuedAnaLoan = snapshot.loanCards.find((loanCard) => loanCard.loan.id === 'loan-ana-1')
    const queueEntry = snapshot.queueEntries[0]
    const locallyQueuedRouteBoard = buildCollectorRouteBoard(snapshot.loanCards, {
      businessDate: FIXTURE_BUSINESS_DATE,
    })

    expect(queueEntry?.payment).toMatchObject({
      deviceLocalId: 'device-local-ana-1',
      syncStatus: 'pending',
      totalAmount: '65.00',
    })
    expect(locallyQueuedAnaLoan).toMatchObject({
      failedSyncCount: 0,
      latestPayment: {
        deviceLocalId: 'device-local-ana-1',
        syncStatus: 'pending',
      },
      outstandingAmount: '85.00',
      pendingSyncCount: 1,
    })
    expect(locallyQueuedAnaLoan?.installments[0]).toMatchObject({
      id: 'installment-ana-1',
      outstandingAmount: '0.00',
      status: 'paid',
    })
    expect(locallyQueuedAnaLoan?.installments[1]).toMatchObject({
      id: 'installment-ana-2',
      outstandingAmount: '35.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '0.00',
      outstandingPrincipalAmount: '35.00',
      status: 'partial',
    })
    expect(locallyQueuedRouteBoard.cards.find((loanCard) => loanCard.loan.id === 'loan-ana-1')?.priority).toBe(
      'scheduled',
    )
    expect(locallyQueuedRouteBoard.metrics.dueTodayLoanCount).toBe(0)

    const syncResult = await flushPaymentSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-06T13:10:00.000Z',
    })

    expect(syncResult).toEqual({
      failed: 0,
      processed: 1,
      synced: 1,
    })

    snapshot = await loadCollectorWorkspaceSnapshot(FIXTURE_COLLECTOR_ID, {
      db: database,
    })

    expect(snapshot.queueEntries).toHaveLength(0)
    expect(snapshot.recentPayments[0]).toMatchObject({
      deviceLocalId: 'device-local-ana-1',
      remotePaymentId: 'remote-payment-1',
      syncStatus: 'synced',
    })
    expect(snapshot.loanCards.find((loanCard) => loanCard.loan.id === 'loan-ana-1')).toMatchObject({
      failedSyncCount: 0,
      outstandingAmount: '85.00',
      pendingSyncCount: 0,
    })
    expect(transport.uniqueRemotePayments()).toBe(1)
    expect(transport.attempts).toHaveLength(1)
  })

  it('surfaces a newly originated loan as collectible from the first installment', async () => {
    const database = await createTestDb()
    const source: CollectorWorkspaceRemoteSource = {
      async fetchWorkspace(collectorId) {
        expect(collectorId).toBe(FIXTURE_COLLECTOR_ID)

        return {
          customers: [
            {
              address_line: 'Calle 99 # 10-11',
              assigned_collector_id: FIXTURE_COLLECTOR_ID,
              full_name: 'Eva Suarez',
              government_id: '50505050',
              id: 'customer-eva-1',
              latitude: '4.701234',
              longitude: '-74.031234',
              neighborhood: 'Chapinero',
              phone: '3005555555',
              updated_at: '2026-05-06T12:00:00.000Z',
            },
          ],
          fetchedAt: '2026-05-06T12:30:00.000Z',
          installments: [
            {
              due_date: '2026-05-06',
              fee_amount: '0.00',
              id: 'installment-eva-1',
              installment_number: 1,
              interest_amount: '10.00',
              loan_id: 'loan-eva-1',
              outstanding_amount: '70.00',
              principal_amount: '60.00',
              scheduled_amount: '70.00',
              status: 'pending',
              updated_at: '2026-05-06T12:00:00.000Z',
            },
            {
              due_date: '2026-05-07',
              fee_amount: '0.00',
              id: 'installment-eva-2',
              installment_number: 2,
              interest_amount: '10.00',
              loan_id: 'loan-eva-1',
              outstanding_amount: '70.00',
              principal_amount: '60.00',
              scheduled_amount: '70.00',
              status: 'pending',
              updated_at: '2026-05-06T12:00:00.000Z',
            },
          ],
          loans: [
            {
              collector_id: FIXTURE_COLLECTOR_ID,
              currency_code: 'COP',
              customer_id: 'customer-eva-1',
              disbursement_date: '2026-05-06',
              external_loan_number: 'CD-20260506-EVA00001',
              first_due_date: '2026-05-06',
              id: 'loan-eva-1',
              installment_amount: '70.00',
              interest_mode: 'simple_precomputed',
              interest_rate_daily: '0.050000',
              notes: 'Alta nueva de originacion.',
              originated_at: '2026-05-06T12:00:00.000Z',
              payment_application_mode: 'oldest_first',
              payment_frequency: 'daily',
              principal_amount: '120.00',
              status: 'active',
              total_installments: 2,
              updated_at: '2026-05-06T12:00:00.000Z',
            },
          ],
          profile: {
            full_name: 'Fase 4 Collector',
            id: FIXTURE_COLLECTOR_ID,
            role: 'collector',
          },
        }
      },
    }

    await bootstrapCollectorWorkspace(source, FIXTURE_COLLECTOR_ID, {
      db: database,
    })

    const snapshot = await loadCollectorWorkspaceSnapshot(FIXTURE_COLLECTOR_ID, {
      db: database,
    })
    const routeBoard = buildCollectorRouteBoard(snapshot.loanCards, {
      businessDate: FIXTURE_BUSINESS_DATE,
    })
    const evaLoanCard = routeBoard.cards.find((loanCard) => loanCard.loan.id === 'loan-eva-1')

    expect(evaLoanCard).toMatchObject({
      customer: {
        fullName: 'Eva Suarez',
      },
      loan: {
        externalLoanNumber: 'CD-20260506-EVA00001',
        firstDueDate: '2026-05-06',
        paymentFrequency: 'daily',
        totalInstallments: 2,
      },
      priority: 'due-today',
    })

    expect(
      buildOldestFirstPaymentApplications('70.00', evaLoanCard?.installments ?? []),
    ).toEqual([
      {
        appliedAmount: '70.00',
        feeComponent: '0.00',
        installmentId: 'installment-eva-1',
        interestComponent: '10.00',
        principalComponent: '60.00',
      },
    ])
  })
})

async function createTestDb(databaseName = `phase4-collector-flow-${crypto.randomUUID()}`) {
  const database = createLocalDb(databaseName)
  openDatabases.push(database)
  await database.open()

  return database
}

function createCollectorFixtureSource(): CollectorWorkspaceRemoteSource {
  return {
    async fetchWorkspace(collectorId) {
      expect(collectorId).toBe(FIXTURE_COLLECTOR_ID)

      return {
        customers: [
          {
            address_line: 'Cra 10 #20-30',
            assigned_collector_id: FIXTURE_COLLECTOR_ID,
            full_name: 'Ana Gomez',
            government_id: '10101010',
            id: 'customer-ana-1',
            latitude: '4.710989',
            longitude: '-74.072090',
            neighborhood: 'Centro',
            phone: '3001111111',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            address_line: 'Calle 45 #18-12',
            assigned_collector_id: FIXTURE_COLLECTOR_ID,
            full_name: 'Brayan Rojas',
            government_id: '20202020',
            id: 'customer-bra-1',
            latitude: '4.648625',
            longitude: '-74.095543',
            neighborhood: 'Galerias',
            phone: '3002222222',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            address_line: 'Tv 72 #90-11',
            assigned_collector_id: FIXTURE_COLLECTOR_ID,
            full_name: 'Carolina Perez',
            government_id: '30303030',
            id: 'customer-car-1',
            latitude: '4.687937',
            longitude: '-74.107194',
            neighborhood: 'Normandia',
            phone: '3003333333',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            address_line: 'Calle 145 #14-20',
            assigned_collector_id: FIXTURE_COLLECTOR_ID,
            full_name: 'Diana Torres',
            government_id: '40404040',
            id: 'customer-dia-1',
            latitude: '4.732585',
            longitude: '-74.037878',
            neighborhood: 'Cedritos',
            phone: '3004444444',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
        ],
        fetchedAt: '2026-05-06T12:30:00.000Z',
        installments: [
          {
            due_date: '2026-05-06',
            fee_amount: '5.00',
            id: 'installment-ana-1',
            installment_number: 1,
            interest_amount: '10.00',
            loan_id: 'loan-ana-1',
            outstanding_amount: '50.00',
            principal_amount: '35.00',
            scheduled_amount: '50.00',
            status: 'pending',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-07',
            fee_amount: '0.00',
            id: 'installment-ana-2',
            installment_number: 2,
            interest_amount: '10.00',
            loan_id: 'loan-ana-1',
            outstanding_amount: '50.00',
            principal_amount: '40.00',
            scheduled_amount: '50.00',
            status: 'pending',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-08',
            fee_amount: '0.00',
            id: 'installment-ana-3',
            installment_number: 3,
            interest_amount: '10.00',
            loan_id: 'loan-ana-1',
            outstanding_amount: '50.00',
            principal_amount: '40.00',
            scheduled_amount: '50.00',
            status: 'pending',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-02',
            fee_amount: '5.00',
            id: 'installment-bra-1',
            installment_number: 1,
            interest_amount: '5.00',
            loan_id: 'loan-bra-1',
            outstanding_amount: '15.00',
            principal_amount: '50.00',
            scheduled_amount: '60.00',
            status: 'overdue',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-05',
            fee_amount: '5.00',
            id: 'installment-bra-2',
            installment_number: 2,
            interest_amount: '5.00',
            loan_id: 'loan-bra-1',
            outstanding_amount: '60.00',
            principal_amount: '50.00',
            scheduled_amount: '60.00',
            status: 'overdue',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-07',
            fee_amount: '5.00',
            id: 'installment-bra-3',
            installment_number: 3,
            interest_amount: '5.00',
            loan_id: 'loan-bra-1',
            outstanding_amount: '60.00',
            principal_amount: '50.00',
            scheduled_amount: '60.00',
            status: 'pending',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-01',
            fee_amount: '0.00',
            id: 'installment-car-1',
            installment_number: 1,
            interest_amount: '5.00',
            loan_id: 'loan-car-1',
            outstanding_amount: '0.00',
            principal_amount: '45.00',
            scheduled_amount: '50.00',
            status: 'paid',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-07',
            fee_amount: '0.00',
            id: 'installment-dia-1',
            installment_number: 1,
            interest_amount: '10.00',
            loan_id: 'loan-dia-1',
            outstanding_amount: '50.00',
            principal_amount: '40.00',
            scheduled_amount: '50.00',
            status: 'pending',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            due_date: '2026-05-08',
            fee_amount: '0.00',
            id: 'installment-dia-2',
            installment_number: 2,
            interest_amount: '10.00',
            loan_id: 'loan-dia-1',
            outstanding_amount: '50.00',
            principal_amount: '40.00',
            scheduled_amount: '50.00',
            status: 'pending',
            updated_at: '2026-05-06T12:00:00.000Z',
          },
        ],
        loans: [
          {
            collector_id: FIXTURE_COLLECTOR_ID,
            currency_code: 'COP',
            customer_id: 'customer-ana-1',
            disbursement_date: '2026-05-04',
            external_loan_number: 'ANA-001',
            first_due_date: '2026-05-06',
            id: 'loan-ana-1',
            installment_amount: '50.00',
            interest_mode: 'simple_precomputed',
            interest_rate_daily: '0.000000',
            notes: null,
            originated_at: '2026-05-04T12:00:00.000Z',
            payment_application_mode: 'oldest_first',
            payment_frequency: 'daily',
            principal_amount: '115.00',
            status: 'active',
            total_installments: 3,
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            collector_id: FIXTURE_COLLECTOR_ID,
            currency_code: 'COP',
            customer_id: 'customer-bra-1',
            disbursement_date: '2026-04-30',
            external_loan_number: 'BRA-001',
            first_due_date: '2026-05-02',
            id: 'loan-bra-1',
            installment_amount: '60.00',
            interest_mode: 'simple_precomputed',
            interest_rate_daily: '0.000000',
            notes: null,
            originated_at: '2026-04-30T12:00:00.000Z',
            payment_application_mode: 'oldest_first',
            payment_frequency: 'daily',
            principal_amount: '150.00',
            status: 'delinquent',
            total_installments: 3,
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            collector_id: FIXTURE_COLLECTOR_ID,
            currency_code: 'COP',
            customer_id: 'customer-car-1',
            disbursement_date: '2026-04-28',
            external_loan_number: 'CAR-001',
            first_due_date: '2026-05-01',
            id: 'loan-car-1',
            installment_amount: '50.00',
            interest_mode: 'simple_precomputed',
            interest_rate_daily: '0.000000',
            notes: null,
            originated_at: '2026-04-28T12:00:00.000Z',
            payment_application_mode: 'oldest_first',
            payment_frequency: 'daily',
            principal_amount: '45.00',
            status: 'settled',
            total_installments: 1,
            updated_at: '2026-05-06T12:00:00.000Z',
          },
          {
            collector_id: FIXTURE_COLLECTOR_ID,
            currency_code: 'COP',
            customer_id: 'customer-dia-1',
            disbursement_date: '2026-05-05',
            external_loan_number: 'DIA-001',
            first_due_date: '2026-05-07',
            id: 'loan-dia-1',
            installment_amount: '50.00',
            interest_mode: 'simple_precomputed',
            interest_rate_daily: '0.000000',
            notes: null,
            originated_at: '2026-05-05T12:00:00.000Z',
            payment_application_mode: 'oldest_first',
            payment_frequency: 'daily',
            principal_amount: '80.00',
            status: 'active',
            total_installments: 2,
            updated_at: '2026-05-06T12:00:00.000Z',
          },
        ],
        profile: {
          full_name: 'Fase 4 Collector',
          id: FIXTURE_COLLECTOR_ID,
          role: 'collector',
        },
      }
    },
  }
}

function buildFixturePaymentDraft(applications: PaymentDraft['applications']): PaymentDraft {
  return {
    applications,
    collectorId: FIXTURE_COLLECTOR_ID,
    customerId: 'customer-ana-1',
    deviceId: 'device-1',
    deviceLocalId: 'device-local-ana-1',
    latitude: 4.710989,
    loanId: 'loan-ana-1',
    longitude: -74.07209,
    paidAt: '2026-05-06T08:05:00-05:00',
    paymentMethod: 'cash',
    paymentReference: 'REC-ANA-001',
  }
}

function createRemoteLedgerTransport(options: { failAfterCommitOnce?: boolean } = {}) {
  const remotePayments = new Map<string, string>()
  const attempts: NormalizedPaymentDraft[] = []
  let failAfterCommitPending = options.failAfterCommitOnce ?? false

  const port: PaymentSyncTransport = {
    async recordPayment(payment) {
      attempts.push(payment)

      const existingRemotePaymentId = remotePayments.get(payment.deviceLocalId)

      if (existingRemotePaymentId) {
        return { paymentId: existingRemotePaymentId }
      }

      const remotePaymentId = `remote-payment-${remotePayments.size + 1}`
      remotePayments.set(payment.deviceLocalId, remotePaymentId)

      if (failAfterCommitPending) {
        failAfterCommitPending = false
        throw {
          code: 'network_timeout_after_commit',
          kind: 'retryable',
          message: 'network_timeout_after_commit',
        } satisfies PaymentSyncFailure
      }

      return { paymentId: remotePaymentId }
    },
  }

  return {
    attempts,
    port,
    uniqueRemotePayments: () => remotePayments.size,
  }
}
