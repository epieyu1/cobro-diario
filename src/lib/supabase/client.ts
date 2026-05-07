import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, hasSupabaseEnv } from '@/lib/env.ts'

let browserClient: SupabaseClient | null = null

export function getSupabaseBrowserClient() {
  // Este singleton evita recrear clientes y listeners de auth en cada render del arbol React.
  // Si cambia la configuracion publica, se debe reiniciar la app o invalidar explicitamente este cache.
  // Si falta configuracion publica, devolvemos null para evitar clientes mal construidos
  // y para hacer visible que la app aun no esta vinculada al proyecto remoto.
  if (!hasSupabaseEnv) {
    return null
  }

  if (!browserClient) {
    // En cliente solo se debe usar la publishable key.
    // Nunca reemplazar esto por service_role ni secretos equivalentes.
    browserClient = createClient(env.supabaseUrl!, env.supabasePublishableKey!, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  }

  return browserClient
}
