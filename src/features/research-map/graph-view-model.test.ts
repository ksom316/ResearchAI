import { describe, expect, it } from 'vitest'
import { deriveResearchMap } from './derive'
import { buildGraphViewModel, MAX_GRAPH_NODES, neighborhoodOf } from './graph-view-model'
import type { GraphEdge } from './graph-view-model'
import {
  buildPaperSummaries,
  buildTermIndex,
  filterPaperSummaries,
  filterTermIndex,
} from './view-model'
import type { Paper } from '#/features/papers/types'
import type { ExtractionField, ExtractionOverview, FieldKey } from '#/features/evidence-matrix/types'

const P1 = 'p1'
const P2 = 'p2'
const P3 = 'p3'

const paper = (id: string, title: string, status: Paper['status'] = 'ready'): Paper => ({
  id, project_ids: ['proj'], title, authors: [], publication_year: null, original_filename: null,
  mime_type: null, storage_path: null, content_hash: null, file_size_bytes: null, status,
  page_count: null, processing_error: null, created_at: '2026-01-01T00:00:00Z',
})
const overview = (paperId: string, over: Partial<ExtractionOverview> = {}): ExtractionOverview => ({
  paperId, schemaVersion: 1, status: 'complete', sourceCompletedAt: 'a', completedAt: 'b',
  provider: null, model: null, createdAt: 'c', updatedAt: 'd', isStale: false, ...over,
})
const field = (
  paperId: string, fieldKey: FieldKey, texts: string[], over: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId, schemaVersion: 1, fieldKey, state: 'extracted', items: texts.map((text) => ({ text })),
  itemsMalformed: false, createdAt: 'x', updatedAt: 'y', ...over,
})

function bertLikeMap() {
  return deriveResearchMap({
    papers: [paper(P1, 'test research'), paper(P2, 'RoBERTa'), paper(P3, 'Tables To Latex')],
    overviews: [overview(P1), overview(P2), overview(P3)],
    fields: [
      field(P1, 'concepts', ['Masked language modeling randomly masks tokens.']),
      field(P2, 'concepts', ['We evaluate masked language modeling.']),
      field(P1, 'methodology', ['We build on BERT.']),
      field(P2, 'methodology', ['We reimplement BERT.']),
      field(P3, 'concepts', ['Tabular processing is divided into stages.']),
      field(P3, 'findings', ['Accuracy improved.', 'Latency dropped.']),
    ],
  })
}

function bertLikeVM(fields: ExtractionField[] = []) {
  const map = bertLikeMap()
  return { entries: buildTermIndex(map, fields), rows: buildPaperSummaries(map, fields) }
}

describe('buildGraphViewModel: node conversion', () => {
  const { entries, rows } = bertLikeVM()
  const g = buildGraphViewModel(entries, rows, { showFindings: false })

  it('converts every paper into a paper node, and every visible shared term into a kinded node', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    const paperNodes = g.nodes.filter((n) => n.kind === 'paper')
    expect(paperNodes.map((n) => n.data.label).sort()).toEqual(['RoBERTa', 'Tables To Latex', 'test research'])
    const termNodes = g.nodes.filter((n) => n.kind !== 'paper' && n.kind !== 'finding')
    expect(termNodes.map((n) => `${n.kind}:${n.data.label}`).sort()).toEqual([
      'concept:Masked language modeling',
      'methodology:BERT',
    ])
  })

  it('gives each term node its connected-paper count', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    const bert = g.nodes.find((n) => n.data.label === 'BERT')!
    expect(bert.data.paperCount).toBe(2)
  })

  it('findings are excluded by default', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    expect(g.nodes.some((n) => n.kind === 'finding')).toBe(false)
    expect(g.edges.some((e) => e.kind === 'finding')).toBe(false)
  })
})

describe('buildGraphViewModel: edge conversion', () => {
  const { entries, rows } = bertLikeVM()
  const g = buildGraphViewModel(entries, rows, { showFindings: false })

  it('creates one edge per term-paper connection, matching TermIndexEntry exactly', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    const bertEntry = entries.find((e) => e.label === 'BERT')!
    const bertEdges = g.edges.filter((e) => e.source === bertEntry.id)
    expect(bertEdges).toHaveLength(2)
    expect(bertEdges.map((e) => e.target).sort()).toEqual(
      ['graph-paper:p1', 'graph-paper:p2'].sort(),
    )
  })

  it('never invents an edge not present in the view-model (Tables To Latex has zero term edges)', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    const tablesEdges = g.edges.filter(
      (e) => e.source === 'graph-paper:p3' || e.target === 'graph-paper:p3',
    )
    expect(tablesEdges).toEqual([])
  })

  it('carries usable provenance (evidence selection) on each edge', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    const edge = g.edges[0]
    expect(edge.evidence.fieldKey).toBe(edge.kind === 'finding' ? 'findings' : edge.kind === 'concept' ? 'concepts' : edge.kind)
    expect(edge.evidence.items.length).toBeGreaterThan(0)
  })
})

describe('buildGraphViewModel: findings shown', () => {
  const fields = [
    field(P3, 'concepts', ['Tabular processing is divided into stages.']),
    field(P3, 'findings', ['Accuracy improved.', 'Latency dropped.']),
  ]
  const { entries, rows } = bertLikeVM(fields)
  const g = buildGraphViewModel(entries, rows, { showFindings: true })

  it('adds one finding node per finding, each edged only to its own paper', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    const findingNodes = g.nodes.filter((n) => n.kind === 'finding')
    expect(findingNodes).toHaveLength(2)
    const findingEdges = g.edges.filter((e) => e.kind === 'finding')
    expect(findingEdges).toHaveLength(2)
    for (const e of findingEdges) expect(e.source).toBe('graph-paper:p3')
  })

  it('truncates long finding text on the node but keeps the full text accessible', () => {
    if (g.kind !== 'graph') throw new Error('expected graph')
    const longText = 'x'.repeat(120)
    const rows2 = rows.map((r) =>
      r.paperId === P3
        ? { ...r, findings: [{ id: 'f', itemIndex: 0, text: longText }] }
        : r,
    )
    const g2 = buildGraphViewModel(entries, rows2, { showFindings: true })
    if (g2.kind !== 'graph') throw new Error('expected graph')
    const node = g2.nodes.find((n) => n.kind === 'finding')!
    expect(node.data.label.length).toBeLessThan(longText.length)
    expect(node.data.label.endsWith('…')).toBe(true)
    expect(node.data.fullText).toBe(longText)
  })

  it('does not merge identical finding text across papers', () => {
    const map2 = deriveResearchMap({
      papers: [paper(P1, 'A'), paper(P2, 'B')],
      overviews: [overview(P1), overview(P2)],
      fields: [field(P1, 'findings', ['Same finding.']), field(P2, 'findings', ['Same finding.'])],
    })
    const fields2 = [field(P1, 'findings', ['Same finding.']), field(P2, 'findings', ['Same finding.'])]
    const entries2 = buildTermIndex(map2, fields2)
    const rows2 = buildPaperSummaries(map2, fields2)
    const g2 = buildGraphViewModel(entries2, rows2, { showFindings: true })
    if (g2.kind !== 'graph') throw new Error('expected graph')
    const findingNodes = g2.nodes.filter((n) => n.kind === 'finding')
    expect(findingNodes).toHaveLength(2)
    expect(new Set(findingNodes.map((n) => n.id)).size).toBe(2)
  })
})

describe('buildGraphViewModel: isolated papers', () => {
  it('an isolated paper (no shared terms) still gets a node', () => {
    const { entries, rows } = bertLikeVM()
    const g = buildGraphViewModel(entries, rows, { showFindings: false })
    if (g.kind !== 'graph') throw new Error('expected graph')
    expect(g.nodes.some((n) => n.data.label === 'Tables To Latex')).toBe(true)
  })

  it('a paper with zero relationships at all (no terms, no findings) still gets a node', () => {
    const map = deriveResearchMap({
      papers: [paper(P1, 'Alone')],
      overviews: [overview(P1)],
      fields: [],
    })
    const entries = buildTermIndex(map, [])
    const rows = buildPaperSummaries(map, [])
    const g = buildGraphViewModel(entries, rows, { showFindings: true })
    expect(g.kind).toBe('graph')
    if (g.kind !== 'graph') return
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toEqual([])
  })
})

describe('buildGraphViewModel: deterministic layout', () => {
  it('produces identical positions across repeated calls with the same input', () => {
    const { entries, rows } = bertLikeVM()
    const a = buildGraphViewModel(entries, rows, { showFindings: false })
    const b = buildGraphViewModel(entries, rows, { showFindings: false })
    expect(a).toEqual(b)
  })

  it('paper nodes sit on one row, term nodes on a row above, findings below', () => {
    const fields = [field(P3, 'findings', ['A finding.'])]
    const { entries, rows } = bertLikeVM(fields)
    const g = buildGraphViewModel(entries, rows, { showFindings: true })
    if (g.kind !== 'graph') throw new Error('expected graph')
    const paperY = new Set(g.nodes.filter((n) => n.kind === 'paper').map((n) => n.position.y))
    const termY = new Set(g.nodes.filter((n) => n.kind === 'concept' || n.kind === 'methodology').map((n) => n.position.y))
    const findingY = new Set(g.nodes.filter((n) => n.kind === 'finding').map((n) => n.position.y))
    expect(paperY.size).toBe(1)
    expect(termY.size).toBe(1)
    expect(findingY.size).toBe(1)
    expect([...termY][0]).toBeLessThan([...paperY][0])
    expect([...paperY][0]).toBeLessThan([...findingY][0])
  })

  it('no two nodes in the same row share the same x position', () => {
    const { entries, rows } = bertLikeVM()
    const g = buildGraphViewModel(entries, rows, { showFindings: false })
    if (g.kind !== 'graph') throw new Error('expected graph')
    const xs = g.nodes.filter((n) => n.kind === 'paper').map((n) => n.position.x)
    expect(new Set(xs).size).toBe(xs.length)
  })
})

describe('buildGraphViewModel: filter integration (reuses the 6B.3 view-model filters)', () => {
  const map = bertLikeMap()
  const allEntries = buildTermIndex(map, [])
  const allRows = buildPaperSummaries(map, [])

  it('respects a kind filter applied upstream via filterTermIndex', () => {
    const methodologyOnly = filterTermIndex(allEntries, { kind: 'methodology', search: '', hideStale: false })
    const g = buildGraphViewModel(methodologyOnly, allRows, { showFindings: false })
    if (g.kind !== 'graph') throw new Error('expected graph')
    expect(g.nodes.some((n) => n.kind === 'concept')).toBe(false)
    expect(g.nodes.some((n) => n.kind === 'methodology')).toBe(true)
  })

  it('a search filter that removes a connecting paper narrows the term edges honestly, without dropping the paper node', () => {
    // search "roberta" keeps only RoBERTa in the paper list, but the term index (built
    // before paper-search is applied) still lists BOTH papers for "BERT"
    const searchedRows = filterPaperSummaries(allRows, 'roberta')
    const g = buildGraphViewModel(allEntries, searchedRows, { showFindings: false })
    if (g.kind !== 'graph') throw new Error('expected graph')
    expect(g.nodes.filter((n) => n.kind === 'paper')).toHaveLength(1)
    const bert = g.nodes.find((n) => n.data.label === 'BERT')!
    expect(bert.data.paperCount).toBe(1) // narrowed, not fabricated as still 2
    const bertEdges = g.edges.filter((e) => e.source === bert.id)
    expect(bertEdges).toHaveLength(1)
    expect(bertEdges[0].target).toBe('graph-paper:p2')
  })

  it('a term with zero visible connecting papers after filtering is dropped, not shown as a dangling node', () => {
    const searchedRows = filterPaperSummaries(allRows, 'tables') // only Tables To Latex
    const g = buildGraphViewModel(allEntries, searchedRows, { showFindings: false })
    if (g.kind !== 'graph') throw new Error('expected graph')
    expect(g.nodes.some((n) => n.kind !== 'paper')).toBe(false)
    expect(g.edges).toEqual([])
    expect(g.nodes).toHaveLength(1) // the paper itself is never dropped
  })

  it('hideStale removes stale-derived term nodes from the graph, same as the index', () => {
    const staleMap = deriveResearchMap({
      papers: [paper(P1, 'A'), paper(P2, 'B')],
      overviews: [overview(P1, { isStale: true }), overview(P2)],
      fields: [field(P1, 'concepts', ['We build on BERT.']), field(P2, 'concepts', ['BERT is widely used.'])],
    })
    const entries = buildTermIndex(staleMap, [])
    const rows = buildPaperSummaries(staleMap, [])
    const hidden = filterTermIndex(entries, { kind: 'all', search: '', hideStale: true })
    const g = buildGraphViewModel(hidden, rows, { showFindings: false })
    if (g.kind !== 'graph') throw new Error('expected graph')
    expect(g.nodes.some((n) => n.kind !== 'paper')).toBe(false)
  })
})

describe('buildGraphViewModel: large-corpus safety', () => {
  it('reports "too_large" instead of rendering an unreadable graph', () => {
    const rows = Array.from({ length: MAX_GRAPH_NODES + 10 }, (_, i) => ({
      paperId: `p${i}`, title: `Paper ${i}`, statusKey: 'extracted' as const, isStale: false,
      contributes: false, concepts: [], methodologies: [], datasets: [], findings: [],
    }))
    const g = buildGraphViewModel([], rows, { showFindings: false })
    expect(g).toEqual({ kind: 'too_large', nodeCount: rows.length, limit: MAX_GRAPH_NODES })
  })

  it('an empty project reports "empty" rather than an empty graph object', () => {
    expect(buildGraphViewModel([], [], { showFindings: false })).toEqual({ kind: 'empty' })
  })
})

describe('buildGraphViewModel: malformed/missing data safety', () => {
  it('a term entry referencing a paper absent from rows is simply narrowed away, never throws', () => {
    const entries = [
      {
        id: 'term:concept:ghost', kind: 'concept' as const, label: 'Ghost', fieldKey: 'concepts' as const,
        papers: [{ paperId: 'nonexistent', title: 'Nonexistent', isStale: false, evidence: [] }],
        hasStaleEvidence: false,
      },
    ]
    const rows = [
      { paperId: P1, title: 'A', statusKey: 'extracted' as const, isStale: false, contributes: false, concepts: [], methodologies: [], datasets: [], findings: [] },
    ]
    expect(() => buildGraphViewModel(entries, rows, { showFindings: false })).not.toThrow()
    const g = buildGraphViewModel(entries, rows, { showFindings: false })
    expect(g).toEqual({ kind: 'graph', nodes: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ label: 'A' }) })]), edges: [] })
  })

  it('empty findings text is still a valid (if blank) finding node, never crashes', () => {
    const rows = [
      { paperId: P1, title: 'A', statusKey: 'extracted' as const, isStale: false, contributes: true, concepts: [], methodologies: [], datasets: [], findings: [{ id: 'f', itemIndex: 0, text: '' }] },
    ]
    expect(() => buildGraphViewModel([], rows, { showFindings: true })).not.toThrow()
  })
})

describe('neighborhoodOf', () => {
  const edges: GraphEdge[] = [
    { id: 'e1', kind: 'concept', source: 'term-a', target: 'paper-1', evidence: { paperId: 'p1', paperTitle: 'P1', fieldKey: 'concepts', contextLabel: 'A', items: [] } },
    { id: 'e2', kind: 'concept', source: 'term-a', target: 'paper-2', evidence: { paperId: 'p2', paperTitle: 'P2', fieldKey: 'concepts', contextLabel: 'A', items: [] } },
    { id: 'e3', kind: 'methodology', source: 'term-b', target: 'paper-2', evidence: { paperId: 'p2', paperTitle: 'P2', fieldKey: 'methodology', contextLabel: 'B', items: [] } },
  ]

  it('selecting a term highlights every paper it connects to, and nothing further away', () => {
    const { nodeIds, edgeIds } = neighborhoodOf('term-a', edges)
    expect(nodeIds).toEqual(new Set(['term-a', 'paper-1', 'paper-2']))
    expect(edgeIds).toEqual(new Set(['e1', 'e2']))
  })

  it('selecting a paper highlights every term connected to it (its shared relationships)', () => {
    const { nodeIds, edgeIds } = neighborhoodOf('paper-2', edges)
    expect(nodeIds).toEqual(new Set(['paper-2', 'term-a', 'term-b']))
    expect(edgeIds).toEqual(new Set(['e2', 'e3']))
  })

  it('an isolated node has a neighborhood of only itself', () => {
    const { nodeIds, edgeIds } = neighborhoodOf('paper-lonely', edges)
    expect(nodeIds).toEqual(new Set(['paper-lonely']))
    expect(edgeIds).toEqual(new Set())
  })
})
