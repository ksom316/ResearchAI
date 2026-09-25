import { describe, expect, it } from 'vitest'
import { createSupabaseServiceRoleClient } from './supabase.server'
import {
  getTrustedSupabaseConfiguration,
  TrustedSupabaseConfigurationError,
} from './trusted-config.server'

const URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = 'local-test-service-role-key'

describe('trusted Supabase server configuration', () => {
  it('reports only missing variable names', () => {
    try {
      getTrustedSupabaseConfiguration({})
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(TrustedSupabaseConfigurationError)
      expect(
        (error as TrustedSupabaseConfigurationError).missingVariables,
      ).toEqual([
        'SUPABASE_URL or VITE_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ])
      expect(JSON.stringify(error)).not.toContain(SERVICE_ROLE_KEY)
    }
  })

  it('accepts the server URL variable and constructs a service-role client', () => {
    const env = {
      SUPABASE_URL: URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    }
    expect(getTrustedSupabaseConfiguration(env)).toEqual({
      url: URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
    })
    expect(createSupabaseServiceRoleClient(env)).toBeDefined()
  })

  it('uses the existing public URL as a server-side URL fallback', () => {
    expect(
      getTrustedSupabaseConfiguration({
        VITE_SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      }),
    ).toEqual({ url: URL, serviceRoleKey: SERVICE_ROLE_KEY })
  })
})
