import { describe, expect, it, vi } from 'vitest'
import type {
  ExtractionField,
  ExtractionOverview,
  ExtractionSource,
  FieldKey,
} from '#/features/evidence-matrix/types'
import type { SearchHit, SearchOutcome } from '#/features/search/types'
import type { WriterPaper } from './evidence'
import { prepareWriterEvidence } from './writer-service'
import type { WriterDb } from './writer-db.server'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'
const FOREIGN = '44444444-4444-4444-8444-444444444444'

const papers: WriterPaper[] = [
  { id: P1, title: 'Alpha', status: 'ready' },
  { id: P2, title: 'Beta', status: 'ready' },
]

const overview = (
  paperId: string,
  overrides: Partial<ExtractionOverview> = {},
): ExtractionOverview => ({
  paperId,
  schemaVersion: 1,
  status: 'complete',
  sourceCompletedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:00:00Z',
  provider: 'test',
  model: 'test',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  isStale: false,
  ...overrides,
})

const field = (
  paperId: string,
  fieldKey: FieldKey,
  text: string,
): ExtractionField => ({
  paperId,
  schemaVersion: 1,
  fieldKey,
  state: 'extracted',
  items: [{ text }],
  itemsMalformed: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})

const source = (paperId: string, fieldKey: FieldKey): ExtractionSource => ({
  paperId,
  schemaVersion: 1,
  fieldKey,
  itemIndex: 0,
  ord: 0,
  chunkId: null,
  sectionId: null,
  sectionTitle: 'Results',
  sectionType: 'results',
  pageStart: 1,
  pageEnd: 1,
  excerpt: 'source support',
})

function fakeDb(overrides: Partial<WriterDb> = {}): WriterDb {
  const fields = [
    field(P1, 'objective', 'objective one'),
    field(P2, 'objective', 'objective two'),
    field(P1, 'methodology', 'method one'),
    field(P2, 'methodology', 'method two'),
    field(P1, 'dataset', 'dataset one'),
    field(P2, 'dataset', 'dataset two'),
    field(P1, 'findings', 'finding one'),
    field(P2, 'findings', 'finding two'),
    field(P1, 'limitations', 'limitation one'),
    field(P2, 'limitations', 'limitation two'),
    field(P1, 'future_work', 'future one'),
    field(P2, 'future_work', 'future two'),
  ]
  return {
    getUserId: async () => 'user-1',
    getProject: async () => ({ id: PROJECT, title: 'Project' }),
    listProjectPapers: async () => papers,
    listExtractionOverviews: async () => [overview(P1), overview(P2)],
    listExtractionFields: async (_ids, fieldKeys) =>
      fields.filter((item) => fieldKeys.includes(item.fieldKey)),
    listExtractionSources: async (_ids, fieldKeys) =>
      fields
        .filter((item) => fieldKeys.includes(item.fieldKey))
        .map((item) => source(item.paperId, item.fieldKey)),
    listChunks: async () => [],
    listSections: async () => [],
    ...overrides,
  }
}

const searchHit = (
  rank: number,
  paperId: string,
  chunkId: string,
): SearchHit => ({
  rank,
  similarity: 0.9,
  paperId,
  paperTitle: paperId === P1 ? 'Alpha' : 'Beta',
  chunkId,
  chunkIndex: rank,
  charStart: 0,
  charEnd: 10,
  pageStart: 1,
  pageEnd: 1,
  sectionId: `${chunkId}-section`,
  sectionTitle: 'Introduction',
  sectionType: 'introduction',
  sectionPosition: 0,
  content: `evidence ${rank}`,
})

const searchResult = (
  results: SearchHit[],
  states: Array<'searchable' | 'index_stale'> = ['searchable', 'searchable'],
): SearchOutcome => ({
  ok: true,
  status: results.length ? 'results' : 'nothing_searchable',
  results,
  coverage: states.map((state, index) => ({
    paperId: index === 0 ? P1 : P2,
    paperTitle: index === 0 ? 'Alpha' : 'Beta',
    state,
    chunkCount: state === 'searchable' ? 1 : 0,
  })),
})

const noSearch = vi.fn(async (): Promise<SearchOutcome> => searchResult([]))

describe('prepareWriterEvidence', () => {
  it('rejects invalid input before touching authentication', async () => {
    const getUserId = vi.fn(async () => 'user')
    const result = await prepareWriterEvidence(
      { projectId: 'bad', mode: 'methodology_summary' },
      { db: fakeDb({ getUserId }), semanticSearch: noSearch },
    )
    expect(result).toEqual({ ok: false, error: 'invalid_request' })
    expect(getUserId).not.toHaveBeenCalled()
  })

  it('fails safely for unauthenticated, missing, and foreign projects', async () => {
    await expect(
      prepareWriterEvidence(
        { projectId: PROJECT, mode: 'methodology_summary' },
        {
          db: fakeDb({ getUserId: async () => null }),
          semanticSearch: noSearch,
        },
      ),
    ).resolves.toEqual({ ok: false, error: 'unauthenticated' })

    for (const getProject of [async () => null, async () => null]) {
      await expect(
        prepareWriterEvidence(
          { projectId: PROJECT, mode: 'methodology_summary' },
          { db: fakeDb({ getProject }), semanticSearch: noSearch },
        ),
      ).resolves.toEqual({ ok: false, error: 'scope_not_found' })
    }
  })

  it('rejects an entirely invalid or mixed explicit paper selection', async () => {
    for (const paperIds of [
      [P1, FOREIGN],
      [P1, '55555555-5555-4555-8555-555555555555'],
    ]) {
      const result = await prepareWriterEvidence(
        { projectId: PROJECT, mode: 'compare_studies', paperIds },
        { db: fakeDb(), semanticSearch: noSearch },
      )
      expect(result).toEqual({ ok: false, error: 'scope_not_found' })
    }
  })

  it('passes a project-only, reference-excluding bounded search request', async () => {
    const semanticSearch = vi.fn(async () =>
      searchResult([searchHit(1, P1, 'chunk-1'), searchHit(2, P2, 'chunk-2')]),
    )
    const result = await prepareWriterEvidence(
      {
        projectId: PROJECT,
        mode: 'literature_synthesis',
        focus: ' table recognition ',
      },
      { db: fakeDb(), semanticSearch },
    )
    expect(result.ok && result.status).toBe('ready')
    expect(semanticSearch).toHaveBeenCalledWith({
      query: 'table recognition',
      scope: { type: 'project', projectId: PROJECT },
      limit: 24,
      minSimilarity: null,
      includeReferences: false,
    })
    if (result.ok && result.status === 'ready') {
      expect(result.evidence.paperIds).toEqual([P1, P2])
      expect(result.evidence.items).toHaveLength(2)
    }
  })

  it('requires semantic support from at least two distinct papers', async () => {
    const result = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'literature_synthesis', focus: 'tables' },
      {
        db: fakeDb(),
        semanticSearch: async () =>
          searchResult([
            searchHit(1, P1, 'chunk-1'),
            searchHit(2, P1, 'chunk-2'),
          ]),
      },
    )
    expect(result.ok && result.status).toBe('insufficient_evidence')
  })

  it('reports stale-only semantic coverage without evidence', async () => {
    const result = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'literature_synthesis', focus: 'tables' },
      {
        db: fakeDb(),
        semanticSearch: async () =>
          searchResult([], ['index_stale', 'index_stale']),
      },
    )
    expect(result.ok && result.status).toBe('stale_only')
  })

  it.each([
    'methodology_summary',
    'findings_synthesis',
    'limitations_future_work',
  ] as const)('prepares authorized Matrix evidence for %s', async (mode) => {
    const result = await prepareWriterEvidence(
      { projectId: PROJECT, mode },
      { db: fakeDb(), semanticSearch: noSearch },
    )
    expect(result.ok && result.status).toBe('ready')
    if (result.ok && result.status === 'ready') {
      expect(result.coverage.participatingPaperCount).toBe(2)
      expect(result.evidence.items.every((item) => !item.isStale)).toBe(true)
      expect(result.evidence.items[0]).not.toHaveProperty('embedding')
    }
  })

  it('requires two selected papers with a comparable field', async () => {
    const onlyAdjacent = fakeDb({
      listExtractionFields: async () => [
        field(P1, 'objective', 'objective'),
        field(P2, 'findings', 'finding'),
      ],
      listExtractionSources: async () => [
        source(P1, 'objective'),
        source(P2, 'findings'),
      ],
    })
    const result = await prepareWriterEvidence(
      {
        projectId: PROJECT,
        mode: 'compare_studies',
        paperIds: [P1, P2],
      },
      { db: onlyAdjacent, semanticSearch: noSearch },
    )
    expect(result.ok && result.status).toBe('insufficient_evidence')
  })

  it('requires source-backed methodology rather than dataset-only evidence', async () => {
    const result = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'methodology_summary', paperIds: [P1] },
      {
        db: fakeDb({
          listExtractionFields: async () => [field(P1, 'dataset', 'dataset')],
          listExtractionSources: async () => [source(P1, 'dataset')],
        }),
        semanticSearch: noSearch,
      },
    )
    expect(result.ok && result.status).toBe('insufficient_evidence')
  })

  it('distinguishes no evidence, stale-only, and insufficient multi-paper evidence', async () => {
    const noEvidence = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'findings_synthesis' },
      {
        db: fakeDb({
          listExtractionFields: async () => [],
          listExtractionSources: async () => [],
        }),
        semanticSearch: noSearch,
      },
    )
    expect(noEvidence.ok && noEvidence.status).toBe('no_evidence')

    const stale = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'findings_synthesis' },
      {
        db: fakeDb({
          listExtractionOverviews: async () => [
            overview(P1, { isStale: true }),
            overview(P2, { isStale: true }),
          ],
        }),
        semanticSearch: noSearch,
      },
    )
    expect(stale.ok && stale.status).toBe('stale_only')

    const onePaper = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'findings_synthesis' },
      {
        db: fakeDb({
          listExtractionFields: async () => [field(P1, 'findings', 'one')],
          listExtractionSources: async () => [source(P1, 'findings')],
        }),
        semanticSearch: noSearch,
      },
    )
    expect(onePaper.ok && onePaper.status).toBe('insufficient_evidence')
  })

  it('returns safe retrieval errors and never leaks thrown database details', async () => {
    const result = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'methodology_summary' },
      {
        db: fakeDb({
          listProjectPapers: async () => {
            throw new Error('secret internal details')
          },
        }),
        semanticSearch: noSearch,
      },
    )
    expect(result).toEqual({ ok: false, error: 'retrieval_unavailable' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it.each([
    ['search_busy', 'retrieval_busy'],
    ['search_unavailable', 'retrieval_unavailable'],
  ] as const)('maps semantic %s safely', async (searchError, expected) => {
    const result = await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'literature_synthesis', focus: 'tables' },
      {
        db: fakeDb(),
        semanticSearch: async () => ({ ok: false, error: searchError }),
      },
    )
    expect(result).toEqual({ ok: false, error: expected })
  })

  it('does not call semantic search for Matrix modes', async () => {
    const semanticSearch = vi.fn(noSearch)
    await prepareWriterEvidence(
      { projectId: PROJECT, mode: 'methodology_summary' },
      { db: fakeDb(), semanticSearch },
    )
    expect(semanticSearch).not.toHaveBeenCalled()
  })
})
