import { describe, expect, it } from 'vitest'
import {
  RateLimiter,
  TOKEN_HEADROOM,
  WINDOW_MARGIN_MS,
  paceLimits,
  simulatePacing,
} from './rate-limiter'
import { TokenEstimator } from './token-estimator'
import { maxInWindow } from './test-support'

const setup = (limits = { requestsPerMinute: 3, tokensPerMinute: 10_000 }) => {
  let t = 0
  const limiter = new RateLimiter({ ...paceLimits(limits), now: () => t })
  return { limiter, advance: (ms: number) => (t += ms), now: () => t }
}

describe('paceLimits (account limits: 3 RPM / 10,000 TPM)', () => {
  it('keeps requests exact and tokens conservatively below the limit', () => {
    const limits = paceLimits({ requestsPerMinute: 3, tokensPerMinute: 10_000 })
    expect(limits.maxRequests).toBe(3)
    expect(limits.maxTokens).toBe(8_500)
    expect(limits.maxTokens).toBeLessThan(10_000)
    expect(limits.windowMs).toBe(60_000 + WINDOW_MARGIN_MS)
    expect(TOKEN_HEADROOM).toBe(0.85)
  })
})

describe('RateLimiter: 3 requests per minute', () => {
  it('allows three requests immediately and makes the fourth wait for the window', () => {
    const { limiter, advance } = setup()
    for (let i = 0; i < 3; i++) {
      expect(limiter.waitMs(100)).toBe(0)
      limiter.reserve(100)
      advance(500)
    }
    // 1.5s in; the first request was at t=0, so the 4th may start at 61s.
    expect(limiter.waitMs(100)).toBe(61_000 - 1_500)
  })

  it('never lets any 60s window contain more than 3 requests', () => {
    const { limiter, advance, now } = setup()
    const starts: { at: number; weight: number }[] = []
    for (let i = 0; i < 20; i++) {
      advance(limiter.waitMs(10))
      limiter.reserve(10)
      starts.push({ at: now(), weight: 1 })
      advance(1_000)
    }
    expect(maxInWindow(starts, 60_000)).toBeLessThanOrEqual(3)
  })

  it('does not busy-wait: it reports how long to wait rather than sleeping', () => {
    const { limiter } = setup()
    limiter.reserve(10)
    limiter.reserve(10)
    limiter.reserve(10)
    expect(limiter.waitMs(10)).toBeGreaterThan(0) // returns immediately
  })
})

describe('RateLimiter: 10,000 tokens per minute', () => {
  it('waits when the next request would exceed the paced token budget', () => {
    const { limiter, advance } = setup()
    limiter.reserve(4_000)
    advance(1_000)
    limiter.reserve(4_000) // 8,000 of 8,500 used
    advance(1_000)
    expect(limiter.waitMs(1_000)).toBe(61_000 - 2_000) // must wait for the first to expire
    expect(limiter.waitMs(500)).toBe(0) // 8,500 exactly still fits
  })

  it('never lets any 60s window exceed 10,000 tokens', () => {
    const { limiter, advance, now } = setup()
    const events: { at: number; weight: number }[] = []
    for (let i = 0; i < 25; i++) {
      advance(limiter.waitMs(3_000))
      limiter.reserve(3_000)
      events.push({ at: now(), weight: 3_000 })
      advance(1_000)
    }
    expect(maxInWindow(events, 60_000)).toBeLessThanOrEqual(10_000)
    expect(maxInWindow(events, 60_000)).toBeLessThanOrEqual(8_500)
  })

  it('counts provider-reported tokens instead of the estimate once known', () => {
    const { limiter, advance } = setup()
    const ticket = limiter.reserve(4_000)
    ticket.settle(1_000) // the estimate was pessimistic
    advance(100)
    limiter.reserve(4_000)
    advance(100)
    expect(limiter.waitMs(3_000)).toBe(0) // 1,000 + 4,000 + 3,000 fits
  })

  it('keeps the estimate when the provider reports nothing', () => {
    const { limiter } = setup()
    limiter.reserve(8_000).settle(null)
    expect(limiter.waitMs(1_000)).toBeGreaterThan(0)
  })

  it('rejects a single request that could never fit, instead of waiting forever', () => {
    const { limiter } = setup()
    expect(() => limiter.waitMs(8_501)).toThrow(RangeError)
  })

  it('combines both limits (whichever binds later)', () => {
    const { limiter, advance } = setup()
    limiter.reserve(8_000)
    advance(10_000)
    limiter.reserve(400)
    advance(10_000)
    limiter.reserve(50)
    advance(1_000)
    // 3 requests used AND tokens: the request limit binds first (until the oldest expires).
    expect(limiter.waitMs(10)).toBe(61_000 - 21_000)
  })
})

describe('RateLimiter: Retry-After', () => {
  it('will not start a request before the provider-requested time', () => {
    const { limiter, now } = setup()
    limiter.blockUntil(now() + 45_000)
    expect(limiter.waitMs(10)).toBe(45_000)
  })

  it('keeps the latest of several blocks', () => {
    const { limiter, now } = setup()
    limiter.blockUntil(now() + 10_000)
    limiter.blockUntil(now() + 5_000)
    expect(limiter.waitMs(10)).toBe(10_000)
  })

  it('reserve() refuses to run early', () => {
    const { limiter, now } = setup()
    limiter.blockUntil(now() + 1_000)
    expect(() => limiter.reserve(10)).toThrow(/before the request was allowed/)
  })
})

describe('simulatePacing (dry-run runtime estimate)', () => {
  it('estimates runtime deterministically without sleeping', () => {
    const limits = paceLimits({ requestsPerMinute: 3, tokensPerMinute: 10_000 })
    const sim = simulatePacing(
      [3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600],
      limits,
    )
    expect(sim.requests).toBe(9)
    // Token-bound: two 3,600-token requests per ~61s window.
    expect(sim.totalMs).toBeGreaterThan(4 * 61_000)
    expect(
      simulatePacing(
        [3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600],
        limits,
      ).totalMs,
    ).toBe(sim.totalMs)
  })

  it('is near-instant when there is a single small request', () => {
    const limits = paceLimits({ requestsPerMinute: 3, tokensPerMinute: 10_000 })
    expect(simulatePacing([500], limits).totalMs).toBeLessThan(5_000)
  })
})

describe('TokenEstimator', () => {
  it('starts pessimistic: 3 characters per token', () => {
    const e = new TokenEstimator()
    expect(e.charsPerToken).toBe(3)
    expect(e.estimate(3_600)).toBe(1_200)
    expect(e.estimate(1)).toBe(1)
  })

  it('learns from billed tokens but stays conservative (10% margin, capped at 4)', () => {
    const e = new TokenEstimator()
    for (let i = 0; i < 20; i++) e.observe(3_700, 900) // ~4.1 chars/token observed
    expect(e.charsPerToken).toBeGreaterThan(3)
    expect(e.charsPerToken).toBeLessThanOrEqual(4)
    expect(e.charsPerToken).toBeLessThan(4.1) // never trusts the observation fully
  })

  it('never goes below 2.5 chars/token, however dense the text', () => {
    const e = new TokenEstimator()
    for (let i = 0; i < 20; i++) e.observe(1_000, 2_000)
    expect(e.charsPerToken).toBe(2.5)
  })

  it('ignores missing or nonsensical feedback', () => {
    const e = new TokenEstimator()
    e.observe(1_000, null)
    e.observe(1_000, 0)
    e.observe(0, 100)
    expect(e.charsPerToken).toBe(3)
  })
})
