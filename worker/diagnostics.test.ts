import { describe, expect, it } from 'vitest'
import { describeError, redact } from './diagnostics'

const KEY = 'sb_secret_abcdefghijklmnop1234'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl'

describe('describeError', () => {
  it('walks the cause chain so "fetch failed" shows its real reason', () => {
    const cause = Object.assign(
      new Error('getaddrinfo ENOTFOUND x.supabase.co'),
      {
        code: 'ENOTFOUND',
      },
    )
    const error = new TypeError('fetch failed', { cause })
    expect(describeError(error)).toBe(
      'fetch failed <- caused by: getaddrinfo ENOTFOUND x.supabase.co [ENOTFOUND]',
    )
  })

  it('reads the cause from supabase-js error details and drops stack frames', () => {
    const postgrestError = {
      message: 'TypeError: fetch failed',
      details:
        'TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND x.supabase.co (ENOTFOUND)\nError: getaddrinfo ENOTFOUND x.supabase.co\n    at GetAddrInfoReqWrap.onlookupall (node:dns:120:26)',
      hint: '',
      code: '',
    }
    const text = describeError(postgrestError)
    expect(text).toContain('fetch failed')
    expect(text).toContain('ENOTFOUND')
    expect(text).not.toContain('node:dns')
    expect(text).not.toContain('\n')
  })

  it('includes API error codes', () => {
    expect(describeError({ message: 'permission denied', code: '42501' })).toBe(
      'permission denied [42501]',
    )
  })

  it('handles non-error values', () => {
    expect(describeError('plain string')).toBe('plain string')
    expect(describeError(undefined)).toBe('unknown error')
    expect(describeError({})).toBe('unknown error')
  })

  it('never emits configured secrets, bearer tokens, JWTs or API keys', () => {
    const error = new Error(
      `request failed with ${KEY}; Authorization: Bearer ${JWT}; apikey ${JWT}`,
    )
    const text = describeError(error, [KEY])
    expect(text).not.toContain(KEY)
    expect(text).not.toContain(JWT)
    expect(text).not.toMatch(/Bearer\s+\w/)
    expect(text).toContain('[redacted]')
  })

  it('redacts a secret that appears inside a cause', () => {
    const error = new Error('outer', { cause: new Error(`inner ${KEY}`) })
    expect(describeError(error, [KEY])).not.toContain(KEY)
  })

  it('bounds the output length', () => {
    expect(
      describeError(new Error('x'.repeat(5000))).length,
    ).toBeLessThanOrEqual(501)
  })
})

describe('redact', () => {
  it('ignores very short "secrets" so it cannot mangle ordinary text', () => {
    expect(redact('abc abc', ['abc'])).toBe('abc abc')
  })
})
