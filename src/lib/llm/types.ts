/**
 * Provider-independent structured-generation interface. Nothing here knows about
 * chat, retrieval or any particular answer schema: callers pass a JSON schema and
 * validate the returned data themselves.
 *
 * Server-side only: implementations hold an API key. Nothing in this directory reads
 * environment variables; callers pass configuration in explicitly.
 */

/** A JSON Schema the provider is asked to follow (OpenAI-style `json_schema`). */
export type JsonSchemaSpec = {
  name: string
  schema: Record<string, unknown>
}

/**
 * Optional, per-call reasoning control for reasoning-capable models. Omitted by default:
 * a request without it is sent exactly as before. Support varies by model/provider.
 */
export type ReasoningConfig = {
  effort: 'none' | 'low' | 'medium' | 'high'
}

export type StructuredRequest = {
  system: string
  user: string
  schema: JsonSchemaSpec
  /** Upper bound on generated tokens. */
  maxTokens: number
  /** Only sent when set. Never set by callers that do not need it. */
  reasoning?: ReasoningConfig
  signal?: AbortSignal
}

export type LlmUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export type StructuredResult = {
  /**
   * The parsed JSON object the model returned. UNTRUSTED: it is guaranteed to be a
   * JSON object, not to match the requested schema. Validate it (e.g. with zod).
   */
  data: Record<string, unknown>
  /** Null when the provider did not report usage. */
  usage: LlmUsage | null
  provider: string
  model: string
  /** Provider-reported finish reason (bounded identifier), when available. */
  finishReason?: string | null
}

export interface LlmProvider {
  /** Optional safe identifiers used by trusted metering and diagnostics. */
  readonly providerName?: string
  readonly modelName?: string
  generateStructured: (request: StructuredRequest) => Promise<StructuredResult>
}
