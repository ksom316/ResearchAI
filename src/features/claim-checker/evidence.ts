import type { WriterDb } from '#/features/writer/writer-db.server'
import { resolveWriterEvidenceLocators } from '#/features/writer/provenance'
import type { WriterSourceRecord } from '#/features/writer/types'
import { claimCheckRequestSchema } from './schemas'
import {
  boundedClaimCheckText,
  sanitizeClaimCheckLine,
} from './sanitize'
import type {
  ClaimCheckAbstentionReason,
  ClaimCheckEvidenceItem,
  ClaimCheckEvidenceResult,
  NormalizedClaimCheckRequest,
} from './types'

export const MAX_CLAIM_CHECK_SOURCES_PER_CITATION = 3
export const MAX_CLAIM_CHECK_SOURCE_CHARS = 1_200
export const MAX_CLAIM_CHECK_EVIDENCE_CHARS = 10_000
const MAX_CLAIM_CHECK_TITLE_CHARS = 200
const MAX_CLAIM_CHECK_SECTION_CHARS = 300

function abstain(
  request: NormalizedClaimCheckRequest,
  reason: ClaimCheckAbstentionReason,
): ClaimCheckEvidenceResult {
  return { ok: true, status: 'insufficient_evidence', reason, request }
}

function usableSource(source: WriterSourceRecord): WriterSourceRecord | null {
  const excerpt = source.excerpt
    ? boundedClaimCheckText(source.excerpt, MAX_CLAIM_CHECK_SOURCE_CHARS)
    : null
  const content = source.content
    ? boundedClaimCheckText(source.content, MAX_CLAIM_CHECK_SOURCE_CHARS)
    : null
  if (!excerpt && !content) return null
  return {
    chunkId: source.chunkId,
    sectionId: source.sectionId,
    sectionTitle: sanitizeClaimCheckLine(
      source.sectionTitle,
      MAX_CLAIM_CHECK_SECTION_CHARS,
    ),
    sectionType: sanitizeClaimCheckLine(source.sectionType, 100),
    pageStart: source.pageStart,
    pageEnd: source.pageEnd,
    excerpt,
    content,
  }
}

function promptText(
  claimText: string | null,
  sources: readonly WriterSourceRecord[],
): string {
  const parts = claimText ? [`Extracted claim: ${claimText}`] : []
  for (const [index, source] of sources.entries()) {
    const text = source.content ?? source.excerpt
    if (text) parts.push(`Source ${index + 1}: ${text}`)
  }
  return parts.join('\n')
}

/** Authenticates and resolves every cited locator before constructing any C ids. */
export async function prepareClaimCheckEvidence(
  raw: unknown,
  deps: { db: WriterDb },
): Promise<ClaimCheckEvidenceResult> {
  const parsed = claimCheckRequestSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_request' }
  const request = parsed.data as NormalizedClaimCheckRequest
  const resolved = await resolveWriterEvidenceLocators(
    request.projectId,
    request.citations.map((citation) => citation.locator),
    deps.db,
  )
  if (!resolved.ok) {
    if (resolved.error === 'unauthenticated') {
      return { ok: false, error: 'unauthenticated' }
    }
    if (resolved.error === 'scope_not_found') {
      return { ok: false, error: 'scope_not_found' }
    }
    if (resolved.error === 'unavailable') {
      return { ok: false, error: 'evidence_unavailable' }
    }
    return abstain(
      request,
      resolved.error === 'stale'
        ? 'stale_evidence'
        : resolved.error === 'paper_not_ready'
          ? 'paper_not_ready'
          : resolved.error === 'unusable'
            ? 'no_usable_source'
            : 'evidence_missing',
    )
  }

  const items: ClaimCheckEvidenceItem[] = []
  let totalPromptEvidenceChars = 0
  for (const [index, provenance] of resolved.provenance.entries()) {
    const selector = request.citations[index]
    const sources = provenance.sources
      .map(usableSource)
      .filter((source): source is WriterSourceRecord => source !== null)
      .slice(0, MAX_CLAIM_CHECK_SOURCES_PER_CITATION)
    if (sources.length === 0) {
      return abstain(request, 'no_usable_source')
    }
    const extractedClaim = provenance.claimText
      ? boundedClaimCheckText(provenance.claimText, 500)
      : null
    const text = promptText(extractedClaim, sources)
    if (!text) return abstain(request, 'no_usable_source')
    totalPromptEvidenceChars += text.length
    items.push({
      id: `C${index + 1}`,
      writerCitationId: selector.citationId,
      locator: selector.locator,
      paperId: provenance.paperId,
      paperTitle: sanitizeClaimCheckLine(
        provenance.paperTitle,
        MAX_CLAIM_CHECK_TITLE_CHARS,
      ),
      claimText: extractedClaim,
      sourceRecords: sources,
      promptText: text,
    })
  }
  if (totalPromptEvidenceChars > MAX_CLAIM_CHECK_EVIDENCE_CHARS) {
    return abstain(request, 'evidence_budget_exceeded')
  }

  return {
    ok: true,
    status: 'ready',
    request,
    evidence: {
      claimText: request.claimText,
      items,
      totalPromptEvidenceChars,
    },
  }
}
