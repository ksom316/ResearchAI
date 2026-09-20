import type { FieldKey } from '#/features/evidence-matrix/types'

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

type AbstentionStatus = 'no_evidence' | 'insufficient_evidence' | 'stale_only'

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
      status: AbstentionStatus
      request: NormalizedWriterRequest
      coverage: WriterEvidenceCoverage
    }
