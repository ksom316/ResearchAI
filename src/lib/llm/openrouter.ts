import { LlmError } from './errors'
import type {
  LlmProvider,
  LlmUsage,
  StructuredRequest,
  StructuredResult,
} from './types'

/** OpenRouter chat completions: https://openrouter.ai/docs/api-reference/chat-completion */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export const DEFAULT_TEMPERATURE = 0.1
export const DEFAULT_TIMEOUT_MS = 45_000

/**
 * How structure is requested. The caller (server adapter) chooses; nothing here guesses
 * from model names.
 *  - json_schema: strict JSON Schema enforcement by the provider
 *  - json_object: JSON-only output without schema enforcement (schema is given in the prompt)
 */
export type StructuredMode = 'json_schema' | 'json_object'

export type OpenRouterOptions = {
  /** Default json_schema. */
  structuredMode?: StructuredMode
  apiKey: string
  /** OpenRouter model slug, e.g. "vendor/model-name". One model only: no fallback. */
  model: string
  temperature?: number
  timeoutMs?: number
  /** Tests only. In production the key is only ever sent to OpenRouter. */
  baseUrl?: string
  fetch?: typeof fetch
}

const isStructuredMode = (value: string): value is StructuredMode =>
  value === 'json_schema' || value === 'json_object'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null

/**
 * Sends one system + one user message and asks for JSON that follows a caller-supplied
 * JSON schema (`response_format: json_schema`, strict, routed only to providers that
 * support it). One request, no retries, no fallback models. The output is untrusted.
 */
export class OpenRouterProvider implements LlmProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly temperature: number
  private readonly timeoutMs: number
  private readonly url: string
  private readonly structuredMode: StructuredMode
  private readonly fetchFn: typeof fetch

  constructor(options: OpenRouterOptions) {
    if (options.apiKey.trim() === '') {
      throw new LlmError('configuration', 'An OpenRouter API key is required')
    }
    if (options.model.trim() === '') {
      throw new LlmError('configuration', 'An LLM model is required')
    }
    const temperature = options.temperature ?? DEFAULT_TEMPERATURE
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new LlmError('configuration', 'Temperature must be between 0 and 2')
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new LlmError('configuration', 'Timeout must be a positive integer')
    }
    const structuredMode: string = options.structuredMode ?? 'json_schema'
    if (!isStructuredMode(structuredMode)) {
      throw new LlmError('configuration', 'Unsupported structured output mode')
    }
    this.structuredMode = structuredMode
    this.apiKey = options.apiKey.trim()
    this.model = options.model.trim()
    this.temperature = temperature
    this.timeoutMs = timeoutMs
    this.url = `${(options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '')}/chat/completions`
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async generateStructured(
    request: StructuredRequest,
  ): Promise<StructuredResult> {
    if (
      !Number.isInteger(request.maxTokens) ||
      request.maxTokens < 1 ||
      request.system.trim() === '' ||
      request.user.trim() === ''
    ) {
      throw new LlmError('configuration', 'Invalid structured request')
    }

    const controller = new AbortController()
    const state = { timedOut: false }
    const timer = setTimeout(() => {
      state.timedOut = true
      controller.abort()
    }, this.timeoutMs)
    const onCallerAbort = () => controller.abort()
    if (request.signal?.aborted) controller.abort()
    request.signal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      let response: Response
      let body: string
      try {
        response = await this.fetchFn(this.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: this.systemContent(request) },
              { role: 'user', content: request.user },
            ],
            temperature: this.temperature,
            max_tokens: request.maxTokens,
            stream: false,
            ...this.structureParameters(request),
          }),
          signal: controller.signal,
        })
        body = await response.text()
      } catch {
        // Never surface the raw error: it could carry request details.
        if (state.timedOut) {
          throw new LlmError(
            'timeout',
            `OpenRouter request timed out after ${this.timeoutMs} ms`,
          )
        }
        if (controller.signal.aborted) {
          throw new LlmError('aborted', 'The request was cancelled')
        }
        throw new LlmError('provider_error', 'Could not reach OpenRouter')
      }
      return this.handle(response.status, body)
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  private systemContent(request: StructuredRequest): string {
    if (this.structuredMode === 'json_schema') return request.system
    // No schema enforcement in this mode, so the schema is part of the instructions.
    return (
      `${request.system}

` +
      'Respond with ONE JSON object only: no markdown, no code fences, no text before or after it. ' +
      `It must conform to this JSON Schema ("${request.schema.name}"):
` +
      JSON.stringify(request.schema.schema)
    )
  }

  private structureParameters(request: StructuredRequest) {
    if (this.structuredMode === 'json_object') {
      return { response_format: { type: 'json_object' } }
    }
    return {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schema.name,
          strict: true,
          schema: request.schema.schema,
        },
      },
      // Only route to providers that honor json_schema.
      provider: { require_parameters: true },
    }
  }

  private handle(status: number, body: string): StructuredResult {
    if (status >= 200 && status < 300) return this.parse(body)
    if (status === 401 || status === 403) {
      throw new LlmError(
        'auth',
        `OpenRouter rejected the API key (HTTP ${status})`,
        status,
      )
    }
    if (status === 429) {
      throw new LlmError(
        'rate_limited',
        'OpenRouter rate limit reached (HTTP 429)',
        status,
      )
    }
    if (status === 408) {
      throw new LlmError(
        'timeout',
        'OpenRouter reported a request timeout (HTTP 408)',
        status,
      )
    }
    throw new LlmError(
      'provider_error',
      `OpenRouter request failed (HTTP ${status})`,
      status,
    )
  }

  private parse(body: string): StructuredResult {
    const bad = (message: string) => new LlmError('invalid_response', message)
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      throw bad('OpenRouter returned a response that is not valid JSON')
    }
    if (!isRecord(json)) throw bad('OpenRouter response is not an object')
    // OpenRouter can report an upstream failure inside a 200 response.
    if (json.error !== undefined) {
      throw new LlmError(
        'provider_error',
        'OpenRouter reported an upstream error',
      )
    }
    const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
    if (!isRecord(choice) || !isRecord(choice.message)) {
      throw bad('OpenRouter response has no message')
    }
    if (choice.finish_reason === 'length') {
      throw bad('The model output was cut off (token limit)')
    }
    const content = choice.message.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw bad('OpenRouter response has no message content')
    }
    let data: unknown
    try {
      data = JSON.parse(content)
    } catch {
      // Deliberately no markdown-fence stripping or repair: malformed is malformed.
      throw bad('The model did not return valid JSON')
    }
    if (!isRecord(data)) throw bad('The model did not return a JSON object')

    return {
      data,
      usage: this.usage(json.usage),
      provider: 'openrouter',
      model: typeof json.model === 'string' ? json.model : this.model,
    }
  }

  private usage(raw: unknown): LlmUsage | null {
    if (!isRecord(raw)) return null
    const usage = {
      inputTokens: count(raw.prompt_tokens),
      outputTokens: count(raw.completion_tokens),
      totalTokens: count(raw.total_tokens),
    }
    return usage.inputTokens === null &&
      usage.outputTokens === null &&
      usage.totalTokens === null
      ? null
      : usage
  }
}

export function createOpenRouterProvider(
  options: OpenRouterOptions,
): OpenRouterProvider {
  return new OpenRouterProvider(options)
}
