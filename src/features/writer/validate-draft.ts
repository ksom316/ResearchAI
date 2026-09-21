import { writerModelOutputSchema } from './generation-schema'
import { evidenceIdentity } from './evidence'
import { writerDraftTitle } from './prompt'
import type {
  GroundedDraftCitation,
  NormalizedWriterRequest,
  WriterEvidenceCoverage,
  WriterEvidenceId,
  WriterEvidenceItem,
  WriterEvidencePacket,
  ValidatedGroundedDraft,
} from './types'

export type DraftValidation =
  | { ok: true; status: 'generated'; draft: ValidatedGroundedDraft }
  | { ok: true; status: 'insufficient_evidence' }
  | {
      ok: false
      error: 'invalid_output' | 'invalid_citation' | 'invalid_content'
    }

const TEXT_CITATION =
  /(?:\[\s*)?\bW\d{1,3}\b(?:\s*\])?|\[\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*\]/i

function schemaError(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): 'invalid_output' | 'invalid_citation' | 'invalid_content' {
  if (
    issues.some((issue) => issue.path.some((part) => part === 'citation_ids'))
  ) {
    return 'invalid_citation'
  }
  if (
    issues.some(
      (issue) =>
        issue.path.some((part) => part === 'text') ||
        issue.message === 'generated_text_limit',
    )
  ) {
    return 'invalid_content'
  }
  return 'invalid_output'
}

function validPacketItem(
  item: WriterEvidenceItem,
  index: number,
  packet: WriterEvidencePacket,
): boolean {
  return (
    item.id === `W${index + 1}` &&
    item.locator.paperId === item.paperId &&
    packet.paperIds.includes(item.paperId) &&
    !item.isStale
  )
}

function citationMetadata(item: WriterEvidenceItem): GroundedDraftCitation {
  return {
    id: item.id,
    paperId: item.paperId,
    paperTitle: item.paperTitle,
    locator: item.locator,
    sources: item.sourceRecords.map((source) => ({
      sectionTitle: source.sectionTitle,
      sectionType: source.sectionType,
      pageStart: source.pageStart,
      pageEnd: source.pageEnd,
    })),
  }
}

/**
 * Validates the complete response and constructs a draft only after every unit and
 * citation passes. No branch removes, repairs, or salvages model output.
 */
export function validateWriterDraft(
  data: unknown,
  input: {
    request: NormalizedWriterRequest
    evidence: WriterEvidencePacket
    coverage: WriterEvidenceCoverage
  },
): DraftValidation {
  const parsed = writerModelOutputSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: schemaError(parsed.error.issues) }
  }
  if (parsed.data.status === 'insufficient_evidence') {
    return { ok: true, status: 'insufficient_evidence' }
  }

  const byId = new Map<WriterEvidenceId, WriterEvidenceItem>()
  const packetOrder = new Map<WriterEvidenceId, number>()
  const provenance = new Set<string>()
  for (const [index, item] of input.evidence.items.entries()) {
    const identity = evidenceIdentity(item.locator)
    if (
      !validPacketItem(item, index, input.evidence) ||
      byId.has(item.id) ||
      provenance.has(identity)
    ) {
      return { ok: false, error: 'invalid_citation' }
    }
    provenance.add(identity)
    byId.set(item.id, item)
    packetOrder.set(item.id, index)
  }

  const citations = new Map<WriterEvidenceId, GroundedDraftCitation>()
  let unitIndex = 0
  const paragraphs = []

  for (const paragraph of parsed.data.paragraphs) {
    const units = []
    for (const unit of paragraph.units) {
      if (TEXT_CITATION.test(unit.text)) {
        return { ok: false, error: 'invalid_content' }
      }
      const seen = new Set<WriterEvidenceId>()
      const resolved: Array<{
        id: WriterEvidenceId
        item: WriterEvidenceItem
      }> = []
      for (const rawId of unit.citation_ids) {
        const id = rawId as WriterEvidenceId
        const item = byId.get(id)
        if (!item || seen.has(id)) {
          return { ok: false, error: 'invalid_citation' }
        }
        seen.add(id)
        resolved.push({ id, item })
      }
      resolved.sort(
        (a, b) =>
          (packetOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (packetOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      )
      for (const { id, item } of resolved) {
        if (!citations.has(id)) citations.set(id, citationMetadata(item))
      }
      unitIndex++
      units.push({
        id: `U${unitIndex}` as const,
        text: unit.text,
        citationIds: resolved.map(({ id }) => id),
      })
    }
    paragraphs.push({ units })
  }

  return {
    ok: true,
    status: 'generated',
    draft: {
      title: writerDraftTitle(input.request),
      mode: input.request.mode,
      paragraphs,
      citations: [...citations.values()],
      coverage: input.coverage,
    },
  }
}
