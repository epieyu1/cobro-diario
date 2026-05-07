// Intencion: agrupar el runtime pesado de operacion en una unica frontera de importacion dinamica.
// Flujo: App.tsx carga primero el shell minimo -> este modulo se resuelve despues del primer render
// y expone IndexedDB, auth browser y flujos operativos completos.
// Riesgo: si se vuelve a importar cualquiera de estas dependencias directo desde App.tsx, el bundle
// inicial vuelve a crecer y BR-1 pierde el beneficio real del corte asincrono.
export {
  describeCollectionActionOutcome,
  describeCollectionActionTone,
  requiresCollectionFollowUp,
} from '@/lib/collector/collection-actions.ts'
export {
  bootstrapCollectorWorkspace,
  clearCollectorOperationalCache,
  createSupabaseCollectorWorkspaceSource,
  loadCollectorWorkspaceSnapshot,
  recordLocalCollectionAction,
} from '@/lib/collector/collector-workspace.ts'
export { buildCollectorRouteBoard } from '@/lib/collector/collector-route-board.ts'
export { localDb } from '@/lib/db/local-db.ts'
export { readBestEffortCoordinates } from '@/lib/device/geolocation.ts'
export { buildOldestFirstPaymentApplications } from '@/lib/finance/payment-planning.ts'
export { buildDirectedPaymentApplications } from '@/lib/finance/payment-planning-v2.ts'
export { evaluateBluetoothReceiptStrategy } from '@/lib/receipts/bluetooth-printer.ts'
export { createSupabaseReceiptTransport } from '@/lib/receipts/receipt-transport.ts'
export { createSupabaseOperationalReportTransport } from '@/lib/reports/report-queries.ts'
export {
  createSupabasePaymentReversalTransport,
  reconcileLocalPaymentReceipt,
} from '@/lib/sync/payment-reversal-sync.ts'
export {
  createSupabaseCollectionActionSyncTransport,
  enqueueOfflineCollectionAction,
  flushCollectionActionSyncQueue,
  retryFailedCollectionActionSyncQueueItem,
} from '@/lib/sync/collection-action-sync.ts'
export {
  createSupabasePaymentSyncTransport,
  enqueueOfflinePayment,
  flushPaymentSyncQueue,
  getSyncQueueSnapshot,
  retryFailedSyncQueueItem,
} from '@/lib/sync/payment-sync.ts'
export {
  readPersistedBrowserSession,
  signInWithPassword,
  signOutBrowserSession,
  subscribeToBrowserAuthSession,
} from '@/lib/supabase/auth-session.ts'
export { getSupabaseBrowserClient } from '@/lib/supabase/client.ts'
