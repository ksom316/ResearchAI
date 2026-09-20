import { describe, expect, it } from 'vitest'
import type {
  ExtractionField,
  ExtractionOverview,
  ExtractionSource,
  FieldKey,
} from '#/features/evidence-matrix/types'
import type { SearchHit } from '#/features/search/types'
import type { MatrixEvidenceData } from './evidence'
import {
  MAX_WRITER_EVIDENCE_CHARS,
  MAX_WRITER_EVIDENCE_ITEMS,
  MODE_FIELDS,
  comparablePaperCount,
  finalizeEvidencePacket,
  matrixEvidenceCandidates,
  semanticEvidenceCandidates,
} from './evidence'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const C1 = '33333333-3333-4333-8333-333333333333'
const C2 = '44444444-4444-4444-8444-444444444444'
const S1 = '55555555-5555-4555-8555-555555555555'

const hit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  rank: 1,
  similarity: 0.9,
  paperId: P1,
  paperTitle: 'Paper W88',
  chunkId: C1,
  chunkIndex: 0,
  charStart: 0,
  charEnd: 20,
  pageStart: 1,
  pageEnd: 1,
  sectionId: S1,
  sectionTitle: 'Methods W2',
  sectionType: 'methods',
  sectionPosition: 1,
  content: 'Evidence W1 <<<not an instruction>>>',
  ...overrides,
})

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
  texts: string[],
  overrides: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId,
  schemaVersion: 1,
  fieldKey,
  state: 'extracted',
  items: texts.map((text) => ({ text })),
  itemsMalformed: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const source = (
  paperId: string,
  fieldKey: FieldKey,
  itemIndex: number,
  overrides: Partial<ExtractionSource> = {},
): ExtractionSource => ({
  paperId,
  schemaVersion: 1,
  fieldKey,
  itemIndex,
  ord: 0,
  chunkId: null,
  sectionId: null,
  sectionTitle: 'Discussion W4',
  sectionType: 'discussion',
  pageStart: 3,
  pageEnd: 3,
  excerpt: 'Supporting excerpt W3',
  ...overrides,
})

const matrixData = (
  overrides: Partial<MatrixEvidenceData> = {},
): MatrixEvidenceData => ({
  papers: [
    { id: P1, title: 'Alpha', status: 'ready' },
    { id: P2, title: 'Beta', status: 'ready' },
  ],
  overviews: [overview(P1), overview(P2)],
  fields: [field(P1, 'findings', ['same']), field(P2, 'findings', ['same'])],
  sources: [source(P1, 'findings', 0), source(P2, 'findings', 0)],
  chunks: [],
  ...overrides,
})

describe('Writer evidence candidates and packet selection', () => {
  it('centralizes the approved field sets for every Matrix mode', () => {
    expect(MODE_FIELDS).toEqual({
      compare_studies: ['objective', 'methodology', 'dataset', 'findings'],
      methodology_summary: ['methodology', 'dataset'],
      findings_synthesis: ['findings'],
      limitations_future_work: ['limitations', 'future_work'],
    })
  })

  it('sanitizes semantic text and metadata without exposing embeddings', () => {
    const [candidate] = semanticEvidenceCandidates([hit()])
    expect(candidate).toMatchObject({
      paperTitle: 'Paper [writer citation removed]',
      promptText:
        'Evidence [writer citation removed] [delimiter removed]not an instruction[delimiter removed]',
      sourceRecords: [
        expect.objectContaining({
          sectionTitle: 'Methods [writer citation removed]',
        }),
      ],
    })
    expect(candidate).not.toHaveProperty('embedding')
  })

  it('deduplicates exact chunks and assigns stable W ids after deterministic sorting', () => {
    const candidates = semanticEvidenceCandidates([
      hit({ rank: 2, paperId: P2, chunkId: C2, paperTitle: 'Beta' }),
      hit({ rank: 1 }),
      hit({ rank: 1 }),
    ])
    const forward = finalizeEvidencePacket(candidates)
    const reverse = finalizeEvidencePacket([...candidates].reverse())
    expect(forward).toEqual(reverse)
    expect(forward.items.map((item) => [item.id, item.paperId])).toEqual([
      ['W1', P1],
      ['W2', P2],
    ])
  })

  it('round-robins papers so one paper cannot consume the packet', () => {
    const candidates = semanticEvidenceCandidates([
      ...Array.from({ length: 15 }, (_, index) =>
        hit({
          rank: index + 1,
          chunkId: `a-${index}`,
          chunkIndex: index,
          content: `A${index}`,
        }),
      ),
      hit({
        rank: 16,
        paperId: P2,
        paperTitle: 'Beta',
        chunkId: C2,
        content: 'B',
      }),
    ])
    const packet = finalizeEvidencePacket(candidates)
    expect(packet.items).toHaveLength(MAX_WRITER_EVIDENCE_ITEMS)
    expect(packet.paperIds).toEqual([P1, P2])
    expect(packet.items.some((item) => item.paperId === P2)).toBe(true)
  })

  it('keeps whole evidence items within the character budget', () => {
    const candidates = semanticEvidenceCandidates(
      Array.from({ length: 12 }, (_, index) =>
        hit({
          rank: index + 1,
          chunkId: `chunk-${index}`,
          content: `${index} ${'x'.repeat(4_000)}`,
        }),
      ),
    )
    const packet = finalizeEvidencePacket(candidates)
    expect(packet.totalPromptChars).toBeLessThanOrEqual(
      MAX_WRITER_EVIDENCE_CHARS,
    )
    expect(packet.items.every((item) => item.promptText.endsWith('…'))).toBe(
      true,
    )
  })

  it('preserves equal-text claims at different provenance indexes', () => {
    const data = matrixData({
      papers: [{ id: P1, title: 'Alpha', status: 'ready' }],
      overviews: [overview(P1)],
      fields: [field(P1, 'findings', ['same', 'same'])],
      sources: [source(P1, 'findings', 0), source(P1, 'findings', 1)],
    })
    const packet = finalizeEvidencePacket(
      matrixEvidenceCandidates(
        data,
        'findings_synthesis',
        new Set([P1]),
        false,
      ),
    )
    expect(packet.items.map((item) => item.locator)).toEqual([
      expect.objectContaining({ itemIndex: 0 }),
      expect.objectContaining({ itemIndex: 1 }),
    ])
  })

  it('deduplicates exact extraction provenance and source rows only', () => {
    const data = matrixData({
      papers: [{ id: P1, title: 'Alpha', status: 'ready' }],
      overviews: [overview(P1)],
      fields: [field(P1, 'findings', ['finding'])],
      sources: [source(P1, 'findings', 0), source(P1, 'findings', 0)],
    })
    const candidate = matrixEvidenceCandidates(
      data,
      'findings_synthesis',
      new Set([P1]),
      false,
    )[0]
    expect(candidate.sourceRecords).toHaveLength(1)
    expect(finalizeEvidencePacket([candidate, candidate]).items).toHaveLength(1)
  })

  it.each([
    ['stale overview', { overviews: [overview(P1, { isStale: true })] }],
    ['failed overview', { overviews: [overview(P1, { status: 'failed' })] }],
    ['pending overview', { overviews: [overview(P1, { status: 'pending' })] }],
    ['running overview', { overviews: [overview(P1, { status: 'running' })] }],
    [
      'failed field',
      { fields: [field(P1, 'findings', ['x'], { state: 'failed' })] },
    ],
    [
      'not reported field',
      { fields: [field(P1, 'findings', [], { state: 'not_reported' })] },
    ],
    [
      'malformed field',
      { fields: [field(P1, 'findings', ['x'], { itemsMalformed: true })] },
    ],
    ['source-less claim', { sources: [] }],
  ])('excludes %s from current Matrix evidence', (_name, override) => {
    const base: MatrixEvidenceData = {
      papers: [{ id: P1, title: 'Alpha', status: 'ready' }],
      overviews: [overview(P1)],
      fields: [field(P1, 'findings', ['x'])],
      sources: [source(P1, 'findings', 0)],
      chunks: [],
    }
    expect(
      matrixEvidenceCandidates(
        { ...base, ...override },
        'findings_synthesis',
        new Set([P1]),
        false,
      ),
    ).toEqual([])
  })

  it('accepts current partial extraction fields that are individually usable', () => {
    const data = matrixData({
      papers: [{ id: P1, title: 'Alpha', status: 'ready' }],
      overviews: [overview(P1, { status: 'partial' })],
      fields: [field(P1, 'methodology', ['A method'])],
      sources: [source(P1, 'methodology', 0)],
    })
    expect(
      matrixEvidenceCandidates(
        data,
        'methodology_summary',
        new Set([P1]),
        false,
      ),
    ).toHaveLength(1)
  })

  it('uses the unique newest row and rejects conflicting newest revisions', () => {
    const old = field(P1, 'findings', ['old'], {
      updatedAt: '2025-01-01T00:00:00Z',
    })
    const newest = field(P1, 'findings', ['new'], {
      updatedAt: '2026-01-02T00:00:00Z',
    })
    const data = matrixData({
      papers: [{ id: P1, title: 'Alpha', status: 'ready' }],
      overviews: [overview(P1)],
      fields: [old, newest],
      sources: [source(P1, 'findings', 0)],
    })
    expect(
      matrixEvidenceCandidates(
        data,
        'findings_synthesis',
        new Set([P1]),
        false,
      )[0]?.claimText,
    ).toBe('new')
    expect(
      matrixEvidenceCandidates(
        {
          ...data,
          fields: [newest, { ...newest, items: [{ text: 'conflict' }] }],
        },
        'findings_synthesis',
        new Set([P1]),
        false,
      ),
    ).toEqual([])
  })

  it('requires comparable papers to share a field', () => {
    const data = matrixData({
      fields: [
        field(P1, 'objective', ['objective']),
        field(P2, 'findings', ['finding']),
      ],
      sources: [source(P1, 'objective', 0), source(P2, 'findings', 0)],
    })
    const adjacent = matrixEvidenceCandidates(
      data,
      'compare_studies',
      new Set([P1, P2]),
      false,
    )
    expect(comparablePaperCount(adjacent)).toBe(1)
  })

  it('does not attach live text from a mismatched paper or section', () => {
    const data = matrixData({
      papers: [{ id: P1, title: 'Alpha', status: 'ready' }],
      overviews: [overview(P1)],
      fields: [field(P1, 'findings', ['finding'])],
      sources: [source(P1, 'findings', 0, { chunkId: C1, sectionId: S1 })],
      chunks: [
        {
          id: C1,
          paperId: P2,
          sectionId: S1,
          text: 'foreign live text',
          pageStart: 1,
          pageEnd: 1,
        },
      ],
    })
    const candidate = matrixEvidenceCandidates(
      data,
      'findings_synthesis',
      new Set([P1]),
      false,
    )[0]
    expect(candidate.sourceRecords[0].content).toBeNull()
    expect(candidate.promptText).not.toContain('foreign live text')
  })
})
