// Solo se leen variables publicables de frontend.
// Ningun secreto operativo debe exponerse por Vite en esta capa.
// Estas variables afectan UX y conectividad del navegador; no reescriben por si solas
// el contrato financiero o el esquema remoto de Supabase.
const appName = import.meta.env.VITE_APP_NAME?.trim() || 'Cobro Diario'
const defaultLocale = import.meta.env.VITE_DEFAULT_LOCALE?.trim() || 'es-CO'
const defaultCurrency = import.meta.env.VITE_DEFAULT_CURRENCY?.trim() || 'COP'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || null
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || null

export const env = {
  appName,
  defaultLocale,
  defaultCurrency,
  supabaseUrl,
  supabasePublishableKey,
} as const

export const hasSupabaseEnv = Boolean(supabaseUrl && supabasePublishableKey)
