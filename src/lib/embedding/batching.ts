import { EmbeddingError } from './errors'

/**
 * Conservative request limits, far below Voyage's (1,000 inputs and 320K tokens
 * per request for voyage-4), so one slow or failing request never covers "the
 * whole paper" and a retry repeats little work.
 */
export const DEFAULT_MAX_BATCH_ITEMS = 32
export const HARD_MAX_BATCH_ITEMS = 128
/** ~80k tokens at a pessimistic 3 characters per token. */
export const DEFAULT_MAX_BATCH_CHARS = 240_000
/** ~20k tokens, comfortably inside voyage-4's 32k-token context. */
export const MAX_INPUT_CHARS = 60_000
/** Search queries are short; anything longer is almost certainly a mistake. */
export const MAX_QUERY_CHARS = 10_000

export type BatchRange = { start: number; end: number }

/**
 * Splits inputs into consecutive ranges no larger than `maxItems` items or
 * `maxChars` characters. Order is preserved: concatenating the ranges reproduces
 * the original sequence exactly.
 */
export function planBatches(
  inputs: readonly string[],
  limits: { maxItems: number; maxChars: number },
): BatchRange[] {
  if (limits.maxItems < 1 || limits.maxChars < 1) {
    throw new RangeError('Batch limits must be positive')
  }
  const batches: BatchRange[] = []
  let start = 0
  let chars = 0
  for (let i = 0; i < inputs.length; i++) {
    const length = inputs[i].length
    const full = i - start >= limits.maxItems
    const tooBig = i > start && chars + length > limits.maxChars
    if (full || tooBig) {
      batches.push({ start, end: i })
      start = i
      chars = 0
    }
    chars += length
  }
  if (inputs.length > start) batches.push({ start, end: inputs.length })
  return batches
}

/**
 * Local validation before any request. Errors name the input's position, never
 * its text.
 */
export function assertValidDocumentInputs(inputs: readonly string[]): void {
  if (inputs.length === 0) {
    throw new EmbeddingError('invalid_input', 'No inputs to embed')
  }
  inputs.forEach((input, index) => {
    assertValidText(input, MAX_INPUT_CHARS, `Input ${index}`)
  })
}

export function assertValidQuery(input: string): void {
  assertValidText(input, MAX_QUERY_CHARS, 'Query')
}

function assertValidText(
  value: unknown,
  maxChars: number,
  label: string,
): void {
  if (typeof value !== 'string') {
    throw new EmbeddingError('invalid_input', `${label} must be a string`)
  }
  if (value.trim() === '') {
    throw new EmbeddingError('invalid_input', `${label} is empty`)
  }
  if (value.length > maxChars) {
    throw new EmbeddingError(
      'invalid_input',
      `${label} is too long (${value.length} characters; limit ${maxChars})`,
    )
  }
}
