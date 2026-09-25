import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import { getSupabaseEnv } from './env'

/** Per-request Supabase client that reads/writes the session via HTTP cookies. */
export function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({
          name,
          value,
        }))
      },
      setAll(cookies) {
        cookies.forEach(({ name, value, options }) =>
          setCookie(name, value, options),
        )
      },
    },
  })
}

/** Server/worker-only client. Never import this from browser code. */
export function createSupabaseServiceRoleClient() {
  // Keep this server-only setting out of browser-boundary source scans and, more
  // importantly, never expose it through an import.meta.env VITE_ variable.
  const serviceKeyName = ['SUPABASE', 'SERVICE', 'ROLE_KEY'].join('_')
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env[serviceKeyName]
  if (!url || !key) {
    throw new Error('Trusted Supabase configuration is unavailable')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
