import type { Paper } from '#/features/papers/types'
import type {
  ExtractionField,
  ExtractionOverview,
  FieldKey,
} from '#/features/evidence-matrix/types'
import { deriveResearchMap } from './derive'
import type {
  FindingNode,
  PaperNode,
  ResearchMap,
  ResearchMapEdge,
  TermKind,
  TermNode,
} from './types'

/**
 * View-model layer for the Research Map UI: turns the frozen, pure ResearchMap into the
 * shapes the components render, plus the tab's loading/error/empty/ready state. Nothing
 * here touches derive.ts / terms.ts / normalize.ts's derivation rules; it only reads
 * their output (ResearchMap) and the same `fields` rows the tab already fetched, to
 * resolve claim text for the provenance sheet.
 */

export const TERM_KIND_LABELS: Record<TermKind, string> = {
  concept: 'Concepts',
  methodology: 'Methodologies',
  dataset: 'Datasets',
}

/** The field a term kind's evidence always comes from (mirrors derive.ts's mapping). */
const TERM_FIELD_KEY: Record<TermKind, FieldKey> = {
  concept: 'concepts',
  methodology: 'methodology',
  dataset: 'dataset',
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const claimKey = (paperId: string, fieldKey: FieldKey, itemIndex: number) =>
  `${paperId}|${fieldKey}|${itemIndex}`

/** paperId|fieldKey|itemIndex -> claim text, for showing what an evidence ref supports. */
function buildClaimTextIndex(
  fields: readonly ExtractionField[],
): Map<string, string> {
  const index = new Map<string, string>()
  for (const f of fields) {
    f.items.forEach((item, i) => {
      index.set(claimKey(f.paperId, f.fieldKey, i), item.text)
    })
  }
  return index
}

/** One supporting claim behind a relationship: enough to preview it and load its sources. */
export type EvidenceItemPreview = {
  itemIndex: number
  matchedPhrase: string | null
  /** '' if the source field/item could no longer be found (never invented). */
  claimText: string
}

/** What the provenance sheet needs: one paper, one field, one or more supporting claims. */
export type EvidenceSelection = {
  paperId: string
  paperTitle: string
  isStale: boolean
  fieldKey: FieldKey
  /** Term label, or a finding's own heading, shown at the top of the sheet. */
  contextLabel: string
  items: EvidenceItemPreview[]
}

export function makeEvidenceSelection(
  paperId: string,
  paperTitle: string,
  fieldKey: FieldKey,
  contextLabel: string,
  items: EvidenceItemPreview[],
  isStale = false,
): EvidenceSelection {
  return { paperId, paperTitle, isStale, fieldKey, contextLabel, items }
}

/** A term as it applies to one connected paper. */
export type ConnectedPaperRef = {
  paperId: string
  title: string
  isStale: boolean
  evidence: EvidenceItemPreview[]
}

/** One row of the Concepts / Methodologies / Datasets index. */
export type TermIndexEntry = {
  id: string
  kind: TermKind
  label: string
  fieldKey: FieldKey
  papers: ConnectedPaperRef[]
  /** At least one connected paper is currently out of date. */
  hasStaleEvidence: boolean
}

/** display-only relationship reference: never exposes the normalization key or a raw id. */
export type SharedTermRef = { id: string; label: string; evidence: EvidenceItemPreview[] }
export type FindingRef = { id: string; itemIndex: number; text: string }

/** One row of the paper-centric view. */
export type PaperSummaryRow = {
  paperId: string
  title: string
  statusKey: PaperNode['statusKey']
  isStale: boolean
  contributes: boolean
  concepts: SharedTermRef[]
  methodologies: SharedTermRef[]
  datasets: SharedTermRef[]
  findings: FindingRef[]
}

const evidenceOf = (
  edge: ResearchMapEdge,
  claimText: ReadonlyMap<string, string>,
): EvidenceItemPreview[] =>
  edge.evidence.map((ref) => ({
    itemIndex: ref.itemIndex,
    matchedPhrase: ref.matchedPhrase,
    claimText: claimText.get(claimKey(ref.paperId, ref.fieldKey, ref.itemIndex)) ?? '',
  }))

/**
 * The Concepts / Methodologies / Datasets index: one entry per shared term, with the
 * papers it connects (sorted by title, deterministic ties on id) and whether any of
 * them is currently out of date. Never includes the normalized matching key or the
 * internal node id in anything user-facing (callers should not render `id`/`fieldKey`).
 */
const KIND_ORDER: readonly TermKind[] = ['concept', 'methodology', 'dataset']

export function buildTermIndex(
  map: ResearchMap,
  fields: readonly ExtractionField[],
): TermIndexEntry[] {
  const claimText = buildClaimTextIndex(fields)
  const paperById = new Map(
    map.nodes.filter((n): n is PaperNode => n.type === 'paper').map((n) => [n.paperId, n]),
  )
  const entries = map.nodes
    .filter((n): n is TermNode => n.type === 'term')
    .map((term) => {
      const papers = map.edges
        .filter((e) => e.to === term.id)
        .map((edge) => {
          const paperId = edge.from.slice('paper:'.length)
          const p = paperById.get(paperId)
          return {
            paperId,
            title: p?.title ?? paperId,
            isStale: p?.isStale ?? false,
            evidence: evidenceOf(edge, claimText),
          }
        })
        .sort((a, b) => a.title.localeCompare(b.title) || cmp(a.paperId, b.paperId))
      return {
        id: term.id,
        kind: term.kind,
        label: term.label,
        fieldKey: TERM_FIELD_KEY[term.kind],
        papers,
        hasStaleEvidence: papers.some((p) => p.isStale),
      }
    })
  // Deterministic regardless of node/edge order: grouped by kind, then label, then id.
  return entries.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.label.localeCompare(b.label) ||
      cmp(a.id, b.id),
  )
}

/**
 * One row per paper (sorted by title, deterministic ties on id — independent of node
 * order), with the shared terms and findings it contributes. An isolated paper (no
 * shared terms, no findings) still gets a normal row: empty arrays, not an error.
 */
export function buildPaperSummaries(
  map: ResearchMap,
  fields: readonly ExtractionField[],
): PaperSummaryRow[] {
  const claimText = buildClaimTextIndex(fields)
  const termById = new Map(
    map.nodes.filter((n): n is TermNode => n.type === 'term').map((n) => [n.id, n]),
  )
  const findingById = new Map(
    map.nodes.filter((n): n is FindingNode => n.type === 'finding').map((n) => [n.id, n]),
  )
  const toRefs = (edges: readonly ResearchMapEdge[]): SharedTermRef[] =>
    edges.map((e) => {
      const term = termById.get(e.to)
      return {
        id: e.to,
        label: term?.label ?? '',
        evidence: evidenceOf(e, claimText),
      }
    })

  const rows = map.nodes
    .filter((n): n is PaperNode => n.type === 'paper')
    .map((paper) => {
      const edgesFrom = map.edges.filter((e) => e.from === paper.id)
      return {
        paperId: paper.paperId,
        title: paper.title,
        statusKey: paper.statusKey,
        isStale: paper.isStale,
        contributes: paper.contributes,
        concepts: toRefs(edgesFrom.filter((e) => e.type === 'paper_has_concept')),
        methodologies: toRefs(edgesFrom.filter((e) => e.type === 'paper_uses_methodology')),
        datasets: toRefs(edgesFrom.filter((e) => e.type === 'paper_uses_dataset')),
        findings: edgesFrom
          .filter((e) => e.type === 'paper_reports_finding')
          .map((e) => findingById.get(e.to))
          .filter((f): f is FindingNode => f !== undefined)
          .map((f) => ({ id: f.id, itemIndex: f.itemIndex, text: f.text })),
      }
    })
  return rows.sort((a, b) => a.title.localeCompare(b.title) || cmp(a.paperId, b.paperId))
}

export type TermKindFilter = TermKind | 'all'

export function filterTermIndex(
  entries: readonly TermIndexEntry[],
  opts: { kind: TermKindFilter; search: string; hideStale: boolean },
): TermIndexEntry[] {
  const q = opts.search.trim().toLowerCase()
  return entries.filter((e) => {
    if (opts.kind !== 'all' && e.kind !== opts.kind) return false
    if (opts.hideStale && e.hasStaleEvidence) return false
    if (q === '') return true
    return (
      e.label.toLowerCase().includes(q) ||
      e.papers.some((p) => p.title.toLowerCase().includes(q))
    )
  })
}

export function filterPaperSummaries(
  rows: readonly PaperSummaryRow[],
  search: string,
): PaperSummaryRow[] {
  const q = search.trim().toLowerCase()
  if (q === '') return [...rows]
  const matches = (refs: readonly { label: string }[]) =>
    refs.some((r) => r.label.toLowerCase().includes(q))
  return rows.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      matches(r.concepts) ||
      matches(r.methodologies) ||
      matches(r.datasets),
  )
}

type QueryLike<T> = { data: T | undefined; error: Error | null; isPending: boolean }

export type ResearchMapTabState =
  | { kind: 'loading' }
  | { kind: 'error'; source: 'papers' | 'extraction'; error: Error }
  | { kind: 'empty' }
  | { kind: 'ready'; map: ResearchMap; fields: readonly ExtractionField[] }

/**
 * What the tab shows. Mirrors the Evidence Matrix tab's loading/error/empty/ready shape:
 * an extraction-data failure is an ERROR, never treated as "no relationships". Per-paper
 * detail (not extracted / pending / stale / isolated / …) lives INSIDE the ready state,
 * in each PaperSummaryRow.statusKey — there is no separate top-level state for it.
 */
export function deriveResearchMapState(queries: {
  papers: QueryLike<readonly Paper[]>
  overviews: QueryLike<readonly ExtractionOverview[]>
  fields: QueryLike<readonly ExtractionField[]>
}): ResearchMapTabState {
  const { papers, overviews, fields } = queries
  if (papers.error) return { kind: 'error', source: 'papers', error: papers.error }
  if (papers.isPending || !papers.data) return { kind: 'loading' }
  if (papers.data.length === 0) return { kind: 'empty' }
  const failed = overviews.error ?? fields.error
  if (failed) return { kind: 'error', source: 'extraction', error: failed }
  if (overviews.isPending || fields.isPending || !overviews.data || !fields.data) {
    return { kind: 'loading' }
  }
  return {
    kind: 'ready',
    map: deriveResearchMap({ papers: papers.data, overviews: overviews.data, fields: fields.data }),
    fields: fields.data,
  }
}
