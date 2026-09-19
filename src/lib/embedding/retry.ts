import { EmbeddingError } from './errors'

export type RetryOptions = {
  /** Total tries, first attempt included. */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  /** Upper bound for honoring a provider's Retry-After. */
  maxRetryAfterMs: number
  sleep: (ms: number) => Promise<void>
  /** Returns a number in [0, 1); injectable for deterministic tests. */
  random: () => number
}

export const DEFAULT_RETRY: Omit<RetryOptions, 'maxAttempts'> = {
  baseDelayMs: 500,
  maxDelayMs: 20_000,
  maxRetryAfterMs: 60_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
}

/**
 * Delay before retry number `attempt` (1 = after the first failure): the
 * provider's Retry-After when given (capped), otherwise exponential backoff with
 * jitter between 50% and 100% of the step.
 */
export function retryDelayMs(
  attempt: number,
  error: EmbeddingError,
  options: Pick<
    RetryOptions,
    'baseDelayMs' | 'maxDelayMs' | 'maxRetryAfterMs' | 'random'
  >,
): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(Math.max(0, error.retryAfterMs), options.maxRetryAfterMs)
  }
  const step = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** (attempt - 1),
  )
  return Math.round(step * (0.5 + options.random() * 0.5))
}

/**
 * Runs `operation`, retrying ONLY transient EmbeddingErrors (rate limit, 5xx,
 * network, timeout), at most `maxAttempts` times. Authentication failures,
 * malformed responses, wrong dimensions and invalid input fail immediately.
 * When retries run out the last error is rethrown with the attempt count.
 */
export async function withRetries<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (!(error instanceof EmbeddingError) || !error.retryable) throw error
      if (attempt >= options.maxAttempts) {
        throw new EmbeddingError(
          error.kind,
          `${error.message} (gave up after ${attempt} ${attempt === 1 ? 'attempt' : 'attempts'})`,
          {
            status: error.status,
            retryAfterMs: error.retryAfterMs,
            attempts: attempt,
          },
        )
      }
      await options.sleep(retryDelayMs(attempt, error, options))
    }
  }
}

/** Parses a Retry-After header (delta-seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(
  value: string | null,
  now: () => number = Date.now,
): number | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000)
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now())
}
