import type { EmbeddingError } from '../../src/lib/embedding/errors'
import type {
  DocumentEmbeddings,
  EmbeddingProfile,
  EmbeddingProvider,
  QueryEmbedding,
} from '../../src/lib/embedding/types'
import { StoreError } from './failure'
import { RateLimiter, paceLimits } from './rate-limiter'
import { EmbeddingJobRunner } from './runner'
import type { RunnerConfig, StepResult } from './runner'
import { TokenEstimator } from './token-estimator'
import type {
  ClaimedEmbeddingJob,
  EmbeddingJobStore,
  EmbeddingRow,
  JobFailure,
  PaperChunkSnapshot,
} from './types'

export const MODEL = 'voyage-4:1024:ctx-v1'
export const PROFILE = {
  provider: 'voyage',
  providerModel: 'voyage-4',
  dimensions: 1024,
  inputProfile: 'ctx-v1',
} as const

/** A virtual clock: nothing ever really sleeps. */
export class FakeClock {
  t = 1_000_000
  now = () => this.t
  advance(ms: number) {
    this.t += ms
  }
}

type FakePaper = {
  id: string
  userId: string
  title: string
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
  completedAt: number | null
}
type FakeChunk = {
  id: string
  paperId: string
  index: number
  text: string
  sectionTitle: string
}
type FakeEmbedding = {
  chunkId: string
  modelId: string
  paperId: string
  vector: number[]
  hash: string | null
}
type FakeJob = {
  paperId: string
  modelId: string
  userId: string
  status: 'pending' | 'embedding' | 'complete' | 'failed'
  attempts: number
  sourceCompletedAt: number
  claimToken: number | null
  chunkCount: number | null
  embeddedCount: number
  lastError: string | null
  nextAttemptAt: number | null
  updatedAt: number
  createdAt: number
}
type FakeModel = { id: string; status: 'building' | 'active' | 'retired' }

/**
 * In-memory database that mirrors what migration 0007's functions do (job
 * creation, generation reset, stalled-job recovery, fenced writes). The store below
 * is a thin interface over it; several stores can share one db to model several
 * workers.
 */
export class FakeDb {
  papers = new Map<string, FakePaper>()
  chunks: FakeChunk[] = []
  embeddings = new Map<string, FakeEmbedding>()
  jobs = new Map<string, FakeJob>()
  models: FakeModel[] = [{ id: MODEL, status: 'active' }]
  private seq = 0
  private jobSeq = 0

  constructor(readonly clock: FakeClock) {}

  nextToken(): number {
    return this.clock.t * 1000 + ++this.seq
  }
  nextJobOrder(): number {
    return ++this.jobSeq
  }

  addPaper(
    id: string,
    chunkCount: number,
    options: {
      status?: FakePaper['status']
      chars?: number
      title?: string
    } = {},
  ) {
    this.papers.set(id, {
      id,
      userId: `user-${id}`,
      title: options.title ?? `Paper ${id}`,
      status: options.status ?? 'ready',
      completedAt: this.clock.t,
    })
    this.replaceChunks(id, chunkCount, options.chars ?? 3_600)
  }

  /** What complete_paper_processing does on reprocessing: new generation, new chunk ids. */
  reprocess(paperId: string, chunkCount: number, chars = 3_600) {
    this.clock.advance(1)
    const paper = this.papers.get(paperId)!
    paper.completedAt = this.clock.t
    this.replaceChunks(paperId, chunkCount, chars, 'g2')
  }

  private replaceChunks(
    paperId: string,
    count: number,
    chars: number,
    tag = 'g1',
  ) {
    const oldIds = new Set(
      this.chunks.filter((c) => c.paperId === paperId).map((c) => c.id),
    )
    this.chunks = this.chunks.filter((c) => c.paperId !== paperId)
    for (const [key, e] of this.embeddings)
      if (oldIds.has(e.chunkId)) this.embeddings.delete(key) // cascade
    for (let i = 0; i < count; i++) {
      this.chunks.push({
        id: `${paperId}-${tag}-c${i}`,
        paperId,
        index: i,
        text: `Chunk ${i} of ${paperId}. `.padEnd(chars, 'lorem ipsum '),
        sectionTitle: i % 3 === 0 ? '' : `Section ${i}`,
      })
    }
  }

  chunksOf(paperId: string) {
    return this.chunks.filter((c) => c.paperId === paperId)
  }
  embeddingsOf(paperId: string, modelId = MODEL) {
    return [...this.embeddings.values()].filter(
      (e) => e.paperId === paperId && e.modelId === modelId,
    )
  }
  job(paperId: string, modelId = MODEL) {
    return this.jobs.get(`${paperId}|${modelId}`)
  }
}

export class FakeStore implements EmbeddingJobStore {
  constructor(
    private readonly db: FakeDb,
    private readonly options: {
      maxAttempts?: number
      staleAfterMs?: number
    } = {},
  ) {}

  private get maxAttempts() {
    return this.options.maxAttempts ?? 4
  }
  private get staleAfterMs() {
    return this.options.staleAfterMs ?? 15 * 60_000
  }

  async claimNext(paperId?: string): Promise<ClaimedEmbeddingJob | null> {
    const { db } = this
    const now = db.clock.t
    const model = db.models.find((m) => m.status === 'active')
    if (!model) return null
    const inScope = (id: string) => paperId === undefined || id === paperId

    // 1. create missing jobs for ready papers that have chunks
    for (const paper of db.papers.values()) {
      if (
        paper.status !== 'ready' ||
        paper.completedAt === null ||
        !inScope(paper.id)
      )
        continue
      if (db.chunksOf(paper.id).length === 0) continue
      const key = `${paper.id}|${model.id}`
      if (!db.jobs.has(key)) {
        db.jobs.set(key, {
          paperId: paper.id,
          modelId: model.id,
          userId: paper.userId,
          status: 'pending',
          attempts: 0,
          sourceCompletedAt: paper.completedAt,
          claimToken: null,
          chunkCount: null,
          embeddedCount: 0,
          lastError: null,
          nextAttemptAt: null,
          updatedAt: now,
          createdAt: db.nextJobOrder(),
        })
      }
    }
    // 2. reset jobs whose paper was reprocessed (clears the claim: fences old workers)
    for (const job of db.jobs.values()) {
      const paper = db.papers.get(job.paperId)!
      if (job.modelId !== model.id || !inScope(job.paperId)) continue
      if (
        paper.status === 'ready' &&
        paper.completedAt !== null &&
        job.sourceCompletedAt !== paper.completedAt
      ) {
        Object.assign(job, {
          status: 'pending',
          attempts: 0,
          sourceCompletedAt: paper.completedAt,
          claimToken: null,
          chunkCount: null,
          embeddedCount: 0,
          lastError: null,
          nextAttemptAt: null,
          updatedAt: now,
        })
      }
    }
    // 3. stalled jobs that used all their attempts fail
    for (const job of db.jobs.values()) {
      if (job.modelId !== model.id || !inScope(job.paperId)) continue
      if (
        job.status === 'embedding' &&
        job.updatedAt < now - this.staleAfterMs &&
        job.attempts >= this.maxAttempts
      ) {
        Object.assign(job, {
          status: 'failed',
          claimToken: null,
          updatedAt: now,
          lastError: 'Indexing was interrupted repeatedly and was stopped.',
        })
      }
    }
    // 4. claim one (a job locked by another worker is simply not eligible: SKIP LOCKED)
    const candidate = [...db.jobs.values()]
      .filter((j) => {
        const paper = db.papers.get(j.paperId)!
        return (
          j.modelId === model.id &&
          inScope(j.paperId) &&
          paper.status === 'ready' &&
          j.sourceCompletedAt === paper.completedAt &&
          j.attempts < this.maxAttempts &&
          (j.nextAttemptAt === null || j.nextAttemptAt <= now) &&
          (j.status === 'pending' ||
            (j.status === 'embedding' && j.updatedAt < now - this.staleAfterMs))
        )
      })
      .sort((a, b) => a.createdAt - b.createdAt)
      .at(0)
    if (!candidate) return null

    candidate.status = 'embedding'
    candidate.claimToken = db.nextToken()
    candidate.attempts += 1
    candidate.lastError = null
    candidate.nextAttemptAt = null
    candidate.chunkCount = db.chunksOf(candidate.paperId).length
    candidate.embeddedCount = db.embeddingsOf(candidate.paperId).length
    candidate.updatedAt = now
    return {
      paperId: candidate.paperId,
      userId: candidate.userId,
      modelId: candidate.modelId,
      claimStartedAt: String(candidate.claimToken),
      sourceCompletedAt: String(candidate.sourceCompletedAt),
      attempts: candidate.attempts,
      chunkCount: candidate.chunkCount,
      profile: { ...PROFILE },
    }
  }

  async loadSnapshot(job: ClaimedEmbeddingJob): Promise<PaperChunkSnapshot> {
    const { db } = this
    return {
      paperTitle: db.papers.get(job.paperId)?.title ?? null,
      chunks: db.chunksOf(job.paperId).map((c) => ({
        id: c.id,
        index: c.index,
        text: c.text,
        sectionTitle: c.sectionTitle,
      })),
      existingHashes: new Map(
        db
          .embeddingsOf(job.paperId, job.modelId)
          .map((e) => [e.chunkId, e.hash]),
      ),
    }
  }

  /** The fence used by store/complete: claim token, ready paper, same generation, active profile. */
  private fenced(
    job: ClaimedEmbeddingJob,
    requireCurrent: boolean,
  ): FakeJob | null {
    const { db } = this
    const row = db.job(job.paperId, job.modelId)
    if (
      !row ||
      row.status !== 'embedding' ||
      row.claimToken !== Number(job.claimStartedAt)
    )
      return null
    if (requireCurrent) {
      const paper = db.papers.get(job.paperId)!
      const model = db.models.find((m) => m.id === job.modelId)
      if (
        paper.status !== 'ready' ||
        row.sourceCompletedAt !== paper.completedAt ||
        model?.status !== 'active'
      )
        return null
    }
    return row
  }

  async storeEmbeddings(
    job: ClaimedEmbeddingJob,
    rows: EmbeddingRow[],
  ): Promise<number | null> {
    const { db } = this
    const row = this.fenced(job, true)
    if (!row) return null
    if (rows.length < 1 || rows.length > 200)
      throw new StoreError('store_chunk_embeddings', 'P0001')
    const own = new Set(db.chunksOf(job.paperId).map((c) => c.id))
    for (const r of rows) {
      if (!own.has(r.chunkId))
        throw new StoreError('store_chunk_embeddings', '23503') // composite FK
      if (r.embedding.length !== 1024)
        throw new StoreError('store_chunk_embeddings', '22000') // vector(1024)
    }
    for (const r of rows) {
      db.embeddings.set(`${r.chunkId}|${job.modelId}`, {
        chunkId: r.chunkId,
        modelId: job.modelId,
        paperId: job.paperId,
        vector: r.embedding,
        hash: r.contentHash,
      })
    }
    row.embeddedCount = db.embeddingsOf(job.paperId, job.modelId).length
    row.updatedAt = db.clock.t
    return row.embeddedCount
  }

  async complete(job: ClaimedEmbeddingJob): Promise<boolean> {
    const { db } = this
    const row = this.fenced(job, true)
    if (!row) return false
    const chunks = db.chunksOf(job.paperId)
    const embedded = chunks.filter(
      (c) => db.embeddings.get(`${c.id}|${job.modelId}`)?.hash != null,
    ).length
    if (chunks.length === 0 || embedded !== chunks.length)
      throw new StoreError('complete_embedding_job', 'P0001')
    Object.assign(row, {
      status: 'complete',
      claimToken: null,
      chunkCount: chunks.length,
      embeddedCount: embedded,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: db.clock.t,
    })
    return true
  }

  async fail(job: ClaimedEmbeddingJob, failure: JobFailure): Promise<boolean> {
    const { db } = this
    const row = this.fenced(job, false)
    if (!row) return false
    if (failure.retry) {
      Object.assign(row, {
        status: 'pending',
        claimToken: null,
        lastError: null,
        updatedAt: db.clock.t,
        nextAttemptAt: db.clock.t + failure.retryDelayMs,
        attempts: failure.countAttempt
          ? row.attempts
          : Math.max(row.attempts - 1, 0),
      })
    } else {
      Object.assign(row, {
        status: 'failed',
        claimToken: null,
        nextAttemptAt: null,
        updatedAt: db.clock.t,
        lastError: failure.message.trim() || 'Indexing failed.',
      })
    }
    return true
  }
}

type ProviderCall = { at: number; inputs: string[]; tokens: number }

/** A fake provider: deterministic vectors, billed tokens = chars/4, scripted failures. */
export class FakeProvider implements EmbeddingProvider {
  readonly profile: EmbeddingProfile = {
    provider: 'voyage',
    model: 'voyage-4',
    dimensions: 1024,
  }
  calls: ProviderCall[] = []
  /** Consumed one per call; null/undefined = succeed. */
  failures: (EmbeddingError | null | undefined)[] = []
  /** Override the returned vector length (to simulate a wrong dimension). */
  dimensions = 1024
  tokensPerChar = 0.25

  constructor(private readonly clock: FakeClock) {}

  async embedDocuments(inputs: readonly string[]): Promise<DocumentEmbeddings> {
    const failure = this.failures.shift()
    const tokens = Math.ceil(
      inputs.reduce((n, s) => n + s.length, 0) * this.tokensPerChar,
    )
    this.calls.push({ at: this.clock.t, inputs: [...inputs], tokens })
    if (failure) throw failure
    this.clock.advance(1_000) // a request takes ~1s
    return {
      vectors: inputs.map((input) => {
        const v = new Array<number>(this.dimensions).fill(0.01)
        v[0] = fnv(input) / 1000
        return v
      }),
      tokens,
    }
  }

  embedQuery(): Promise<QueryEmbedding> {
    throw new Error('not used in the indexing worker')
  }
}

export function fnv(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) % 1000
}

export const runnerConfig = (
  overrides: Partial<RunnerConfig> = {},
): RunnerConfig => ({
  jobMaxAttempts: 4,
  maxRequestAttempts: 4,
  maxItemsPerRequest: 32,
  maxRequestTokens: 4_000,
  expectedProfile: { ...PROFILE },
  ...overrides,
})

export function makeRunner(
  db: FakeDb,
  provider: FakeProvider,
  options: {
    store?: FakeStore
    config?: Partial<RunnerConfig>
    log?: (m: string) => void
    paperId?: string
    limits?: { requestsPerMinute: number; tokensPerMinute: number }
  } = {},
) {
  const clock = db.clock
  return new EmbeddingJobRunner({
    store: options.store ?? new FakeStore(db),
    provider,
    limiter: new RateLimiter({
      ...paceLimits(
        options.limits ?? { requestsPerMinute: 3, tokensPerMinute: 10_000 },
      ),
      now: clock.now,
    }),
    estimator: new TokenEstimator(),
    now: clock.now,
    config: runnerConfig(options.config),
    log: options.log,
    paperId: options.paperId,
  })
}

const TERMINAL = new Set([
  'complete',
  'failed',
  'retry',
  'lost',
  'idle',
  'blocked',
  'interrupted',
])

/** Steps a runner to a terminal result, advancing the virtual clock over waits. */
export async function drive(
  runner: EmbeddingJobRunner,
  clock: FakeClock,
  maxSteps = 500,
): Promise<StepResult[]> {
  const results: StepResult[] = []
  for (let i = 0; i < maxSteps; i++) {
    const result = await runner.step()
    results.push(result)
    if (result.kind === 'waiting') clock.advance(result.waitMs)
    if (TERMINAL.has(result.kind)) break
  }
  return results
}

/** Largest number of `values`-weighted events inside any sliding window. */
export function maxInWindow(
  events: { at: number; weight: number }[],
  windowMs: number,
): number {
  let best = 0
  for (const e of events) {
    const sum = events
      .filter((o) => o.at >= e.at && o.at < e.at + windowMs)
      .reduce((n, o) => n + o.weight, 0)
    best = Math.max(best, sum)
  }
  return best
}
