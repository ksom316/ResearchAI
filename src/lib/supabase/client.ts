import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

let client: ReturnType<typeof createBrowserClient> | undefined

/** Browser-side Supabase client. Data access is protected by Row Level Security. */
export function getSupabaseBrowserClient() {
  if (!client) {
    const { url, anonKey } = getSupabaseEnv()
    client = createBrowserClient(url, anonKey)
  }
  return client
}
