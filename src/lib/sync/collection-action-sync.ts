import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CobroDiarioDb,
  type LocalCollectionAction,
  localDb,
  type SyncQueueItem,
} from '@/lib/db/local-db.ts'
import { requiresCollectionFollowUp } from '@/lib/collector/collection-actions.ts'
import type {
  CollectionActionDraft,
  CollectionActionOutcome,
  SyncFailureKind,
} from '@/types/domain.ts'

export const COLLECTION_ACTION_QUEUE_ENTITY = 'collection_action' as const
const VALID_COLLECTION_ACTION_OUTCOMES = new Set<CollectionActionOutcome>([
  'promise_to_pay',
  'not_found',
  'return_visit',
  'visited_no_payment',
])

const COLLECTION_ACTION_SYNC_CONFLICT_CODES = new Set([
  'collection_action_follow_up_required',
  'collection_action_outcome_invalid',
  'collector_not_allowed',
  'customer_archived',
  'customer_collector_mismatch',
  'customer_not_found',
  'device_local_id_conflict',
  'loan_collector_mismatch',
  'loan_customer_mismatch',
  'loan_not_found',
  'recorded_at_required',
])

export type NormalizedCollectionActionDraft = Omit<CollectionActionDraft, 'notes'> & {
  outcome: CollectionActionOutcome
  notes?: string
}

export type CollectionActionSyncFailure = {
  code: string
  message: string
  kind: SyncFailureKind
}

export type CollectionActionSyncTransport = {
  recordCollectionAction(
    action: NormalizedCollectionActionDraft,
  ): Promise<{ collectionActionId: string }>
}

export type EnqueueOfflineCollectionActionResult = {
  clientEventId: string
  localCollectionActionId: string
  queueId: number
}

export type FlushCollectionActionSyncQueueResult = {
  failed: number
  processed: number
  synced: number
}

type RecordCollectionActionRpcPayload = {
  p_collector_id: string
  p_customer_id: string
  p_device_local_id: string
  p_follow_up_at: string | null
  p_latitude: number | null
  p_loan_id: string
  p_longitude: number | null
  p_notes: string | null
  p_outcome: CollectionActionOutcome
  p_recorded_at: string
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

function normalizeOptionalDate(value: string | undefined) {
  const normalizedValue = value?.trim()

  if (!normalizedValue) {
    return undefined
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    throw new Error('collection_action_follow_up_invalid')
  }

  return normalizedValue
}

export function normalizeCollectionActionDraft(
  action: CollectionActionDraft,
): NormalizedCollectionActionDraft {
  const deviceLocalId = normalizeRequiredId(action.deviceLocalId, 'device_local_id_required')
  const collectorId = normalizeRequiredId(action.collectorId, 'collector_id_required')
  const customerId = normalizeRequiredId(action.customerId, 'customer_id_required')
  const loanId = normalizeRequiredId(action.loanId, 'loan_id_required')

  if (!action.recordedAt || Number.isNaN(new Date(action.recordedAt).getTime())) {
    throw new Error('recorded_at_required')
  }

  if (!VALID_COLLECTION_ACTION_OUTCOMES.has(action.outcome)) {
    throw new Error('collection_action_outcome_invalid')
  }

  const normalizedFollowUpAt = normalizeOptionalDate(action.followUpAt)

  if (requiresCollectionFollowUp(action.outcome) && !normalizedFollowUpAt) {
    throw new Error('collection_action_follow_up_required')
  }

  return {
    collectorId,
    customerId,
    deviceLocalId,
    followUpAt: normalizedFollowUpAt,
    latitude: action.latitude,
    loanId,
    longitude: action.longitude,
    notes: normalizeOptionalText(action.notes),
    outcome: action.outcome,
    recordedAt: action.recordedAt,
  }
}

export function buildCollectionActionClientEventId(deviceLocalId: string) {
  return `collection_action:${deviceLocalId}:insert`
}

export function buildRecordCollectionActionRpcPayload(
  action: NormalizedCollectionActionDraft,
): RecordCollectionActionRpcPayload {
  return {
    p_collector_id: action.collectorId,
    p_customer_id: action.customerId,
    p_device_local_id: action.deviceLocalId,
    p_follow_up_at: action.followUpAt ?? null,
    p_latitude: action.latitude ?? null,
    p_loan_id: action.loanId,
    p_longitude: action.longitude ?? null,
    p_notes: action.notes ?? null,
    p_outcome: action.outcome,
    p_recorded_at: action.recordedAt,
  }
}

export function createSupabaseCollectionActionSyncTransport(
  supabaseClient: SupabaseClient,
): CollectionActionSyncTransport {
  return {
    async recordCollectionAction(action) {
      const payload = buildRecordCollectionActionRpcPayload(action)
      const { data, error } = await supabaseClient.rpc('record_collection_action', payload)

      if (error) {
        throw normalizeCollectionActionSyncFailure(error)
      }

      if (typeof data !== 'string' || !data) {
        throw {
          code: 'invalid_collection_action_id',
          kind: 'retryable',
          message: 'record_collection_action returned an invalid identifier',
        } satisfies CollectionActionSyncFailure
      }

      return { collectionActionId: data }
    },
  }
}

export async function enqueueOfflineCollectionAction(
  action: CollectionActionDraft,
  options: {
    db?: CobroDiarioDb
    now?: () => string
  } = {},
): Promise<EnqueueOfflineCollectionActionResult> {
  const db = options.db ?? localDb
  const now = options.now ?? (() => new Date().toISOString())
  const normalizedAction = normalizeCollectionActionDraft(action)
  const clientEventId = buildCollectionActionClientEventId(normalizedAction.deviceLocalId)
  const nowIso = now()

  return db.transaction('rw', db.collectionActions, db.customers, db.loans, db.syncQueue, async () => {
    const existingCollectionAction = await db.collectionActions.get(normalizedAction.deviceLocalId)

    if (existingCollectionAction) {
      if (
        existingCollectionAction.loanId === normalizedAction.loanId &&
        existingCollectionAction.customerId === normalizedAction.customerId &&
        existingCollectionAction.collectorId === normalizedAction.collectorId
      ) {
        const existingQueueItem = await db.syncQueue.where('clientEventId').equals(clientEventId).first()

        if (!existingQueueItem?.id) {
          throw new Error('missing_local_sync_queue_item')
        }

        return {
          clientEventId,
          localCollectionActionId: existingCollectionAction.id,
          queueId: existingQueueItem.id,
        }
      }

      throw new Error('device_local_id_conflict')
    }

    const loan = await db.loans.get(normalizedAction.loanId)

    if (!loan) {
      throw new Error('loan_not_found')
    }

    if (loan.customerId !== normalizedAction.customerId) {
      throw new Error('loan_customer_mismatch')
    }

    if (loan.collectorId !== normalizedAction.collectorId) {
      throw new Error('loan_collector_mismatch')
    }

    const customer = await db.customers.get(normalizedAction.customerId)

    if (!customer) {
      throw new Error('customer_not_found')
    }

    if (customer.assignedCollectorId !== normalizedAction.collectorId) {
      throw new Error('customer_collector_mismatch')
    }

    const localCollectionAction: LocalCollectionAction = {
      collectorId: normalizedAction.collectorId,
      createdAt: normalizedAction.recordedAt,
      customerId: normalizedAction.customerId,
      deviceLocalId: normalizedAction.deviceLocalId,
      followUpAt: normalizedAction.followUpAt,
      id: normalizedAction.deviceLocalId,
      latitude: normalizedAction.latitude,
      loanId: normalizedAction.loanId,
      longitude: normalizedAction.longitude,
      notes: normalizedAction.notes,
      outcome: normalizedAction.outcome,
      syncStatus: 'pending',
      updatedAt: nowIso,
    }

    const queueItem: SyncQueueItem = {
      attemptCount: 0,
      clientEventId,
      createdAt: nowIso,
      entityId: localCollectionAction.id,
      entityName: COLLECTION_ACTION_QUEUE_ENTITY,
      operation: 'insert',
      payload: normalizedAction as unknown as Record<string, unknown>,
      status: 'pending',
      updatedAt: nowIso,
    }

    await db.collectionActions.put(localCollectionAction)
    const queueId = await db.syncQueue.add(queueItem)

    return {
      clientEventId,
      localCollectionActionId: localCollectionAction.id,
      queueId,
    }
  })
}

export async function flushCollectionActionSyncQueue(
  transport: CollectionActionSyncTransport,
  options: {
    db?: CobroDiarioDb
    limit?: number
    now?: () => string
  } = {},
): Promise<FlushCollectionActionSyncQueueResult> {
  const db = options.db ?? localDb
  const now = options.now ?? (() => new Date().toISOString())
  const limit = options.limit ?? 50
  const queueItems = await db.syncQueue.where('status').equals('pending').sortBy('createdAt')
  const itemsToProcess = queueItems
    .filter((queueItem) => queueItem.entityName === COLLECTION_ACTION_QUEUE_ENTITY)
    .slice(0, limit)

  const result: FlushCollectionActionSyncQueueResult = {
    failed: 0,
    processed: itemsToProcess.length,
    synced: 0,
  }

  for (const queueItem of itemsToProcess) {
    await db.transaction('rw', db.collectionActions, db.syncQueue, async () => {
      const startedAt = now()
      await updateQueueItemStatus(db, queueItem.id, {
        attemptCount: queueItem.attemptCount + 1,
        lastAttemptAt: startedAt,
        status: 'processing',
        updatedAt: startedAt,
      })
      await updateLocalCollectionActionStatus(db, queueItem.entityId, {
        lastSyncAttemptAt: startedAt,
        syncStatus: 'processing',
        updatedAt: startedAt,
      })
    })

    try {
      const normalizedAction = queueItem.payload as unknown as NormalizedCollectionActionDraft
      const remoteAck = await transport.recordCollectionAction(normalizedAction)
      const finishedAt = now()

      await db.transaction('rw', db.collectionActions, db.syncQueue, async () => {
        await updateQueueItemStatus(db, queueItem.id, {
          lastErrorAt: undefined,
          lastErrorCode: undefined,
          lastErrorKind: undefined,
          lastErrorMessage: undefined,
          remoteRecordId: remoteAck.collectionActionId,
          status: 'synced',
          updatedAt: finishedAt,
        })
        await updateLocalCollectionActionStatus(db, queueItem.entityId, {
          remoteCollectionActionId: remoteAck.collectionActionId,
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
      const syncFailure = normalizeCollectionActionSyncFailure(error)
      const failedAt = now()

      await db.transaction('rw', db.collectionActions, db.syncQueue, async () => {
        await updateQueueItemStatus(db, queueItem.id, {
          lastErrorAt: failedAt,
          lastErrorCode: syncFailure.code,
          lastErrorKind: syncFailure.kind,
          lastErrorMessage: syncFailure.message,
          status: 'failed',
          updatedAt: failedAt,
        })
        await updateLocalCollectionActionStatus(db, queueItem.entityId, {
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

export async function retryFailedCollectionActionSyncQueueItem(
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

  if (queueItem.entityName !== COLLECTION_ACTION_QUEUE_ENTITY) {
    throw new Error('sync_queue_item_entity_mismatch')
  }

  const retryAt = now()

  await db.transaction('rw', db.collectionActions, db.syncQueue, async () => {
    await updateQueueItemStatus(db, queueItem.id, {
      status: 'pending',
      updatedAt: retryAt,
    })
    await updateLocalCollectionActionStatus(db, queueItem.entityId, {
      syncStatus: 'pending',
      updatedAt: retryAt,
    })
  })
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

async function updateLocalCollectionActionStatus(
  db: CobroDiarioDb,
  localCollectionActionId: string,
  patch: Partial<LocalCollectionAction>,
) {
  const currentCollectionAction = await db.collectionActions.get(localCollectionActionId)

  if (!currentCollectionAction) {
    throw new Error('local_collection_action_not_found')
  }

  await db.collectionActions.put({
    ...currentCollectionAction,
    ...patch,
  })
}

function normalizeCollectionActionSyncFailure(error: unknown): CollectionActionSyncFailure {
  if (isCollectionActionSyncFailure(error)) {
    return error
  }

  const message = extractErrorMessage(error)
  const code = extractErrorCode(message)

  if (code && COLLECTION_ACTION_SYNC_CONFLICT_CODES.has(code)) {
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
    return String(error.message)
  }

  return 'sync_transport_error'
}

function isCollectionActionSyncFailure(error: unknown): error is CollectionActionSyncFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'kind' in error &&
    'message' in error
  )
}
