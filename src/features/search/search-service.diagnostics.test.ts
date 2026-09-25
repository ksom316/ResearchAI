import { describe, expect, it, vi } from 'vitest'
import { EmbeddingError } from '#/lib/embedding'
import { runSemanticSearch } from './search-service'
import type { SearchDb } from './search-service'

const request = {
  query: 'How does attention work?',
  scope: { type: 'library' as const },
}

const searchableCoverage = [
  {
    paper_id: '11111111-1111-4111-8111-111111111111',
    paper_title: 'Paper',
    state: 'searchable',
    chunk_count: 1,
  },
]

function dbWithSearchError(message: string, code = '42501'): SearchDb {
  return {
    getUserId: async () => 'user-1',
    coverage: async () => ({ data: searchableCoverage, error: null }),
    activeProfile: async () => ({
      data: {
        id: 'voyage-4:1024:ctx-v1',
        provider: 'voyage',
        provider_model: 'voyage-4',
        dimensions: 1024,
        input_profile: 'ctx-v1',
      },
      error: null,
    }),
    search: async () => ({ data: null, error: { code, message } }),
  }
}

describe('semantic search failure diagnostics', () => {
  it('identifies a search RPC failure without copying database text', async () => {
    const secret = 'private SQL details and query text'
    const diagnostic = vi.fn()

    await expect(
      runSemanticSearch(request, {
        db: dbWithSearchError(secret),
        embedQuery: async () => [0.1],
        diagnostic,
      }),
    ).resolves.toEqual({ ok: false, error: 'search_unavailable' })

    expect(diagnostic).toHaveBeenCalledWith({
      event: 'semantic_search_failure',
      stage: 'search_rpc',
      errorCode: 'search_unavailable',
      databaseCode: '42501',
      embeddingKind: null,
    })
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(secret)
  })

  it('reports a fixed embedding failure kind without copying provider text', async () => {
    const secret = 'provider response with an API key'
    const diagnostic = vi.fn()

    await expect(
      runSemanticSearch(request, {
        db: dbWithSearchError('not reached'),
        embedQuery: async () => {
          throw new EmbeddingError('rate_limited', secret)
        },
        diagnostic,
      }),
    ).resolves.toEqual({ ok: false, error: 'search_busy' })

    expect(diagnostic).toHaveBeenCalledWith({
      event: 'semantic_search_failure',
      stage: 'embedding',
      errorCode: 'search_busy',
      databaseCode: null,
      embeddingKind: 'rate_limited',
    })
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(secret)
  })
})
