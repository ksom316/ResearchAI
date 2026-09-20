import type { TermKind } from './types'
import { extractionStatusLabel } from '#/features/evidence-matrix/status'
import type {
  EvidenceSelection,
  PaperSummaryRow,
  TermIndexEntry,
} from './view-model'
import { makeEvidenceSelection } from './view-model'

/**
 * Converts the ALREADY-FILTERED 6B.3 view-model (TermIndexEntry[] / PaperSummaryRow[])
 * into a plain, deterministic node/edge graph for the visual map. This is the ONLY
 * filtering path the graph uses — it never re-derives from ResearchMap and never adds a
 * second filter system. No relationship is invented here: every edge mirrors a
 * TermIndexEntry.papers entry or a PaperSummaryRow.findings entry that the frozen
 * derivation already produced.
 */

export type GraphNodeKind = 'paper' | TermKind | 'finding'

export type GraphNode = {
  id: string
  kind: GraphNodeKind
  position: { x: number; y: number }
  data: {
    label: string
    /** Present for paper nodes: their status label, for the badge. */
    statusLabel?: string
    isStale: boolean
    /** Present for term nodes: how many papers it connects. */
    paperCount?: number
    /** Present for finding nodes: full text (the node itself shows a truncated form). */
    fullText?: string
    /** What clicking this node opens in the provenance sheet, if anything. */
    evidence?: EvidenceSelection
  }
}

export type GraphEdgeKind = TermKind | 'finding'

export type GraphEdge = {
  id: string
  kind: GraphEdgeKind
  source: string
  target: string
  /** The relationship's own provenance (a term-paper or paper-finding pair). */
  evidence: EvidenceSelection
}

export type GraphViewModel =
  | { kind: 'empty' }
  | { kind: 'too_large'; nodeCount: number; limit: number }
  | { kind: 'graph'; nodes: GraphNode[]; edges: GraphEdge[] }

/** Presentation safeguard: past this, a force/grid graph stops being readable. */
export const MAX_GRAPH_NODES = 150

const X_STEP = 220
const PAPER_Y = 220
const TERM_Y = 40
const FINDING_Y = 420
const FINDING_X_STEP = 140

const paperNodeId = (paperId: string) => `graph-paper:${paperId}`
const findingNodeId = (id: string) => `graph-${id}`

/**
 * Builds the graph. `entries`/`rows` are exactly what RelationshipIndex /
 * PaperRelationshipList already render (post search/kind/stale filtering), so the graph
 * always agrees with the index. Paper nodes are never dropped by filtering — only their
 * edges may thin out; a term's connected-paper list is narrowed to papers still visible
 * in `rows` (search can hide a paper without hiding the term, which would otherwise
 * point at a paper that no longer exists as a node).
 */
export function buildGraphViewModel(
  entries: readonly TermIndexEntry[],
  rows: readonly PaperSummaryRow[],
  options: { showFindings: boolean },
): GraphViewModel {
  if (rows.length === 0) return { kind: 'empty' }

  const visiblePaperIds = new Set(rows.map((r) => r.paperId))
  const paperIndex = new Map(rows.map((r, i) => [r.paperId, i]))

  const visibleTerms = entries
    .map((entry) => ({
      entry,
      papers: entry.papers.filter((p) => visiblePaperIds.has(p.paperId)),
    }))
    .filter((t) => t.papers.length > 0)

  const findingCount = options.showFindings
    ? rows.reduce((n, r) => n + r.findings.length, 0)
    : 0
  const nodeCount = rows.length + visibleTerms.length + findingCount
  if (nodeCount > MAX_GRAPH_NODES) {
    return { kind: 'too_large', nodeCount, limit: MAX_GRAPH_NODES }
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Papers: the dominant row, centered, in the same deterministic order as the paper list.
  const paperX = (i: number) => (i - (rows.length - 1) / 2) * X_STEP
  rows.forEach((row, i) => {
    nodes.push({
      id: paperNodeId(row.paperId),
      kind: 'paper',
      position: { x: paperX(i), y: PAPER_Y },
      data: { label: row.title, isStale: row.isStale, statusLabel: extractionStatusLabel(row.statusKey) },
    })
  })

  // Shared terms: one row above the papers, in the index's own deterministic order.
  const termX = (i: number) => (i - (visibleTerms.length - 1) / 2) * X_STEP
  visibleTerms.forEach(({ entry, papers }, i) => {
    const nodeId = entry.id
    nodes.push({
      id: nodeId,
      kind: entry.kind,
      position: { x: termX(i), y: TERM_Y },
      data: { label: entry.label, isStale: papers.some((p) => p.isStale), paperCount: papers.length },
    })
    for (const p of papers) {
      edges.push({
        id: `${nodeId}->${paperNodeId(p.paperId)}`,
        kind: entry.kind,
        source: nodeId,
        target: paperNodeId(p.paperId),
        evidence: makeEvidenceSelection(p.paperId, p.title, entry.fieldKey, entry.label, p.evidence, p.isStale),
      })
    }
  })

  // Findings: paper-specific leaves, one row below the papers, grouped under their paper.
  if (options.showFindings) {
    for (const row of rows) {
      const baseX = paperX(paperIndex.get(row.paperId) ?? 0)
      row.findings.forEach((f, i) => {
        const id = findingNodeId(f.id)
        const offset = (i - (row.findings.length - 1) / 2) * FINDING_X_STEP
        nodes.push({
          id,
          kind: 'finding',
          position: { x: baseX + offset, y: FINDING_Y },
          data: {
            label: truncate(f.text),
            fullText: f.text,
            isStale: row.isStale,
            evidence: makeEvidenceSelection(row.paperId, row.title, 'findings', `Finding ${i + 1}`, [
              { itemIndex: f.itemIndex, matchedPhrase: null, claimText: f.text },
            ], row.isStale),
          },
        })
        edges.push({
          id: `${paperNodeId(row.paperId)}->${id}`,
          kind: 'finding',
          source: paperNodeId(row.paperId),
          target: id,
          evidence: makeEvidenceSelection(row.paperId, row.title, 'findings', `Finding ${i + 1}`, [
            { itemIndex: f.itemIndex, matchedPhrase: null, claimText: f.text },
          ], row.isStale),
        })
      })
    }
  }

  return { kind: 'graph', nodes, edges }
}

const TRUNCATE_AT = 60
function truncate(text: string): string {
  return text.length > TRUNCATE_AT ? `${text.slice(0, TRUNCATE_AT).trimEnd()}…` : text
}

/** The 1-hop neighborhood of a selected node: itself, its edges, and the far endpoints. */
export function neighborhoodOf(
  nodeId: string,
  edges: readonly GraphEdge[],
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set([nodeId])
  const edgeIds = new Set<string>()
  for (const e of edges) {
    if (e.source === nodeId || e.target === nodeId) {
      edgeIds.add(e.id)
      nodeIds.add(e.source)
      nodeIds.add(e.target)
    }
  }
  return { nodeIds, edgeIds }
}
