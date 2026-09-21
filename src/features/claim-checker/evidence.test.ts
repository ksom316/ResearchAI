import { describe, expect, it, vi } from 'vitest'
import type { WriterDb } from '#/features/writer/writer-db.server'
import { MAX_CLAIM_CHECK_EVIDENCE_CHARS, prepareClaimCheckEvidence } from './evidence'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'
const CHUNK1 = '44444444-4444-4444-8444-444444444444'
const CHUNK2 = '55555555-5555-4555-8555-555555555555'
const SECTION1 = '66666666-6666-4666-8666-666666666666'
const SECTION2 = '77777777-7777-4777-8777-777777777777'

const overview = (paperId: string, overrides = {}) => ({
  paperId,
  schemaVersion: 1,
  status: 'complete' as const,
  sourceCompletedAt: '2026-01-01',
  completedAt: '2026-01-01',
  provider: null,
  model: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  isStale: false,
  ...overrides,
})

const field = (paperId: string, items = [{ text: 'Extracted finding.' }], overrides = {}) => ({
  paperId,
  schemaVersion: 1,
  fieldKey: 'findings' as const,
  state: 'extracted' as const,
  items,
  itemsMalformed: false,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
})

const source = (paperId: string, itemIndex = 0, ord = 0, excerpt = 'Source support.') => ({
  paperId,
  schemaVersion: 1,
  fieldKey: 'findings' as const,
  itemIndex,
  ord,
  chunkId: paperId === P1 ? CHUNK1 : CHUNK2,
  sectionId: paperId === P1 ? SECTION1 : SECTION2,
  sectionTitle: 'Results',
  sectionType: 'results',
  pageStart: 3,
  pageEnd: 3,
  excerpt,
})

function db(overrides: Partial<WriterDb> = {}): WriterDb {
  const chunks = [
    { id: CHUNK1, paperId: P1, sectionId: SECTION1, text: 'Live source C1 W1.', pageStart: 3, pageEnd: 3 },
    { id: CHUNK2, paperId: P2, sectionId: SECTION2, text: 'Second live source.', pageStart: 4, pageEnd: 4 },
  ]
  return {
    getUserId: vi.fn(async () => 'user'),
    getProject: vi.fn(async () => ({ id: PROJECT, title: 'Project' })),
    listProjectPapers: vi.fn(async () => [
      { id: P1, title: 'Server Paper One', status: 'ready' as const },
      { id: P2, title: 'Server Paper Two', status: 'ready' as const },
    ]),
    listExtractionOverviews: vi.fn(async () => [overview(P1), overview(P2)]),
    listExtractionFields: vi.fn(async () => [field(P1), field(P2)]),
    listExtractionSources: vi.fn(async () => [source(P1), source(P2)]),
    listChunks: vi.fn(async (ids) => chunks.filter((chunk) => ids.includes(chunk.id))),
    listSections: vi.fn(async (ids) => [
      { id: SECTION1, paperId: P1, title: 'Methods C2', sectionType: 'methods', pageStart: 2, pageEnd: 3 },
      { id: SECTION2, paperId: P2, title: 'Results', sectionType: 'results', pageStart: 4, pageEnd: 4 },
    ].filter((section) => ids.includes(section.id))),
    ...overrides,
  }
}

const chunkCitation = {
  citationId: 'W1',
  locator: { kind: 'chunk' as const, paperId: P1, chunkId: CHUNK1, sectionId: SECTION1 },
}
const extractionCitation = {
  citationId: 'W2',
  locator: {
    kind: 'extraction_claim' as const,
    paperId: P2,
    schemaVersion: 1,
    fieldKey: 'findings' as const,
    itemIndex: 0,
  },
}
const request = {
  projectId: PROJECT,
  claimId: 'U1',
  claimText: 'Generated claim C9 W9.',
  citations: [chunkCitation, extractionCitation],
}

describe('Claim Checker evidence preparation', () => {
  it('batch-resolves current chunk and extraction evidence with deterministic C ids', async () => {
    const result = await prepareClaimCheckEvidence(request, { db: db() })
    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      request: { claimId: 'U1' },
      evidence: {
        items: [
          { id: 'C1', writerCitationId: 'W1', paperTitle: 'Server Paper One', claimText: null },
          { id: 'C2', writerCitationId: 'W2', paperTitle: 'Server Paper Two', claimText: 'Extracted finding.' },
        ],
      },
    })
    if (!result.ok || result.status !== 'ready') return
    expect(result.evidence.claimText).not.toMatch(/C9|W9/)
    expect(JSON.stringify(result.evidence.items)).not.toMatch(/C1 W1|Methods C2/)
    expect(result.evidence.totalPromptEvidenceChars).toBeGreaterThan(0)
  })

  it('accepts current partial extraction evidence', async () => {
    const result = await prepareClaimCheckEvidence(
      { ...request, citations: [extractionCitation] },
      { db: db({ listExtractionOverviews: vi.fn(async () => [overview(P2, { status: 'partial' as const })]) }) },
    )
    expect(result).toMatchObject({ ok: true, status: 'ready' })
  })

  it.each([
    ['stale_evidence', db({ listExtractionOverviews: vi.fn(async () => [overview(P2, { isStale: true })]) })],
    ['no_usable_source', db({ listExtractionFields: vi.fn(async () => [field(P2, [], { itemsMalformed: true })]) })],
    ['no_usable_source', db({ listExtractionSources: vi.fn(async () => []) })],
  ] as const)('abstains with %s for unusable extraction evidence', async (reason, mocked) => {
    const result = await prepareClaimCheckEvidence(
      { ...request, citations: [extractionCitation] },
      { db: mocked },
    )
    expect(result).toMatchObject({ ok: true, status: 'insufficient_evidence', reason })
  })

  it('abstains when a chunk disappeared or its paper is not ready', async () => {
    const missing = await prepareClaimCheckEvidence(
      { ...request, citations: [chunkCitation] },
      { db: db({ listChunks: vi.fn(async () => []) }) },
    )
    expect(missing).toMatchObject({ ok: true, reason: 'evidence_missing' })

    const notReady = await prepareClaimCheckEvidence(
      { ...request, citations: [chunkCitation] },
      { db: db({ listProjectPapers: vi.fn(async () => [{ id: P1, title: 'Paper', status: 'processing' as const }]) }) },
    )
    expect(notReady).toMatchObject({ ok: true, reason: 'paper_not_ready' })
  })

  it('returns safe auth/scope errors and fails a mixed unlinked request entirely', async () => {
    const unauthenticated = await prepareClaimCheckEvidence(request, {
      db: db({ getUserId: vi.fn(async () => null) }),
    })
    expect(unauthenticated).toEqual({ ok: false, error: 'unauthenticated' })

    const missingProject = await prepareClaimCheckEvidence(request, {
      db: db({ getProject: vi.fn(async () => null) }),
    })
    expect(missingProject).toEqual({ ok: false, error: 'scope_not_found' })

    const mixed = await prepareClaimCheckEvidence(request, {
      db: db({ listProjectPapers: vi.fn(async () => [{ id: P1, title: 'Paper', status: 'ready' as const }]) }),
    })
    expect(mixed).toEqual({ ok: false, error: 'scope_not_found' })
  })

  it('never drops citations when the complete packet exceeds the budget', async () => {
    const citations = Array.from({ length: 4 }, (_, itemIndex) => ({
      citationId: `W${itemIndex + 1}`,
      locator: {
        kind: 'extraction_claim' as const,
        paperId: P1,
        schemaVersion: 1,
        fieldKey: 'findings' as const,
        itemIndex,
      },
    }))
    const long = 'e'.repeat(5_000)
    const fields = field(P1, Array.from({ length: 4 }, () => ({ text: long })))
    const sources = citations.flatMap((_, itemIndex) =>
      Array.from({ length: 3 }, (__, ord) => source(P1, itemIndex, ord, long)),
    )
    const result = await prepareClaimCheckEvidence(
      { ...request, citations },
      {
        db: db({
          listExtractionOverviews: vi.fn(async () => [overview(P1)]),
          listExtractionFields: vi.fn(async () => [fields]),
          listExtractionSources: vi.fn(async () => sources),
          listChunks: vi.fn(async () => []),
        }),
      },
    )
    expect(result).toMatchObject({
      ok: true,
      status: 'insufficient_evidence',
      reason: 'evidence_budget_exceeded',
    })
    expect(result).not.toHaveProperty('evidence.items')
    expect(MAX_CLAIM_CHECK_EVIDENCE_CHARS).toBe(10_000)
  })
})
