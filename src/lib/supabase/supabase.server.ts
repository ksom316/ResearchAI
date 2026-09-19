import { createServerClient } from '@supabase/ssr'
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
