import {
  DEFAULT_MAX_BATCH_CHARS,
  DEFAULT_MAX_BATCH_ITEMS,
  HARD_MAX_BATCH_ITEMS,
  assertValidDocumentInputs,
  assertValidQuery,
  planBatches,
} from './batching'
import { EmbeddingError, safeDetail } from './errors'
import { DEFAULT_RETRY, parseRetryAfter, withRetries } from './retry'
import type { RetryOptions } from './retry'
import type {
  DocumentEmbeddings,
  EmbeddingProfile,
  EmbeddingProvider,
  QueryEmbedding,
} from './types'

/** Voyage AI embeddings API: https://docs.voyageai.com/reference/embeddings-api */
export const VOYAGE_BASE_URL = 'https://api.voyageai.com/v1'

/** The Phase 4 profile; must match the seeded embedding_models row (0006). */
export const VOYAGE_PHASE4_PROFILE = {
  provider: 'voyage',
  model: 'voyage-4',
  dimensions: 1024,
} as const

/** Output sizes voyage-4 supports. The database column is vector(1024). */
const SUPPORTED_DIMENSIONS: readonly number[] = [256, 512, 1024, 2048]

export type VoyageOptions = {
  apiKey: string
  model?: string
  dimensions?: number
  /** Tests only. In production the key is only ever sent to Voyage. */
  baseUrl?: string
  /** Inputs per request. Default 32; the hard cap is 128. */
  batchSize?: number
  /** Characters per request (a conservative token-limit guard). */
  maxBatchChars?: number
  timeoutMs?: number
  maxAttempts?: number
  fetch?: typeof fetch
  retry?: Partial<Omit<RetryOptions, 'maxAttempts'>>
}

type InputType = 'document' | 'query'

type Parsed = { vectors: number[][]; tokens: number | null }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Voyage adapter. Sends documents with input_type "document" and queries with
 * "query", always requests `output_dimension`, disables silent truncation, and
 * strictly validates every response: one vector per input, in input order,
 * exactly `dimensions` finite numbers each.
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly profile: EmbeddingProfile
  private readonly apiKey: string
  private readonly model: string
  private readonly dimensions: number
  private readonly url: string
  private readonly batchSize: number
  private readonly maxBatchChars: number
  private readonly timeoutMs: number
  private readonly retryOptions: RetryOptions
  private readonly fetchFn: typeof fetch

  constructor(options: VoyageOptions) {
    if (options.apiKey.trim() === '') {
      throw new EmbeddingError('invalid_input', 'A Voyage API key is required')
    }
    this.apiKey = options.apiKey.trim()
    this.model = options.model ?? VOYAGE_PHASE4_PROFILE.model
    this.dimensions = options.dimensions ?? VOYAGE_PHASE4_PROFILE.dimensions
    if (!SUPPORTED_DIMENSIONS.includes(this.dimensions)) {
      throw new EmbeddingError(
        'invalid_input',
        `Unsupported output dimension ${this.dimensions}`,
      )
    }
    this.batchSize = options.batchSize ?? DEFAULT_MAX_BATCH_ITEMS
    if (
      !Number.isInteger(this.batchSize) ||
      this.batchSize < 1 ||
      this.batchSize > HARD_MAX_BATCH_ITEMS
    ) {
      throw new EmbeddingError(
        'invalid_input',
        `Batch size must be between 1 and ${HARD_MAX_BATCH_ITEMS}`,
      )
    }
    this.maxBatchChars = options.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.url = `${(options.baseUrl ?? VOYAGE_BASE_URL).replace(/\/+$/, '')}/embeddings`
    this.retryOptions = {
      ...DEFAULT_RETRY,
      ...options.retry,
      maxAttempts: options.maxAttempts ?? 4,
    }
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.profile = {
      provider: VOYAGE_PHASE4_PROFILE.provider,
      model: this.model,
      dimensions: this.dimensions,
    }
  }

  async embedDocuments(inputs: readonly string[]): Promise<DocumentEmbeddings> {
    assertValidDocumentInputs(inputs)
    const vectors: number[][] = []
    let tokens: number | null = 0
    const ranges = planBatches(inputs, {
      maxItems: this.batchSize,
      maxChars: this.maxBatchChars,
    })
    // Sequential on purpose: keeps order trivially correct and stays inside
    // provider rate limits.
    for (const range of ranges) {
      const batch = await this.post(
        inputs.slice(range.start, range.end),
        'document',
      )
      vectors.push(...batch.vectors)
      tokens =
        tokens === null || batch.tokens === null ? null : tokens + batch.tokens
    }
    return { vectors, tokens }
  }

  async embedQuery(input: string): Promise<QueryEmbedding> {
    assertValidQuery(input)
    const result = await this.post([input], 'query')
    return { vector: result.vectors[0], tokens: result.tokens }
  }

  private post(inputs: string[], inputType: InputType): Promise<Parsed> {
    return withRetries(
      () => this.postOnce(inputs, inputType),
      this.retryOptions,
    )
  }

  private async postOnce(
    inputs: string[],
    inputType: InputType,
  ): Promise<Parsed> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
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
            input: inputs,
            model: this.model,
            input_type: inputType,
            output_dimension: this.dimensions,
            output_dtype: 'float',
            // An oversized input must be an error, never silently cut short.
            truncation: false,
          }),
          signal: controller.signal,
        })
        body = await response.text()
      } catch (error) {
        throw this.transportError(error, controller.signal.aborted)
      }
      return this.handleResponse(response, body, inputs)
    } finally {
      clearTimeout(timer)
    }
  }

  private transportError(error: unknown, aborted: boolean): EmbeddingError {
    const name =
      isRecord(error) && typeof error.name === 'string' ? error.name : ''
    if (aborted || name === 'AbortError' || name === 'TimeoutError') {
      return new EmbeddingError(
        'timeout',
        `Voyage request timed out after ${this.timeoutMs} ms`,
      )
    }
    // Only the low-level error code (e.g. ECONNRESET), never the raw message.
    const cause =
      isRecord(error) && isRecord(error.cause) ? error.cause : undefined
    const code =
      (cause && typeof cause.code === 'string' ? cause.code : undefined) ??
      (isRecord(error) && typeof error.code === 'string'
        ? error.code
        : undefined)
    const suffix = code && /^[A-Z0-9_]{2,40}$/.test(code) ? ` (${code})` : ''
    return new EmbeddingError('network', `Could not reach Voyage${suffix}`)
  }

  private handleResponse(
    response: Response,
    body: string,
    inputs: string[],
  ): Parsed {
    const { status } = response
    if (status >= 200 && status < 300) return this.parse(body, inputs.length)

    if (status === 401 || status === 403) {
      throw new EmbeddingError(
        'auth',
        `Voyage rejected the API key (HTTP ${status})`,
        { status },
      )
    }
    if (status === 429) {
      throw new EmbeddingError(
        'rate_limited',
        'Voyage rate limit reached (HTTP 429)',
        {
          status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        },
      )
    }
    if (status === 408) {
      throw new EmbeddingError(
        'timeout',
        'Voyage reported a request timeout (HTTP 408)',
        { status },
      )
    }
    if (status >= 500) {
      throw new EmbeddingError(
        'server',
        `Voyage server error (HTTP ${status})`,
        {
          status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        },
      )
    }
    const detail = this.errorDetail(body, inputs)
    throw new EmbeddingError(
      'bad_request',
      `Voyage rejected the request (HTTP ${status})${detail ? `: ${detail}` : ''}`,
      { status },
    )
  }

  /**
   * A short redacted excerpt of the provider's own error text, if it sent one.
   * Dropped entirely if it appears to echo any of the submitted text, so paper
   * content can never travel into an error message.
   */
  private errorDetail(body: string, inputs: string[]): string | null {
    try {
      const json: unknown = JSON.parse(body)
      if (!isRecord(json)) return null
      const raw =
        json.detail ?? (isRecord(json.error) ? json.error.message : json.error)
      const detail = safeDetail(raw, [this.apiKey])
      if (detail === null) return null
      const echoesInput = inputs.some((input) => {
        const trimmed = input.trim()
        return (
          trimmed.length >= 12 &&
          (detail.includes(trimmed.slice(0, 40)) ||
            detail.includes(trimmed.slice(-40)))
        )
      })
      return echoesInput ? null : detail
    } catch {
      return null
    }
  }

  private parse(body: string, count: number): Parsed {
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      throw new EmbeddingError(
        'invalid_response',
        'Voyage returned a response that is not valid JSON',
      )
    }
    if (!isRecord(json) || !Array.isArray(json.data)) {
      throw new EmbeddingError(
        'invalid_response',
        'Voyage response is missing the "data" array',
      )
    }
    if (json.data.length !== count) {
      throw new EmbeddingError(
        'invalid_response',
        `Voyage returned ${json.data.length} embeddings for ${count} inputs`,
      )
    }

    const vectors: (number[] | undefined)[] = new Array<number[] | undefined>(
      count,
    ).fill(undefined)
    for (const item of json.data as unknown[]) {
      if (
        !isRecord(item) ||
        !Number.isInteger(item.index) ||
        !Array.isArray(item.embedding)
      ) {
        throw new EmbeddingError(
          'invalid_response',
          'Voyage returned a malformed embedding entry',
        )
      }
      const index = item.index as number
      if (index < 0 || index >= count || vectors[index] !== undefined) {
        throw new EmbeddingError(
          'invalid_response',
          'Voyage returned an invalid or duplicate embedding index',
        )
      }
      vectors[index] = this.validateVector(item.embedding as unknown[])
    }

    const ordered = vectors.filter((v): v is number[] => v !== undefined)
    if (ordered.length !== count) {
      throw new EmbeddingError(
        'invalid_response',
        'Voyage response did not cover every input',
      )
    }
    const usage = isRecord(json.usage) ? json.usage.total_tokens : undefined
    const tokens =
      typeof usage === 'number' && Number.isFinite(usage) && usage >= 0
        ? usage
        : null
    return { vectors: ordered, tokens }
  }

  private validateVector(values: unknown[]): number[] {
    if (values.length !== this.dimensions) {
      throw new EmbeddingError(
        'dimension_mismatch',
        `Expected ${this.dimensions} dimensions but Voyage returned ${values.length}`,
      )
    }
    for (const value of values) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new EmbeddingError(
          'invalid_response',
          'Voyage returned a non-numeric or non-finite vector value',
        )
      }
    }
    return values as number[]
  }
}

/** Convenience factory for the locked Phase 4 profile (voyage-4, 1024 dimensions). */
export function createVoyageProvider(
  options: Omit<VoyageOptions, 'model' | 'dimensions'>,
): VoyageEmbeddingProvider {
  return new VoyageEmbeddingProvider({
    ...options,
    model: VOYAGE_PHASE4_PROFILE.model,
    dimensions: VOYAGE_PHASE4_PROFILE.dimensions,
  })
}
