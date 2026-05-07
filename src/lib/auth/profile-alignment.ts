import type { SessionProfile } from '@/lib/db/local-db.ts'

type WorkspaceProfileState = {
  profile?: SessionProfile
} | null

export type AuthenticatedProfileAlignmentInput = {
  authReady: boolean
  dbReady: boolean
  sessionUserId: string | null
  workspace: WorkspaceProfileState
}

// Fuente de verdad operativa: una sesion Auth no basta para abrir la shell.
// Auth y public.profiles deben converger antes de presentar cartera, cobro o reportes.
// Riesgo: si este guard deja pasar usuarios sin perfil remoto, la UI parece "collector"
// aunque RLS o las pantallas privilegiadas sigan bloqueando por falta de alineacion real.
export function shouldBlockAuthenticatedWorkspaceForProfileAlignment(
  input: AuthenticatedProfileAlignmentInput,
) {
  return Boolean(
    input.authReady
    && input.dbReady
    && input.sessionUserId
    && input.workspace
    && !input.workspace.profile,
  )
}
