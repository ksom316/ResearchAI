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

/** Why a response was unusable. A fixed set: never derived from model output. */
export type LlmFailureCategory =
  'truncated' | 'not_json' | 'not_object' | 'empty'

export type LlmFailureStage =
  | 'configuration'
  | 'request_construction'
  | 'network'
  | 'provider_response'
  | 'structured_parse'

/** Numeric token counts the provider reported; a field is omitted when not supplied. */
export type LlmDiagnosticUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  /** Only when the response supplied a numeric reasoning-token count. */
  reasoningTokens?: number
}

/** Safe metadata about an unusable response: no content, only bounded identifiers/numbers. */
export type LlmDiagnostic = {
  category?: LlmFailureCategory
  stage?: LlmFailureStage
  provider?: string | null
  requestedModel?: string | null
  providerCode?: string | null
  requestSent?: boolean
  responseContentPresent?: boolean | null
  /** The model that answered, if the provider said so. */
  model?: string | null
  finishReason?: string | null
  usage?: LlmDiagnosticUsage
}

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  readonly status: number | undefined
  readonly diagnostic: LlmDiagnostic | undefined

  constructor(
    kind: LlmErrorKind,
    message: string,
    status?: number,
    diagnostic?: LlmDiagnostic,
  ) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    this.status = status
    this.diagnostic = diagnostic
  }
}
