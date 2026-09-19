import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPersistenceRows } from '../src/features/processing/persistence'
import type {
  ProcessedDocument,
  ProcessingFailure,
} from '../src/features/processing/types'
import type { WorkerConfig } from './config'
import { describeError } from './diagnostics'

/** A paper this worker has claimed. `startedAt` is the fencing token for finishing the job. */
export type ClaimedJob = {
  paperId: string
  userId: string
  storagePath: string
  startedAt: string
  attempts: number
}

/** Everything the orchestrator needs from the outside world (Supabase in production). */
export interface JobStore {
  claimNext: () => Promise<ClaimedJob | null>
  download: (job: ClaimedJob) => Promise<Uint8Array>
  /** Returns false if the claim was lost (another worker took over). */
  complete: (job: ClaimedJob, document: ProcessedDocument) => Promise<boolean>
  /** retry = true returns the paper to 'uploaded'; otherwise it becomes 'failed'. */
  fail: (
    job: ClaimedJob,
    failure: ProcessingFailure,
    retry: boolean,
  ) => Promise<boolean>
}

/** Privileged client. Server-only: it carries the service-role key and bypasses RLS. */
export function createWorkerClient(config: WorkerConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type ClaimRow = {
  id: string
  user_id: string
  storage_path: string
  processing_started_at: string
  processing_attempts: number
}

export function createSupabaseJobStore(
  client: SupabaseClient,
  config: WorkerConfig,
): JobStore {
  const secrets = [config.serviceRoleKey]
  const explain = (error: unknown) => describeError(error, secrets)

  return {
    async claimNext() {
      const { data, error } = await client.rpc('claim_next_paper', {
        p_max_attempts: config.maxAttempts,
        p_stale_after: `${config.staleAfterMinutes} minutes`,
      })
      if (error) throw new Error(`claim_next_paper failed: ${explain(error)}`)
      const row = (data as ClaimRow[] | null)?.[0]
      if (!row) return null
      return {
        paperId: row.id,
        userId: row.user_id,
        storagePath: row.storage_path,
        startedAt: row.processing_started_at,
        attempts: row.processing_attempts,
      }
    },

    async download(job) {
      const { data, error } = await client.storage
        .from(config.bucket)
        .download(job.storagePath)
      if (error) throw new Error(`download failed: ${explain(error)}`)
      return new Uint8Array(await data.arrayBuffer())
    },

    async complete(job, document) {
      const rows = buildPersistenceRows(
        { paperId: job.paperId, userId: job.userId },
        document,
      )
      const { data, error } = await client.rpc('complete_paper_processing', {
        p_paper_id: job.paperId,
        p_started_at: job.startedAt,
        p_page_count: Math.max(1, document.pageCount),
        p_sections: rows.sections,
        p_chunks: rows.chunks,
      })
      if (error) {
        throw new Error(`complete_paper_processing failed: ${explain(error)}`)
      }
      return data === true
    },

    async fail(job, failure, retry) {
      const { data, error } = await client.rpc('fail_paper_processing', {
        p_paper_id: job.paperId,
        p_started_at: job.startedAt,
        p_error: failure.message,
        p_retry: retry,
      })
      if (error) {
        throw new Error(`fail_paper_processing failed: ${explain(error)}`)
      }
      return data === true
    },
  }
}
