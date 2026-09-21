import { z } from 'zod'
import {
  EmbeddingError,
  INPUT_PROFILE_CTX_V1,
  VOYAGE_PHASE4_PROFILE,
} from '#/lib/embedding'
import { searchRequestSchema } from './schemas'
import type {
  PaperCoverage,
  SearchErrorCode,
  SearchCoverageOutcome,
  SearchHit,
  SearchOutcome,
  SearchRequest,
} from './types'

const coverageRequestSchema = z.object({ projectId: z.string().uuid() }).strict()

export type RpcResult = {
  data: unknown
  error: { message: string } | null
}

/** What the service needs from Supabase, as the authenticated caller. */
export type SearchDb = {
  /** Verified user id of the current session, or null. */
  getUserId: () => Promise<string | null>
  /** get_search_coverage */
  coverage: (args: {
    paperIds: string[] | null
    projectId: string | null
  }) => Promise<RpcResult>
  /** The embedding_models row with status = 'active' (one row or null). */
  activeProfile: () => Promise<RpcResult>
  /** search_paper_chunks */
  search: (args: {
    queryEmbedding: number[]
    expectedModelId: string
    paperIds: string[] | null
    projectId: string | null
    limit: number
    minSimilarity: number | null
    includeReferences: boolean
  }) => Promise<RpcResult>
}

export type SearchDeps = {
  db: SearchDb
  /** Embeds the (already normalized) query text as a QUERY. Throws EmbeddingError. */
  embedQuery: (query: string) => Promise<number[]>
}

const coverageRow = z.object({
  paper_id: z.string(),
  paper_title: z.string(),
  state: z.enum([
    'searchable',
    'pdf_processing',
    'pdf_failed',
    'not_indexed',
    'index_pending',
    'indexing',
    'index_failed',
    'index_stale',
  ]),
  chunk_count: z.number(),
})

/** Shared safe boundary for the authenticated get_search_coverage RPC. */
export function parseSearchCoverage(value: unknown): PaperCoverage[] | null {
  const parsed = z.array(coverageRow).safeParse(value)
  if (!parsed.success) return null
  return parsed.data.map((row) => ({
    paperId: row.paper_id,
    paperTitle: row.paper_title,
    state: row.state,
    chunkCount: row.chunk_count,
  }))
}

const profileRow = z.object({
  id: z.string(),
  provider: z.string(),
  provider_model: z.string(),
  dimensions: z.number(),
  input_profile: z.string(),
})

/** Parsing rows field by field also strips anything the database might add later. */
const hitRow = z.object({
  rank: z.number(),
  similarity: z.number(),
  paper_id: z.string(),
  paper_title: z.string(),
  chunk_id: z.string(),
  chunk_index: z.number(),
  char_start: z.number(),
  char_end: z.number(),
  page_start: z.number().nullable(),
  page_end: z.number().nullable(),
  section_id: z.string(),
  section_title: z.string(),
  section_type: z.string(),
  section_position: z.number(),
  content: z.string(),
})

const scopeArgs = (request: SearchRequest) => ({
  paperIds: request.scope.type === 'papers' ? request.scope.paperIds : null,
  projectId: request.scope.type === 'project' ? request.scope.projectId : null,
})

/** Maps a database error to a safe code. Only the fixed RPC identifiers are read. */
function rpcError(error: { message: string }): SearchErrorCode {
  if (error.message.includes('search_scope_not_found')) return 'scope_not_found'
  if (error.message.includes('search_unauthenticated')) return 'unauthenticated'
  if (error.message.includes('search_invalid_argument'))
    return 'invalid_request'
  return 'search_unavailable'
}

const fail = (error: SearchErrorCode): SearchOutcome => ({ ok: false, error })

/** Coverage-only path: authenticated RPC inspection with no embedding/provider call. */
export async function runSearchCoverage(
  raw: unknown,
  db: Pick<SearchDb, 'getUserId' | 'coverage'>,
): Promise<SearchCoverageOutcome> {
  const request = coverageRequestSchema.safeParse(raw)
  if (!request.success) return { ok: false, error: 'invalid_request' }
  try {
    if (!(await db.getUserId())) return { ok: false, error: 'unauthenticated' }
    const result = await db.coverage({
      paperIds: null,
      projectId: request.data.projectId,
    })
    if (result.error) {
      return {
        ok: false,
        error: result.error.message.includes('search_scope_not_found')
          ? 'scope_not_found'
          : result.error.message.includes('search_unauthenticated')
            ? 'unauthenticated'
            : 'search_unavailable',
      }
    }
    const coverage = parseSearchCoverage(result.data)
    return coverage
      ? { ok: true, coverage }
      : { ok: false, error: 'search_unavailable' }
  } catch {
    return { ok: false, error: 'search_unavailable' }
  }
}

/**
 * Question -> coverage -> (only if something is searchable) query embedding -> exact
 * cosine retrieval. The provider is never called when no paper in scope is searchable;
 * that is why the active profile is read after coverage, not before.
 */
export async function runSemanticSearch(
  raw: unknown,
  deps: SearchDeps,
): Promise<SearchOutcome> {
  const parsed = searchRequestSchema.safeParse(raw)
  if (!parsed.success) return fail('invalid_request')
  const request: SearchRequest = parsed.data
  const { db } = deps

  try {
    if (!(await db.getUserId())) return fail('unauthenticated')

    const scope = scopeArgs(request)
    const coverageResult = await db.coverage(scope)
    if (coverageResult.error) return fail(rpcError(coverageResult.error))
    const coverage = parseSearchCoverage(coverageResult.data)
    if (!coverage) return fail('search_unavailable')

    if (!coverage.some((paper) => paper.state === 'searchable')) {
      return { ok: true, status: 'nothing_searchable', results: [], coverage }
    }

    const profileResult = await db.activeProfile()
    if (profileResult.error) return fail('search_unavailable')
    const profile = profileRow.safeParse(profileResult.data)
    if (
      !profile.success ||
      profile.data.provider !== VOYAGE_PHASE4_PROFILE.provider ||
      profile.data.provider_model !== VOYAGE_PHASE4_PROFILE.model ||
      profile.data.dimensions !== VOYAGE_PHASE4_PROFILE.dimensions ||
      profile.data.input_profile !== INPUT_PROFILE_CTX_V1
    ) {
      return fail('search_unavailable')
    }

    // The normalized question is sent as-is: no ctx-v1 document header.
    let queryEmbedding: number[]
    try {
      queryEmbedding = await deps.embedQuery(request.query)
    } catch (error) {
      return fail(
        error instanceof EmbeddingError && error.kind === 'rate_limited'
          ? 'search_busy'
          : 'search_unavailable',
      )
    }

    const searchResult = await db.search({
      queryEmbedding,
      expectedModelId: profile.data.id,
      ...scope,
      limit: request.limit,
      minSimilarity: request.minSimilarity,
      includeReferences: request.includeReferences,
    })
    if (searchResult.error) return fail(rpcError(searchResult.error))
    const hitRows = z.array(hitRow).safeParse(searchResult.data)
    if (!hitRows.success) return fail('search_unavailable')

    const results: SearchHit[] = hitRows.data.map((row) => ({
      rank: row.rank,
      similarity: row.similarity,
      paperId: row.paper_id,
      paperTitle: row.paper_title,
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      charStart: row.char_start,
      charEnd: row.char_end,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      sectionId: row.section_id,
      sectionTitle: row.section_title,
      sectionType: row.section_type,
      sectionPosition: row.section_position,
      content: row.content,
    }))
    return { ok: true, status: 'results', results, coverage }
  } catch {
    // Never surface raw errors: they could carry query text or secrets.
    return fail('search_unavailable')
  }
}
