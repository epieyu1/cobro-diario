import type { Session, SupabaseClient } from '@supabase/supabase-js'

export async function readPersistedBrowserSession(supabaseClient: SupabaseClient) {
  // En la PWA necesitamos poder reingresar offline con la sesion persistida del navegador.
  // getSession() lee el almacenamiento local; no exigir getUser() aqui evita depender de red
  // solo para reconstruir el estado inicial de la shell operativa.
  const { data, error } = await supabaseClient.auth.getSession()

  if (error) {
    throw error
  }

  return data.session
}

export function subscribeToBrowserAuthSession(
  supabaseClient: SupabaseClient,
  onSessionChange: (session: Session | null) => void,
) {
  const {
    data: { subscription },
  } = supabaseClient.auth.onAuthStateChange((_event, session) => {
    onSessionChange(session)
  })

  return () => {
    subscription.unsubscribe()
  }
}

export async function signInWithPassword(
  supabaseClient: SupabaseClient,
  credentials: {
    email: string
    password: string
  },
) {
  const normalizedEmail = credentials.email.trim()

  if (!normalizedEmail || !credentials.password) {
    throw new Error('sign_in_credentials_required')
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: normalizedEmail,
    password: credentials.password,
  })

  if (error) {
    throw error
  }

  return data.session
}

export async function signOutBrowserSession(supabaseClient: SupabaseClient) {
  const { error } = await supabaseClient.auth.signOut()

  if (error) {
    throw error
  }
}
