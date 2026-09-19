import type { PaperInput } from '../../src/features/evidence-matrix/evidence-packet'
import type { NormalizedField } from '../../src/features/evidence-matrix/extract'

/** A claimed extraction. `claimStartedAt` is the fencing token for every write. */
export type ClaimedExtraction = {
  paperId: string
  userId: string
  schemaVersion: number
  /** The papers.processing_completed_at this run was claimed for. */
  sourceCompletedAt: string
  claimStartedAt: string
  attempts: number
}

export type LoadedPaper = {
  input: PaperInput
  /**
   * True only if the paper is ready and its processing_completed_at equalled the
   * claimed generation both before and after the sections/chunks were read.
   */
  generationCurrent: boolean
}

/** Everything the runner needs from the outside world (Supabase in production). */
export interface ExtractionStore {
  claimNext: () => Promise<ClaimedExtraction | null>
  loadPaper: (claim: ClaimedExtraction) => Promise<LoadedPaper>
  /** False when the claim no longer holds (fenced out / generation changed). */
  storeField: (
    claim: ClaimedExtraction,
    field: NormalizedField,
  ) => Promise<boolean>
  /** Final status, or null when the claim no longer holds. provider/model null = no LLM ran. */
  complete: (
    claim: ClaimedExtraction,
    provider: string | null,
    model: string | null,
  ) => Promise<string | null>
  /** Back to the queue (transient failure, or the generation changed). */
  retry: (claim: ClaimedExtraction) => Promise<boolean>
  fail: (claim: ClaimedExtraction, message: string) => Promise<boolean>
}
