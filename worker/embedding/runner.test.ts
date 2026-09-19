import { describe, expect, it } from 'vitest'
import { EmbeddingError } from '../../src/lib/embedding/errors'
import { contentHash } from '../../src/lib/embedding/hash'
import { buildDocumentInput } from '../../src/lib/embedding/input'
import { FAILURE_MESSAGES, StoreError } from './failure'
import { InvalidVectorError } from './serialize'
import {
  FakeClock,
  FakeDb,
  FakeProvider,
  FakeStore,
  MODEL,
  drive,
  makeRunner,
  maxInWindow,
} from './test-support'
import type { ClaimedEmbeddingJob, EmbeddingRow, JobFailure } from './types'

const P = 'paper-1'

function setup(
  chunks = 10,
  options: { chars?: number; runner?: Parameters<typeof makeRunner>[2] } = {},
) {
  const clock = new FakeClock()
  const db = new FakeDb(clock)
  db.addPaper(P, chunks, { chars: options.chars })
  const provider = new FakeProvider(clock)
  const logs: string[] = []
  const runner = makeRunner(db, provider, {
    log: (m) => logs.push(m),
    ...options.runner,
  })
  return { clock, db, provider, runner, logs }
}

const serverError = () =>
  new EmbeddingError('server', 'Voyage server error (HTTP 503)', {
    status: 503,
  })
const paperSnapshot = (db: FakeDb) => JSON.stringify([...db.papers.values()])
const okRows = (chunkIds: string[]): EmbeddingRow[] =>
  chunkIds.map((chunkId) => ({
    chunkId,
    embedding: new Array<number>(1024).fill(0.1),
    contentHash: 'a'.repeat(64),
  }))
const noRetry: JobFailure = {
  message: '',
  retry: true,
  countAttempt: false,
  retryDelayMs: 0,
}

describe('claiming (mirrors claim_next_embedding_job)', () => {
  it('automatically backfills an existing ready paper: no job has to be inserted by hand', async () => {
    const { db } = setup()
    expect(db.jobs.size).toBe(0)
    const job = await new FakeStore(db).claimNext()
    expect(job).not.toBeNull()
    expect(job?.paperId).toBe(P)
    expect(db.job(P)?.status).toBe('embedding')
  })

  it.each(['uploaded', 'processing', 'failed'] as const)(
    'does not claim a %s paper',
    async (status) => {
      const clock = new FakeClock()
      const db = new FakeDb(clock)
      db.addPaper('p', 5, { status })
      expect(await new FakeStore(db).claimNext()).toBeNull()
      expect(db.jobs.size).toBe(0)
    },
  )

  it('does not claim a ready paper that has no chunks', async () => {
    const clock = new FakeClock()
    const db = new FakeDb(clock)
    db.addPaper('p', 0)
    expect(await new FakeStore(db).claimNext()).toBeNull()
  })

  it('uses only the active profile (never building or retired ones)', async () => {
    const { db } = setup()
    db.models = [
      { id: 'old:1024:ctx-v0', status: 'retired' },
      { id: 'next:1024:ctx-v2', status: 'building' },
      { id: MODEL, status: 'active' },
    ]
    const job = await new FakeStore(db).claimNext()
    expect(job?.modelId).toBe(MODEL)
    expect([...db.jobs.values()].map((j) => j.modelId)).toEqual([MODEL])
  })

  it('claims nothing when no profile is active', async () => {
    const { db } = setup()
    db.models = [{ id: MODEL, status: 'building' }]
    expect(await new FakeStore(db).claimNext()).toBeNull()
  })

  it('two workers can never claim the same job', async () => {
    const { db } = setup()
    const a = new FakeStore(db)
    const b = new FakeStore(db)
    const [ja, jb] = [await a.claimNext(), await b.claimNext()]
    expect(ja).not.toBeNull()
    expect(jb).toBeNull()
  })

  it('two workers split two papers between them', async () => {
    const { db } = setup()
    db.addPaper('paper-2', 3)
    const claimed = [
      await new FakeStore(db).claimNext(),
      await new FakeStore(db).claimNext(),
    ]
    expect(claimed.map((j) => j?.paperId).sort()).toEqual([
      'paper-1',
      'paper-2',
    ])
  })

  it('restricts everything to one paper when asked (no library-wide backfill)', async () => {
    const { db } = setup()
    db.addPaper('paper-2', 3)
    const job = await new FakeStore(db).claimNext('paper-2')
    expect(job?.paperId).toBe('paper-2')
    expect([...db.jobs.keys()]).toEqual([`paper-2|${MODEL}`]) // paper-1 got no job
  })

  it('does not steal a live claim, but recovers a stalled one', async () => {
    const { db, clock } = setup()
    const a = new FakeStore(db)
    const first = await a.claimNext()
    clock.advance(10 * 60_000)
    expect(await new FakeStore(db).claimNext()).toBeNull() // 10 min < 15 min stale window
    clock.advance(6 * 60_000)
    const second = await new FakeStore(db).claimNext()
    expect(second).not.toBeNull()
    expect(second?.attempts).toBe(2)
    expect(second?.claimStartedAt).not.toBe(first?.claimStartedAt)
    // The crashed worker is fenced out.
    expect(
      await a.storeEmbeddings(first!, okRows(['paper-1-g1-c0'])),
    ).toBeNull()
    expect(await a.complete(first!)).toBe(false)
  })

  it('a batch stored recently keeps a long job alive (heartbeat)', async () => {
    const { db, clock } = setup()
    const a = new FakeStore(db)
    const job = await a.claimNext()
    clock.advance(14 * 60_000)
    await a.storeEmbeddings(job!, okRows(['paper-1-g1-c0']))
    clock.advance(14 * 60_000) // 28 min since claim, but only 14 since the last batch
    expect(await new FakeStore(db).claimNext()).toBeNull()
  })

  it('stops claiming a job after the attempt limit, and fails abandoned jobs', async () => {
    const { db, clock } = setup()
    const store = new FakeStore(db, { maxAttempts: 2 })
    await store.claimNext()
    clock.advance(16 * 60_000)
    await store.claimNext() // attempt 2, stalled again
    clock.advance(16 * 60_000)
    expect(await store.claimNext()).toBeNull()
    expect(db.job(P)?.status).toBe('failed')
    expect(db.job(P)?.lastError).toBe(
      'Indexing was interrupted repeatedly and was stopped.',
    )
  })

  it('honors next_attempt_at (retry backoff)', async () => {
    const { db, clock } = setup()
    const store = new FakeStore(db)
    const job = await store.claimNext()
    await store.fail(job!, {
      message: '',
      retry: true,
      countAttempt: true,
      retryDelayMs: 120_000,
    })
    expect(await store.claimNext()).toBeNull()
    clock.advance(121_000)
    expect((await store.claimNext())?.attempts).toBe(2)
  })
})

describe('generation safety (reprocessing)', () => {
  it('a reprocessed paper resets its job and rebuilds embeddings for the new chunks', async () => {
    const { db, clock, runner } = setup(6)
    const first = await drive(runner, clock)
    expect(first.at(-1)?.kind).toBe('complete')
    expect(db.job(P)?.status).toBe('complete')
    const oldGeneration = db.job(P)!.sourceCompletedAt

    db.reprocess(P, 8) // new chunk ids, old vectors cascade away
    expect(db.embeddingsOf(P)).toHaveLength(0)

    const runner2 = makeRunner(db, new FakeProvider(clock))
    const second = await drive(runner2, clock)
    const done = second.at(-1)
    expect(done?.kind).toBe('complete')
    if (done?.kind === 'complete') {
      expect(done.summary.chunksTotal).toBe(8)
      expect(done.summary.newlyEmbedded).toBe(8)
      expect(done.summary.reused).toBe(0)
    }
    expect(db.job(P)?.sourceCompletedAt).not.toBe(oldGeneration)
    expect(db.job(P)?.attempts).toBe(1) // attempts reset for the new generation
    expect(db.embeddingsOf(P)).toHaveLength(8)
  })

  it("a job is current only while its source generation equals the paper's", async () => {
    const { db, clock, runner } = setup(4)
    await drive(runner, clock)
    const job = db.job(P)!
    expect(job.sourceCompletedAt).toBe(db.papers.get(P)!.completedAt)
    db.reprocess(P, 4)
    expect(job.sourceCompletedAt).not.toBe(db.papers.get(P)!.completedAt) // stale until re-claimed
  })

  it('a worker holding the OLD generation cannot store or complete the new one', async () => {
    const { db } = setup(4)
    const oldWorker = new FakeStore(db)
    const oldJob = await oldWorker.claimNext()
    expect(oldJob).not.toBeNull()

    db.reprocess(P, 4)
    const newWorker = new FakeStore(db)
    const newJob = await newWorker.claimNext() // resets the generation and claims it
    expect(newJob).not.toBeNull()
    expect(newJob?.claimStartedAt).not.toBe(oldJob?.claimStartedAt)

    const newChunkIds = db.chunksOf(P).map((c) => c.id)
    expect(
      await oldWorker.storeEmbeddings(oldJob!, okRows(newChunkIds)),
    ).toBeNull()
    expect(await oldWorker.complete(oldJob!)).toBe(false)
    expect(await oldWorker.fail(oldJob!, noRetry)).toBe(false)
    expect(db.embeddingsOf(P)).toHaveLength(0)
  })

  it('a running worker stops with "lost" when the paper is reprocessed under it', async () => {
    const { db, clock, runner } = setup(9)
    expect((await runner.step()).kind).toBe('progress') // first batch stored
    db.reprocess(P, 9)
    clock.advance(100_000)
    const results = await drive(runner, clock)
    expect(results.at(-1)?.kind).toBe('lost')
    expect(db.embeddingsOf(P)).toHaveLength(0)
  })

  it('a paper that leaves "ready" during reprocessing is not claimable until it is ready again', async () => {
    const { db } = setup(4)
    db.papers.get(P)!.status = 'processing'
    expect(await new FakeStore(db).claimNext()).toBeNull()
  })
})

describe('chunk loading, inputs and resumability', () => {
  it('embeds chunks in deterministic chunk_index order with exact ctx-v1 inputs', async () => {
    const { db, clock, provider, runner } = setup(7)
    db.chunks.reverse() // storage order must not matter
    await drive(runner, clock)
    const sent = provider.calls.flatMap((c) => c.inputs)
    const expected = db
      .chunksOf(P)
      .sort((a, b) => a.index - b.index)
      .map((c) =>
        buildDocumentInput({
          paperTitle: `Paper ${P}`,
          sectionTitle: c.sectionTitle,
          text: c.text,
        }),
      )
    expect(sent).toEqual(expected)
    expect(sent[0].startsWith('Title: Paper paper-1\n\n')).toBe(true) // blank section dropped
    expect(
      sent[1].startsWith('Title: Paper paper-1\nSection: Section 1\n\n'),
    ).toBe(true)
  })

  it('stores each batch as it goes (batch persistence)', async () => {
    const { db, runner } = setup(10)
    const first = await runner.step()
    expect(first).toMatchObject({ kind: 'progress', embedded: 3 })
    expect(db.embeddingsOf(P)).toHaveLength(3)
    expect(db.job(P)?.embeddedCount).toBe(3)
    expect(db.job(P)?.status).toBe('embedding')
  })

  it('completes only when every chunk is embedded, then marks the job complete', async () => {
    const { db, clock, runner } = setup(10)
    const results = await drive(runner, clock)
    expect(results.at(-1)?.kind).toBe('complete')
    expect(db.embeddingsOf(P)).toHaveLength(10)
    expect(db.job(P)).toMatchObject({
      status: 'complete',
      chunkCount: 10,
      embeddedCount: 10,
      claimToken: null,
    })
    // Every stored vector carries the hash of its exact ctx-v1 input.
    for (const e of db.embeddingsOf(P)) {
      const chunk = db.chunks.find((c) => c.id === e.chunkId)!
      expect(e.hash).toBe(
        contentHash(
          buildDocumentInput({
            paperTitle: `Paper ${P}`,
            sectionTitle: chunk.sectionTitle,
            text: chunk.text,
          }),
        ),
      )
    }
  })

  it('the store refuses to complete a job with missing embeddings', async () => {
    const { db } = setup(4)
    const store = new FakeStore(db)
    const job = (await store.claimNext())!
    await store.storeEmbeddings(job, okRows([db.chunksOf(P)[0].id]))
    await expect(store.complete(job)).rejects.toBeInstanceOf(StoreError)
    expect(db.job(P)?.status).toBe('embedding')
  })

  it('crash after one batch: the restart embeds ONLY the missing chunks', async () => {
    const { db, clock, runner } = setup(10)
    expect((await runner.step()).kind).toBe('progress') // 3 chunks stored, then the process "crashes"
    expect(db.embeddingsOf(P)).toHaveLength(3)

    clock.advance(16 * 60_000) // the stalled-job window passes
    const provider2 = new FakeProvider(clock)
    const runner2 = makeRunner(db, provider2)
    const results = await drive(runner2, clock)

    const done = results.at(-1)
    expect(done?.kind).toBe('complete')
    if (done?.kind === 'complete') {
      expect(done.summary.reused).toBe(3)
      expect(done.summary.newlyEmbedded).toBe(7)
    }
    expect(provider2.calls.flatMap((c) => c.inputs)).toHaveLength(7) // completed batches not resent
    expect(db.job(P)?.attempts).toBe(2)
    expect(db.embeddingsOf(P)).toHaveLength(10)
  })

  it('reuses embeddings whose content_hash matches, and embeds nothing when all match', async () => {
    const { db, clock, runner } = setup(6)
    await drive(runner, clock) // index once
    db.job(P)!.status = 'pending' // pretend the job is re-run (e.g. after a profile reset)
    db.job(P)!.nextAttemptAt = null
    const provider2 = new FakeProvider(clock)
    const results = await drive(makeRunner(db, provider2), clock)
    const done = results.at(-1)
    expect(done?.kind).toBe('complete')
    if (done?.kind === 'complete') {
      expect(done.summary.reused).toBe(6)
      expect(done.summary.newlyEmbedded).toBe(0)
      expect(done.summary.requests).toBe(0)
    }
    expect(provider2.calls).toHaveLength(0) // Voyage is not called at all
  })

  it('re-embeds a chunk whose stored content_hash no longer matches, and replaces it', async () => {
    const { db, clock, runner } = setup(6)
    await drive(runner, clock)
    const stale = db.embeddingsOf(P)[2]
    stale.hash = 'e'.repeat(64)
    stale.vector = new Array<number>(1024).fill(9)
    db.job(P)!.status = 'pending'
    const provider2 = new FakeProvider(clock)
    const done = (await drive(makeRunner(db, provider2), clock)).at(-1)
    expect(done?.kind).toBe('complete')
    if (done?.kind === 'complete') {
      expect(done.summary.newlyEmbedded).toBe(1)
      expect(done.summary.reused).toBe(5)
    }
    expect(provider2.calls.flatMap((c) => c.inputs)).toHaveLength(1)
    const fixed = db.embeddingsOf(P).find((e) => e.chunkId === stale.chunkId)!
    expect(fixed.hash).not.toBe('e'.repeat(64))
    expect(fixed.vector[0]).not.toBe(9)
  })

  it('re-embeds a stored embedding that has no content_hash', async () => {
    const { db, clock, runner } = setup(3)
    await drive(runner, clock)
    db.embeddingsOf(P)[0].hash = null
    db.job(P)!.status = 'pending'
    const provider2 = new FakeProvider(clock)
    await drive(makeRunner(db, provider2), clock)
    expect(provider2.calls.flatMap((c) => c.inputs)).toHaveLength(1)
  })
})

describe('rate-limit pacing: 3 requests/min, 10,000 tokens/min', () => {
  it('never exceeds 3 requests in any 60s window (many small requests)', async () => {
    const { clock, provider, runner } = setup(14, {
      chars: 200,
      runner: { config: { maxItemsPerRequest: 1 } },
    })
    const results = await drive(runner, clock, 2_000)
    expect(results.at(-1)?.kind).toBe('complete')
    expect(provider.calls).toHaveLength(14)
    const times = provider.calls.map((c) => ({ at: c.at, weight: 1 }))
    expect(maxInWindow(times, 60_000)).toBeLessThanOrEqual(3)
  })

  it('never exceeds 10,000 billed tokens in any 60s window (realistic 3,600-char chunks)', async () => {
    const { clock, provider, runner } = setup(20)
    const results = await drive(runner, clock, 2_000)
    expect(results.at(-1)?.kind).toBe('complete')
    const usage = provider.calls.map((c) => ({ at: c.at, weight: c.tokens }))
    expect(maxInWindow(usage, 60_000)).toBeLessThanOrEqual(10_000)
    expect(
      maxInWindow(
        provider.calls.map((c) => ({ at: c.at, weight: 1 })),
        60_000,
      ),
    ).toBeLessThanOrEqual(3)
  })

  it('stays under the limit even with math-dense text (billed tokens far above the estimate)', async () => {
    const { clock, provider, runner } = setup(12)
    provider.tokensPerChar = 0.4 // 2.5 chars/token: the densest text the estimator allows for
    await drive(runner, clock, 2_000)
    const usage = provider.calls.map((c) => ({ at: c.at, weight: c.tokens }))
    expect(maxInWindow(usage, 60_000)).toBeLessThanOrEqual(10_000)
  })

  it('asks the scheduler to wait instead of sleeping or sending early', async () => {
    const { runner, provider } = setup(30)
    const seen: string[] = []
    for (let i = 0; i < 6; i++) seen.push((await runner.step()).kind)
    expect(seen).toContain('waiting')
    expect(provider.calls.length).toBeLessThanOrEqual(3)
  })

  it('a 429 with Retry-After waits at least that long before the next request', async () => {
    const { clock, provider, runner } = setup(2)
    provider.failures = [
      new EmbeddingError(
        'rate_limited',
        'Voyage rate limit reached (HTTP 429)',
        { status: 429, retryAfterMs: 45_000 },
      ),
    ]
    const waiting = await runner.step()
    expect(waiting).toEqual({ kind: 'waiting', waitMs: 45_000 })
    clock.advance(45_000)
    const results = await drive(runner, clock)
    expect(results.at(-1)?.kind).toBe('complete')
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[1].at - provider.calls[0].at).toBeGreaterThanOrEqual(
      45_000,
    )
  })

  it('a 429 without Retry-After waits a full window', async () => {
    const { provider, runner } = setup(2)
    provider.failures = [
      new EmbeddingError(
        'rate_limited',
        'Voyage rate limit reached (HTTP 429)',
        { status: 429 },
      ),
    ]
    const waiting = await runner.step()
    expect(waiting.kind).toBe('waiting')
    if (waiting.kind === 'waiting')
      expect(waiting.waitMs).toBeGreaterThanOrEqual(60_000)
  })

  it('a rate-limited request still counts against the window (no immediate extra requests)', async () => {
    const { clock, provider, runner } = setup(2)
    provider.failures = [serverError(), serverError()]
    await runner.step()
    clock.advance(2_000)
    await runner.step()
    clock.advance(4_000)
    await runner.step() // third attempt succeeds
    const times = provider.calls.map((c) => ({ at: c.at, weight: 1 }))
    expect(maxInWindow(times, 60_000)).toBeLessThanOrEqual(3)
  })

  it('exhausted request retries requeue the JOB (bounded), leaving the paper ready', async () => {
    const { db, clock, provider, runner } = setup(2, {
      runner: { config: { maxRequestAttempts: 2 } },
    })
    provider.failures = [serverError(), serverError()]
    const results = await drive(runner, clock)
    expect(results.at(-1)).toMatchObject({ kind: 'retry' })
    expect(db.job(P)?.status).toBe('pending')
    expect(db.job(P)?.nextAttemptAt).toBeGreaterThan(clock.t)
    expect(db.papers.get(P)?.status).toBe('ready')
  })
})

describe('failure model (PDF lifecycle untouched)', () => {
  it('a provider outage never changes papers, and the job ends failed after bounded attempts', async () => {
    const { db, clock, provider } = setup(4)
    const before = paperSnapshot(db)
    provider.failures = Array.from({ length: 50 }, serverError)
    const config = { maxRequestAttempts: 1, jobMaxAttempts: 3 }
    const kinds: string[] = []
    for (let attempt = 0; attempt < 5; attempt++) {
      const runner = makeRunner(db, provider, {
        config,
        store: new FakeStore(db, { maxAttempts: 3 }),
      })
      kinds.push((await drive(runner, clock)).at(-1)!.kind)
      clock.advance(40 * 60_000)
    }
    expect(kinds).toEqual(['retry', 'retry', 'failed', 'idle', 'idle'])
    expect(db.job(P)).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: FAILURE_MESSAGES.provider_unavailable,
    })
    expect(paperSnapshot(db)).toBe(before)
    expect(db.papers.get(P)?.status).toBe('ready')
  })

  it("an unusable API key blocks the stage and refunds the attempt (not the paper's fault)", async () => {
    const { db, clock, provider, runner } = setup(3)
    provider.failures = [
      new EmbeddingError('auth', 'Voyage rejected the API key (HTTP 401)', {
        status: 401,
      }),
    ]
    const results = await drive(runner, clock)
    expect(results.at(-1)).toMatchObject({ kind: 'blocked' })
    expect(db.job(P)).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
    })
    expect(db.papers.get(P)?.status).toBe('ready')
  })

  it('a wrong vector dimension is fatal and is never stored', async () => {
    const { db, clock, provider, runner } = setup(3)
    provider.dimensions = 768
    const results = await drive(runner, clock)
    expect(results.at(-1)).toMatchObject({ kind: 'failed' })
    expect(db.job(P)).toMatchObject({
      status: 'failed',
      lastError: FAILURE_MESSAGES.invalid_vector,
    })
    expect(db.embeddingsOf(P)).toHaveLength(0)
    expect(InvalidVectorError).toBeDefined()
  })

  it('a malformed provider response is fatal', async () => {
    const { db, clock, provider, runner } = setup(3)
    provider.failures = [
      new EmbeddingError(
        'invalid_response',
        'Voyage returned a malformed embedding entry',
      ),
    ]
    expect((await drive(runner, clock)).at(-1)).toMatchObject({
      kind: 'failed',
    })
    expect(db.job(P)?.lastError).toBe(
      FAILURE_MESSAGES.invalid_provider_response,
    )
  })

  it('a transient database failure while storing is retried', async () => {
    const { db, clock, provider } = setup(3)
    class FlakyStore extends FakeStore {
      override async storeEmbeddings(
        job: ClaimedEmbeddingJob,
        rows: EmbeddingRow[],
      ) {
        throw new StoreError('store_chunk_embeddings', null)
        return super.storeEmbeddings(job, rows)
      }
    }
    const runner = makeRunner(db, provider, { store: new FlakyStore(db) })
    expect((await drive(runner, clock)).at(-1)).toMatchObject({ kind: 'retry' })
    expect(db.job(P)?.status).toBe('pending')
  })

  it('an ownership/constraint violation is fatal (impossible mismatch: retrying cannot help)', async () => {
    const { db, clock, provider } = setup(3)
    class WrongOwnerStore extends FakeStore {
      override async storeEmbeddings(
        _job: ClaimedEmbeddingJob,
        _rows: EmbeddingRow[],
      ): Promise<number | null> {
        throw new StoreError('store_chunk_embeddings', '23503')
      }
    }
    const runner = makeRunner(db, provider, { store: new WrongOwnerStore(db) })
    expect((await drive(runner, clock)).at(-1)).toMatchObject({
      kind: 'failed',
    })
    expect(db.job(P)?.lastError).toBe(FAILURE_MESSAGES.integrity_error)
  })

  it("refuses to embed with a profile different from the job's vector space", async () => {
    const { db, clock, provider } = setup(3)
    class OtherProfileStore extends FakeStore {
      override async claimNext(paperId?: string) {
        const job = await super.claimNext(paperId)
        return job
          ? { ...job, profile: { ...job.profile, inputProfile: 'ctx-v2' } }
          : null
      }
    }
    const runner = makeRunner(db, provider, {
      store: new OtherProfileStore(db),
    })
    const results = await drive(runner, clock)
    expect(results.at(-1)).toMatchObject({ kind: 'blocked' })
    expect(provider.calls).toHaveLength(0)
    expect(db.job(P)).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('an unexpected error in the loader fails the job with a fixed message, not raw text', async () => {
    const { db, clock, provider } = setup(3)
    class BrokenLoadStore extends FakeStore {
      override async loadSnapshot(): Promise<never> {
        throw new Error('raw internal detail: postgres://user:secret@host/db')
      }
    }
    const runner = makeRunner(db, provider, { store: new BrokenLoadStore(db) })
    expect((await drive(runner, clock)).at(-1)).toMatchObject({
      kind: 'failed',
    })
    expect(db.job(P)?.lastError).toBe(FAILURE_MESSAGES.unexpected_error)
    expect(JSON.stringify([...db.jobs.values()])).not.toContain('secret')
  })
})

describe('shutdown', () => {
  it('releasing an in-flight job returns it to pending without counting an attempt', async () => {
    const { db, runner } = setup(10)
    await runner.step() // claims, embeds one batch
    expect(db.job(P)?.attempts).toBe(1)
    expect(await runner.release()).toMatchObject({
      kind: 'interrupted',
      paperId: P,
    })
    expect(db.job(P)).toMatchObject({
      status: 'pending',
      attempts: 0,
      claimToken: null,
    })
    expect(db.embeddingsOf(P)).toHaveLength(3) // stored work is kept
    expect(runner.hasActiveJob).toBe(false)
  })

  it('an aborted signal makes the next step release the job instead of working', async () => {
    const { db, provider, runner } = setup(10)
    await runner.step()
    const controller = new AbortController()
    controller.abort()
    const callsBefore = provider.calls.length
    expect((await runner.step(controller.signal)).kind).toBe('interrupted')
    expect(provider.calls).toHaveLength(callsBefore)
    expect(db.job(P)?.status).toBe('pending')
  })

  it('releasing with nothing active is a no-op', async () => {
    const { runner } = setup(3)
    expect((await runner.release()).kind).toBe('idle')
  })
})

describe('token accounting and safe logs', () => {
  it('reports aggregate metadata for the job', async () => {
    const { clock, runner } = setup(6)
    const done = (await drive(runner, clock)).at(-1)
    expect(done?.kind).toBe('complete')
    if (done?.kind === 'complete') {
      expect(done.summary).toMatchObject({
        paperId: P,
        chunksTotal: 6,
        newlyEmbedded: 6,
        reused: 0,
        requests: 2,
      })
      expect(done.summary.billedTokens).toBeGreaterThan(0)
      expect(done.summary.elapsedMs).toBeGreaterThan(0)
    }
  })

  it('logs only ids and counts: never chunk text, vectors, keys or headers', async () => {
    const { db, clock, provider, runner, logs } = setup(6)
    provider.failures = [serverError()]
    await drive(runner, clock)
    const text = logs.join('\n')
    expect(text).toContain(P)
    for (const forbidden of [
      'lorem ipsum',
      'Chunk 0 of',
      'Title:',
      'Bearer',
      'pa-',
      '0.01,',
    ]) {
      expect(text).not.toContain(forbidden)
    }
    // No long numeric arrays (vectors).
    expect(text).not.toMatch(/\d\.\d+,\s*\d\.\d+,\s*\d\.\d+/)
    expect(db.job(P)?.lastError).toBeNull()
  })

  it('stored job errors are always one of the fixed messages', async () => {
    const { db, clock, provider, runner } = setup(3)
    provider.failures = [
      new EmbeddingError(
        'bad_request',
        'Voyage rejected the request (HTTP 400): secret-ish detail',
      ),
    ]
    await drive(runner, clock)
    expect(Object.values(FAILURE_MESSAGES)).toContain(db.job(P)?.lastError)
    expect(db.job(P)?.lastError).not.toContain('secret-ish')
  })
})
