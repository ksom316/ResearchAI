import { ConfigError } from './config'
import { VOYAGE_PHASE4_PROFILE } from '../src/lib/embedding/voyage'

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
  /** Tries per request, first attempt included. */
  maxAttempts: number
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

  return {
    apiKey,
    model,
    dimensions,
    batchSize: readInt(env, 'EMBEDDING_BATCH_SIZE', 32, 1, 128),
    timeoutMs: readInt(env, 'EMBEDDING_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxAttempts: readInt(env, 'EMBEDDING_MAX_ATTEMPTS', 4, 1, 8),
  }
}
