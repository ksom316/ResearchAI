import { claimCheckModelOutputSchema } from './model-schema'
import type { ClaimCheckModelOutput } from './model-schema'
import type {
  ClaimCheckEvidencePacket,
  ClaimSupportAssessment,
  NormalizedClaimCheckRequest,
} from './types'

export type ClaimAssessmentValidation =
  | { ok: true; assessment: ClaimSupportAssessment }
  | { ok: false; error: 'invalid_output' | 'invalid_assessment' }

const FORMATTING =
  /<\/?[A-Za-z][^>]*>|```|(?:^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s)|\[[^\]]+\]\([^)]+\)|\*\*|__/m
const WRITER_ID = /\bW\d{1,3}\b/i

function normalizedLiteral(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function plain(value: string): boolean {
  return !FORMATTING.test(value) && !WRITER_ID.test(value)
}

function consistent(
  output: ClaimCheckModelOutput,
  normalizedClaim: string,
  normalizedFragments: readonly string[],
): boolean {
  const supports = output.citation_assessments.map((entry) => entry.support)
  if (output.overall_support === 'supported') {
    const supportive = supports.filter(
      (support) => support === 'partially_supported',
    ).length
    return (
      output.unsupported_fragments.length === 0 &&
      (supports.includes('supported') || supportive >= 2)
    )
  }
  if (output.overall_support === 'partially_supported') {
    return (
      output.unsupported_fragments.length > 0 &&
      !supports.includes('supported') &&
      supports.includes('partially_supported') &&
      normalizedFragments.every((fragment) => fragment !== normalizedClaim)
    )
  }
  if (output.overall_support === 'unsupported') {
    return (
      output.unsupported_fragments.length > 0 &&
      !supports.includes('supported')
    )
  }
  return !supports.includes('supported')
}

/** All-or-nothing validation; no IDs, entries, or text are repaired or discarded. */
export function validateClaimAssessment(
  data: unknown,
  input: {
    request: NormalizedClaimCheckRequest
    evidence: ClaimCheckEvidencePacket
  },
): ClaimAssessmentValidation {
  const parsed = claimCheckModelOutputSchema.safeParse(data)
  if (!parsed.success) return { ok: false, error: 'invalid_output' }
  const output = parsed.data

  const expectedIds: string[] = input.evidence.items.map((item) => item.id)
  const receivedIds = output.citation_assessments.map(
    (assessment) => assessment.evidence_id,
  )
  if (
    receivedIds.length !== expectedIds.length ||
    new Set(receivedIds).size !== receivedIds.length ||
    expectedIds.some((id) => !receivedIds.includes(id)) ||
    receivedIds.some((id) => !expectedIds.includes(id))
  ) {
    return { ok: false, error: 'invalid_assessment' }
  }

  const textValues = [
    output.summary,
    ...output.unsupported_fragments,
    ...output.citation_assessments.map((assessment) => assessment.rationale),
  ]
  if (textValues.some((value) => !plain(value))) {
    return { ok: false, error: 'invalid_assessment' }
  }

  const normalizedClaim = normalizedLiteral(input.evidence.claimText)
  const normalizedFragments = output.unsupported_fragments.map(normalizedLiteral)
  if (
    new Set(normalizedFragments).size !== normalizedFragments.length ||
    normalizedFragments.some(
      (fragment) => !fragment || !normalizedClaim.includes(fragment),
    ) ||
    !consistent(output, normalizedClaim, normalizedFragments)
  ) {
    return { ok: false, error: 'invalid_assessment' }
  }

  const byId = new Map(
    output.citation_assessments.map((assessment) => [
      assessment.evidence_id,
      assessment,
    ]),
  )
  return {
    ok: true,
    assessment: {
      claimId: input.request.claimId,
      overallSupport: output.overall_support,
      summary: output.summary,
      unsupportedFragments: output.unsupported_fragments,
      citations: input.evidence.items.map((item) => {
        const assessment = byId.get(item.id)!
        return {
          citationId: item.writerCitationId,
          support: assessment.support,
          rationale: assessment.rationale,
          paperId: item.paperId,
          paperTitle: item.paperTitle,
          locator: item.locator,
        }
      }),
    },
  }
}
