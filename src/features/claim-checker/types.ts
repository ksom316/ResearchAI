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
