import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import { getSupabaseEnv } from './env'
import { getTrustedSupabaseConfiguration } from './trusted-config.server'

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
export function createSupabaseServiceRoleClient(
  env: Record<string, string | undefined> = process.env,
) {
  const { url, serviceRoleKey } = getTrustedSupabaseConfiguration(env)
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
