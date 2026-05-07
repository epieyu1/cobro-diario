import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const PROJECT_ROOT = process.cwd()
const DEFAULT_ENV_PATH = resolve(PROJECT_ROOT, '.env.local')

export function createPublicSupabaseClient(envPath = DEFAULT_ENV_PATH) {
  // Esta utilidad solo usa el contexto autenticado ya versionado en el repo.
  // No debe ampliarse para buscar secretos fuera de `.env.local` o del proyecto actual.
  const env = readSimpleEnvFile(envPath)
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim()
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('missing_public_supabase_env')
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export function readSimpleEnvFile(filePath = DEFAULT_ENV_PATH) {
  const envFileContent = readFileSync(filePath, 'utf8')
  const envEntries = {}

  for (const rawLine of envFileContent.split('\n')) {
    const trimmedLine = rawLine.trim()

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmedLine.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = trimmedLine.slice(0, separatorIndex).trim()
    const value = trimmedLine.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')

    envEntries[key] = value
  }

  return envEntries
}

export function assertNoSupabaseError(scope, error) {
  if (error) {
    throw new Error(
      JSON.stringify(
        {
          code: error.code ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
          message: error.message,
          scope,
        },
        null,
        2,
      ),
    )
  }
}
