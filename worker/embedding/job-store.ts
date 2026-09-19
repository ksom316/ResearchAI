import type { SupabaseClient } from '@supabase/supabase-js'
import { StoreError } from './failure'
import type {
  ChunkForEmbedding,
  ClaimedEmbeddingJob,
  EmbeddingJobStore,
  EmbeddingRow,
  JobFailure,
  PaperChunkSnapshot,
} from './types'

export type EmbeddingStoreConfig = {
  jobMaxAttempts: number
  staleAfterMinutes: number
}

type ClaimRow = {
  paper_id: string
  user_id: string
  model_id: string
  claim_started_at: string
  source_completed_at: string
  attempts: number
  chunk_count: number
  provider: string
  provider_model: string
  dimensions: number
  input_profile: string
}

const PAGE = 500

/**
 * Supabase implementation of the embedding job store. Uses the service-role client
 * (worker only). Every write goes through a fenced RPC with parameterized
 * arguments; no SQL is ever assembled as a string. Errors are reduced to the
 * operation name and SQLSTATE so raw database messages (which may echo row data)
 * never reach logs or job rows.
 */
function fail(operation: string, error: { code?: string } | null): never {
  const code =
    error?.code && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null
  throw new StoreError(operation, code)
}

/** Reads every row of a query in pages (PostgREST returns at most 1000 per request). */
async function fetchAll<T>(
  operation: string,
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) fail(operation, error)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/**
 * Everything ctx-v1 needs for one paper, in chunk_index order, plus the content
 * hashes of embeddings already stored for `modelId`. Read-only.
 */
export async function loadPaperSnapshot(
  client: SupabaseClient,
  paperId: string,
  modelId: string,
): Promise<PaperChunkSnapshot> {
  const paper = await client
    .from('papers')
    .select('title')
    .eq('id', paperId)
    .maybeSingle()
  if (paper.error) fail('load paper', paper.error)

  const sections = await fetchAll<{ id: string; title: string }>(
    'load sections',
    (from, to) =>
      client
        .from('paper_sections')
        .select('id, title')
        .eq('paper_id', paperId)
        .order('position', { ascending: true })
        .range(from, to),
  )
  const sectionTitles = new Map(sections.map((s) => [s.id, s.title]))

  const chunks = await fetchAll<{
    id: string
    chunk_index: number
    section_id: string
    text: string
  }>('load chunks', (from, to) =>
    client
      .from('paper_chunks')
      .select('id, chunk_index, section_id, text')
      .eq('paper_id', paperId)
      .order('chunk_index', { ascending: true })
      .range(from, to),
  )

  const existing = await fetchAll<{
    chunk_id: string
    content_hash: string | null
  }>('load existing embeddings', (from, to) =>
    client
      .from('chunk_embeddings')
      .select('chunk_id, content_hash')
      .eq('paper_id', paperId)
      .eq('model_id', modelId)
      .order('chunk_id', { ascending: true })
      .range(from, to),
  )

  const mapped: ChunkForEmbedding[] = chunks.map((c) => ({
    id: c.id,
    index: c.chunk_index,
    text: c.text,
    sectionTitle: sectionTitles.get(c.section_id) ?? null,
  }))
  return {
    paperTitle: paper.data?.title ?? null,
    chunks: mapped,
    existingHashes: new Map(existing.map((e) => [e.chunk_id, e.content_hash])),
  }
}

export function createSupabaseEmbeddingStore(
  client: SupabaseClient,
  config: EmbeddingStoreConfig,
): EmbeddingJobStore {
  return {
    async claimNext(paperId) {
      const { data, error } = await client.rpc('claim_next_embedding_job', {
        p_paper_id: paperId ?? null,
        p_max_attempts: config.jobMaxAttempts,
        p_stale_after: `${config.staleAfterMinutes} minutes`,
      })
      if (error) fail('claim_next_embedding_job', error)
      const row = (data as ClaimRow[] | null)?.[0]
      if (!row) return null
      return {
        paperId: row.paper_id,
        userId: row.user_id,
        modelId: row.model_id,
        claimStartedAt: row.claim_started_at,
        sourceCompletedAt: row.source_completed_at,
        attempts: row.attempts,
        chunkCount: row.chunk_count,
        profile: {
          provider: row.provider,
          providerModel: row.provider_model,
          dimensions: row.dimensions,
          inputProfile: row.input_profile,
        },
      }
    },

    loadSnapshot: (job) => loadPaperSnapshot(client, job.paperId, job.modelId),

    async storeEmbeddings(job: ClaimedEmbeddingJob, rows: EmbeddingRow[]) {
      const { data, error } = await client.rpc('store_chunk_embeddings', {
        p_paper_id: job.paperId,
        p_model_id: job.modelId,
        p_claim_started_at: job.claimStartedAt,
        // A JSON array of numbers per row; the database casts it to vector(1024).
        p_rows: rows.map((r) => ({
          chunk_id: r.chunkId,
          embedding: r.embedding,
          content_hash: r.contentHash,
        })),
      })
      if (error) fail('store_chunk_embeddings', error)
      const stored = data as number
      return stored < 0 ? null : stored
    },

    async complete(job) {
      const { data, error } = await client.rpc('complete_embedding_job', {
        p_paper_id: job.paperId,
        p_model_id: job.modelId,
        p_claim_started_at: job.claimStartedAt,
      })
      if (error) fail('complete_embedding_job', error)
      return data === true
    },

    async fail(job, failure: JobFailure) {
      const { data, error } = await client.rpc('fail_embedding_job', {
        p_paper_id: job.paperId,
        p_model_id: job.modelId,
        p_claim_started_at: job.claimStartedAt,
        p_error: failure.message,
        p_retry: failure.retry,
        p_count_attempt: failure.countAttempt,
        p_retry_delay: `${Math.ceil(failure.retryDelayMs / 1000)} seconds`,
      })
      if (error) fail('fail_embedding_job', error)
      return data === true
    },
  }
}
