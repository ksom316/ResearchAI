import { createOpenRouterProvider, LlmError } from '#/lib/llm'
import type { LlmProvider, StructuredMode } from '#/lib/llm'

/**
 * SERVER ONLY (the .server suffix keeps it out of browser bundles) and the ONLY place
 * the chat LLM configuration is read from the environment. OPENROUTER_API_KEY and
 * LLM_MODEL are read at call time, never as VITE_ variables, never logged, and never
 * echoed in errors. One configured model: no fallback, no racing.
 */
export const LLM_TIMEOUT_MS = 75_000

const PLACEHOLDER =
  /your|placeholder|changeme|change-me|example|xxx|\.\.\.|<|>/i
/** OpenRouter model slugs look like "vendor/model-name[:variant]". */
const MODEL_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/

function readSetting(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim()
  if (!value || PLACEHOLDER.test(value)) {
    // Only the variable NAME is mentioned, never a value.
    throw new LlmError('configuration', `${name} is not configured`)
  }
  return value
}

/**
 * LLM_STRUCTURED_MODE: json_schema (default when unset/blank) or json_object, for models
 * that return JSON but do not enforce a schema. Phase 5C validates output either way.
 */
function readStructuredMode(
  env: Record<string, string | undefined>,
): StructuredMode {
  const value = env.LLM_STRUCTURED_MODE?.trim()
  if (!value) return 'json_schema'
  if (value === 'json_schema' || value === 'json_object') return value
  throw new LlmError(
    'configuration',
    'LLM_STRUCTURED_MODE must be json_schema or json_object',
  )
}

export function createServerLlm(
  env: Record<string, string | undefined> = process.env,
  options: { fetch?: typeof fetch } = {},
): LlmProvider {
  const apiKey = readSetting(env, 'OPENROUTER_API_KEY')
  const model = readSetting(env, 'LLM_MODEL')
  if (!MODEL_SLUG.test(model)) {
    throw new LlmError('configuration', 'LLM_MODEL is not a valid model id')
  }
  return createOpenRouterProvider({
    apiKey,
    model,
    structuredMode: readStructuredMode(env),
    timeoutMs: LLM_TIMEOUT_MS,
    fetch: options.fetch,
  })
}
