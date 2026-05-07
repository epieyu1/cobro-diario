export type ConfirmedPaymentReceiptApplication = {
  appliedAmount: string
  dueDate: string
  feeComponent: string
  installmentId: string
  installmentNumber: number
  interestComponent: string
  principalComponent: string
}

export type ConfirmedPaymentReceipt = {
  applications: ConfirmedPaymentReceiptApplication[]
  collector: {
    fullName?: string
    id: string
  }
  collectorId: string
  createdAt: string
  customer: {
    fullName: string
    governmentId?: string
    id: string
    phone?: string
  }
  deviceLocalId: string
  loan: {
    currencyCode: string
    externalLoanNumber?: string
    id: string
  }
  paidAt: string
  paymentId: string
  paymentMethod: string
  paymentReference?: string
  reversal?: {
    reason: string
    reversedAt: string
    reversedBy: {
      fullName?: string
      id: string
    }
  }
  status: 'posted' | 'reversed'
  totalAmount: string
}

export type ConfirmedReceiptLookupState = {
  error?: string
  paymentId: string | null
  status: 'error' | 'idle' | 'loading'
}

export type PaymentReceiptAvailability = {
  canRequestConfirmedReceipt: boolean
  key:
    | 'confirmed'
    | 'local_failed'
    | 'local_pending'
    | 'local_processing'
    | 'reversed'
    | 'sync_incomplete'
  label: string
  summary: string
  tone: 'danger' | 'pending' | 'success' | 'warning'
}

export type BluetoothReceiptStrategy = {
  deliveryTarget: 'web_bluetooth'
  key: 'deferred_web_bluetooth'
  nextGate: 'manual_smoke_with_supported_printer'
  status: 'deferred'
  summary: string
}
