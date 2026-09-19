/**
 * Provider-independent embedding interface. The rest of ResearchAI depends on
 * this, never on a provider's request/response format.
 *
 * Server-side only: implementations hold an API key. Nothing here reads
 * environment variables; callers pass configuration in explicitly.
 */

export type EmbeddingVector = number[]

/** Which vector space an embedding belongs to (mirrors a row of embedding_models). */
export type EmbeddingProfile = {
  provider: string
  model: string
  dimensions: number
}

export type DocumentEmbeddings = {
  /** One vector per input, in input order. */
  vectors: EmbeddingVector[]
  /** Tokens billed by the provider, or null if it did not report usage. */
  tokens: number | null
}

export type QueryEmbedding = {
  vector: EmbeddingVector
  tokens: number | null
}

export interface EmbeddingProvider {
  readonly profile: EmbeddingProfile
  /** Embeds stored passages (provider "document" input type), preserving order. */
  embedDocuments: (inputs: readonly string[]) => Promise<DocumentEmbeddings>
  /** Embeds one search query (provider "query" input type). */
  embedQuery: (input: string) => Promise<QueryEmbedding>
}
