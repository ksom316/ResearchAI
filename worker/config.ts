/**
 * Worker configuration. Reads ONLY server-side variables; the service-role key
 * must never carry a VITE_ prefix (Vite would expose such variables to the browser).
 */

export type WorkerConfig = {
  supabaseUrl: string
  serviceRoleKey: string
  bucket: string
  /** Idle wait between polls in continuous mode. */
  pollIntervalMs: number
  /** Total attempts (first try included) before a paper is left as failed. */
  maxAttempts: number
  /** A 'processing' paper older than this is considered abandoned by a crashed worker. */
  staleAfterMinutes: number
  /** Soft time budget for extracting one PDF. */
  jobTimeoutMs: number
  /** Largest PDF the worker will download and parse. */
  maxPdfBytes: number
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
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

export function loadConfig(env: Env = process.env): WorkerConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim()
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  const missing = [
    !supabaseUrl && 'SUPABASE_URL',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing worker environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.worker.example to .env.worker and fill them in ' +
        '(server-only values; never use a VITE_ prefix).',
    )
  }
  let host: string
  try {
    const parsed = new URL(supabaseUrl!)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('protocol')
    }
    host = parsed.hostname
  } catch {
    throw new ConfigError(
      'SUPABASE_URL must be a full URL such as https://<project-ref>.supabase.co.',
    )
  }
  if (
    host.includes('your-project-ref') ||
    serviceRoleKey!.startsWith('your-')
  ) {
    throw new ConfigError(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY still contain the placeholder values ' +
        'from .env.worker.example. Replace them with your real project values.',
    )
  }

  const config: WorkerConfig = {
    supabaseUrl: supabaseUrl!.replace(/\/+$/, ''),
    serviceRoleKey: serviceRoleKey!,
    bucket: 'papers',
    pollIntervalMs: readInt(
      env,
      'WORKER_POLL_INTERVAL_MS',
      10_000,
      1_000,
      3_600_000,
    ),
    maxAttempts: readInt(env, 'WORKER_MAX_ATTEMPTS', 3, 1, 10),
    staleAfterMinutes: readInt(env, 'WORKER_STALE_AFTER_MINUTES', 15, 2, 1440),
    jobTimeoutMs: readInt(
      env,
      'WORKER_JOB_TIMEOUT_MS',
      120_000,
      5_000,
      3_600_000,
    ),
    maxPdfBytes: readInt(
      env,
      'WORKER_MAX_PDF_BYTES',
      60 * 1024 * 1024,
      1024,
      500 * 1024 * 1024,
    ),
  }

  // A job must be able to finish long before it can be declared abandoned, or a
  // slow-but-healthy job could be reclaimed and processed twice.
  if (config.staleAfterMinutes * 60_000 < config.jobTimeoutMs * 2) {
    throw new ConfigError(
      'WORKER_STALE_AFTER_MINUTES must be at least twice WORKER_JOB_TIMEOUT_MS.',
    )
  }
  return config
}
