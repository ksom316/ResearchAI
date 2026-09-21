import { describe, expect, it, vi } from 'vitest'
import { runSearchCoverage } from '#/features/search/search-service'

const projectId = '11111111-1111-4111-8111-111111111111'

describe('quality inspector search coverage adapter', () => {
  it('maps authenticated RPC rows without exposing vector data', async () => {
    const coverage = vi.fn().mockResolvedValue({
      data: [{
        paper_id: 'p1', paper_title: 'Paper', state: 'not_indexed', chunk_count: 4,
      }],
      error: null,
    })
    const result = await runSearchCoverage(
      { projectId },
      { getUserId: vi.fn().mockResolvedValue('user'), coverage },
    )
    expect(result).toEqual({
      ok: true,
      coverage: [{ paperId: 'p1', paperTitle: 'Paper', state: 'not_indexed', chunkCount: 4 }],
    })
    expect(coverage).toHaveBeenCalledWith({ paperIds: null, projectId })
    expect(JSON.stringify(result)).not.toMatch(/vector|embedding/iu)
  })

  it('rejects invalid, unauthenticated, inaccessible, and malformed requests safely', async () => {
    const coverage = vi.fn()
    expect(await runSearchCoverage({ projectId: 'bad' }, { getUserId: vi.fn(), coverage })).toEqual({ ok: false, error: 'invalid_request' })
    expect(await runSearchCoverage({ projectId }, { getUserId: vi.fn().mockResolvedValue(null), coverage })).toEqual({ ok: false, error: 'unauthenticated' })
    expect(await runSearchCoverage({ projectId }, {
      getUserId: vi.fn().mockResolvedValue('user'),
      coverage: vi.fn().mockResolvedValue({ data: null, error: { message: 'search_scope_not_found' } }),
    })).toEqual({ ok: false, error: 'scope_not_found' })
    expect(await runSearchCoverage({ projectId }, {
      getUserId: vi.fn().mockResolvedValue('user'),
      coverage: vi.fn().mockResolvedValue({ data: [{ unsafe: true }], error: null }),
    })).toEqual({ ok: false, error: 'search_unavailable' })
  })
})
