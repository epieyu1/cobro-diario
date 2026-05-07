import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalDb, type CobroDiarioDb } from '@/lib/db/local-db.ts'
import {
  enqueueOfflineCollectionAction,
  flushCollectionActionSyncQueue,
  retryFailedCollectionActionSyncQueueItem,
  type CollectionActionSyncFailure,
  type CollectionActionSyncTransport,
  type NormalizedCollectionActionDraft,
} from '@/lib/sync/collection-action-sync.ts'

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

describe('collection action sync queue', () => {
  it('registers an offline collection action and leaves it pending in the local queue', async () => {
    const database = await createTestDb()
    await seedCollectionActionScenario(database)

    const enqueueResult = await enqueueOfflineCollectionAction(buildPromiseToPayAction(), {
      db: database,
      now: () => '2026-05-06T15:00:00.000Z',
    })

    const localCollectionAction = await database.collectionActions.get(enqueueResult.localCollectionActionId)
    const queueItem = await database.syncQueue.get(enqueueResult.queueId)

    expect(localCollectionAction).toMatchObject({
      deviceLocalId: 'collection-action-local-1',
      followUpAt: '2026-05-07',
      outcome: 'promise_to_pay',
      syncStatus: 'pending',
    })
    expect(queueItem).toMatchObject({
      entityName: 'collection_action',
      entityId: 'collection-action-local-1',
      status: 'pending',
    })
  })

  it('keeps the pending collection action after closing and reopening the app database', async () => {
    const databaseName = 'phase4-collection-action-reopen-db'
    const firstInstance = await createTestDb(databaseName)
    await seedCollectionActionScenario(firstInstance)

    await enqueueOfflineCollectionAction(buildPromiseToPayAction(), {
      db: firstInstance,
      now: () => '2026-05-06T15:00:00.000Z',
    })

    firstInstance.close()

    const reopenedInstance = createLocalDb(databaseName)
    openDatabases.push(reopenedInstance)
    await reopenedInstance.open()

    const localCollectionAction = await reopenedInstance.collectionActions.get('collection-action-local-1')
    const queueItem = await reopenedInstance.syncQueue.where('entityName').equals('collection_action').first()

    expect(localCollectionAction?.syncStatus).toBe('pending')
    expect(queueItem?.status).toBe('pending')
  })

  it('syncs exactly one remote collection action when connectivity returns', async () => {
    const database = await createTestDb()
    await seedCollectionActionScenario(database)
    const transport = createRemoteCollectionActionTransport()

    await enqueueOfflineCollectionAction(buildPromiseToPayAction(), {
      db: database,
      now: () => '2026-05-06T15:00:00.000Z',
    })

    const syncResult = await flushCollectionActionSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-06T15:05:00.000Z',
    })
    const queueItem = await database.syncQueue.where('entityName').equals('collection_action').first()
    const localCollectionAction = await database.collectionActions.get('collection-action-local-1')

    expect(syncResult).toEqual({
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(queueItem).toMatchObject({
      remoteRecordId: 'remote-collection-action-1',
      status: 'synced',
    })
    expect(localCollectionAction).toMatchObject({
      remoteCollectionActionId: 'remote-collection-action-1',
      syncStatus: 'synced',
      syncedAt: '2026-05-06T15:05:00.000Z',
    })
    expect(transport.uniqueRemoteCollectionActions()).toBe(1)
    expect(transport.attempts).toHaveLength(1)
  })

  it('retries the same payload without duplicating the remote collection action', async () => {
    const database = await createTestDb()
    await seedCollectionActionScenario(database)
    const transport = createRemoteCollectionActionTransport({ failAfterCommitOnce: true })

    const enqueueResult = await enqueueOfflineCollectionAction(buildPromiseToPayAction(), {
      db: database,
      now: () => '2026-05-06T15:00:00.000Z',
    })

    const firstAttempt = await flushCollectionActionSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-06T15:05:00.000Z',
    })
    const failedQueueItem = await database.syncQueue.get(enqueueResult.queueId)
    const failedCollectionAction = await database.collectionActions.get('collection-action-local-1')

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
    expect(failedCollectionAction?.syncStatus).toBe('failed')

    await retryFailedCollectionActionSyncQueueItem(enqueueResult.queueId, {
      db: database,
      now: () => '2026-05-06T15:06:00.000Z',
    })

    const secondAttempt = await flushCollectionActionSyncQueue(transport.port, {
      db: database,
      now: () => '2026-05-06T15:07:00.000Z',
    })
    const syncedQueueItem = await database.syncQueue.get(enqueueResult.queueId)

    expect(secondAttempt).toEqual({
      failed: 0,
      processed: 1,
      synced: 1,
    })
    expect(syncedQueueItem).toMatchObject({
      attemptCount: 2,
      remoteRecordId: 'remote-collection-action-1',
      status: 'synced',
    })
    expect(transport.uniqueRemoteCollectionActions()).toBe(1)
    expect(transport.attempts).toHaveLength(2)
  })

  it('marks a collection action queue item as failed on remote conflict and leaves a retry path', async () => {
    const database = await createTestDb()
    await seedCollectionActionScenario(database)
    const enqueueResult = await enqueueOfflineCollectionAction(buildPromiseToPayAction(), {
      db: database,
      now: () => '2026-05-06T15:00:00.000Z',
    })

    const failingTransport: CollectionActionSyncTransport = {
      async recordCollectionAction() {
        throw {
          code: 'customer_archived',
          kind: 'conflict',
          message: 'customer_archived',
        } satisfies CollectionActionSyncFailure
      },
    }

    await flushCollectionActionSyncQueue(failingTransport, {
      db: database,
      now: () => '2026-05-06T15:05:00.000Z',
    })

    const failedQueueItem = await database.syncQueue.get(enqueueResult.queueId)
    const failedCollectionAction = await database.collectionActions.get('collection-action-local-1')

    expect(failedQueueItem).toMatchObject({
      lastErrorCode: 'customer_archived',
      lastErrorKind: 'conflict',
      status: 'failed',
    })
    expect(failedCollectionAction).toMatchObject({
      syncErrorCode: 'customer_archived',
      syncErrorKind: 'conflict',
      syncStatus: 'failed',
    })

    await retryFailedCollectionActionSyncQueueItem(enqueueResult.queueId, {
      db: database,
      now: () => '2026-05-06T15:06:00.000Z',
    })

    const retriedQueueItem = await database.syncQueue.get(enqueueResult.queueId)
    const retriedCollectionAction = await database.collectionActions.get('collection-action-local-1')

    expect(retriedQueueItem?.status).toBe('pending')
    expect(retriedCollectionAction?.syncStatus).toBe('pending')
  })
})

async function createTestDb(databaseName = `phase4-collection-action-${crypto.randomUUID()}`) {
  const database = createLocalDb(databaseName)
  openDatabases.push(database)
  await database.open()
  return database
}

async function seedCollectionActionScenario(database: CobroDiarioDb) {
  await database.customers.put({
    assignedCollectorId: 'collector-1',
    fullName: 'Ana Gomez',
    id: 'customer-1',
    updatedAt: '2026-05-06T14:00:00.000Z',
  })
  await database.loans.put({
    collectorId: 'collector-1',
    currencyCode: 'COP',
    customerId: 'customer-1',
    id: 'loan-1',
    installmentAmount: '100.00',
    interestRateDaily: '0.000000',
    principalAmount: '300.00',
    status: 'active',
    updatedAt: '2026-05-06T14:00:00.000Z',
  })
}

function buildPromiseToPayAction() {
  return {
    collectorId: 'collector-1',
    customerId: 'customer-1',
    deviceLocalId: 'collection-action-local-1',
    followUpAt: '2026-05-07',
    loanId: 'loan-1',
    notes: 'Confirmo visita en la tarde.',
    outcome: 'promise_to_pay',
    recordedAt: '2026-05-06T14:30:00.000Z',
  } satisfies Parameters<typeof enqueueOfflineCollectionAction>[0]
}

function createRemoteCollectionActionTransport(options: { failAfterCommitOnce?: boolean } = {}) {
  const actionsByDeviceLocalId = new Map<string, string>()
  const attempts: string[] = []
  const failedAfterCommit = new Set<string>()

  const port: CollectionActionSyncTransport = {
    async recordCollectionAction(action: NormalizedCollectionActionDraft) {
      attempts.push(action.deviceLocalId)

      const existingActionId = actionsByDeviceLocalId.get(action.deviceLocalId)

      if (existingActionId) {
        return {
          collectionActionId: existingActionId,
        }
      }

      const nextActionId = `remote-collection-action-${actionsByDeviceLocalId.size + 1}`
      actionsByDeviceLocalId.set(action.deviceLocalId, nextActionId)

      if (options.failAfterCommitOnce && !failedAfterCommit.has(action.deviceLocalId)) {
        failedAfterCommit.add(action.deviceLocalId)
        throw {
          code: 'network_timeout_after_commit',
          kind: 'retryable',
          message: 'network_timeout_after_commit',
        } satisfies CollectionActionSyncFailure
      }

      return {
        collectionActionId: nextActionId,
      }
    },
  }

  return {
    attempts,
    port,
    uniqueRemoteCollectionActions() {
      return actionsByDeviceLocalId.size
    },
  }
}
