import Dexie, { type Table } from 'dexie'
import type {
  CollectorRole,
  InstallmentStatus,
  LoanStatus,
  SyncQueueOperation,
  SyncQueueStatus,
} from '@/types/domain.ts'

export type LocalCustomer = {
  id: string
  assignedCollectorId: string
  fullName: string
  governmentId?: string
  phone?: string
  address?: string
  latitude?: number
  longitude?: number
  updatedAt: string
}

export type LocalLoan = {
  id: string
  customerId: string
  collectorId: string
  status: LoanStatus
  principalAmount: string
  installmentAmount: string
  interestRateDaily: string
  currencyCode: string
  updatedAt: string
}

export type LocalInstallment = {
  id: string
  loanId: string
  installmentNumber: number
  dueDate: string
  scheduledAmount: string
  outstandingAmount: string
  status: InstallmentStatus
  updatedAt: string
}

export type LocalPayment = {
  id: string
  loanId: string
  customerId: string
  collectorId: string
  totalAmount: string
  paidAt: string
  deviceLocalId: string
  latitude?: number
  longitude?: number
  syncedAt?: string
}

export type SyncQueueItem = {
  id?: number
  entityName: string
  entityId: string
  operation: SyncQueueOperation
  payload: Record<string, unknown>
  status: SyncQueueStatus
  createdAt: string
}

export type LocalSetting = {
  key: string
  value: string
}

export type SessionProfile = {
  id: string
  role: CollectorRole
  fullName: string
}

class CobroDiarioDb extends Dexie {
  customers!: Table<LocalCustomer, string>
  loans!: Table<LocalLoan, string>
  installments!: Table<LocalInstallment, string>
  payments!: Table<LocalPayment, string>
  syncQueue!: Table<SyncQueueItem, number>
  settings!: Table<LocalSetting, string>
  profiles!: Table<SessionProfile, string>

  constructor() {
    super('cobro-diario')

    // Esta base local es soporte offline.
    // Ningun asistente debe asumir que este esquema reemplaza el modelo transaccional del backend.
    this.version(1).stores({
      customers: 'id, assignedCollectorId, updatedAt',
      loans: 'id, customerId, collectorId, status, updatedAt',
      installments: 'id, loanId, installmentNumber, status, dueDate, updatedAt',
      payments: 'id, loanId, customerId, collectorId, paidAt, deviceLocalId, syncedAt',
      syncQueue: '++id, status, entityName, entityId, createdAt',
      settings: 'key',
      profiles: 'id, role',
    })
  }
}

export const localDb = new CobroDiarioDb()
