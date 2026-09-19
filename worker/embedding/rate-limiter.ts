/**
 * Proactive request/token pacing for the embedding provider.
 *
 * Voyage voyage-4 on our account allows 3 requests per minute and 10,000 tokens
 * per minute. Reacting to 429s is not enough, so every request first asks this
 * limiter when it may start. It keeps a rolling window of (time, tokens)
 * reservations:
 *
 *  - at most `maxRequests` requests in any `windowMs`;
 *  - at most `maxTokens` tokens in any `windowMs`.
 *
 * Because the window is rolling, no calendar minute can ever contain more than the
 * limit. It is a pure object with an injected clock and does NOT sleep: callers
 * ask `waitMs()` and decide how to wait (so shutdown stays possible and tests
 * never really sleep). A provider `Retry-After` is honored through `blockUntil()`.
 */

export type RateLimiterOptions = {
  maxRequests: number
  maxTokens: number
  windowMs: number
  now: () => number
}

/** Real limits with headroom: requests exact, tokens at 85%, window plus 1s. */
export function paceLimits(limits: {
  requestsPerMinute: number
  tokensPerMinute: number
}): Pick<RateLimiterOptions, 'maxRequests' | 'maxTokens' | 'windowMs'> {
  return {
    maxRequests: limits.requestsPerMinute,
    maxTokens: Math.floor(limits.tokensPerMinute * TOKEN_HEADROOM),
    windowMs: 60_000 + WINDOW_MARGIN_MS,
  }
}

/** Share of the provider's token limit we allow ourselves to use. */
export const TOKEN_HEADROOM = 0.85
/** Extra time on the 60s window, in case the provider's minute boundary drifts. */
export const WINDOW_MARGIN_MS = 1_000

type Reservation = { at: number; tokens: number }

export type Ticket = {
  /** Replace the estimate with the provider-reported token count (or keep it if null). */
  settle: (actualTokens: number | null) => void
}

export class RateLimiter {
  private readonly events: Reservation[] = []
  private blockedUntil = 0

  constructor(private readonly options: RateLimiterOptions) {
    if (
      options.maxRequests < 1 ||
      options.maxTokens < 1 ||
      options.windowMs < 1
    ) {
      throw new RangeError('Rate limiter limits must be positive')
    }
  }

  /** The largest single request this limiter can ever admit. */
  get maxTokensPerRequest(): number {
    return this.options.maxTokens
  }

  /**
   * Milliseconds until a request of `estimatedTokens` may start (0 = now).
   * Throws if the request alone exceeds the token budget: it could never be sent.
   */
  waitMs(estimatedTokens: number): number {
    const { maxRequests, maxTokens, windowMs } = this.options
    if (estimatedTokens > maxTokens) {
      throw new RangeError(
        `A single request of ~${estimatedTokens} tokens exceeds the ${maxTokens}-token budget`,
      )
    }
    const now = this.options.now()
    this.prune(now)

    let wait = Math.max(0, this.blockedUntil - now)

    if (this.events.length >= maxRequests) {
      const oldestBlocking = this.events[this.events.length - maxRequests]
      wait = Math.max(wait, oldestBlocking.at + windowMs - now)
    }

    let used = this.events.reduce((sum, e) => sum + e.tokens, 0)
    if (used + estimatedTokens > maxTokens) {
      for (const event of this.events) {
        used -= event.tokens
        if (used + estimatedTokens <= maxTokens) {
          wait = Math.max(wait, event.at + windowMs - now)
          break
        }
      }
    }
    return Math.max(0, Math.ceil(wait))
  }

  /** Reserve capacity now. Throws if the request would have to wait. */
  reserve(estimatedTokens: number): Ticket {
    if (this.waitMs(estimatedTokens) > 0) {
      throw new Error(
        'Rate limiter: reserve() called before the request was allowed',
      )
    }
    const reservation: Reservation = {
      at: this.options.now(),
      tokens: estimatedTokens,
    }
    this.events.push(reservation)
    return {
      settle: (actual) => {
        if (actual !== null && actual >= 0) reservation.tokens = actual
      },
    }
  }

  /** Do not start any request before `timestamp` (e.g. from Retry-After). */
  blockUntil(timestamp: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, timestamp)
  }

  private prune(now: number): void {
    const cutoff = now - this.options.windowMs
    while (this.events.length > 0 && this.events[0].at <= cutoff) {
      this.events.shift()
    }
  }
}

/**
 * Deterministic estimate of how long a series of requests will take under the
 * limits, using a virtual clock (nothing sleeps). Used for the dry-run preview.
 */
export function simulatePacing(
  requestTokenEstimates: readonly number[],
  limits: Pick<RateLimiterOptions, 'maxRequests' | 'maxTokens' | 'windowMs'>,
  requestDurationMs = 1_000,
): { totalMs: number; requests: number } {
  let clock = 0
  const limiter = new RateLimiter({ ...limits, now: () => clock })
  for (const tokens of requestTokenEstimates) {
    clock += limiter.waitMs(tokens)
    limiter.reserve(tokens)
    clock += requestDurationMs
  }
  return { totalMs: clock, requests: requestTokenEstimates.length }
}
