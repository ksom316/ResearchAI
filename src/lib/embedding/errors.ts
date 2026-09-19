/**
 * Errors from the embedding client. Messages are safe by construction: they are
 * built only from fixed text, HTTP status codes and network error codes, never
 * from request bodies, API keys, Authorization headers or chunk text.
 */

export type EmbeddingErrorKind =
  | 'auth' // 401 / 403: bad or unauthorized key
  | 'rate_limited' // 429
  | 'server' // 5xx
  | 'network' // connection failed
  | 'timeout' // request exceeded its time budget
  | 'bad_request' // other 4xx: the provider rejected the request
  | 'invalid_response' // successful HTTP, but not the shape we expect
  | 'dimension_mismatch' // a vector was not the expected size
  | 'invalid_input' // rejected locally, before any request

/** Only transient conditions are worth retrying. */
const RETRYABLE: ReadonlySet<EmbeddingErrorKind> = new Set([
  'rate_limited',
  'server',
  'network',
  'timeout',
])

export class EmbeddingError extends Error {
  readonly kind: EmbeddingErrorKind
  readonly retryable: boolean
  readonly status: number | undefined
  /** Delay the provider asked for (Retry-After), in milliseconds. */
  readonly retryAfterMs: number | undefined
  /** How many attempts were made when the client gave up. */
  readonly attempts: number | undefined

  constructor(
    kind: EmbeddingErrorKind,
    message: string,
    options: {
      status?: number
      retryAfterMs?: number
      attempts?: number
    } = {},
  ) {
    super(message)
    this.name = 'EmbeddingError'
    this.kind = kind
    this.retryable = RETRYABLE.has(kind)
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.attempts = options.attempts
  }
}

const TOKEN_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[\w.~+/=-]+/gi,
  /\bpa-[A-Za-z0-9_-]{16,}/g, // Voyage API keys
]

/** Removes the configured secrets and anything key-shaped from a string. */
export function redactSecrets(
  text: string,
  secrets: readonly string[] = [],
): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[redacted]')
  return out
}

/**
 * A short, single-line, redacted excerpt of a provider error detail. Control
 * characters are dropped and the length is capped, so it is safe to log.
 */
export function safeDetail(
  detail: unknown,
  secrets: readonly string[] = [],
  maxLength = 200,
): string | null {
  if (typeof detail !== 'string') return null
  const cleaned = redactSecrets(
    Array.from(detail, (ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join(''),
    secrets,
  )
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return null
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}…`
    : cleaned
}
