import { ConfigError } from './config'
import { VOYAGE_PHASE4_PROFILE } from '../src/lib/embedding/voyage'
import { TOKEN_HEADROOM } from './embedding/rate-limiter'

/**
 * Embedding configuration for the worker. Kept separate from loadConfig() so the
 * PDF stage keeps running without an embedding key; the embedding stage (and the
 * smoke test) call this and fail fast if it is missing.
 *
 * Server-only: the key must never carry a VITE_ prefix or appear in browser code.
 * The provider endpoint is deliberately NOT configurable, so the key can only ever
 * be sent to Voyage.
 */

export type EmbeddingConfig = {
  apiKey: string
  /** Locked for Phase 4: voyage-4. */
  model: string
  /** Locked for Phase 4: 1024 (matches vector(1024)). */
  dimensions: number
  /** Inputs per provider request. */
  batchSize: number
  /** Per-request time budget. */
  timeoutMs: number
  /** Tries per request (batch), first attempt included. */
  maxAttempts: number
  /** Provider limits we pace against. Defaults are this account's current limits. */
  requestsPerMinute: number
  tokensPerMinute: number
  /** Estimated tokens allowed in one request (must fit inside the paced budget). */
  maxRequestTokens: number
  /** Attempts per indexing JOB (claims), before it is left as failed. */
  jobMaxAttempts: number
  /** An 'embedding' job with no progress for this long is treated as abandoned. */
  staleAfterMinutes: number
  /** Whether `npm run worker` also runs the embedding stage (off by default). */
  stageEnabled: boolean
}

type Env = Record<string, string | undefined>

function readInt(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(
      `${name} must be an integer between ${min} and ${max}.`,
    )
  }
  return value
}

export function loadEmbeddingConfig(env: Env = process.env): EmbeddingConfig {
  const apiKey = env.EMBEDDING_API_KEY?.trim()
  if (!apiKey) {
    throw new ConfigError(
      'Missing worker environment variable: EMBEDDING_API_KEY. Add your Voyage AI ' +
        'key to .env.worker (server-only; never use a VITE_ prefix).',
    )
  }
  if (apiKey.startsWith('your-') || /\s/.test(apiKey) || apiKey.length < 16) {
    throw new ConfigError(
      'EMBEDDING_API_KEY looks like a placeholder or is malformed. Set it to your real ' +
        'Voyage AI key in .env.worker.',
    )
  }

  // Phase 4 is locked to one vector space. These are accepted only to catch
  // accidental edits; any other value is refused rather than silently used.
  const model = env.EMBEDDING_MODEL?.trim() || VOYAGE_PHASE4_PROFILE.model
  if (model !== VOYAGE_PHASE4_PROFILE.model) {
    throw new ConfigError(
      `EMBEDDING_MODEL must be "${VOYAGE_PHASE4_PROFILE.model}" (Phase 4 is locked to one model).`,
    )
  }
  const dimensions = readInt(
    env,
    'EMBEDDING_DIMENSIONS',
    VOYAGE_PHASE4_PROFILE.dimensions,
    1,
    100_000,
  )
  if (dimensions !== VOYAGE_PHASE4_PROFILE.dimensions) {
    throw new ConfigError(
      `EMBEDDING_DIMENSIONS must be ${VOYAGE_PHASE4_PROFILE.dimensions} (matches the vector(1024) column).`,
    )
  }

  const requestsPerMinute = readInt(env, 'EMBEDDING_RPM_LIMIT', 3, 1, 100_000)
  const tokensPerMinute = readInt(
    env,
    'EMBEDDING_TPM_LIMIT',
    10_000,
    1_000,
    100_000_000,
  )
  const maxRequestTokens = readInt(
    env,
    'EMBEDDING_MAX_REQUEST_TOKENS',
    4_000,
    500,
    1_000_000,
  )
  const budget = Math.floor(tokensPerMinute * TOKEN_HEADROOM)
  if (maxRequestTokens > budget) {
    throw new ConfigError(
      `EMBEDDING_MAX_REQUEST_TOKENS (${maxRequestTokens}) must not exceed the paced token budget (${budget}).`,
    )
  }

  const stage = env.EMBEDDING_STAGE_ENABLED?.trim().toLowerCase()
  if (
    stage !== undefined &&
    stage !== '' &&
    !['true', 'false', '1', '0'].includes(stage)
  ) {
    throw new ConfigError('EMBEDDING_STAGE_ENABLED must be true or false.')
  }

  return {
    apiKey,
    model,
    dimensions,
    batchSize: readInt(env, 'EMBEDDING_BATCH_SIZE', 32, 1, 128),
    timeoutMs: readInt(env, 'EMBEDDING_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxAttempts: readInt(env, 'EMBEDDING_MAX_ATTEMPTS', 4, 1, 8),
    requestsPerMinute,
    tokensPerMinute,
    maxRequestTokens,
    jobMaxAttempts: readInt(env, 'EMBEDDING_JOB_MAX_ATTEMPTS', 4, 1, 10),
    staleAfterMinutes: readInt(
      env,
      'EMBEDDING_STALE_AFTER_MINUTES',
      15,
      2,
      1440,
    ),
    stageEnabled: stage === 'true' || stage === '1',
  }
}

/** Production continuous workers must index every newly-ready paper. */
export function loadEnabledEmbeddingConfig(
  env: Env = process.env,
): EmbeddingConfig {
  const config = loadEmbeddingConfig(env)
  if (!config.stageEnabled) {
    throw new ConfigError(
      'EMBEDDING_STAGE_ENABLED must be true for the continuous PDF and embedding worker.',
    )
  }
  return config
}
