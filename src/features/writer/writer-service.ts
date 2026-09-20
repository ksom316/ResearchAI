import type { FieldKey } from '#/features/evidence-matrix/types'
import type { SearchOutcome } from '#/features/search/types'
import {
  MODE_FIELDS,
  WRITER_SEMANTIC_RETRIEVAL_LIMIT,
  comparablePaperCount,
  finalizeEvidencePacket,
  matrixEvidenceCandidates,
  semanticEvidenceCandidates,
} from './evidence'
import { writerRequestSchema } from './schemas'
import type {
  NormalizedWriterRequest,
  WriterEvidenceCoverage,
  WriterEvidencePacket,
  WriterEvidenceResult,
} from './types'
import type { WriterDb } from './writer-db.server'

export type WriterEvidenceDeps = {
  db: WriterDb
  semanticSearch: (request: unknown) => Promise<SearchOutcome>
}

const failure = (error: 'invalid_request'): WriterEvidenceResult => ({
  ok: false,
  error,
})

function coverage(
  projectPaperCount: number,
  selectedPaperCount: number,
  evidence: WriterEvidencePacket,
  availablePaperIds: ReadonlySet<string>,
): WriterEvidenceCoverage {
  return {
    projectPaperCount,
    selectedPaperCount,
    participatingPaperCount: evidence.paperIds.length,
    unavailablePaperCount: Math.max(
      0,
      selectedPaperCount - availablePaperIds.size,
    ),
    evidenceItemCount: evidence.items.length,
  }
}

function abstain(
  status: 'no_evidence' | 'insufficient_evidence' | 'stale_only',
  request: NormalizedWriterRequest,
  resultCoverage: WriterEvidenceCoverage,
): WriterEvidenceResult {
  return { ok: true, status, request, coverage: resultCoverage }
}

function ready(
  request: NormalizedWriterRequest,
  evidence: WriterEvidencePacket,
  resultCoverage: WriterEvidenceCoverage,
): WriterEvidenceResult {
  return {
    ok: true,
    status: 'ready',
    request,
    evidence,
    coverage: resultCoverage,
  }
}

function packetComparablePaperCount(packet: WriterEvidencePacket): number {
  const byField = new Map<FieldKey, Set<string>>()
  for (const item of packet.items) {
    if (item.locator.kind !== 'extraction_claim') continue
    const papers = byField.get(item.locator.fieldKey) ?? new Set<string>()
    papers.add(item.paperId)
    byField.set(item.locator.fieldKey, papers)
  }
  return Math.max(0, ...[...byField.values()].map((papers) => papers.size))
}

function packetHasField(packet: WriterEvidencePacket, fieldKey: FieldKey) {
  return packet.items.some(
    (item) =>
      item.locator.kind === 'extraction_claim' &&
      item.locator.fieldKey === fieldKey,
  )
}

async function prepareSemanticEvidence(
  request: Extract<NormalizedWriterRequest, { mode: 'literature_synthesis' }>,
  deps: WriterEvidenceDeps,
  projectPaperCount: number,
): Promise<WriterEvidenceResult> {
  const outcome = await deps.semanticSearch({
    query: request.focus,
    scope: { type: 'project', projectId: request.projectId },
    limit: WRITER_SEMANTIC_RETRIEVAL_LIMIT,
    minSimilarity: null,
    includeReferences: false,
  })
  if (!outcome.ok) {
    const error =
      outcome.error === 'search_busy'
        ? 'retrieval_busy'
        : outcome.error === 'unauthenticated'
          ? 'unauthenticated'
          : outcome.error === 'scope_not_found'
            ? 'scope_not_found'
            : 'retrieval_unavailable'
    return { ok: false, error }
  }

  const evidence = finalizeEvidencePacket(
    semanticEvidenceCandidates(outcome.results),
  )
  const available = new Set(evidence.paperIds)
  const resultCoverage = coverage(
    projectPaperCount,
    projectPaperCount,
    evidence,
    available,
  )
  if (evidence.items.length === 0) {
    const staleOnly =
      outcome.coverage.length > 0 &&
      outcome.coverage.every((paper) => paper.state === 'index_stale')
    return abstain(
      staleOnly ? 'stale_only' : 'no_evidence',
      request,
      resultCoverage,
    )
  }
  if (evidence.paperIds.length < 2) {
    return abstain('insufficient_evidence', request, resultCoverage)
  }
  return ready(request, evidence, resultCoverage)
}

async function prepareMatrixEvidence(
  request: Exclude<NormalizedWriterRequest, { mode: 'literature_synthesis' }>,
  deps: WriterEvidenceDeps,
  projectPaperCount: number,
  selectedPapers: Awaited<ReturnType<WriterDb['listProjectPapers']>>,
): Promise<WriterEvidenceResult> {
  const paperIds = selectedPapers.map((paper) => paper.id)
  const fieldKeys = MODE_FIELDS[request.mode]
  const [overviews, fields, sources] = await Promise.all([
    deps.db.listExtractionOverviews(paperIds),
    deps.db.listExtractionFields(paperIds, fieldKeys),
    deps.db.listExtractionSources(paperIds, fieldKeys),
  ])
  const chunkIds = sources.flatMap((source) =>
    source.chunkId ? [source.chunkId] : [],
  )
  const chunks = await deps.db.listChunks(chunkIds)
  const data = { papers: selectedPapers, overviews, fields, sources, chunks }
  const selectedIds = new Set(paperIds)
  const currentCandidates = matrixEvidenceCandidates(
    data,
    request.mode,
    selectedIds,
    false,
  )
  const staleCandidates = matrixEvidenceCandidates(
    data,
    request.mode,
    selectedIds,
    true,
  )
  const evidence = finalizeEvidencePacket(currentCandidates)
  const available = new Set(currentCandidates.map((item) => item.paperId))
  const resultCoverage = coverage(
    projectPaperCount,
    selectedPapers.length,
    evidence,
    available,
  )

  if (currentCandidates.length === 0) {
    return abstain(
      staleCandidates.length > 0 ? 'stale_only' : 'no_evidence',
      request,
      resultCoverage,
    )
  }
  if (evidence.items.length === 0) {
    return abstain('no_evidence', request, resultCoverage)
  }

  const sufficient =
    request.mode === 'methodology_summary'
      ? packetHasField(evidence, 'methodology')
      : request.mode === 'compare_studies'
        ? comparablePaperCount(currentCandidates) >= 2 &&
          packetComparablePaperCount(evidence) >= 2
        : evidence.paperIds.length >= 2

  return sufficient
    ? ready(request, evidence, resultCoverage)
    : abstain('insufficient_evidence', request, resultCoverage)
}

/**
 * Authenticates, authorizes, retrieves and bounds Writer evidence. This phase has
 * no provider dependency and cannot generate prose.
 */
export async function prepareWriterEvidence(
  raw: unknown,
  deps: WriterEvidenceDeps,
): Promise<WriterEvidenceResult> {
  const parsed = writerRequestSchema.safeParse(raw)
  if (!parsed.success) return failure('invalid_request')
  const request = parsed.data

  try {
    if (!(await deps.db.getUserId())) {
      return { ok: false, error: 'unauthenticated' }
    }
    const project = await deps.db.getProject(request.projectId)
    if (!project) return { ok: false, error: 'scope_not_found' }

    const projectPapers = await deps.db.listProjectPapers(request.projectId)
    const byId = new Map(projectPapers.map((paper) => [paper.id, paper]))
    const requestedIds = 'paperIds' in request ? request.paperIds : undefined
    if (requestedIds?.some((paperId) => !byId.has(paperId))) {
      return { ok: false, error: 'scope_not_found' }
    }
    const selectedPapers = requestedIds
      ? requestedIds.map((paperId) => byId.get(paperId)!)
      : projectPapers

    if (request.mode === 'literature_synthesis') {
      return prepareSemanticEvidence(request, deps, projectPapers.length)
    }
    if (selectedPapers.length === 0) {
      const empty = finalizeEvidencePacket([])
      return abstain(
        'no_evidence',
        request,
        coverage(projectPapers.length, 0, empty, new Set()),
      )
    }
    return prepareMatrixEvidence(
      request,
      deps,
      projectPapers.length,
      selectedPapers,
    )
  } catch {
    return { ok: false, error: 'retrieval_unavailable' }
  }
}
