import Dexie, { type Table } from 'dexie'
import type {
  CollectionActionOutcome,
  CollectorRole,
  InstallmentStatus,
  LoanInterestMode,
  LoanPaymentApplicationMode,
  LoanStatus,
  OriginationPaymentFrequency,
  PaymentStatus,
  SyncFailureKind,
  SyncQueueEntityName,
  SyncQueueOperation,
  SyncQueueStatus,
} from '@/types/domain.ts'

// Snapshot local del cliente para operacion offline.
// Si se amplia este shape, revisar las consultas UI y la estrategia de reconciliacion remota.
export type LocalCustomer = {
  id: string
  assignedCollectorId: string
  fullName: string
  governmentId?: string
  phone?: string
  address?: string
  // routeLabel formaliza la agrupacion operativa remota sin inventar aun una tabla dedicada.
  // Si cambia el origen de esta ruta, bootstrap, UI y docs deben actualizarse juntos.
  routeLabel?: string
  // neighborhood no reemplaza una entidad formal de ruta.
  // Hoy queda como contexto geografico del cliente y fallback de compatibilidad.
  neighborhood?: string
  latitude?: number
  longitude?: number
  updatedAt: string
}

// El prestamo local solo refleja estado operativo.
// Los cambios finales de saldo y estados deben confirmarse en PostgreSQL via RPC o sync.
export type LocalLoan = {
  id: string
  customerId: string
  collectorId: string
  // Estos metadatos permiten identificar en UI el caso recien originado sin inventar
  // una segunda fuente local del prestamo. La verdad sigue viniendo del bootstrap remoto.
  externalLoanNumber?: string
  status: LoanStatus
  principalAmount: string
  installmentAmount: string
  interestRateDaily: string
  totalInstallments?: number
  currencyCode: string
  disbursementDate?: string
  firstDueDate?: string
  paymentFrequency?: OriginationPaymentFrequency
  interestMode?: LoanInterestMode
  paymentApplicationMode?: LoanPaymentApplicationMode
  originatedAt?: string
  notes?: string
  updatedAt: string
}

// Cada cuota local se usa para UI y trabajo de campo.
// No debe asumirse como autoridad final despues de registrar un pago hasta que el sync confirme servidor.
export type LocalInstallment = {
  id: string
  loanId: string
  installmentNumber: number
  dueDate: string
  scheduledAmount: string
  principalAmount: string
  interestAmount: string
  feeAmount: string
  // Estos saldos por componente permiten aplicar pagos offline con la misma semantica del RPC.
  // Si faltan o se corrompen, la cuota debe rehidratarse desde servidor antes de seguir cobrando.
  outstandingPrincipalAmount: string
  outstandingInterestAmount: string
  outstandingFeeAmount: string
  outstandingAmount: string
  status: InstallmentStatus
  updatedAt: string
}

// Este registro es solo la cabecera del pago vista por el navegador.
// El reparto por cuotas no debe reconstruirse desde totalAmount: debe viajar completo en syncQueue.payload.
export type LocalPayment = {
  id: string
  loanId: string
  customerId: string
  collectorId: string
  totalAmount: string
  paidAt: string
  deviceLocalId: string
  paymentMethod: string
  paymentReference?: string
  notes?: string
  latitude?: number
  longitude?: number
  syncStatus: SyncQueueStatus
  remotePaymentId?: string
  // Esta marca solo replica el estado autoritativo ya confirmado por PostgreSQL.
  // No reemplaza el recibo remoto: sirve para que la shell no siga rotulando como "confirmado"
  // un pago que el servidor ya devolvió como `reversed`.
  remotePaymentStatus?: PaymentStatus
  syncErrorKind?: SyncFailureKind
  syncErrorCode?: string
  syncErrorMessage?: string
  lastSyncAttemptAt?: string
  updatedAt: string
  syncedAt?: string
}

// Este evento representa la visita operativa del cobrador.
// La identidad local vive en deviceLocalId para poder reintentar contra el RPC sin duplicar auditoria remota.
export type LocalCollectionAction = {
  id: string
  deviceLocalId: string
  collectorId: string
  customerId: string
  loanId: string
  outcome: CollectionActionOutcome
  notes?: string
  followUpAt?: string
  latitude?: number
  longitude?: number
  syncStatus: SyncQueueStatus
  remoteCollectionActionId?: string
  syncErrorKind?: SyncFailureKind
  syncErrorCode?: string
  syncErrorMessage?: string
  lastSyncAttemptAt?: string
  createdAt: string
  updatedAt: string
  syncedAt?: string
}

// La cola local debe ser replayable.
// Para pagos, payload debe contener el mismo contrato esperado por record_payment:
// deviceLocalId estable, aplicaciones materializadas y coordenadas/notas si existen.
export type SyncQueueItem = {
  id?: number
  clientEventId: string
  entityName: SyncQueueEntityName
  entityId: string
  operation: SyncQueueOperation
  payload: Record<string, unknown>
  status: SyncQueueStatus
  attemptCount: number
  lastAttemptAt?: string
  lastErrorAt?: string
  lastErrorKind?: SyncFailureKind
  lastErrorCode?: string
  lastErrorMessage?: string
  remoteRecordId?: string
  createdAt: string
  updatedAt: string
}

export type LocalSetting = {
  key: string
  value: string
}

// Este perfil alimenta alcance local y UX.
// No reemplaza claims de Auth ni autorizacion real del backend.
export type SessionProfile = {
  id: string
  role: CollectorRole
  fullName: string
}

export class CobroDiarioDb extends Dexie {
  customers!: Table<LocalCustomer, string>
  loans!: Table<LocalLoan, string>
  installments!: Table<LocalInstallment, string>
  payments!: Table<LocalPayment, string>
  collectionActions!: Table<LocalCollectionAction, string>
  syncQueue!: Table<SyncQueueItem, number>
  settings!: Table<LocalSetting, string>
  profiles!: Table<SessionProfile, string>

  constructor(databaseName = 'cobro-diario') {
    super(databaseName)

    // Esta base local es soporte offline.
    // Ningun asistente debe asumir que este esquema reemplaza el modelo transaccional del backend.
    // La version debe subir solo cuando exista una migracion real del cache local y su plan de compatibilidad.
    this.version(1).stores({
      customers: 'id, assignedCollectorId, updatedAt',
      loans: 'id, customerId, collectorId, status, updatedAt',
      installments: 'id, loanId, installmentNumber, status, dueDate, updatedAt',
      payments: 'id, loanId, customerId, collectorId, paidAt, deviceLocalId, syncedAt',
      collectionActions: 'id, collectorId, customerId, loanId, outcome, createdAt, updatedAt',
      syncQueue: '++id, status, entityName, entityId, createdAt',
      settings: 'key',
      profiles: 'id, role',
    })

    // Version 2 formaliza la cola offline de pagos.
    // Se agregan campos de reintento, error y confirmacion remota para no perder trazabilidad al reabrir la app.
    this.version(2)
      .stores({
        customers: 'id, assignedCollectorId, updatedAt',
        loans: 'id, customerId, collectorId, status, updatedAt',
        installments: 'id, loanId, installmentNumber, status, dueDate, updatedAt',
        payments:
          'id, loanId, customerId, collectorId, paidAt, deviceLocalId, syncStatus, syncedAt, updatedAt',
        collectionActions: 'id, collectorId, customerId, loanId, outcome, createdAt, updatedAt',
        syncQueue:
          '++id, &clientEventId, status, entityName, entityId, [status+createdAt], createdAt, updatedAt',
        settings: 'key',
        profiles: 'id, role',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('installments')
          .toCollection()
          .modify((installment) => {
            installment.principalAmount ??= '0.00'
            installment.interestAmount ??= '0.00'
            installment.feeAmount ??= '0.00'
            installment.outstandingPrincipalAmount ??= installment.principalAmount
            installment.outstandingInterestAmount ??= installment.interestAmount
            installment.outstandingFeeAmount ??= installment.feeAmount
          })

        await transaction
          .table('payments')
          .toCollection()
          .modify((payment) => {
            payment.paymentMethod ??= 'cash'
            payment.syncStatus ??= payment.syncedAt ? 'synced' : 'pending'
            payment.updatedAt ??= payment.syncedAt ?? payment.paidAt
          })

        await transaction
          .table('syncQueue')
          .toCollection()
          .modify((queueItem) => {
            queueItem.clientEventId ??= `${queueItem.entityName}:${queueItem.entityId}:${queueItem.operation}`
            queueItem.attemptCount ??= 0
            queueItem.updatedAt ??= queueItem.createdAt
          })
      })

    // Version 3 agrega gestion de visita local sin depender aun de un modelo remoto.
    // La informacion es operativa y debe limpiarse junto al cache del cobrador al cerrar sesion.
    this.version(3).stores({
      customers: 'id, assignedCollectorId, updatedAt',
      loans: 'id, customerId, collectorId, status, updatedAt',
      installments: 'id, loanId, installmentNumber, status, dueDate, updatedAt',
      payments:
        'id, loanId, customerId, collectorId, paidAt, deviceLocalId, syncStatus, syncedAt, updatedAt',
      collectionActions:
        'id, collectorId, customerId, loanId, outcome, [loanId+createdAt], createdAt, updatedAt',
      syncQueue:
        '++id, &clientEventId, status, entityName, entityId, [status+createdAt], createdAt, updatedAt',
      settings: 'key',
      profiles: 'id, role',
    })

    // Version 4 convierte gestion de visita en un evento sincronizable:
    // mantiene deviceLocalId, estado de cola y metadata de error para reconciliar
    // el historial remoto sin perder la continuidad offline ya existente.
    this.version(4)
      .stores({
        customers: 'id, assignedCollectorId, updatedAt',
        loans: 'id, customerId, collectorId, status, updatedAt',
        installments: 'id, loanId, installmentNumber, status, dueDate, updatedAt',
        payments:
          'id, loanId, customerId, collectorId, paidAt, deviceLocalId, syncStatus, syncedAt, updatedAt',
        collectionActions:
          'id, deviceLocalId, collectorId, customerId, loanId, outcome, syncStatus, [loanId+createdAt], createdAt, updatedAt',
        syncQueue:
          '++id, &clientEventId, status, entityName, entityId, [status+createdAt], createdAt, updatedAt',
        settings: 'key',
        profiles: 'id, role',
      })
      .upgrade(async (transaction) => {
        const syncQueueTable = transaction.table('syncQueue')
        const collectionActions = await transaction.table('collectionActions').toArray()

        for (const collectionAction of collectionActions) {
          const deviceLocalId = collectionAction.deviceLocalId ?? collectionAction.id
          const clientEventId = `collection_action:${deviceLocalId}:insert`
          const updatedCollectionAction = {
            ...collectionAction,
            deviceLocalId,
            syncStatus: collectionAction.syncStatus ?? 'pending',
            updatedAt: collectionAction.updatedAt ?? collectionAction.createdAt,
          }

          await transaction.table('collectionActions').put(updatedCollectionAction)

          const existingQueueItem = await syncQueueTable.where('clientEventId').equals(clientEventId).first()

          if (existingQueueItem) {
            continue
          }

          await syncQueueTable.add({
            attemptCount: 0,
            clientEventId,
            createdAt: updatedCollectionAction.createdAt,
            entityId: updatedCollectionAction.id,
            entityName: 'collection_action',
            operation: 'insert',
            payload: {
              collectorId: updatedCollectionAction.collectorId,
              customerId: updatedCollectionAction.customerId,
              deviceLocalId,
              followUpAt: updatedCollectionAction.followUpAt,
              latitude: updatedCollectionAction.latitude,
              loanId: updatedCollectionAction.loanId,
              longitude: updatedCollectionAction.longitude,
              notes: updatedCollectionAction.notes,
              outcome: updatedCollectionAction.outcome,
              recordedAt: updatedCollectionAction.createdAt,
            },
            status: 'pending',
            updatedAt: updatedCollectionAction.updatedAt,
          })
        }
      })
  }
}

export function createLocalDb(databaseName?: string) {
  return new CobroDiarioDb(databaseName)
}

export const localDb = createLocalDb()
