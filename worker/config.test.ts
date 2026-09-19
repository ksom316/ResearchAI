import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

const base = {
  SUPABASE_URL: 'https://abc.supabase.co/',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-value',
}

describe('loadConfig', () => {
  it('applies documented defaults and trims the URL', () => {
    const c = loadConfig(base)
    expect(c).toMatchObject({
      supabaseUrl: 'https://abc.supabase.co',
      bucket: 'papers',
      pollIntervalMs: 10_000,
      maxAttempts: 3,
      staleAfterMinutes: 15,
      jobTimeoutMs: 120_000,
    })
  })

  it('fails fast and names the missing variables without printing values', () => {
    expect(() => loadConfig({})).toThrowError(ConfigError)
    expect(() => loadConfig({ SUPABASE_URL: 'https://x.co' })).toThrowError(
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
    try {
      loadConfig({ SUPABASE_SERVICE_ROLE_KEY: 'super-secret' })
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret')
    }
  })

  it('does not accept VITE_-prefixed variables as a fallback', () => {
    expect(() =>
      loadConfig({
        VITE_SUPABASE_URL: 'https://x.co',
        VITE_SUPABASE_ANON_KEY: 'k',
      }),
    ).toThrowError(ConfigError)
  })

  it('rejects the placeholder values copied from .env.worker.example', () => {
    expect(() =>
      loadConfig({
        SUPABASE_URL: 'https://your-project-ref.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'real-looking-key-value',
      }),
    ).toThrowError(/placeholder/)
    expect(() =>
      loadConfig({
        ...base,
        SUPABASE_SERVICE_ROLE_KEY: 'your-service-role-key',
      }),
    ).toThrowError(/placeholder/)
  })

  it('rejects values that are not full URLs', () => {
    expect(() =>
      loadConfig({ ...base, SUPABASE_URL: 'abc.supabase.co' }),
    ).toThrowError(/full URL/)
    expect(() =>
      loadConfig({ ...base, SUPABASE_URL: 'ftp://abc.supabase.co' }),
    ).toThrowError(/full URL/)
  })

  it('tolerates whitespace and Windows line endings around values', () => {
    const crlf = String.fromCharCode(13, 10)
    const c = loadConfig({
      SUPABASE_URL: `  https://abc.supabase.co${crlf}`,
      SUPABASE_SERVICE_ROLE_KEY: `key-value-1234${crlf}`,
    })
    expect(c.supabaseUrl).toBe('https://abc.supabase.co')
    expect(c.serviceRoleKey).toBe('key-value-1234')
  })

  it('validates numeric bounds', () => {
    expect(() =>
      loadConfig({ ...base, WORKER_MAX_ATTEMPTS: '0' }),
    ).toThrowError(ConfigError)
    expect(() =>
      loadConfig({ ...base, WORKER_MAX_ATTEMPTS: '99' }),
    ).toThrowError(ConfigError)
    expect(() =>
      loadConfig({ ...base, WORKER_POLL_INTERVAL_MS: '5' }),
    ).toThrowError(ConfigError)
    expect(() =>
      loadConfig({ ...base, WORKER_MAX_ATTEMPTS: 'abc' }),
    ).toThrowError(ConfigError)
    expect(loadConfig({ ...base, WORKER_MAX_ATTEMPTS: '5' }).maxAttempts).toBe(
      5,
    )
  })

  it('requires the stale timeout to comfortably exceed the job timeout', () => {
    expect(() =>
      loadConfig({
        ...base,
        WORKER_STALE_AFTER_MINUTES: '2',
        WORKER_JOB_TIMEOUT_MS: '100000',
      }),
    ).toThrowError(/at least twice/)
  })
})
