import { extractEvidenceMatrix } from '../../src/features/evidence-matrix/extract'
import type { LlmProvider } from '../../src/lib/llm'
import { StoreError } from '../embedding/failure'
import { decideExtractionFailure, FAILURE_MESSAGE } from './retry-policy'
import type { ExtractionFailureKind } from './retry-policy'
import type { ExtractionStore } from './types'

export type ExtractionJobResult =
  | { kind: 'idle' }
  | { kind: 'complete'; paperId: string; status: string; llmCalled: boolean }
  | {
      kind: 'retry'
      paperId: string
      reason: ExtractionFailureKind
      /** Safe, content-free detail for the local log only (never persisted). */
      diagnostic?: string
    }
  | {
      kind: 'failed'
      paperId: string
      reason: ExtractionFailureKind
      diagnostic?: string
    }
  /** The paper was reprocessed while running; re-queued for the new generation. */
  | { kind: 'superseded'; paperId: string }
  /** The claim was lost; nothing more was written. */
  | { kind: 'lost'; paperId: string }

export type RunExtractionDeps = {
  store: ExtractionStore
  /** Only called when routed evidence exists. Tests pass a fake provider. */
  getLlm: (context?: {
    actorUserId: string
    projectId: string | null
    operationKey: string
  }) => LlmProvider
  maxAttempts: number
  log?: (message: string) => void
  signal?: AbortSignal
}

/**
 * Claim ONE requested extraction and run it: load the paper's current sections and
 * chunks, ONE structured LLM call (none when nothing is routed), then store the seven
 * fields and complete. Every write is fenced by the claim token and the paper's
 * processing generation inside the database. A failure re-queues (transient, attempts
 * left) or fails the run; output is never reported complete unless complete succeeded.
 */
export async function runNextExtraction(
  deps: RunExtractionDeps,
): Promise<ExtractionJobResult> {
  const { store, log } = deps
  const claim = await store.claimNext()
  if (!claim) return { kind: 'idle' }
  const paperId = claim.paperId
  log?.(
    `extraction ${paperId}: claimed (attempt ${claim.attempts}/${deps.maxAttempts})`,
  )

  const failWith = async (
    kind: ExtractionFailureKind,
    diagnostic?: string,
  ): Promise<ExtractionJobResult> => {
    const retry =
      decideExtractionFailure(kind, claim.attempts, deps.maxAttempts) ===
      'retry'
    const applied = retry
      ? await store.retry(claim)
      : await store.fail(claim, FAILURE_MESSAGE[kind])
    if (!applied) return { kind: 'lost', paperId }
    log?.(
      `extraction ${paperId}: ${retry ? 'will retry' : 'failed'} (${kind}${diagnostic ? `: ${diagnostic}` : ''})`,
    )
    return retry
      ? { kind: 'retry', paperId, reason: kind, diagnostic }
      : { kind: 'failed', paperId, reason: kind, diagnostic }
  }

  /**
   * Hand the row back for a generation change or lost claim (a no-op if fenced out).
   * A real generation change gets a fresh budget from the database's generation reset;
   * anything else is bounded by the same attempts limit, so it can never loop forever.
   */
  const requeue = () =>
    decideExtractionFailure('superseded', claim.attempts, deps.maxAttempts) ===
    'retry'
      ? store.retry(claim)
      : store.fail(claim, FAILURE_MESSAGE.superseded)

  const lost = async (): Promise<ExtractionJobResult> => {
    try {
      await requeue()
    } catch {
      // best effort: an abandoned 'running' row is reclaimed after the stale timeout
    }
    log?.(`extraction ${paperId}: claim or generation no longer holds`)
    return { kind: 'lost', paperId }
  }

  try {
    const loaded = await store.loadPaper(claim)
    if (!loaded.generationCurrent) {
      await requeue()
      log?.(`extraction ${paperId}: paper changed; re-queued or failed when out of attempts`)
      return { kind: 'superseded', paperId }
    }

    const outcome = await extractEvidenceMatrix(loaded.input, {
      getLlm: () =>
        deps.getLlm({
          actorUserId: claim.userId,
          projectId: null,
          operationKey: `evidence-matrix:${claim.paperId}:${claim.claimStartedAt}`,
        }),
      signal: deps.signal,
    })
    if (!outcome.ok) return await failWith(outcome.error, outcome.diagnostic)

    for (const field of outcome.fields) {
      if (!(await store.storeField(claim, field))) return await lost()
    }
    const status = await store.complete(claim, outcome.provider, outcome.model)
    if (status === null) return await lost()
    log?.(
      `extraction ${paperId}: ${status}` +
        (outcome.provider === null ? ' (no evidence, no LLM call)' : ''),
    )
    return {
      kind: 'complete',
      paperId,
      status,
      llmCalled: outcome.provider !== null,
    }
  } catch (error) {
    let kind: ExtractionFailureKind = 'unexpected'
    if (error instanceof StoreError) {
      kind = error.retryable ? 'persistence' : 'persistence_permanent'
    }
    try {
      return await failWith(kind)
    } catch {
      // the failure could not even be recorded; the stale timeout will reclaim it
      return { kind: 'lost', paperId }
    }
  }
}
