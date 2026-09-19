/**
 * Errors from the LLM client. Messages are safe by construction: fixed text plus an
 * HTTP status code. They never contain the API key, Authorization header, a provider
 * response body, or any prompt/evidence text. No error is retried automatically.
 */
export type LlmErrorKind =
  | 'configuration' // missing/invalid key, model or options (no request was made)
  | 'auth' // 401 / 403
  | 'rate_limited' // 429
  | 'timeout' // our time budget elapsed, or the provider reported 408
  | 'aborted' // the caller cancelled
  | 'provider_error' // 5xx, other 4xx, or the provider could not be reached
  | 'invalid_response' // successful HTTP, but not usable structured output

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  readonly status: number | undefined

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    this.status = status
  }
}
