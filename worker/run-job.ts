import {
  FAILURE_MESSAGES,
  ProcessingError,
  toProcessingFailure,
} from '../src/features/processing/errors'
import type { PdfExtractor } from '../src/features/processing/extractor'
import { processPdf } from '../src/features/processing/pipeline'
import type { ProcessingErrorCode } from '../src/features/processing/types'
import type { WorkerConfig } from './config'
import type { ClaimedJob, JobStore } from './job-store'
import { decideFailure } from './retry-policy'

export type JobResult =
  | { kind: 'idle' }
  | { kind: 'ready'; paperId: string; sections: number; chunks: number }
  | { kind: 'failed'; paperId: string; code: ProcessingErrorCode }
  | { kind: 'retry'; paperId: string; code: ProcessingErrorCode }
  /** The claim was lost (e.g. taken over after a stale timeout); nothing was written. */
  | { kind: 'lost'; paperId: string }

export type Logger = (message: string) => void

export type RunJobDeps = {
  store: JobStore
  extractor: PdfExtractor
  config: Pick<WorkerConfig, 'maxAttempts' | 'maxPdfBytes'>
  log?: Logger
}

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

/** PDFs may carry up to 1 KiB of junk before the header, per common reader behavior. */
function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_HEADER.length, 1024)
  for (let i = 0; i <= limit; i++) {
    if (PDF_HEADER.every((b, j) => bytes[i + j] === b)) return true
  }
  return false
}

async function downloadValidated(
  deps: RunJobDeps,
  job: ClaimedJob,
): Promise<Uint8Array> {
  let bytes: Uint8Array
  try {
    bytes = await deps.store.download(job)
  } catch (error) {
    deps.log?.(`paper ${job.paperId}: download error: ${describe(error)}`)
    throw new ProcessingError('storage_error', FAILURE_MESSAGES.storage_error)
  }
  if (bytes.length === 0) {
    throw new ProcessingError('invalid_pdf', 'The stored PDF file is empty.')
  }
  if (bytes.length > deps.config.maxPdfBytes) {
    throw new ProcessingError(
      'invalid_pdf',
      'The PDF is larger than the processing limit.',
    )
  }
  if (!hasPdfHeader(bytes)) {
    throw new ProcessingError('invalid_pdf', FAILURE_MESSAGES.invalid_pdf)
  }
  return bytes
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Claims one eligible paper and runs it end to end. Resolves with what happened;
 * it only rejects if the claim itself, or recording a failure, cannot reach the
 * database (a paper left in 'processing' is recovered by the stale-job rule).
 * Everything stored on failure comes from FAILURE_MESSAGES or ProcessingError
 * messages, never from raw exceptions.
 */
export async function runNextJob(deps: RunJobDeps): Promise<JobResult> {
  const { store, extractor, config, log } = deps

  const job = await store.claimNext()
  if (!job) return { kind: 'idle' }
  log?.(
    `paper ${job.paperId}: claimed (attempt ${job.attempts}/${config.maxAttempts})`,
  )

  const failWith = async (failure: {
    code: ProcessingErrorCode
    message: string
  }): Promise<JobResult> => {
    const retry =
      decideFailure(failure.code, job.attempts, config.maxAttempts) === 'retry'
    const applied = await store.fail(job, failure, retry)
    if (!applied) return { kind: 'lost', paperId: job.paperId }
    log?.(
      `paper ${job.paperId}: ${retry ? 'will retry' : 'failed'} (${failure.code})`,
    )
    return retry
      ? { kind: 'retry', paperId: job.paperId, code: failure.code }
      : { kind: 'failed', paperId: job.paperId, code: failure.code }
  }

  let bytes: Uint8Array
  try {
    bytes = await downloadValidated(deps, job)
  } catch (error) {
    return failWith(toProcessingFailure(error))
  }

  const outcome = await processPdf(bytes, extractor)
  if (!outcome.ok) {
    log?.(`paper ${job.paperId}: processing error: ${outcome.error.code}`)
    return failWith(outcome.error)
  }

  let applied: boolean
  try {
    applied = await store.complete(job, outcome.document)
  } catch (error) {
    log?.(`paper ${job.paperId}: persistence error: ${describe(error)}`)
    return failWith({
      code: 'persistence_error',
      message: FAILURE_MESSAGES.persistence_error,
    })
  }
  if (!applied) return { kind: 'lost', paperId: job.paperId }

  log?.(
    `paper ${job.paperId}: ready (${outcome.document.pageCount} pages, ` +
      `${outcome.document.sections.length} sections, ${outcome.document.chunks.length} chunks)`,
  )
  return {
    kind: 'ready',
    paperId: job.paperId,
    sections: outcome.document.sections.length,
    chunks: outcome.document.chunks.length,
  }
}
