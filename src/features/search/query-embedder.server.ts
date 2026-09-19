import { createVoyageProvider, EmbeddingError } from '#/lib/embedding'

/**
 * SERVER ONLY (the .server suffix keeps it out of browser bundles). Embeds one search
 * question with Voyage as a QUERY: voyage-4, 1024 dims, input_type "query", the
 * normalized question only (no ctx-v1 document header), one attempt, ~10 s budget.
 * The key comes from EMBEDDING_API_KEY, read lazily here and nowhere else; it is
 * never a VITE_ variable. Errors are EmbeddingErrors, whose messages carry no key or
 * query text.
 */
export const QUERY_TIMEOUT_MS = 10_000

export async function embedSearchQuery(
  query: string,
  env: Record<string, string | undefined> = process.env,
): Promise<number[]> {
  const apiKey = env.EMBEDDING_API_KEY
  if (!apiKey || apiKey.trim() === '') {
    throw new EmbeddingError('invalid_input', 'Embedding is not configured')
  }
  const provider = createVoyageProvider({
    apiKey,
    maxAttempts: 1,
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  return (await provider.embedQuery(query)).vector
}
