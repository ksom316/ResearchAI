import { describe, expect, it, vi } from 'vitest'
import { createSupabaseSearchDb } from './search-db'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const PAPER_ID = '22222222-2222-4222-8222-222222222222'

describe('Supabase semantic search database adapter', () => {
  it('preserves the authenticated client and exact RPC contracts', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }))
    const getUser = vi.fn(async () => ({
      data: { user: { id: 'actor-1' } },
      error: null,
    }))
    const db = createSupabaseSearchDb({ auth: { getUser }, rpc } as never)

    await expect(db.getUserId()).resolves.toBe('actor-1')
    await db.coverage({ paperIds: [PAPER_ID], projectId: PROJECT_ID })
    await db.search({
      queryEmbedding: [0.1, 0.2],
      expectedModelId: 'voyage-4:1024:ctx-v1',
      paperIds: [PAPER_ID],
      projectId: PROJECT_ID,
      limit: 8,
      minSimilarity: 0.25,
      includeReferences: false,
    })

    expect(getUser).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_search_coverage', {
      p_paper_ids: [PAPER_ID],
      p_project_id: PROJECT_ID,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'search_paper_chunks', {
      p_query_embedding: [0.1, 0.2],
      p_expected_model_id: 'voyage-4:1024:ctx-v1',
      p_paper_ids: [PAPER_ID],
      p_project_id: PROJECT_ID,
      p_limit: 8,
      p_min_similarity: 0.25,
      p_include_references: false,
    })
  })
})
