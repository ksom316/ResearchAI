import type { FieldKey } from '#/features/evidence-matrix/types'
import type { PaperCitationMetadata } from '#/features/citations/types'

export const WRITER_MODES = [
  'literature_synthesis',
  'compare_studies',
  'methodology_summary',
  'findings_synthesis',
  'limitations_future_work',
] as const

export type WriterMode = (typeof WRITER_MODES)[number]
export type WriterEvidenceId = `W${number}`

export type NormalizedWriterRequest =
  | {
      projectId: string
      mode: 'literature_synthesis'
      focus: string
    }
  | {
      projectId: string
      mode: 'compare_studies'
      paperIds: string[]
    }
  | {
      projectId: string
      mode:
        'methodology_summary' | 'findings_synthesis' | 'limitations_future_work'
      paperIds?: string[]
    }

export type WriterEvidenceLocator =
  | {
      kind: 'chunk'
      paperId: string
      chunkId: string
      sectionId: string
    }
  | {
      kind: 'extraction_claim'
      paperId: string
      schemaVersion: number
      fieldKey: FieldKey
      itemIndex: number
    }

export type WriterSourceRecord = {
  chunkId: string | null
  sectionId: string | null
  sectionTitle: string
  sectionType: string
  pageStart: number | null
  pageEnd: number | null
  excerpt: string | null
  /** A bounded live chunk snapshot when the source still resolves. */
  content: string | null
}

export type WriterEvidenceItem = {
  id: WriterEvidenceId
  locator: WriterEvidenceLocator
  paperId: string
  paperTitle: string
  claimText: string | null
  sourceRecords: WriterSourceRecord[]
  /** Sanitized, bounded text intended for the future Writer prompt. */
  promptText: string
  isStale: boolean
}

export type WriterEvidencePacket = {
  items: WriterEvidenceItem[]
  paperIds: string[]
  totalPromptChars: number
}

export type WriterEvidenceCoverage = {
  projectPaperCount: number
  selectedPaperCount: number
  participatingPaperCount: number
  unavailablePaperCount: number
  evidenceItemCount: number
}

export type WriterEvidenceErrorCode =
  | 'invalid_request'
  | 'unauthenticated'
  | 'scope_not_found'
  | 'retrieval_busy'
  | 'retrieval_unavailable'

export type WriterAbstentionStatus =
  'no_evidence' | 'insufficient_evidence' | 'stale_only'

export type WriterEvidenceResult =
  | { ok: false; error: WriterEvidenceErrorCode }
  | {
      ok: true
      status: 'ready'
      request: NormalizedWriterRequest
      evidence: WriterEvidencePacket
      coverage: WriterEvidenceCoverage
    }
  | {
      ok: true
      status: WriterAbstentionStatus
      request: NormalizedWriterRequest
      coverage: WriterEvidenceCoverage
    }

export type GroundedDraftUnit = {
  /** Assigned by the server after the complete model response is validated. */
  id: `U${number}`
  text: string
  citationIds: WriterEvidenceId[]
}

export type GroundedDraftParagraph = {
  units: GroundedDraftUnit[]
}

export type GroundedDraftCitationSource = {
  sectionTitle: string
  sectionType: string
  pageStart: number | null
  pageEnd: number | null
}

/** Server-built metadata only. Evidence text is never copied into the draft response. */
export type GroundedDraftCitation = {
  id: WriterEvidenceId
  paperId: string
  paperTitle: string
  locator: WriterEvidenceLocator
  sources: GroundedDraftCitationSource[]
}

/** One server-owned academic reference; evidence identities remain unmerged. */
export type GroundedDraftReference = {
  number: number
  paperId: string
  metadata: PaperCitationMetadata
  evidenceIds: WriterEvidenceId[]
}

export type GroundedDraft = {
  title: string
  mode: WriterMode
  paragraphs: GroundedDraftParagraph[]
  /** Only cited evidence, in order of first use. */
  citations: GroundedDraftCitation[]
  /** One entry per cited paper, in first-use order. */
  references: GroundedDraftReference[]
  coverage: WriterEvidenceCoverage
}

export type ValidatedGroundedDraft = Omit<GroundedDraft, 'references'>

export type WriterGenerationErrorCode =
  | WriterEvidenceErrorCode
  | 'writer_busy'
  | 'writer_timeout'
  | 'usage_exhausted'
  | 'writer_unavailable'
  | 'writer_truncated'
  | 'invalid_output'
  | 'invalid_citation'
  | 'invalid_content'

export type WriterGenerationResult =
  | { ok: false; error: WriterGenerationErrorCode; resetDate?: string }
  | {
      ok: true
      status: 'generated'
      draft: GroundedDraft
    }
  | {
      ok: true
      status: WriterAbstentionStatus
      stage: 'evidence' | 'generation'
      explanation: string
      request: NormalizedWriterRequest
      coverage: WriterEvidenceCoverage
    }
