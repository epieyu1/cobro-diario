// Estos tipos son contratos compartidos entre UI, cache local y futuras capas de sync.
// Si un asistente cambia un literal, debe revisar IndexedDB, SQL y documentacion.
export type CollectorRole = 'admin' | 'collector'
export type OriginationPaymentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly'
export type LoanInterestMode = 'simple_precomputed' | 'compound_fixed_installment'
export type LoanPaymentApplicationMode = 'oldest_first' | 'principal_only' | 'interest_only'

// Estos estados describen gestion de campo operativa.
// No cambian por si solos el saldo ni el estado financiero del prestamo.
export type CollectionActionOutcome =
  | 'promise_to_pay'
  | 'not_found'
  | 'return_visit'
  | 'visited_no_payment'

export type LoanStatus =
  | 'draft'
  | 'active'
  | 'delinquent'
  | 'settled'
  | 'written_off'
  | 'canceled'

export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'canceled'

export type PaymentStatus = 'posted' | 'reversed'

export type SyncQueueStatus = 'pending' | 'processing' | 'failed' | 'synced'

export type SyncQueueOperation = 'insert' | 'update' | 'delete'

export type SyncQueueEntityName = 'payment' | 'collection_action'

// Esta clasificacion no cambia el estado final de la cola por si sola.
// Sirve para separar errores recuperables de conflictos de negocio sin ocultar divergencias.
export type SyncFailureKind = 'retryable' | 'conflict'

// Cada aplicacion ya debe llegar materializada por cuota desde la capa de negocio.
// El backend no inventa esta distribucion: solo valida que sea coherente e idempotente.
export type PaymentApplicationDraft = {
  installmentId: string
  appliedAmount: string
  principalComponent?: string
  interestComponent?: string
  // Mientras no exista un modelo explicito de mora, este bucket agrupa mora y otros cargos.
  feeComponent?: string
}

// Este es el contrato que futuras capas de formulario, sync y RPC deben compartir.
// Si se cambia un campo aqui, debe revisarse record_payment, la cola offline y los comentarios SQL.
export type PaymentDraft = {
  deviceLocalId: string
  collectorId: string
  customerId: string
  loanId: string
  // Este modo debe viajar explicito para que cola local, UI y RPC confirmen
  // la misma semantica del abono sin inferirla desde la vista actual.
  paymentApplicationMode?: LoanPaymentApplicationMode
  // V1 lo trata como recomendado: ayuda a trazabilidad por equipo, pero no bloquea el cobro.
  deviceId?: string
  // Referencia operativa opcional para recibos, correlacion manual o auditoria externa.
  paymentReference?: string
  paymentMethod?: string
  paidAt: string
  // GPS se conserva si existe. Su ausencia no debe romper atomicidad ni sync.
  latitude?: number
  longitude?: number
  notes?: string
  applications: PaymentApplicationDraft[]
}

// Este contrato comparte el evento de visita entre UI, cache local, cola offline y RPC.
// Si cambia, hay que revisar la validacion local, el write path remoto y la compuerta SQL.
export type CollectionActionDraft = {
  deviceLocalId: string
  collectorId: string
  customerId: string
  loanId: string
  outcome: CollectionActionOutcome
  recordedAt: string
  followUpAt?: string
  latitude?: number
  longitude?: number
  notes?: string
}
