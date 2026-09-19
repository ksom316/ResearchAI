import { EmbeddingError } from '../../src/lib/embedding/errors'
import { InvalidChunkError } from './plan'
import { InvalidVectorError } from './serialize'
import type { JobFailure } from './types'

/**
 * An error from the store (Supabase). It carries ONLY the operation and, when the
 * database reported one, its SQLSTATE code. Raw messages and details are never kept:
 * a failed insert's detail can contain the row (vector or chunk text).
 */
export class StoreError extends Error {
  readonly operation: string
  readonly sqlState: string | null

  constructor(operation: string, sqlState: string | null) {
    super(`${operation} failed${sqlState ? ` (${sqlState})` : ''}`)
    this.name = 'StoreError'
    this.operation = operation
    this.sqlState = sqlState
  }

  /**
   * Data and constraint problems (SQLSTATE class 22, 23, 42, P0) will fail the same
   * way every time. Everything else (no code = network, 5xx, timeouts) is transient.
   */
  get retryable(): boolean {
    return !(this.sqlState && /^(22|23|42|P0)/.test(this.sqlState))
  }
}

/** A job problem that retrying cannot fix (e.g. chunk count changed unexpectedly). */
export class JobIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JobIntegrityError'
  }
}

export type FailureCode =
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'invalid_provider_response'
  | 'invalid_vector'
  | 'invalid_input'
  | 'storage_error'
  | 'integrity_error'
  | 'unexpected_error'

/** Fixed messages: the ONLY text that can reach paper_embedding_jobs.last_error. */
export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  provider_rate_limited: 'The embedding service rate limit was reached.',
  provider_unavailable: 'The embedding service was unavailable.',
  provider_rejected: 'The embedding service rejected the request.',
  invalid_provider_response:
    'The embedding service returned an unexpected response.',
  invalid_vector: 'The embedding service returned an invalid vector.',
  invalid_input: 'A chunk could not be turned into a valid embedding input.',
  storage_error: 'The embeddings could not be saved.',
  integrity_error: 'The paper changed or does not match its indexing job.',
  unexpected_error: 'Indexing failed unexpectedly.',
}

export type Classification =
  | { kind: 'job'; code: FailureCode; retryable: boolean }
  /** The provider key is unusable: a stage-wide problem, not this job's fault. */
  | { kind: 'blocked'; reason: string }

export function classify(error: unknown): Classification {
  if (error instanceof EmbeddingError) {
    switch (error.kind) {
      case 'auth':
        return { kind: 'blocked', reason: error.message }
      case 'rate_limited':
        return { kind: 'job', code: 'provider_rate_limited', retryable: true }
      case 'server':
      case 'network':
      case 'timeout':
        return { kind: 'job', code: 'provider_unavailable', retryable: true }
      case 'bad_request':
        return { kind: 'job', code: 'provider_rejected', retryable: false }
      case 'dimension_mismatch':
        return { kind: 'job', code: 'invalid_vector', retryable: false }
      case 'invalid_input':
        return { kind: 'job', code: 'invalid_input', retryable: false }
      case 'invalid_response':
        return {
          kind: 'job',
          code: 'invalid_provider_response',
          retryable: false,
        }
    }
  }
  if (error instanceof InvalidVectorError) {
    return { kind: 'job', code: 'invalid_vector', retryable: false }
  }
  if (error instanceof InvalidChunkError) {
    return { kind: 'job', code: 'invalid_input', retryable: false }
  }
  if (error instanceof StoreError) {
    return {
      kind: 'job',
      code: error.retryable ? 'storage_error' : 'integrity_error',
      retryable: error.retryable,
    }
  }
  if (error instanceof JobIntegrityError) {
    return { kind: 'job', code: 'integrity_error', retryable: false }
  }
  return { kind: 'job', code: 'unexpected_error', retryable: false }
}

/** Delay before a failed-but-retryable job may be claimed again: 1m, 2m, 4m ... max 30m. */
export function jobRetryDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1))
}

/**
 * Turns a classified error into what the store should record. A retryable error
 * only stays retryable while attempts remain, so every job ends within maxAttempts.
 */
export function toJobFailure(
  code: FailureCode,
  retryable: boolean,
  attempts: number,
  maxAttempts: number,
): JobFailure {
  const retry = retryable && attempts < maxAttempts
  return {
    message: FAILURE_MESSAGES[code],
    retry,
    countAttempt: true,
    retryDelayMs: retry ? jobRetryDelayMs(attempts) : 0,
  }
}
