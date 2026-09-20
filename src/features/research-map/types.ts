import type { ExtractionStatus, FieldKey } from '#/features/evidence-matrix/types'
import type { ExtractionStatusKey } from '#/features/evidence-matrix/status'

/**
 * Research Map graph model. Pure data: no UI, no network, no database. Everything is
 * derived deterministically from persisted Evidence Matrix data.
 */
export type TermKind = 'concept' | 'methodology' | 'dataset'

/**
 * Where a relationship comes from. Enough to load the provenance lazily later with
 * paperId + fieldKey (+ itemIndex to pick the claim). Excerpts are never copied here.
 */
export type EvidenceRef = {
  paperId: string
  fieldKey: FieldKey
  /** Position of the claim within the field's items (= the sources' item_index). */
  itemIndex: number
  /** The phrase as it appeared in the claim; null for a finding (the whole claim). */
  matchedPhrase: string | null
}

export type PaperNode = {
  /** `paper:<uuid>` */
  id: string
  type: 'paper'
  paperId: string
  title: string
  /** Paper-level extraction state, as the Evidence Matrix describes it. */
  statusKey: ExtractionStatusKey
  extractionStatus: ExtractionStatus | null
  /** Extracted from an older generation of the paper. Its evidence is still used. */
  isStale: boolean
  /** Has at least one term edge or finding. */
  contributes: boolean
}

export type TermNode = {
  /** `term:<kind>:<normalized term>`; the three kinds never share a node. */
  id: string
  type: 'term'
  kind: TermKind
  /** Normalized matching text. */
  key: string
  /** Display text chosen from the observed forms. */
  label: string
  /** Distinct papers supporting the term (always >= 2). Sorted. */
  paperIds: string[]
}

export type FindingNode = {
  /** `finding:<paperId>:<itemIndex>` */
  id: string
  type: 'finding'
  paperId: string
  itemIndex: number
  text: string
  evidence: EvidenceRef
}

export type ResearchMapNode = PaperNode | TermNode | FindingNode

export type EdgeType =
  | 'paper_has_concept'
  | 'paper_uses_methodology'
  | 'paper_uses_dataset'
  | 'paper_reports_finding'

export type ResearchMapEdge = {
  id: string
  type: EdgeType
  /** Always a paper node id. */
  from: string
  /** A term node id or a finding node id. */
  to: string
  /** Every supporting claim, sorted. One edge per paper/term pair. */
  evidence: EvidenceRef[]
}

export type ResearchMapSummary = {
  /** Every project paper. */
  totalPapers: number
  /** Papers with at least one term edge or finding. */
  contributingPapers: number
  /** Extracted and up to date (status "Extracted"). */
  currentPapers: number
  /** Extracted but out of date (status "Out of date"). */
  stalePapers: number
  /** Queued or running. */
  activePapers: number
  /** Papers with no extraction record at all (never requested, or not ready yet). */
  unextractedPapers: number
  /** Partial or failed extractions. */
  incompletePapers: number
  sharedConcepts: number
  sharedMethodologies: number
  sharedDatasets: number
  /** Finding nodes (one per extracted finding, never merged). */
  findings: number
}

export type ResearchMap = {
  nodes: ResearchMapNode[]
  edges: ResearchMapEdge[]
  summary: ResearchMapSummary
  /** Candidate terms seen in only one paper (not map nodes); for diagnostics only. */
  diagnostics: { unsharedCandidates: Record<TermKind, number> }
}
