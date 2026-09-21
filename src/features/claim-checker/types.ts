import type {
  WriterEvidenceId,
  WriterEvidenceLocator,
  WriterSourceRecord,
} from '#/features/writer/types'

export type ClaimCheckClaimId = `U${number}`
export type ClaimCheckEvidenceId = `C${number}`

export type ClaimCheckCitationSelector = {
  citationId: WriterEvidenceId
  locator: WriterEvidenceLocator
}

export type NormalizedClaimCheckRequest = {
  projectId: string
  claimId: ClaimCheckClaimId
  claimText: string
  citations: ClaimCheckCitationSelector[]
}

export type ClaimCheckEvidenceItem = {
  id: ClaimCheckEvidenceId
  writerCitationId: WriterEvidenceId
  locator: WriterEvidenceLocator
  paperId: string
  paperTitle: string
  claimText: string | null
  sourceRecords: WriterSourceRecord[]
  promptText: string
}

export type ClaimCheckEvidencePacket = {
  claimText: string
  items: ClaimCheckEvidenceItem[]
  totalPromptEvidenceChars: number
}

export type ClaimCheckAbstentionReason =
  | 'stale_evidence'
  | 'evidence_missing'
  | 'paper_not_ready'
  | 'no_usable_source'
  | 'evidence_budget_exceeded'

export type ClaimCheckEvidenceError =
  | 'invalid_request'
  | 'unauthenticated'
  | 'scope_not_found'
  | 'evidence_unavailable'

export type ClaimCheckEvidenceResult =
  | { ok: false; error: ClaimCheckEvidenceError }
  | {
      ok: true
      status: 'insufficient_evidence'
      reason: ClaimCheckAbstentionReason
      request: NormalizedClaimCheckRequest
    }
  | {
      ok: true
      status: 'ready'
      request: NormalizedClaimCheckRequest
      evidence: ClaimCheckEvidencePacket
    }

export const CLAIM_SUPPORT_VALUES = [
  'supported',
  'partially_supported',
  'unsupported',
  'insufficient_evidence',
] as const

export type ClaimSupport = (typeof CLAIM_SUPPORT_VALUES)[number]

export type ClaimCitationAssessment = {
  citationId: WriterEvidenceId
  support: ClaimSupport
  rationale: string
  paperId: string
  paperTitle: string
  locator: WriterEvidenceLocator
}

export type ClaimSupportAssessment = {
  claimId: ClaimCheckClaimId
  overallSupport: ClaimSupport
  summary: string
  unsupportedFragments: string[]
  citations: ClaimCitationAssessment[]
}

export type ClaimCheckAssessmentError =
  | ClaimCheckEvidenceError
  | 'checker_busy'
  | 'checker_timeout'
  | 'checker_unavailable'
  | 'checker_truncated'
  | 'invalid_output'
  | 'invalid_assessment'

export type ClaimCheckResult =
  | { ok: false; error: ClaimCheckAssessmentError }
  | {
      ok: true
      status: 'insufficient_evidence'
      stage: 'evidence'
      claimId: ClaimCheckClaimId
      reason: ClaimCheckAbstentionReason
      explanation: string
    }
  | {
      ok: true
      status: 'assessed'
      assessment: ClaimSupportAssessment
    }
