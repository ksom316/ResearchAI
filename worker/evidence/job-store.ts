import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaperInput } from '../../src/features/evidence-matrix/evidence-packet'
import { EVIDENCE_SCHEMA_VERSION } from '../../src/features/evidence-matrix/fields'
import { StoreError } from '../embedding/failure'
import type { ExtractionStore, LoadedPaper } from './types'

export type EvidenceStoreConfig = {
  maxAttempts: number
  staleAfterMinutes: number
}

type ClaimRow = {
  paper_id: string
  user_id: string
  schema_version: number
  source_completed_at: string
  claim_started_at: string
  attempts: number
}

const PAGE = 500

/** Only the operation name and SQLSTATE are kept (raw messages can echo row data). */
function fail(operation: string, error: { code?: string } | null): never {
  const code =
    error?.code && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null
  throw new StoreError(operation, code)
}

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

const sameInstant = (a: string | null, b: string) =>
  a !== null && new Date(a).getTime() === new Date(b).getTime()

/**
 * Supabase implementation (service-role client, worker only). READS use the tables;
 * every WRITE goes through a fenced 0009/0010 function. Nothing is written directly.
 */
export function createSupabaseExtractionStore(
  client: SupabaseClient,
  config: EvidenceStoreConfig,
): ExtractionStore {
  async function readGeneration(
    paperId: string,
  ): Promise<{ status: string; generation: string | null } | null> {
    const { data, error } = await client
      .from('papers')
      .select('status, processing_completed_at')
      .eq('id', paperId)
      .maybeSingle()
    if (error) fail('load paper', error)
    if (!data) return null
    const row: { status: string; processing_completed_at: string | null } =
      data
    return { status: row.status, generation: row.processing_completed_at }
  }

  return {
    async claimNext() {
      const { data, error } = await client.rpc('claim_next_paper_extraction', {
        p_schema_version: EVIDENCE_SCHEMA_VERSION,
        p_max_attempts: config.maxAttempts,
        p_stale_after: `${config.staleAfterMinutes} minutes`,
      })
      if (error) fail('claim_next_paper_extraction', error)
      const row = (data as ClaimRow[] | null)?.[0]
      if (!row) return null
      return {
        paperId: row.paper_id,
        userId: row.user_id,
        schemaVersion: row.schema_version,
        sourceCompletedAt: row.source_completed_at,
        claimStartedAt: row.claim_started_at,
        attempts: row.attempts,
      }
    },

    async loadPaper(claim): Promise<LoadedPaper> {
      const empty: PaperInput = {
        paperId: claim.paperId,
        sections: [],
        chunks: [],
      }
      const before = await readGeneration(claim.paperId)
      if (
        !before ||
        before.status !== 'ready' ||
        !sameInstant(before.generation, claim.sourceCompletedAt)
      ) {
        return { input: empty, generationCurrent: false }
      }

      const sections = await fetchAll<{
        id: string
        title: string
        section_type: string
      }>('load sections', (from, to) =>
        client
          .from('paper_sections')
          .select('id, title, section_type')
          .eq('paper_id', claim.paperId)
          .order('position', { ascending: true })
          .range(from, to),
      )
      const chunks = await fetchAll<{
        id: string
        section_id: string
        chunk_index: number
        text: string
        page_start: number | null
        page_end: number | null
      }>('load chunks', (from, to) =>
        client
          .from('paper_chunks')
          .select('id, section_id, chunk_index, text, page_start, page_end')
          .eq('paper_id', claim.paperId)
          .order('chunk_index', { ascending: true })
          .range(from, to),
      )

      // Reprocessing between the reads would mix generations: check again.
      const after = await readGeneration(claim.paperId)
      const current =
        !!after &&
        after.status === 'ready' &&
        sameInstant(after.generation, claim.sourceCompletedAt)
      return {
        generationCurrent: current,
        input: {
          paperId: claim.paperId,
          sections: sections.map((s) => ({
            id: s.id,
            title: s.title,
            sectionType: s.section_type,
          })),
          chunks: chunks.map((c) => ({
            id: c.id,
            sectionId: c.section_id,
            chunkIndex: c.chunk_index,
            text: c.text,
            pageStart: c.page_start,
            pageEnd: c.page_end,
          })),
        },
      }
    },

    async storeField(claim, field) {
      const { data, error } = await client.rpc('store_extraction_field', {
        p_paper_id: claim.paperId,
        p_schema_version: claim.schemaVersion,
        p_claim_started_at: claim.claimStartedAt,
        p_field_key: field.fieldKey,
        p_state: field.state,
        p_value: field.value,
        p_sources: field.sources,
      })
      if (error) fail('store_extraction_field', error)
      return data === true
    },

    async complete(claim, provider, model) {
      const { data, error } = await client.rpc('complete_paper_extraction', {
        p_paper_id: claim.paperId,
        p_schema_version: claim.schemaVersion,
        p_claim_started_at: claim.claimStartedAt,
        p_provider: provider,
        p_model: model,
      })
      if (error) fail('complete_paper_extraction', error)
      return typeof data === 'string' ? data : null
    },

    async retry(claim) {
      const { data, error } = await client.rpc('retry_paper_extraction', {
        p_paper_id: claim.paperId,
        p_schema_version: claim.schemaVersion,
        p_claim_started_at: claim.claimStartedAt,
      })
      if (error) fail('retry_paper_extraction', error)
      return data === true
    },

    async fail(claim, message) {
      const { data, error } = await client.rpc('fail_paper_extraction', {
        p_paper_id: claim.paperId,
        p_schema_version: claim.schemaVersion,
        p_claim_started_at: claim.claimStartedAt,
        p_error: message,
      })
      if (error) fail('fail_paper_extraction', error)
      return data === true
    },
  }
}
