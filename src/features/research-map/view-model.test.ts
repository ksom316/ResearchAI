import { describe, expect, it } from 'vitest'
import type { Paper } from '#/features/papers/types'
import type {
  ExtractionField,
  ExtractionOverview,
  FieldKey,
} from '#/features/evidence-matrix/types'
import { deriveResearchMap } from './derive'
import {
  buildPaperSummaries,
  buildTermIndex,
  deriveResearchMapState,
  filterPaperSummaries,
  filterTermIndex,
  makeEvidenceSelection,
} from './view-model'

const P1 = 'p1'
const P2 = 'p2'
const P3 = 'p3'

const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  id,
  project_ids: ['proj'],
  title: `Paper ${id}`,
  authors: [],
  publication_year: null,
  original_filename: null,
  mime_type: null,
  storage_path: null,
  content_hash: null,
  file_size_bytes: null,
  status: 'ready',
  page_count: null,
  processing_error: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})
const overview = (
  paperId: string,
  over: Partial<ExtractionOverview> = {},
): ExtractionOverview => ({
  paperId,
  schemaVersion: 1,
  status: 'complete',
  sourceCompletedAt: 'a',
  completedAt: 'b',
  provider: null,
  model: null,
  createdAt: 'c',
  updatedAt: 'd',
  isStale: false,
  ...over,
})
const field = (
  paperId: string,
  fieldKey: FieldKey,
  texts: string[],
  over: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId,
  schemaVersion: 1,
  fieldKey,
  state: 'extracted',
  items: texts.map((text) => ({ text })),
  itemsMalformed: false,
  createdAt: 'x',
  updatedAt: 'y',
  ...over,
})

/** BERT-like fixture: two related papers sharing a concept, methodology and finding-only paper. */
function bertLikeFixture() {
  const papers = [paper(P1, { title: 'test research' }), paper(P2, { title: 'RoBERTa' }), paper(P3, { title: 'Tables To Latex' })]
  const overviews = [overview(P1), overview(P2), overview(P3)]
  const fields = [
    field(P1, 'concepts', ['Masked language modeling randomly masks tokens.', 'Fine-tuning keeps the pretrained architecture.']),
    field(P2, 'concepts', ['We evaluate masked language modeling.', 'Fine-tuning is central to our approach.']),
    field(P1, 'methodology', ['We build on BERT for classification.']),
    field(P2, 'methodology', ['We reimplement BERT with tuned hyperparameters.']),
    field(P3, 'concepts', ['Tabular processing is divided into three stages.']),
    field(P3, 'findings', ['Accuracy improved by 5 points.', 'Latency dropped by half.']),
  ]
  return deriveResearchMap({ papers, overviews, fields })
}

describe('buildTermIndex', () => {
  const map = bertLikeFixture()
  const fields = [
    field(P1, 'concepts', ['Masked language modeling randomly masks tokens.', 'Fine-tuning keeps the pretrained architecture.']),
    field(P2, 'concepts', ['We evaluate masked language modeling.', 'Fine-tuning is central to our approach.']),
    field(P1, 'methodology', ['We build on BERT for classification.']),
    field(P2, 'methodology', ['We reimplement BERT with tuned hyperparameters.']),
  ]
  const index = buildTermIndex(map, fields)

  it('lists each shared term under its correct kind', () => {
    const byLabel = new Map(index.map((e) => [e.label.toLowerCase(), e.kind]))
    expect(byLabel.get('masked language modeling')).toBe('concept')
    expect(byLabel.get('fine-tuning')).toBe('concept')
    expect(byLabel.get('bert')).toBe('methodology')
    expect(index.every((e) => e.fieldKey === (e.kind === 'concept' ? 'concepts' : e.kind))).toBe(true)
  })

  it('never exposes the normalized key or a raw evidence id on an entry', () => {
    for (const e of index) {
      expect(e).not.toHaveProperty('key')
      expect(Object.keys(e)).toEqual(['id', 'kind', 'label', 'fieldKey', 'papers', 'hasStaleEvidence'])
    }
  })

  it('lists the connected papers with their claim text resolved, sorted by title', () => {
    const bert = index.find((e) => e.label === 'BERT')!
    expect(bert.papers.map((p) => p.title)).toEqual(['RoBERTa', 'test research']) // "RoBERTa" < "test research"
    const p1side = bert.papers.find((p) => p.paperId === P1)!
    expect(p1side.evidence).toEqual([
      { itemIndex: 0, matchedPhrase: 'BERT', claimText: 'We build on BERT for classification.' },
    ])
  })

  it('is deterministic regardless of node/edge order in the map', () => {
    const reordered = { ...map, nodes: [...map.nodes].reverse(), edges: [...map.edges].reverse() }
    expect(buildTermIndex(reordered, fields)).toEqual(index)
  })
})

describe('buildPaperSummaries', () => {
  const map = bertLikeFixture()
  const fields = [
    field(P3, 'concepts', ['Tabular processing is divided into three stages.']),
    field(P3, 'findings', ['Accuracy improved by 5 points.', 'Latency dropped by half.']),
  ]
  const rows = buildPaperSummaries(map, fields)

  it('produces one row per paper with correct relationship counts', () => {
    const bert = rows.find((r) => r.title === 'test research')!
    expect(bert.concepts.map((c) => c.label).sort()).toEqual(['Fine-tuning', 'Masked language modeling'])
    expect(bert.methodologies.map((c) => c.label)).toEqual(['BERT'])
    expect(bert.datasets).toEqual([])
    expect(bert.findings).toEqual([])
    expect(bert.contributes).toBe(true)
  })

  it('gives an isolated-by-terms paper (still has findings) a normal, non-empty row', () => {
    const tables = rows.find((r) => r.title === 'Tables To Latex')!
    expect(tables.concepts).toEqual([])
    expect(tables.methodologies).toEqual([])
    expect(tables.datasets).toEqual([])
    expect(tables.contributes).toBe(true) // contributes via findings
    expect(tables.findings.map((f) => f.text)).toEqual(['Accuracy improved by 5 points.', 'Latency dropped by half.'])
  })

  it('a fully isolated paper (no terms, no findings) still gets a row, not an error', () => {
    const map2 = deriveResearchMap({
      papers: [paper(P1), paper(P2), paper('lonely', { title: 'Lonely Paper' })],
      overviews: [overview(P1), overview(P2), overview('lonely')],
      fields: [
        field(P1, 'concepts', ['We build on BERT.']),
        field(P2, 'concepts', ['BERT is widely used.']),
      ],
    })
    const row = buildPaperSummaries(map2, []).find((r) => r.paperId === 'lonely')!
    expect(row).toMatchObject({ concepts: [], methodologies: [], datasets: [], findings: [], contributes: false })
  })

  it('findings remain paper-specific: identical finding text in two papers stays on separate rows', () => {
    const map2 = deriveResearchMap({
      papers: [paper(P1), paper(P2)],
      overviews: [overview(P1), overview(P2)],
      fields: [field(P1, 'findings', ['Accuracy improved.']), field(P2, 'findings', ['Accuracy improved.'])],
    })
    const rows2 = buildPaperSummaries(map2, [field(P1, 'findings', ['Accuracy improved.']), field(P2, 'findings', ['Accuracy improved.'])])
    expect(rows2.find((r) => r.paperId === P1)!.findings).toHaveLength(1)
    expect(rows2.find((r) => r.paperId === P2)!.findings).toHaveLength(1)
    expect(rows2.find((r) => r.paperId === P1)!.findings[0].id).not.toBe(rows2.find((r) => r.paperId === P2)!.findings[0].id)
  })

  it('carries current/stale status through from the paper node', () => {
    const map2 = deriveResearchMap({
      papers: [paper(P1), paper(P2)],
      overviews: [overview(P1, { isStale: true }), overview(P2)],
      fields: [],
    })
    const rows2 = buildPaperSummaries(map2, [])
    expect(rows2.find((r) => r.paperId === P1)).toMatchObject({ statusKey: 'out_of_date', isStale: true })
    expect(rows2.find((r) => r.paperId === P2)).toMatchObject({ statusKey: 'extracted', isStale: false })
  })

  it('orders rows by title deterministically, independent of node order', () => {
    expect(rows.map((r) => r.title)).toEqual([...rows.map((r) => r.title)].sort((a, b) => a.localeCompare(b)))
    const reordered = { ...map, nodes: [...map.nodes].reverse() }
    expect(buildPaperSummaries(reordered, fields)).toEqual(rows)
  })

  it('a missing claim (data no longer available) resolves to an empty string, not a crash', () => {
    const row = buildPaperSummaries(map, []).find((r) => r.title === 'test research')!
    expect(row.concepts.every((c) => c.evidence.every((e) => e.claimText === ''))).toBe(true)
  })
})

describe('filterTermIndex', () => {
  const map = bertLikeFixture()
  const index = buildTermIndex(map, [])

  it('filters by kind', () => {
    expect(filterTermIndex(index, { kind: 'methodology', search: '', hideStale: false }).every((e) => e.kind === 'methodology')).toBe(true)
    expect(filterTermIndex(index, { kind: 'dataset', search: '', hideStale: false })).toEqual([])
  })

  it('filters by search text across label and connected paper titles', () => {
    // "bert" matches the BERT term by label, AND matches "RoBERTa" as a connected paper
    // title substring, so terms connected to RoBERTa also match.
    expect(filterTermIndex(index, { kind: 'all', search: 'bert', hideStale: false }).map((e) => e.label).sort()).toEqual(
      ['BERT', 'Fine-tuning', 'Masked language modeling'].sort(),
    )
    expect(filterTermIndex(index, { kind: 'methodology', search: 'bert', hideStale: false }).map((e) => e.label)).toEqual(['BERT'])
    expect(filterTermIndex(index, { kind: 'all', search: 'nonexistent-xyz', hideStale: false })).toEqual([])
  })

  it('hides stale-derived entries only when asked', () => {
    const staleMap = deriveResearchMap({
      papers: [paper(P1), paper(P2)],
      overviews: [overview(P1, { isStale: true }), overview(P2)],
      fields: [field(P1, 'concepts', ['We build on BERT.']), field(P2, 'concepts', ['BERT is widely used.'])],
    })
    const staleIndex = buildTermIndex(staleMap, [])
    expect(filterTermIndex(staleIndex, { kind: 'all', search: '', hideStale: false })).toHaveLength(1)
    expect(filterTermIndex(staleIndex, { kind: 'all', search: '', hideStale: true })).toEqual([])
  })
})

describe('filterPaperSummaries', () => {
  const map = bertLikeFixture()
  const rows = buildPaperSummaries(map, [])

  it('matches by title or by a connected term label', () => {
    expect(filterPaperSummaries(rows, 'tables').map((r) => r.title)).toEqual(['Tables To Latex'])
    expect(filterPaperSummaries(rows, 'bert').map((r) => r.title).sort()).toEqual(['RoBERTa', 'test research'])
    expect(filterPaperSummaries(rows, '')).toEqual(rows)
    expect(filterPaperSummaries(rows, 'zzz-none')).toEqual([])
  })
})

describe('makeEvidenceSelection', () => {
  it('builds the plain selection object', () => {
    expect(makeEvidenceSelection('p', 'Title', 'findings', 'Finding 1', [{ itemIndex: 0, matchedPhrase: null, claimText: 'x' }])).toEqual({
      paperId: 'p',
      paperTitle: 'Title',
      isStale: false,
      fieldKey: 'findings',
      contextLabel: 'Finding 1',
      items: [{ itemIndex: 0, matchedPhrase: null, claimText: 'x' }],
    })
  })

  it('preserves stale state for provenance views', () => {
    expect(
      makeEvidenceSelection('p', 'Title', 'concepts', 'BERT', [], true)
        .isStale,
    ).toBe(true)
  })
})

describe('deriveResearchMapState', () => {
  const ok = <T,>(data: T) => ({ data, error: null, isPending: false })
  const pending = { data: undefined, error: null, isPending: true }
  const fail = (m: string) => ({ data: undefined, error: new Error(m), isPending: false })

  it('loading while papers load, empty with no papers, error on failure, ready when joined', () => {
    expect(deriveResearchMapState({ papers: pending, overviews: pending, fields: pending })).toEqual({ kind: 'loading' })
    expect(deriveResearchMapState({ papers: ok([]), overviews: pending, fields: pending })).toEqual({ kind: 'empty' })
    expect(deriveResearchMapState({ papers: fail('down'), overviews: ok([]), fields: ok([]) })).toMatchObject({ kind: 'error', source: 'papers' })
    expect(
      deriveResearchMapState({ papers: ok([paper(P1)]), overviews: fail('x'), fields: ok([]) }),
    ).toMatchObject({ kind: 'error', source: 'extraction' })
    const ready = deriveResearchMapState({ papers: ok([paper(P1)]), overviews: ok([overview(P1)]), fields: ok([]) })
    expect(ready.kind).toBe('ready')
  })

  it('malformed extraction rows do not crash derivation (fail safely, empty relationships)', () => {
    const state = deriveResearchMapState({
      papers: ok([paper(P1), paper(P2)]),
      overviews: ok([overview(P1)]), // P2 missing an overview entirely
      fields: ok([field(P1, 'concepts', ['x'], { itemsMalformed: true })]),
    })
    expect(state.kind).toBe('ready')
    if (state.kind !== 'ready') return
    expect(() => buildTermIndex(state.map, state.fields)).not.toThrow()
    expect(() => buildPaperSummaries(state.map, state.fields)).not.toThrow()
    expect(buildTermIndex(state.map, state.fields)).toEqual([])
  })
})
