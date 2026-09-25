/**
 * What went wrong in one extraction attempt.
 *  - llm_unavailable: provider timeout / rate limit / 5xx / unreachable (transient)
 *  - persistence:     a database or network hiccup while saving (transient)
 *  - persistence_permanent: the database rejected the data itself (SQLSTATE 22/23/42/P0)
 *  - truncated:       the provider returned finish_reason=length (the answer was cut off).
 *                     The router may serve a different model next attempt, so it is retried
 *                     within the attempt budget. Only this exact signal qualifies.
 *  - invalid_output / invalid_citation: the model's answer failed validation. Retrying
 *                     would spend another LLM call on the same evidence, so it is final.
 *  - unexpected:      a bug or an unknown error; final.
 * A paper reprocessed mid-run is not a failure: the run is re-queued (see the runner).
 */
export type ExtractionFailureKind =
  | 'llm_unavailable'
  | 'usage_exhausted'
  | 'truncated'
  | 'persistence'
  | 'persistence_permanent'
  | 'invalid_output'
  | 'invalid_citation'
  | 'unexpected'
  | 'superseded'

const TRANSIENT: ReadonlySet<ExtractionFailureKind> = new Set([
  'llm_unavailable',
  'truncated',
  'persistence',
  'superseded',
])

/**
 * `attempts` counts claims so far including the one that just failed
 * (claim_paper_extraction increments it). Retry only while attempts remain, so every
 * request ends after at most `maxAttempts` claims, hence at most that many LLM calls.
 */
export function decideExtractionFailure(
  kind: ExtractionFailureKind,
  attempts: number,
  maxAttempts: number,
): 'retry' | 'fail' {
  return TRANSIENT.has(kind) && attempts < maxAttempts ? 'retry' : 'fail'
}

/** Short, fixed, internal messages. Never contain model output, paper text or keys. */
export const FAILURE_MESSAGE: Record<ExtractionFailureKind, string> = {
  llm_unavailable: 'The language model was unavailable.',
  usage_exhausted: 'The monthly AI usage allowance was reached.',
  truncated: 'The model response was cut off before it finished.',
  persistence: 'Saving the extraction failed.',
  persistence_permanent: 'The database rejected the extraction.',
  invalid_output: 'The model returned output that failed validation.',
  invalid_citation: 'The model cited evidence that is not allowed for a field.',
  unexpected: 'Unexpected error during extraction.',
  superseded: 'The paper kept changing while it was being extracted.',
}
