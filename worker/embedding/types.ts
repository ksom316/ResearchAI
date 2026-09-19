/**
 * Data shapes and the store interface for the embedding (indexing) worker stage.
 * The Supabase implementation lives in job-store.ts; tests use an in-memory fake.
 */

export type ProfileRef = {
  provider: string
  providerModel: string
  dimensions: number
  inputProfile: string
}

/** An indexing job this worker has claimed. `claimStartedAt` is the fencing token. */
export type ClaimedEmbeddingJob = {
  paperId: string
  userId: string
  modelId: string
  claimStartedAt: string
  /** papers.processing_completed_at of the chunk generation this job covers. */
  sourceCompletedAt: string
  attempts: number
  chunkCount: number
  profile: ProfileRef
}

/** Only what ctx-v1 needs, plus the chunk id and its position. */
export type ChunkForEmbedding = {
  id: string
  index: number
  text: string
  sectionTitle: string | null
}

export type PaperChunkSnapshot = {
  paperTitle: string | null
  chunks: ChunkForEmbedding[]
  /** chunk id -> content_hash of the stored embedding for the claimed profile. */
  existingHashes: ReadonlyMap<string, string | null>
}

export type EmbeddingRow = {
  chunkId: string
  embedding: number[]
  contentHash: string
}

export type JobFailure = {
  /** Safe, fixed-vocabulary text. Stored only when retry is false. */
  message: string
  retry: boolean
  /** false refunds the attempt (shutdown, unusable provider key). */
  countAttempt: boolean
  retryDelayMs: number
}

export interface EmbeddingJobStore {
  /** Claims the next eligible job, or null. `paperId` restricts it to one paper. */
  claimNext: (paperId?: string) => Promise<ClaimedEmbeddingJob | null>
  loadSnapshot: (job: ClaimedEmbeddingJob) => Promise<PaperChunkSnapshot>
  /**
   * Persists a batch. Resolves to how many chunks of the paper are now embedded,
   * or null if the claim was lost (the worker must stop working on this job).
   */
  storeEmbeddings: (
    job: ClaimedEmbeddingJob,
    rows: EmbeddingRow[],
  ) => Promise<number | null>
  /** false if the claim was lost. Throws if chunks are still missing embeddings. */
  complete: (job: ClaimedEmbeddingJob) => Promise<boolean>
  /** false if the claim was lost. */
  fail: (job: ClaimedEmbeddingJob, failure: JobFailure) => Promise<boolean>
}
