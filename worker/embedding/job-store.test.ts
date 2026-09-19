import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { StoreError } from './failure'
import { createSupabaseEmbeddingStore } from './job-store'
import type { ClaimedEmbeddingJob } from './types'

const SECRET = 'sb_secret_SUPERSECRETSERVICEROLEKEY_1234567890'
const PRIVATE = 'PRIVATE CHUNK TEXT should never be logged'

const job: ClaimedEmbeddingJob = {
  paperId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  modelId: 'voyage-4:1024:ctx-v1',
  claimStartedAt: '2026-01-01T00:00:00.123456+00:00',
  sourceCompletedAt: '2026-01-01T00:00:00+00:00',
  attempts: 1,
  chunkCount: 3,
  profile: {
    provider: 'voyage',
    providerModel: 'voyage-4',
    dimensions: 1024,
    inputProfile: 'ctx-v1',
  },
}

function stub(
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => { data?: unknown; error?: unknown },
) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      const result = rpc(name, args)
      return { data: result.data ?? null, error: result.error ?? null }
    }),
  }
  return {
    calls,
    store: createSupabaseEmbeddingStore(client as unknown as SupabaseClient, {
      jobMaxAttempts: 4,
      staleAfterMinutes: 15,
    }),
  }
}

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(StoreError)
  return error as StoreError
}

describe('Supabase embedding store', () => {
  it('claims via the RPC with the configured limits and maps the row', async () => {
    const { store, calls } = stub(() => ({
      data: [
        {
          paper_id: job.paperId,
          user_id: job.userId,
          model_id: job.modelId,
          claim_started_at: job.claimStartedAt,
          source_completed_at: job.sourceCompletedAt,
          attempts: 2,
          chunk_count: 27,
          provider: 'voyage',
          provider_model: 'voyage-4',
          dimensions: 1024,
          input_profile: 'ctx-v1',
        },
      ],
    }))
    const claimed = await store.claimNext(job.paperId)
    expect(calls[0]).toEqual({
      name: 'claim_next_embedding_job',
      args: {
        p_paper_id: job.paperId,
        p_max_attempts: 4,
        p_stale_after: '15 minutes',
      },
    })
    expect(claimed).toMatchObject({
      paperId: job.paperId,
      attempts: 2,
      chunkCount: 27,
      profile: { inputProfile: 'ctx-v1' },
    })
    expect(await stub(() => ({ data: [] })).store.claimNext()).toBeNull()
  })

  it('sends vectors as JSON arrays of numbers through a parameterized RPC (no SQL text)', async () => {
    const vector = new Array<number>(1024).fill(0.25)
    const { store, calls } = stub(() => ({ data: 3 }))
    const stored = await store.storeEmbeddings(job, [
      { chunkId: 'c1', embedding: vector, contentHash: 'a'.repeat(64) },
    ])
    expect(stored).toBe(3)
    const { name, args } = calls[0]
    expect(name).toBe('store_chunk_embeddings')
    expect(args.p_paper_id).toBe(job.paperId)
    expect(args.p_claim_started_at).toBe(job.claimStartedAt)
    const rows = args.p_rows as {
      chunk_id: string
      embedding: number[]
      content_hash: string
    }[]
    expect(rows[0].embedding).toHaveLength(1024)
    expect(rows[0].embedding.every((n) => typeof n === 'number')).toBe(true)
    // No user id or SQL-like strings travel in the payload.
    expect(JSON.stringify(args)).not.toMatch(
      /select |insert |update |delete |values\s*\(/i,
    )
    expect(JSON.stringify(args.p_rows)).not.toContain(job.userId)
  })

  it('maps a lost claim (-1) to null', async () => {
    const { store } = stub(() => ({ data: -1 }))
    expect(
      await store.storeEmbeddings(job, [
        { chunkId: 'c', embedding: [0], contentHash: 'a'.repeat(64) },
      ]),
    ).toBeNull()
  })

  it('maps complete/fail results and sends the retry delay as an interval', async () => {
    const { store, calls } = stub((name) => ({
      data: name === 'complete_embedding_job' ? false : true,
    }))
    expect(await store.complete(job)).toBe(false)
    expect(
      await store.fail(job, {
        message: 'x',
        retry: true,
        countAttempt: false,
        retryDelayMs: 61_500,
      }),
    ).toBe(true)
    expect(calls[1].args).toMatchObject({
      p_retry: true,
      p_count_attempt: false,
      p_retry_delay: '62 seconds',
      p_claim_started_at: job.claimStartedAt,
    })
  })

  it('reduces database errors to operation + SQLSTATE: never message, details or row data', async () => {
    const { store } = stub(() => ({
      error: {
        code: '23514',
        message: `new row violates check constraint; ${SECRET}`,
        details: `Failing row contains (${PRIVATE}, [0.1,0.2,0.3])`,
        hint: PRIVATE,
      },
    }))
    const error = await failure(
      store.storeEmbeddings(job, [
        { chunkId: 'c', embedding: [0], contentHash: 'a'.repeat(64) },
      ]),
    )
    expect(error.message).toBe('store_chunk_embeddings failed (23514)')
    for (const forbidden of [SECRET, 'PRIVATE', '0.1,0.2', 'violates']) {
      expect(JSON.stringify(error)).not.toContain(forbidden)
      expect(error.message).not.toContain(forbidden)
    }
    expect(error.retryable).toBe(false)
  })

  it('treats an error with no SQLSTATE (network failure) as retryable', async () => {
    const { store } = stub(() => ({
      error: { message: 'TypeError: fetch failed', code: '' },
    }))
    const error = await failure(store.claimNext())
    expect(error.retryable).toBe(true)
  })
})
