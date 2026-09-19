import type { EmbeddingJobRunner, StepResult } from './embedding/runner'
import type { JobResult } from './run-job'

/**
 * One worker process, two independent job lifecycles: PDF processing and
 * embedding (indexing). This cooperative scheduler interleaves them:
 *
 *  - Every pass polls the PDF lane FIRST, so a newly uploaded paper is picked up
 *    within one poll interval plus at most one embedding request, no matter how
 *    long Voyage pacing is holding an indexing job back.
 *  - The embedding lane advances one small step per pass (at most one provider
 *    request). When pacing needs a wait the step returns immediately; we then sleep
 *    only min(wait, pollInterval), so PDF polling continues and nothing busy-waits.
 *  - Each lane backs off on its own after errors, so a Voyage outage does not stop
 *    PDF processing and vice versa.
 *  - On shutdown the claimed indexing job is released (attempt refunded).
 *
 * Time is injected (`now`, `sleep`) so the schedule is testable without waiting.
 */

export type SchedulerDeps = {
  pdf: () => Promise<JobResult>
  embedding?: Pick<EmbeddingJobRunner, 'step' | 'release'>
  pollIntervalMs: number
  now: () => number
  /** Resolves after ms, or immediately when the signal aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  log?: (message: string) => void
  /** How long the embedding lane rests after a stage-wide problem (default 5 min). */
  blockedBackoffMs?: number
}

const ERROR_BACKOFF_MAX_MS = 5 * 60_000

const errorBackoff = (pollIntervalMs: number, consecutiveErrors: number) =>
  Math.min(pollIntervalMs * 2 ** consecutiveErrors, ERROR_BACKOFF_MAX_MS)

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'unexpected error'

export async function runScheduler(
  signal: AbortSignal,
  deps: SchedulerDeps,
): Promise<void> {
  const { pollIntervalMs, now, sleep, log } = deps
  const blockedBackoffMs = deps.blockedBackoffMs ?? 5 * 60_000
  // A function (not `signal.aborted` inline) so TypeScript re-reads it after each await.
  const aborted = () => signal.aborted
  let pdfBlockedUntil = 0
  let pdfErrors = 0
  let embeddingBlockedUntil = 0
  let embeddingErrors = 0

  try {
    while (!aborted()) {
      // 1. PDF lane (priority).
      if (now() >= pdfBlockedUntil) {
        try {
          const result = await deps.pdf()
          pdfErrors = 0
          if (result.kind !== 'idle') continue
        } catch (error) {
          pdfErrors++
          const delay = errorBackoff(pollIntervalMs, pdfErrors)
          pdfBlockedUntil = now() + delay
          log?.(
            `pdf lane error: ${message(error)}; pausing it for ${Math.round(delay / 1000)}s`,
          )
        }
      }

      // 2. Embedding lane: one small step.
      let nap = pollIntervalMs
      if (deps.embedding && now() >= embeddingBlockedUntil && !aborted()) {
        let step: StepResult
        try {
          step = await deps.embedding.step(signal)
          embeddingErrors = 0
        } catch (error) {
          embeddingErrors++
          const delay = errorBackoff(pollIntervalMs, embeddingErrors)
          embeddingBlockedUntil = now() + delay
          log?.(
            `embedding lane error: ${message(error)}; pausing it for ${Math.round(delay / 1000)}s`,
          )
          step = { kind: 'idle' }
        }
        switch (step.kind) {
          case 'progress':
          case 'complete':
          case 'retry':
          case 'failed':
          case 'lost':
            continue // more indexing work may be ready right away; PDF gets polled first
          case 'waiting':
            nap = Math.max(1, Math.min(step.waitMs, pollIntervalMs))
            break
          case 'blocked':
            embeddingBlockedUntil = now() + blockedBackoffMs
            log?.(
              `embedding stage paused for ${Math.round(blockedBackoffMs / 60_000)} min: ${step.reason}`,
            )
            break
          case 'idle':
          case 'interrupted':
            break
        }
      }

      if (aborted()) break
      await sleep(nap, signal)
    }
  } finally {
    if (deps.embedding) await deps.embedding.release()
  }
}
