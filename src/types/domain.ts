// Estos tipos son contratos compartidos entre UI, cache local y futuras capas de sync.
// Si un asistente cambia un literal, debe revisar IndexedDB, SQL y documentacion.
export type CollectorRole = 'admin' | 'supervisor' | 'collector'

export type LoanStatus =
  | 'draft'
  | 'active'
  | 'delinquent'
  | 'settled'
  | 'written_off'
  | 'canceled'

export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'canceled'

export type SyncQueueStatus = 'pending' | 'processing' | 'failed' | 'synced'

export type SyncQueueOperation = 'insert' | 'update' | 'delete'
