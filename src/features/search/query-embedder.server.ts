import { createVoyageProvider, EmbeddingError } from '#/lib/embedding'
import type { UsageFeature, UsageRecorder } from '#/lib/usage/types'

/**
 * SERVER ONLY (the .server suffix keeps it out of browser bundles). Embeds one search
 * question with Voyage as a QUERY: voyage-4, 1024 dims, input_type "query", the
 * normalized question only (no ctx-v1 document header), one attempt, ~10 s budget.
 * The key comes from EMBEDDING_API_KEY, read lazily here and nowhere else; it is
 * never a VITE_ variable. Errors are EmbeddingErrors, whose messages carry no key or
 * query text.
 */
export const QUERY_TIMEOUT_MS = 10_000

export type QueryEmbeddingUsage = {
  actorUserId: string
  projectId: string | null
  feature: Extract<UsageFeature, 'research_chat' | 'academic_writer' | 'semantic_search'>
  recordUsage: UsageRecorder
  operationKey?: string
}

const isQueryEmbeddingUsage = (
  value: Record<string, string | undefined> | QueryEmbeddingUsage,
): value is QueryEmbeddingUsage =>
  typeof (value as { actorUserId?: unknown }).actorUserId === 'string' &&
  typeof (value as { recordUsage?: unknown }).recordUsage === 'function'

export async function embedSearchQuery(
  query: string,
  envOrUsage: Record<string, string | undefined> | QueryEmbeddingUsage = process.env,
  usage?: QueryEmbeddingUsage,
): Promise<number[]> {
  const env = isQueryEmbeddingUsage(envOrUsage) ? process.env : envOrUsage
  const metering = isQueryEmbeddingUsage(envOrUsage) ? envOrUsage : usage
  const apiKey = env.EMBEDDING_API_KEY
  if (!apiKey || apiKey.trim() === '') {
    throw new EmbeddingError('invalid_input', 'Embedding is not configured')
  }
  const provider = createVoyageProvider({
    apiKey,
    maxAttempts: 1,
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  const result = await provider.embedQuery(query)
  if (metering) {
    await metering.recordUsage({
      actorUserId: metering.actorUserId,
      projectId: metering.projectId,
      feature: metering.feature,
      eventType: 'embedding_request',
      provider: provider.profile.provider,
      model: provider.profile.model,
      inputTokens: result.tokens,
      totalTokens: result.tokens,
      quantity: 1,
      idempotencyKey: `${metering.operationKey ?? crypto.randomUUID()}:query`,
      metadata: { input_type: 'query' },
    }).catch(() => undefined)
  }
  return result.vector
}
