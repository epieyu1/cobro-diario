import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalDb, type CobroDiarioDb } from '@/lib/db/local-db.ts'
import {
  enqueueOfflinePayment,
  flushPaymentSyncQueue,
  getSyncQueueSnapshot,
  retryFailedSyncQueueItem,
  type NormalizedPaymentDraft,
  type PaymentSyncFailure,
  type PaymentSyncTransport,
} from '@/lib/sync/payment-sync.ts'
import type { PaymentDraft } from '@/types/domain.ts'

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

describe('payment sync queue', () => {
  it('registers an offline payment and leaves it pending in the local queue', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)

    const enqueueResult = await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const localPayment = await database.payments.get(enqueueResult.localPaymentId)
    const queueSnapshot = await getSyncQueueSnapshot(database)
    const firstInstallment = await database.installments.get('installment-1')
    const secondInstallment = await database.installments.get('installment-2')
    const loan = await database.loans.get('loan-1')

    expect(localPayment).toMatchObject({
      deviceLocalId: 'device-local-1',
      syncStatus: 'pending',
      totalAmount: '50.00',
    })
    expect(queueSnapshot).toEqual({
      failed: 0,
      pending: 1,
      processing: 0,
      synced: 0,
      total: 1,
    })
    expect(firstInstallment).toMatchObject({
      outstandingAmount: '0.00',
      status: 'paid',
    })
    expect(secondInstallment).toMatchObject({
      outstandingAmount: '50.00',
      status: 'pending',
    })
    expect(loan?.status).toBe('active')
  })

  it('keeps the pending queue after closing and reopening the app database', async () => {
    const databaseName = 'phase3-reopen-db'
    const firstInstance = await createTestDb(databaseName)
    await seedLoanScenario(firstInstance)

    await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: firstInstance,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    firstInstance.close()

    const reopenedInstance = createLocalDb(databaseName)
    openDatabases.push(reopenedInstance)
    await reopenedInstance.open()

    const queueSnapshot = await getSyncQueueSnapshot(reopenedInstance)
    const localPayment = await reopenedInstance.payments.get('device-local-1')

    expect(queueSnapshot.pending).toBe(1)
    expect(localPayment?.syncStatus).toBe('pending')
  })

  it('returns the same local queue item when the same deviceLocalId retries the exact same payload', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)

    const firstEnqueue = await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const secondEnqueue = await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:01:00.000Z',
    })

    const queueSnapshot = await getSyncQueueSnapshot(database)

    expect(secondEnqueue).toEqual(firstEnqueue)
    expect(queueSnapshot.total).toBe(1)
  })

  it('rejects a reused deviceLocalId when the payload changes', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)

    await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    await expect(enqueueOfflinePayment({
      ...buildSingleInstallmentPayment(),
      paymentReference: 'REC-001-MUTATED',
    }, {
      db: database,
      now: () => '2026-05-05T15:01:00.000Z',
    })).rejects.toThrow('device_local_id_conflict')
  })

  it('syncs exactly one remote payment when connectivity returns', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)
    const transport = createRemoteLedgerTransport()

    await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const syncResult = await flushPaymentSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-05T15:05:00.000Z',
    })
    const queueItem = await database.syncQueue.toCollection().first()
    const localPayment = await database.payments.get('device-local-1')

    expect(syncResult).toEqual({
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(queueItem).toMatchObject({
      remoteRecordId: 'remote-payment-1',
      status: 'synced',
    })
    expect(localPayment).toMatchObject({
      remotePaymentId: 'remote-payment-1',
      syncStatus: 'synced',
      syncedAt: '2026-05-05T15:05:00.000Z',
    })
    expect(transport.uniqueRemotePayments()).toBe(1)
    expect(transport.attempts).toHaveLength(1)
  })

  it('retries the same payload without duplicating the remote payment', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)
    const transport = createRemoteLedgerTransport({ failAfterCommitOnce: true })

    const enqueueResult = await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const firstAttempt = await flushPaymentSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-05T15:05:00.000Z',
    })
    const failedQueueItem = await database.syncQueue.get(enqueueResult.queueId)
    const failedPayment = await database.payments.get('device-local-1')

    expect(firstAttempt).toEqual({
      failed: 1,
      processed: 1,
      synced: 0,
    })
    expect(failedQueueItem).toMatchObject({
      attemptCount: 1,
      lastErrorCode: 'network_timeout_after_commit',
      lastErrorKind: 'retryable',
      status: 'failed',
    })
    expect(failedPayment?.syncStatus).toBe('failed')

    await retryFailedSyncQueueItem(enqueueResult.queueId, {
      db: database,
      now: () => '2026-05-05T15:06:00.000Z',
    })

    const secondAttempt = await flushPaymentSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-05T15:07:00.000Z',
    })
    const syncedQueueItem = await database.syncQueue.get(enqueueResult.queueId)

    expect(secondAttempt).toEqual({
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(syncedQueueItem).toMatchObject({
      attemptCount: 2,
      remoteRecordId: 'remote-payment-1',
      status: 'synced',
    })
    expect(transport.uniqueRemotePayments()).toBe(1)
    expect(transport.attempts).toHaveLength(2)
  })

  it('marks a queue item as failed on remote conflict and leaves a retry path', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)
    const enqueueResult = await enqueueOfflinePayment(buildSingleInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const failingTransport: PaymentSyncTransport = {
      async recordPayment() {
        throw {
          code: 'loan_status_not_payable',
          kind: 'conflict',
          message: 'loan_status_not_payable',
        } satisfies PaymentSyncFailure
      },
    }

    await flushPaymentSyncQueue(failingTransport, {
      db: database,
      now: () => '2026-05-05T15:05:00.000Z',
    })

    const failedQueueItem = await database.syncQueue.get(enqueueResult.queueId)
    const failedPayment = await database.payments.get('device-local-1')

    expect(failedQueueItem).toMatchObject({
      lastErrorCode: 'loan_status_not_payable',
      lastErrorKind: 'conflict',
      status: 'failed',
    })
    expect(failedPayment).toMatchObject({
      syncErrorCode: 'loan_status_not_payable',
      syncErrorKind: 'conflict',
      syncStatus: 'failed',
    })

    await retryFailedSyncQueueItem(enqueueResult.queueId, {
      db: database,
      now: () => '2026-05-05T15:06:00.000Z',
    })

    const retriedQueueItem = await database.syncQueue.get(enqueueResult.queueId)
    const retriedPayment = await database.payments.get('device-local-1')

    expect(retriedQueueItem?.status).toBe('pending')
    expect(retriedPayment?.syncStatus).toBe('pending')
  })

  it('reconciles local installments and loan state after a successful sync', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)
    const transport = createRemoteLedgerTransport()

    await enqueueOfflinePayment(buildMultiInstallmentPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const locallyAppliedInstallmentOne = await database.installments.get('installment-1')
    const locallyAppliedInstallmentTwo = await database.installments.get('installment-2')
    const locallyAppliedLoan = await database.loans.get('loan-1')

    expect(locallyAppliedInstallmentOne).toMatchObject({
      outstandingAmount: '0.00',
      status: 'paid',
    })
    expect(locallyAppliedInstallmentTwo).toMatchObject({
      outstandingAmount: '35.00',
      outstandingInterestAmount: '0.00',
      outstandingPrincipalAmount: '35.00',
      status: 'partial',
    })
    expect(locallyAppliedLoan?.status).toBe('active')

    await flushPaymentSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-05T15:05:00.000Z',
    })

    const syncedInstallmentOne = await database.installments.get('installment-1')
    const syncedInstallmentTwo = await database.installments.get('installment-2')
    const syncedLoan = await database.loans.get('loan-1')
    const syncedPayment = await database.payments.get('device-local-2')

    expect(syncedInstallmentOne).toMatchObject({
      outstandingAmount: '0.00',
      status: 'paid',
    })
    expect(syncedInstallmentTwo).toMatchObject({
      outstandingAmount: '35.00',
      status: 'partial',
    })
    expect(syncedLoan?.status).toBe('active')
    expect(syncedPayment).toMatchObject({
      syncStatus: 'synced',
      remotePaymentId: 'remote-payment-1',
    })
  })

  it('applies a principal_only payment locally without consuming interest or fee', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)

    await enqueueOfflinePayment(buildPrincipalOnlyPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const firstInstallment = await database.installments.get('installment-1')
    const queuedPayment = await database.payments.get('device-local-principal-only')

    expect(firstInstallment).toMatchObject({
      outstandingAmount: '15.00',
      outstandingFeeAmount: '5.00',
      outstandingInterestAmount: '10.00',
      outstandingPrincipalAmount: '0.00',
      status: 'overdue',
    })
    expect(queuedPayment?.syncStatus).toBe('pending')
  })

  it('applies an interest_only payment locally without consuming principal', async () => {
    const database = await createTestDb()
    await seedLoanScenario(database)

    await enqueueOfflinePayment(buildInterestOnlyPayment(), {
      db: database,
      now: () => '2026-05-05T15:00:00.000Z',
    })

    const firstInstallment = await database.installments.get('installment-1')
    const queueItem = await database.syncQueue.toCollection().first()

    expect(firstInstallment).toMatchObject({
      outstandingAmount: '40.00',
      outstandingFeeAmount: '5.00',
      outstandingInterestAmount: '0.00',
      outstandingPrincipalAmount: '35.00',
      status: 'overdue',
    })
    expect(queueItem?.payload).toMatchObject({
      paymentApplicationMode: 'interest_only',
    })
  })
})

async function createTestDb(databaseName = `phase3-test-${crypto.randomUUID()}`) {
  const database = createLocalDb(databaseName)
  openDatabases.push(database)
  await database.open()

  return database
}

async function seedLoanScenario(database: CobroDiarioDb) {
  await database.customers.put({
    assignedCollectorId: 'collector-1',
    fullName: 'Cliente Demo',
    id: 'customer-1',
    updatedAt: '2026-05-05T10:00:00.000Z',
  })

  await database.loans.put({
    collectorId: 'collector-1',
    currencyCode: 'COP',
    customerId: 'customer-1',
    id: 'loan-1',
    installmentAmount: '50.00',
    interestRateDaily: '0.050000',
    principalAmount: '85.00',
    status: 'active',
    updatedAt: '2026-05-05T10:00:00.000Z',
  })

  await database.installments.bulkPut([
    {
      dueDate: '2026-05-04',
      feeAmount: '5.00',
      id: 'installment-1',
      installmentNumber: 1,
      interestAmount: '10.00',
      loanId: 'loan-1',
      outstandingAmount: '50.00',
      outstandingFeeAmount: '5.00',
      outstandingInterestAmount: '10.00',
      outstandingPrincipalAmount: '35.00',
      principalAmount: '35.00',
      scheduledAmount: '50.00',
      status: 'pending',
      updatedAt: '2026-05-05T10:00:00.000Z',
    },
    {
      dueDate: '2026-05-06',
      feeAmount: '0.00',
      id: 'installment-2',
      installmentNumber: 2,
      interestAmount: '10.00',
      loanId: 'loan-1',
      outstandingAmount: '50.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '10.00',
      outstandingPrincipalAmount: '40.00',
      principalAmount: '40.00',
      scheduledAmount: '50.00',
      status: 'pending',
      updatedAt: '2026-05-05T10:00:00.000Z',
    },
  ])
}

function buildSingleInstallmentPayment(): PaymentDraft {
  return {
    applications: [
      {
        appliedAmount: '50.00',
        feeComponent: '5.00',
        installmentId: 'installment-1',
        interestComponent: '10.00',
        principalComponent: '35.00',
      },
    ],
    collectorId: 'collector-1',
    customerId: 'customer-1',
    deviceId: 'device-1',
    deviceLocalId: 'device-local-1',
    latitude: 4.710989,
    loanId: 'loan-1',
    longitude: -74.07209,
    paidAt: '2026-05-05T10:00:00-05:00',
    paymentMethod: 'cash',
    paymentReference: 'REC-001',
  }
}

function buildMultiInstallmentPayment(): PaymentDraft {
  return {
    applications: [
      {
        appliedAmount: '50.00',
        feeComponent: '5.00',
        installmentId: 'installment-1',
        interestComponent: '10.00',
        principalComponent: '35.00',
      },
      {
        appliedAmount: '15.00',
        feeComponent: '0.00',
        installmentId: 'installment-2',
        interestComponent: '10.00',
        principalComponent: '5.00',
      },
    ],
    collectorId: 'collector-1',
    customerId: 'customer-1',
    deviceId: 'device-1',
    deviceLocalId: 'device-local-2',
    loanId: 'loan-1',
    paidAt: '2026-05-05T10:00:00-05:00',
    paymentMethod: 'cash',
    paymentReference: 'REC-002',
  }
}

function buildPrincipalOnlyPayment(): PaymentDraft {
  return {
    applications: [
      {
        appliedAmount: '35.00',
        feeComponent: '0.00',
        installmentId: 'installment-1',
        interestComponent: '0.00',
        principalComponent: '35.00',
      },
    ],
    collectorId: 'collector-1',
    customerId: 'customer-1',
    deviceLocalId: 'device-local-principal-only',
    loanId: 'loan-1',
    paidAt: '2026-05-05T10:00:00-05:00',
    paymentApplicationMode: 'principal_only',
  }
}

function buildInterestOnlyPayment(): PaymentDraft {
  return {
    applications: [
      {
        appliedAmount: '10.00',
        feeComponent: '0.00',
        installmentId: 'installment-1',
        interestComponent: '10.00',
        principalComponent: '0.00',
      },
    ],
    collectorId: 'collector-1',
    customerId: 'customer-1',
    deviceLocalId: 'device-local-interest-only',
    loanId: 'loan-1',
    paidAt: '2026-05-05T10:00:00-05:00',
    paymentApplicationMode: 'interest_only',
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
