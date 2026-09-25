import { EmbeddingError } from '../../src/lib/embedding/errors'
import type { EmbeddingProvider } from '../../src/lib/embedding/types'
import { classify, toJobFailure, JobIntegrityError } from './failure'
import { planChunks, takeBatch } from './plan'
import type { PlannedChunk } from './plan'
import type { RateLimiter } from './rate-limiter'
import { toEmbeddingRows } from './serialize'
import type { TokenEstimator } from './token-estimator'
import type {
  ClaimedEmbeddingJob,
  EmbeddingJobStore,
  JobFailure,
  ProfileRef,
} from './types'
import type { UsageRecorder } from '../../src/lib/usage/types'

export type Logger = (message: string) => void

export type RunnerConfig = {
  /** Attempts per indexing job before it is left as failed. */
  jobMaxAttempts: number
  /** Attempts per request (batch) before the JOB is failed/requeued. */
  maxRequestAttempts: number
  /** Most chunks in one request. */
  maxItemsPerRequest: number
  /** Most estimated tokens in one request (a single oversized chunk aside). */
  maxRequestTokens: number
  /** The profile this worker embeds with; the claimed job must match exactly. */
  expectedProfile: ProfileRef
}

export type RunnerDeps = {
  store: EmbeddingJobStore
  provider: EmbeddingProvider
  limiter: RateLimiter
  estimator: TokenEstimator
  now: () => number
  config: RunnerConfig
  log?: Logger
  /** Restrict claiming to one paper (the manual command). */
  paperId?: string
  /** Trusted service-role append path; failures never stop indexing. */
  recordUsage?: UsageRecorder
}

export type JobSummary = {
  paperId: string
  chunksTotal: number
  newlyEmbedded: number
  reused: number
  requests: number
  billedTokens: number
  elapsedMs: number
}

export type StepResult =
  | { kind: 'idle' }
  /** Pacing (or a provider Retry-After / backoff) requires waiting before the next request. */
  | { kind: 'waiting'; waitMs: number }
  | { kind: 'progress'; embedded: number; remaining: number }
  | { kind: 'complete'; summary: JobSummary }
  | { kind: 'retry'; paperId: string; message: string }
  | { kind: 'failed'; paperId: string; message: string }
  | { kind: 'lost'; paperId: string }
  | { kind: 'interrupted'; paperId: string }
  /** Stage-wide problem (unusable key, profile mismatch). The job was released, not failed. */
  | { kind: 'blocked'; reason: string }

type ActiveJob = {
  job: ClaimedEmbeddingJob
  total: number
  reused: number
  queue: PlannedChunk[]
  batch: PlannedChunk[] | null
  batchAttempts: number
  requests: number
  billedTokens: number
  newlyEmbedded: number
  startedAt: number
}

const REQUEST_BACKOFF_BASE_MS = 2_000
const REQUEST_BACKOFF_MAX_MS = 30_000

/**
 * Runs indexing jobs one small STEP at a time so a single worker process can
 * interleave them with PDF processing. A step does at most one provider request:
 * it never sleeps; when pacing requires waiting it returns `waiting` and the
 * scheduler decides how to wait (abortably). The job stays claimed meanwhile, and
 * every stored batch refreshes its row so it is not mistaken for a crashed one.
 *
 * Only paper_embedding_jobs / chunk_embeddings are ever written: papers.status and
 * the PDF lifecycle are untouched, so a provider outage cannot un-ready a paper.
 */
export class EmbeddingJobRunner {
  private active: ActiveJob | null = null

  constructor(private readonly deps: RunnerDeps) {}

  /** True while a job is claimed (waiting or in progress). */
  get hasActiveJob(): boolean {
    return this.active !== null
  }

  async step(signal?: AbortSignal): Promise<StepResult> {
    if (signal?.aborted) return this.release()
    try {
      if (!this.active) {
        const started = await this.start()
        if (started) return started
      }
      return await this.advance()
    } catch (error) {
      return this.failActive(error)
    }
  }

  /**
   * Gives an in-flight job back without counting an attempt (shutdown). Safe to
   * call when nothing is active.
   */
  async release(): Promise<StepResult> {
    const active = this.active
    if (!active) return { kind: 'idle' }
    this.active = null
    try {
      await this.deps.store.fail(active.job, {
        message: '',
        retry: true,
        countAttempt: false,
        retryDelayMs: 0,
      })
    } catch {
      // The job will be recovered by the stalled-job rule.
    }
    return { kind: 'interrupted', paperId: active.job.paperId }
  }

  // ---- starting a job ---------------------------------------------------------------

  private async start(): Promise<StepResult | null> {
    const { store, config, log } = this.deps
    const job = await store.claimNext(this.deps.paperId)
    if (!job) return { kind: 'idle' }

    if (!profilesMatch(job.profile, config.expectedProfile)) {
      // Never embed with a profile different from the job's vector space.
      await store
        .fail(job, {
          message: '',
          retry: true,
          countAttempt: false,
          retryDelayMs: 0,
        })
        .catch(() => undefined)
      return {
        kind: 'blocked',
        reason: `The active embedding profile (${job.profile.provider}/${job.profile.providerModel}/${job.profile.dimensions}/${job.profile.inputProfile}) does not match this worker`,
      }
    }

    this.active = {
      job,
      total: 0,
      reused: 0,
      queue: [],
      batch: null,
      batchAttempts: 0,
      requests: 0,
      billedTokens: 0,
      newlyEmbedded: 0,
      startedAt: this.deps.now(),
    }

    const snapshot = await store.loadSnapshot(job)
    if (snapshot.chunks.length !== job.chunkCount) {
      // The chunk set moved between claim and load; a new generation will re-claim.
      throw new JobIntegrityError('Chunk count does not match the claimed job')
    }
    const plan = planChunks(snapshot)
    this.active.total = plan.total
    this.active.reused = plan.reused
    this.active.queue = plan.pending
    log?.(
      `paper ${job.paperId}: claimed indexing job (attempt ${job.attempts}/${config.jobMaxAttempts}): ` +
        `${plan.total} chunks, ${plan.reused} reusable, ${plan.pending.length} to embed`,
    )
    return null
  }

  // ---- one step of work ------------------------------------------------------------

  private async advance(): Promise<StepResult> {
    const active = this.active!
    const { store, provider, limiter, estimator, config, log } = this.deps

    if (!active.batch) {
      if (active.queue.length === 0) return this.finish()
      active.batch = takeBatch(
        active.queue,
        {
          maxItems: config.maxItemsPerRequest,
          maxTokens: config.maxRequestTokens,
        },
        (chars) => estimator.estimate(chars),
      )
      active.batchAttempts = 0
    }

    const batch = active.batch
    const chars = batch.reduce((n, c) => n + c.chars, 0)
    const estimated = estimator.estimate(chars)
    if (estimated > limiter.maxTokensPerRequest) {
      // Could never be sent under the token budget: a permanent problem with this chunk.
      throw new EmbeddingError(
        'invalid_input',
        'A chunk is too large to send under the token budget',
      )
    }

    const wait = limiter.waitMs(estimated)
    if (wait > 0) return { kind: 'waiting', waitMs: wait }

    const ticket = limiter.reserve(estimated)
    active.requests++
    let result
    try {
      result = await provider.embedDocuments(batch.map((c) => c.input))
    } catch (error) {
      ticket.settle(null) // unknown: keep counting the estimate against the window
      return this.handleRequestError(active, error)
    }
    ticket.settle(result.tokens)
    estimator.observe(chars, result.tokens)
    active.billedTokens += result.tokens ?? 0

    await this.deps.recordUsage?.({
      actorUserId: active.job.userId,
      projectId: null,
      feature: 'embedding_indexing',
      eventType: 'embedding_request',
      provider: active.job.profile.provider,
      model: active.job.profile.providerModel,
      inputTokens: result.tokens,
      totalTokens: result.tokens,
      quantity: batch.length,
      idempotencyKey:
        `embedding:${active.job.paperId}:${active.job.claimStartedAt}:${active.requests}`,
      metadata: { input_type: 'document', batch_items: batch.length },
    }).catch(() => {
      log?.(`paper ${active.job.paperId}: usage recording unavailable`)
    })

    const rows = toEmbeddingRows(
      batch,
      result.vectors,
      config.expectedProfile.dimensions,
    )
    const stored = await store.storeEmbeddings(active.job, rows)
    if (stored === null) {
      this.active = null
      log?.(
        `paper ${active.job.paperId}: claim lost while storing (paper reprocessed or job reset)`,
      )
      return { kind: 'lost', paperId: active.job.paperId }
    }

    active.newlyEmbedded += batch.length
    active.queue = active.queue.slice(batch.length)
    active.batch = null
    active.batchAttempts = 0
    log?.(
      `paper ${active.job.paperId}: stored ${batch.length} embeddings ` +
        `(${stored}/${active.total} done, ${result.tokens ?? '?'} tokens billed)`,
    )
    return active.queue.length === 0
      ? this.finish()
      : {
          kind: 'progress',
          embedded: batch.length,
          remaining: active.queue.length,
        }
  }

  /** Per-request failures: pace retries here; escalate to a job failure when exhausted. */
  private handleRequestError(active: ActiveJob, error: unknown): StepResult {
    const { limiter, config, now } = this.deps
    if (!(error instanceof EmbeddingError) || !error.retryable) throw error

    active.batchAttempts++
    if (active.batchAttempts >= config.maxRequestAttempts) throw error

    const backoff = Math.min(
      REQUEST_BACKOFF_MAX_MS,
      REQUEST_BACKOFF_BASE_MS * 2 ** (active.batchAttempts - 1),
    )
    // Retry-After wins over our own backoff. A 429 with no hint waits a full window.
    const delay =
      error.retryAfterMs ?? (error.kind === 'rate_limited' ? 60_000 : backoff)
    limiter.blockUntil(now() + delay)
    return { kind: 'waiting', waitMs: delay }
  }

  private async finish(): Promise<StepResult> {
    const active = this.active!
    const ok = await this.deps.store.complete(active.job)
    this.active = null
    if (!ok) return { kind: 'lost', paperId: active.job.paperId }
    const summary: JobSummary = {
      paperId: active.job.paperId,
      chunksTotal: active.total,
      newlyEmbedded: active.newlyEmbedded,
      reused: active.reused,
      requests: active.requests,
      billedTokens: active.billedTokens,
      elapsedMs: this.deps.now() - active.startedAt,
    }
    this.deps.log?.(
      `paper ${summary.paperId}: indexing complete (${summary.newlyEmbedded} new, ${summary.reused} reused, ` +
        `${summary.requests} requests, ${summary.billedTokens} tokens, ${Math.round(summary.elapsedMs / 1000)}s)`,
    )
    return { kind: 'complete', summary }
  }

  // ---- failures -----------------------------------------------------------------------

  private async failActive(error: unknown): Promise<StepResult> {
    const active = this.active
    const classification = classify(error)

    if (!active) throw error // failed before/while claiming: an infrastructure error

    if (classification.kind === 'blocked') {
      this.active = null
      const released: JobFailure = {
        message: '',
        retry: true,
        countAttempt: false,
        retryDelayMs: 0,
      }
      await this.deps.store.fail(active.job, released).catch(() => undefined)
      return { kind: 'blocked', reason: classification.reason }
    }

    const failure = toJobFailure(
      classification.code,
      classification.retryable,
      active.job.attempts,
      this.deps.config.jobMaxAttempts,
    )
    this.active = null
    const applied = await this.deps.store.fail(active.job, failure)
    this.deps.log?.(
      `paper ${active.job.paperId}: indexing ${failure.retry ? 'will retry' : 'failed'} (${classification.code})`,
    )
    if (!applied) return { kind: 'lost', paperId: active.job.paperId }
    return failure.retry
      ? { kind: 'retry', paperId: active.job.paperId, message: failure.message }
      : {
          kind: 'failed',
          paperId: active.job.paperId,
          message: failure.message,
        }
  }
}

function profilesMatch(a: ProfileRef, b: ProfileRef): boolean {
  return (
    a.provider === b.provider &&
    a.providerModel === b.providerModel &&
    a.dimensions === b.dimensions &&
    a.inputProfile === b.inputProfile
  )
}
