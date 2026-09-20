import { FIELD_LABELS } from '#/features/evidence-matrix/matrix-model'
import type {
  ExtractionField,
  ExtractionOverview,
} from '#/features/evidence-matrix/types'
import type { Paper } from '#/features/papers/types'
import { deriveResearchMap } from '#/features/research-map/derive'
import type {
  PaperNode,
  ResearchMap,
  TermNode,
} from '#/features/research-map/types'
import { deriveResearchGaps } from './derive'
import {
  explainGapSignals,
  gapDisplayHeading,
  gapTypeLabel,
} from './presentation'
import type { GapCandidate, GapClaimFieldKey, GapType } from './types'

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const evidenceKey = (ref: GapCandidate['evidenceRefs'][number]) =>
  JSON.stringify([ref.paperId, ref.fieldKey, ref.itemIndex])

export type GapStatusFilter = 'all' | 'current' | 'stale'
export type GapTypeFilter = GapType | 'all'

export type ResearchGapsSummary = {
  potentialGaps: number
  supportingPapers: number
  evidenceClaims: number
  current: number
  stale: number
}

export function summarizeResearchGaps(
  candidates: readonly GapCandidate[],
): ResearchGapsSummary {
  const paperIds = new Set<string>()
  const evidence = new Set<string>()
  for (const candidate of candidates) {
    candidate.paperIds.forEach((paperId) => paperIds.add(paperId))
    candidate.evidenceRefs.forEach((ref) => evidence.add(evidenceKey(ref)))
  }
  return {
    potentialGaps: candidates.length,
    supportingPapers: paperIds.size,
    evidenceClaims: evidence.size,
    current: candidates.filter((candidate) => !candidate.isStale).length,
    stale: candidates.filter((candidate) => candidate.isStale).length,
  }
}

export function availableGapTypes(
  candidates: readonly GapCandidate[],
): GapType[] {
  return [...new Set(candidates.map((candidate) => candidate.type))].sort(compare)
}

export function filterGapCandidates(
  candidates: readonly GapCandidate[],
  filters: { type: GapTypeFilter; status: GapStatusFilter },
): GapCandidate[] {
  return candidates.filter((candidate) => {
    if (filters.type !== 'all' && candidate.type !== filters.type) return false
    if (filters.status === 'current' && candidate.isStale) return false
    if (filters.status === 'stale' && !candidate.isStale) return false
    return true
  })
}

export type GapPaperRef = { paperId: string; title: string }
export type GapTermRef = { termId: string; label: string }

export type GapCandidateView = {
  candidate: GapCandidate
  heading: string
  typeLabel: string
  papers: GapPaperRef[]
  relatedTerms: GapTermRef[]
  explanations: string[]
}

export function buildGapCandidateView(
  candidate: GapCandidate,
  map: Pick<ResearchMap, 'nodes'>,
): GapCandidateView {
  const papers = new Map(
    map.nodes
      .filter((node): node is PaperNode => node.type === 'paper')
      .map((node) => [node.paperId, node]),
  )
  const terms = new Map(
    map.nodes
      .filter((node): node is TermNode => node.type === 'term')
      .map((node) => [node.id, node]),
  )
  return {
    candidate,
    heading: gapDisplayHeading(candidate),
    typeLabel: gapTypeLabel(candidate.type),
    papers: candidate.paperIds.map((paperId) => ({
      paperId,
      title: papers.get(paperId)?.title || 'Unknown paper',
    })),
    relatedTerms: candidate.relatedTermIds.map((termId) => ({
      termId,
      label: terms.get(termId)?.label || 'Related corpus term',
    })),
    explanations: explainGapSignals(candidate, terms),
  }
}

export type GapEvidenceClaim = {
  fieldKey: GapClaimFieldKey
  fieldLabel: string
  itemIndex: number
  text: string
}

export type GapEvidencePaper = GapPaperRef & { claims: GapEvidenceClaim[] }

export type GapEvidenceSelection = GapCandidateView & {
  evidencePapers: GapEvidencePaper[]
  showStaleWarning: boolean
}

function resolveClaim(
  fields: readonly ExtractionField[],
  paperId: string,
  fieldKey: GapClaimFieldKey,
  itemIndex: number,
): string {
  const rows = fields.filter(
    (field) => field.paperId === paperId && field.fieldKey === fieldKey,
  )
  const newest = rows.map((row) => row.updatedAt).sort(compare).at(-1)
  const latest = rows.filter((row) => row.updatedAt === newest)
  if (latest.length === 0) return 'Extracted claim unavailable.'
  if (
    new Set(
      latest.map((row) =>
        JSON.stringify([row.state, row.itemsMalformed, row.items]),
      ),
    ).size !== 1
  )
    return 'Extracted claim unavailable.'
  const field = latest[0]
  if (field.state !== 'extracted' || field.itemsMalformed)
    return 'Extracted claim unavailable.'
  return field.items[itemIndex]?.text || 'Extracted claim unavailable.'
}

export function buildGapEvidenceSelection(
  candidate: GapCandidate,
  map: Pick<ResearchMap, 'nodes'>,
  fields: readonly ExtractionField[],
): GapEvidenceSelection {
  const view = buildGapCandidateView(candidate, map)
  const uniqueRefs = new Map(
    candidate.evidenceRefs.map((ref) => [evidenceKey(ref), ref]),
  )
  const refsByPaper = new Map<string, typeof candidate.evidenceRefs>()
  for (const ref of uniqueRefs.values()) {
    if (ref.fieldKey !== 'limitations' && ref.fieldKey !== 'future_work') continue
    refsByPaper.set(ref.paperId, [
      ...(refsByPaper.get(ref.paperId) ?? []),
      ref,
    ])
  }
  const evidencePapers = view.papers.map((paper) => ({
    ...paper,
    claims: [...(refsByPaper.get(paper.paperId) ?? [])]
      .sort(
        (a, b) =>
          compare(a.fieldKey, b.fieldKey) || a.itemIndex - b.itemIndex,
      )
      .map((ref) => ({
        fieldKey: ref.fieldKey as GapClaimFieldKey,
        fieldLabel: FIELD_LABELS[ref.fieldKey],
        itemIndex: ref.itemIndex,
        text: resolveClaim(fields, ref.paperId, ref.fieldKey as GapClaimFieldKey, ref.itemIndex),
      })),
  }))
  return { ...view, evidencePapers, showStaleWarning: candidate.isStale }
}

type QueryLike<T> = {
  data: T | undefined
  error: Error | null
  isPending: boolean
}

export type ResearchGapsTabState =
  | { kind: 'loading' }
  | { kind: 'error'; source: 'papers' | 'extraction'; error: Error }
  | { kind: 'empty' }
  | { kind: 'not_ready' }
  | {
      kind: 'ready'
      map: ResearchMap
      fields: readonly ExtractionField[]
      candidates: GapCandidate[]
    }

export function deriveResearchGapsState(queries: {
  papers: QueryLike<readonly Pick<Paper, 'id' | 'title' | 'status'>[]>
  overviews: QueryLike<readonly ExtractionOverview[]>
  fields: QueryLike<readonly ExtractionField[]>
}): ResearchGapsTabState {
  const { papers, overviews, fields } = queries
  if (papers.error) return { kind: 'error', source: 'papers', error: papers.error }
  if (papers.isPending || !papers.data) return { kind: 'loading' }
  if (papers.data.length === 0) return { kind: 'empty' }
  const extractionError = overviews.error ?? fields.error
  if (extractionError)
    return { kind: 'error', source: 'extraction', error: extractionError }
  if (
    overviews.isPending ||
    fields.isPending ||
    !overviews.data ||
    !fields.data
  )
    return { kind: 'loading' }

  const map = deriveResearchMap({
    papers: papers.data,
    overviews: overviews.data,
    fields: fields.data,
  })
  const usablePapers = map.nodes.filter(
    (node): node is PaperNode =>
      node.type === 'paper' &&
      (node.statusKey === 'extracted' || node.statusKey === 'out_of_date'),
  ).length
  if (usablePapers < 2) return { kind: 'not_ready' }
  return {
    kind: 'ready',
    map,
    fields: fields.data,
    candidates: deriveResearchGaps({ fields: fields.data, researchMap: map }),
  }
}
