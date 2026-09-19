/**
 * Safe, single-line descriptions of errors for the worker console.
 *
 * Network failures surface as "TypeError: fetch failed" with the real reason
 * (ENOTFOUND, ECONNREFUSED, a certificate problem...) hidden in `error.cause`
 * or, for supabase-js, in `error.details`. This walks both. Output is redacted
 * so credentials can never reach the log, and stack traces are dropped.
 */

const MAX_LENGTH = 500

const TOKEN_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[\w.~+/=-]+/gi,
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWTs (legacy anon / service_role keys)
  /sb_(?:secret|publishable)_[\w-]+/g, // new-style Supabase API keys
  /\bpa-[A-Za-z0-9_-]{16,}/g, // Voyage AI API keys
]

export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[redacted]')
  return out
}

type ErrorLike = {
  name?: unknown
  message?: unknown
  code?: unknown
  details?: unknown
  cause?: unknown
}

function firstLine(text: string): string {
  return text.split('\n')[0].trim()
}

/** "Caused by: ..." lines from supabase-js `details`, without stack frames. */
function causedByLines(details: unknown): string[] {
  if (typeof details !== 'string') return []
  return details
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Caused by:'))
    .map((line) => line.replace(/^Caused by:\s*/, ''))
}

export function describeError(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (typeof current !== 'object') {
      parts.push(String(current))
      break
    }
    const e = current as ErrorLike
    const message = typeof e.message === 'string' ? firstLine(e.message) : ''
    const code = typeof e.code === 'string' && e.code ? ` [${e.code}]` : ''
    if (message || code) parts.push(`${message}${code}`.trim())
    else if (typeof e.name === 'string') parts.push(e.name)
    if (depth === 0) parts.push(...causedByLines(e.details).map(firstLine))
    current = e.cause
  }
  const text = parts.filter(Boolean).join(' <- caused by: ') || 'unknown error'
  const redacted = redact(text, secrets)
  return redacted.length > MAX_LENGTH
    ? `${redacted.slice(0, MAX_LENGTH)}…`
    : redacted
}
