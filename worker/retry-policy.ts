import type { ProcessingErrorCode } from '../src/features/processing/types'

/**
 * Only failures that plausibly succeed on a second try are retried:
 *  - storage_error / persistence_error: network or database hiccups.
 * Everything else is a property of the file (invalid, encrypted, no text) or of
 * the extraction itself (timeout, unknown), so retrying would just repeat it.
 */
const RETRYABLE: ReadonlySet<ProcessingErrorCode> = new Set([
  'storage_error',
  'persistence_error',
])

export type FailureDecision = 'retry' | 'fail'

/**
 * `attempts` is how many times the paper has been claimed so far, including the
 * attempt that just failed (the claim function increments it). Retry only while
 * attempts remain, so every job ends after at most `maxAttempts` tries.
 */
export function decideFailure(
  code: ProcessingErrorCode,
  attempts: number,
  maxAttempts: number,
): FailureDecision {
  return RETRYABLE.has(code) && attempts < maxAttempts ? 'retry' : 'fail'
}
