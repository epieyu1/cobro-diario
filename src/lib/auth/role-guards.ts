import type { SessionProfile } from '@/lib/db/local-db.ts'

type OperationalProfile = Pick<SessionProfile, 'role'> | null | undefined

export type OperationalRoleCapabilities = {
  canAccessCollectorManagement: boolean
  canAccessOperationalReports: boolean
  canAccessOrigination: boolean
  canReversePayments: boolean
  canReadAggregateWorkspace: boolean
  isAdmin: boolean
}

// Intencion: concentrar en una sola capa las capacidades visibles por rol.
// Flujo: App/paneles UI reciben SessionProfile -> resuelven capacidades -> solo renderizan
// lo que el backend ya autoriza bajo RLS.
// Riesgo: si cada pantalla vuelve a comparar `profile.role` por su cuenta, admin/collector
// terminan divergiendo en frontend aunque PostgreSQL siga siendo la fuente de verdad.
export function resolveOperationalRoleCapabilities(
  profile?: OperationalProfile,
): OperationalRoleCapabilities {
  const isAdmin = profile?.role === 'admin'

  return {
    canAccessCollectorManagement: isAdmin,
    canAccessOperationalReports: isAdmin,
    canAccessOrigination: isAdmin,
    canReversePayments: isAdmin,
    canReadAggregateWorkspace: isAdmin,
    isAdmin,
  }
}

export function canAccessOrigination(profile?: OperationalProfile) {
  return resolveOperationalRoleCapabilities(profile).canAccessOrigination
}

export function canAccessCollectorManagement(profile?: OperationalProfile) {
  return resolveOperationalRoleCapabilities(profile).canAccessCollectorManagement
}

export function canAccessOperationalReports(profile?: OperationalProfile) {
  return resolveOperationalRoleCapabilities(profile).canAccessOperationalReports
}

export function canReversePayments(profile?: OperationalProfile) {
  return resolveOperationalRoleCapabilities(profile).canReversePayments
}

export function canReadAggregateWorkspace(profile?: OperationalProfile) {
  return resolveOperationalRoleCapabilities(profile).canReadAggregateWorkspace
}
