import type { PaperCoverage } from '#/features/search/types'

/** Built by the SERVER from retrieval metadata, never from model output. */
export type ChatCitation = {
  id: string
  paperId: string
  paperTitle: string
  chunkId: string
  sectionTitle: string
  sectionType: string
  pageStart: number | null
  pageEnd: number | null
}

export type ChatSegment = {
  text: string
  /** Validated evidence ids (each has a matching entry in `citations`). */
  citations: string[]
}

export type ChatErrorCode =
  | 'invalid_request'
  | 'unauthenticated'
  | 'scope_not_found'
  | 'search_busy'
  | 'search_unavailable'
  | 'answer_busy' // LLM rate limited
  | 'answer_timeout' // LLM took too long
  | 'usage_exhausted'
  | 'answer_unavailable' // LLM failure, unusable output, or nothing grounded

export type ChatStatus =
  'answered' | 'insufficient_evidence' | 'out_of_scope' | 'no_evidence'

export type AskOutcome =
  | {
      ok: true
      status: ChatStatus
      /** Only 'answered' segments carry citations. */
      segments: ChatSegment[]
      /** Only the citations actually used, in order of first use. */
      citations: ChatCitation[]
      /** Short note for insufficient_evidence / out_of_scope only; never an answer. */
      explanation: string | null
      limitations: string | null
      followUps: string[]
      coverage: PaperCoverage[]
    }
  | { ok: false; error: ChatErrorCode; resetDate?: string }
