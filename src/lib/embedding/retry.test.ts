import { describe, expect, it, vi } from 'vitest'
import { EmbeddingError } from './errors'
import { parseRetryAfter, retryDelayMs, withRetries } from './retry'
import type { RetryOptions } from './retry'

const options = (overrides: Partial<RetryOptions> = {}): RetryOptions => ({
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  maxRetryAfterMs: 5_000,
  sleep: async () => undefined,
  random: () => 1, // top of the jitter range: delay == full step
  ...overrides,
})

describe('retryDelayMs', () => {
  it('backs off exponentially, capped at maxDelayMs', () => {
    const e = new EmbeddingError('server', 'x')
    const o = options()
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs(n, e, o))).toEqual([
      100, 200, 400, 800, 1_000,
    ])
  })

  it('applies jitter between 50% and 100% of the step', () => {
    const e = new EmbeddingError('server', 'x')
    expect(retryDelayMs(1, e, options({ random: () => 0 }))).toBe(50)
    expect(
      retryDelayMs(1, e, options({ random: () => 0.999 })),
    ).toBeGreaterThanOrEqual(99)
  })

  it('honors Retry-After over backoff, but caps it', () => {
    const o = options()
    expect(
      retryDelayMs(
        1,
        new EmbeddingError('rate_limited', 'x', { retryAfterMs: 2_000 }),
        o,
      ),
    ).toBe(2_000)
    expect(
      retryDelayMs(
        1,
        new EmbeddingError('rate_limited', 'x', { retryAfterMs: 999_999 }),
        o,
      ),
    ).toBe(5_000)
  })
})

describe('withRetries', () => {
  it('returns immediately on success without sleeping', async () => {
    const sleep = vi.fn(async () => undefined)
    await expect(
      withRetries(async () => 'ok', options({ sleep })),
    ).resolves.toBe('ok')
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each(['rate_limited', 'server', 'network', 'timeout'] as const)(
    'retries transient %s errors then succeeds',
    async (kind) => {
      let calls = 0
      const sleep = vi.fn(async () => undefined)
      const result = await withRetries(async () => {
        calls++
        if (calls < 3) throw new EmbeddingError(kind, 'transient')
        return 'done'
      }, options({ sleep }))
      expect(result).toBe('done')
      expect(calls).toBe(3)
      expect(sleep).toHaveBeenCalledTimes(2)
    },
  )

  it.each([
    'auth',
    'bad_request',
    'invalid_response',
    'dimension_mismatch',
    'invalid_input',
  ] as const)('never retries %s', async (kind) => {
    let calls = 0
    await expect(
      withRetries(async () => {
        calls++
        throw new EmbeddingError(kind, 'permanent')
      }, options()),
    ).rejects.toMatchObject({ kind })
    expect(calls).toBe(1)
  })

  it('does not retry unexpected non-EmbeddingErrors', async () => {
    let calls = 0
    await expect(
      withRetries(async () => {
        calls++
        throw new Error('boom')
      }, options()),
    ).rejects.toThrow('boom')
    expect(calls).toBe(1)
  })

  it('stops at maxAttempts and reports the attempt count', async () => {
    let calls = 0
    const error = await withRetries(
      async () => {
        calls++
        throw new EmbeddingError('server', 'Voyage server error (HTTP 503)', {
          status: 503,
        })
      },
      options({ maxAttempts: 3 }),
    ).catch((e: unknown) => e as EmbeddingError)
    expect(calls).toBe(3)
    expect(error).toBeInstanceOf(EmbeddingError)
    expect(error.kind).toBe('server')
    expect(error.status).toBe(503)
    expect(error.attempts).toBe(3)
    expect(error.message).toContain('gave up after 3 attempts')
  })

  it('sleeps for the Retry-After the provider asked for', async () => {
    const delays: number[] = []
    let calls = 0
    await withRetries(
      async () => {
        calls++
        if (calls === 1)
          throw new EmbeddingError('rate_limited', 'x', { retryAfterMs: 1_234 })
        return 1
      },
      options({ sleep: async (ms) => void delays.push(ms) }),
    )
    expect(delays).toEqual([1_234])
  })

  it('uses exactly one attempt when maxAttempts is 1', async () => {
    let calls = 0
    await expect(
      withRetries(
        async () => {
          calls++
          throw new EmbeddingError('server', 'x')
        },
        options({ maxAttempts: 1 }),
      ),
    ).rejects.toMatchObject({ kind: 'server' })
    expect(calls).toBe(1)
  })
})

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('3')).toBe(3_000)
    expect(parseRetryAfter('0.5')).toBe(500)
  })

  it('parses an HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', () => now)).toBe(
      10_000,
    )
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', () => now)).toBe(0)
  })

  it('returns undefined for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
  })
})
