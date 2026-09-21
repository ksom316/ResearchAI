/** Where a search looks. Ownership is enforced by the database, never by these ids. */
export type SearchScope =
  | { type: 'library' }
  | { type: 'project'; projectId: string }
  | { type: 'papers'; paperIds: string[] }

/** A validated, normalized request (see schemas.ts). */
export type SearchRequest = {
  query: string
  scope: SearchScope
  limit: number
  minSimilarity: number | null
  includeReferences: boolean
}

export type CoverageState =
  | 'searchable'
  | 'pdf_processing'
  | 'pdf_failed'
  | 'not_indexed'
  | 'index_pending'
  | 'indexing'
  | 'index_failed'
  | 'index_stale'

export type PaperCoverage = {
  paperId: string
  paperTitle: string
  state: CoverageState
  chunkCount: number
}

/** Exactly the fields search_paper_chunks exposes: no vectors, hashes or user ids. */
export type SearchHit = {
  rank: number
  similarity: number
  paperId: string
  paperTitle: string
  chunkId: string
  chunkIndex: number
  charStart: number
  charEnd: number
  pageStart: number | null
  pageEnd: number | null
  sectionId: string
  sectionTitle: string
  sectionType: string
  sectionPosition: number
  content: string
}

export type SearchErrorCode =
  | 'invalid_request'
  | 'unauthenticated'
  | 'scope_not_found'
  | 'search_busy'
  | 'search_unavailable'

export type SearchOutcome =
  | {
      ok: true
      /** 'nothing_searchable': no paper in scope is indexed yet; no provider call was made. */
      status: 'results' | 'nothing_searchable'
      results: SearchHit[]
      coverage: PaperCoverage[]
    }
  | { ok: false; error: SearchErrorCode }

export type SearchCoverageOutcome =
  | { ok: true; coverage: PaperCoverage[] }
  | {
      ok: false
      error: 'invalid_request' | 'unauthenticated' | 'scope_not_found' | 'search_unavailable'
    }
