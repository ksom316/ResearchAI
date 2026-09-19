import { describe, expect, it } from 'vitest'
import { EmbeddingError } from '../../src/lib/embedding/errors'
import { contentHash } from '../../src/lib/embedding/hash'
import { buildDocumentInput } from '../../src/lib/embedding/input'
import {
  FAILURE_MESSAGES,
  JobIntegrityError,
  StoreError,
  classify,
  jobRetryDelayMs,
  toJobFailure,
} from './failure'
import { InvalidChunkError, planChunks, takeBatch } from './plan'
import { InvalidVectorError, toEmbeddingRows, vectorPayload } from './serialize'
import type { PaperChunkSnapshot } from './types'

const snapshot = (
  over: Partial<PaperChunkSnapshot> = {},
): PaperChunkSnapshot => ({
  paperTitle: 'BERT: Pre-training',
  chunks: [
    {
      id: 'c1',
      index: 1,
      text: 'Second chunk text.',
      sectionTitle: '2 Related Work',
    },
    { id: 'c0', index: 0, text: 'First chunk text.', sectionTitle: '' },
    { id: 'c2', index: 2, text: 'Third chunk text.', sectionTitle: null },
  ],
  existingHashes: new Map(),
  ...over,
})

describe('planChunks: deterministic ctx-v1 inputs in chunk_index order', () => {
  it('orders by chunk_index regardless of load order', () => {
    const plan = planChunks(snapshot())
    expect(plan.pending.map((c) => c.chunkId)).toEqual(['c0', 'c1', 'c2'])
    expect(plan.pending.map((c) => c.index)).toEqual([0, 1, 2])
  })

  it('builds exactly the existing ctx-v1 input, with blank section titles handled', () => {
    const plan = planChunks(snapshot())
    expect(plan.pending[0].input).toBe(
      'Title: BERT: Pre-training\n\nFirst chunk text.',
    )
    expect(plan.pending[1].input).toBe(
      'Title: BERT: Pre-training\nSection: 2 Related Work\n\nSecond chunk text.',
    )
    expect(plan.pending[2].input).toBe(
      'Title: BERT: Pre-training\n\nThird chunk text.',
    )
    for (const c of plan.pending) expect(c.hash).toBe(contentHash(c.input))
    expect(plan.pending[1].input).toBe(
      buildDocumentInput({
        paperTitle: 'BERT: Pre-training',
        sectionTitle: '2 Related Work',
        text: 'Second chunk text.',
      }),
    )
  })

  it('is deterministic', () => {
    expect(planChunks(snapshot())).toEqual(planChunks(snapshot()))
  })

  it('reuses an embedding only when its content_hash matches the exact current input', () => {
    const base = planChunks(snapshot())
    const existing = new Map<string, string | null>([
      ['c0', base.pending[0].hash], // matches: reuse
      ['c1', 'f'.repeat(64)], // stale hash: re-embed
      ['c2', null], // no hash recorded: re-embed
    ])
    const plan = planChunks(snapshot({ existingHashes: existing }))
    expect(plan.total).toBe(3)
    expect(plan.reused).toBe(1)
    expect(plan.pending.map((c) => c.chunkId)).toEqual(['c1', 'c2'])
  })

  it('re-embeds when the paper title or section title changed (the input changed)', () => {
    const base = planChunks(snapshot())
    const existing = new Map(base.pending.map((c) => [c.chunkId, c.hash]))
    const renamed = planChunks(
      snapshot({ paperTitle: 'A different title', existingHashes: existing }),
    )
    expect(renamed.reused).toBe(0)
  })

  it('rejects a chunk with no text (never retryable)', () => {
    const bad = snapshot({
      chunks: [{ id: 'x', index: 0, text: '  \n', sectionTitle: 'S' }],
    })
    expect(() => planChunks(bad)).toThrow(InvalidChunkError)
  })
})

describe('takeBatch', () => {
  const pending = Array.from({ length: 10 }, (_, i) => ({
    chunkId: `c${i}`,
    index: i,
    input: 'x',
    hash: 'h',
    chars: 3_700,
  }))
  const estimate = (chars: number) => Math.ceil(chars / 3)

  it('takes chunks in order up to the token budget (3 x ~1,234 fits 4,000)', () => {
    const batch = takeBatch(
      pending,
      { maxItems: 32, maxTokens: 4_000 },
      estimate,
    )
    expect(batch.map((c) => c.chunkId)).toEqual(['c0', 'c1', 'c2'])
  })

  it('respects the item cap', () => {
    expect(
      takeBatch(pending, { maxItems: 2, maxTokens: 100_000 }, estimate),
    ).toHaveLength(2)
  })

  it('always makes progress, even for a single chunk above the token cap', () => {
    const big = [
      { chunkId: 'big', index: 0, input: 'x', hash: 'h', chars: 30_000 },
    ]
    expect(
      takeBatch(big, { maxItems: 32, maxTokens: 4_000 }, estimate),
    ).toHaveLength(1)
  })

  it('never returns an empty batch for non-empty input', () => {
    expect(
      takeBatch(pending, { maxItems: 1, maxTokens: 1 }, estimate),
    ).toHaveLength(1)
  })
})

describe('vector serialization', () => {
  const vec = (n: number, fill = 0.5) => new Array<number>(n).fill(fill)

  it('returns a plain copy of a valid 1024-number vector', () => {
    const input = vec(1024)
    const out = vectorPayload(input, 1024)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(JSON.parse(JSON.stringify(out))).toEqual(input) // survives JSON (the RPC transport)
  })

  it.each([1023, 1025, 0, 768])('rejects a vector of length %i', (n) => {
    expect(() => vectorPayload(vec(n), 1024)).toThrow(InvalidVectorError)
  })

  it.each([NaN, Infinity, -Infinity])('rejects %s', (bad) => {
    const v = vec(1024)
    v[10] = bad
    expect(() => vectorPayload(v, 1024)).toThrow(InvalidVectorError)
  })

  it('rejects non-numbers', () => {
    const v = vec(1024) as unknown[]
    v[3] = '0.5'
    expect(() => vectorPayload(v as number[], 1024)).toThrow(InvalidVectorError)
  })

  it('pairs each chunk with its own vector and content hash, in order', () => {
    const batch = planChunks(snapshot()).pending
    const rows = toEmbeddingRows(
      batch,
      [vec(1024, 0.1), vec(1024, 0.2), vec(1024, 0.3)],
      1024,
    )
    expect(rows.map((r) => r.chunkId)).toEqual(['c0', 'c1', 'c2'])
    expect(rows.map((r) => r.embedding[0])).toEqual([0.1, 0.2, 0.3])
    expect(rows.map((r) => r.contentHash)).toEqual(batch.map((c) => c.hash))
  })

  it('rejects a mismatched vector count', () => {
    const batch = planChunks(snapshot()).pending
    expect(() => toEmbeddingRows(batch, [vec(1024)], 1024)).toThrow(
      InvalidVectorError,
    )
  })

  it('never contains SQL text: rows are plain numbers and strings', () => {
    const batch = planChunks(snapshot()).pending.slice(0, 1)
    const [row] = toEmbeddingRows(batch, [vec(1024)], 1024)
    expect(Array.isArray(row.embedding)).toBe(true)
    expect(row.embedding.every((n) => typeof n === 'number')).toBe(true)
  })
})

describe('failure classification', () => {
  const kind = (k: ConstructorParameters<typeof EmbeddingError>[0]) =>
    classify(new EmbeddingError(k, 'x'))

  it.each([
    ['rate_limited', true],
    ['server', true],
    ['network', true],
    ['timeout', true],
  ] as const)('provider %s is retryable', (k, retryable) => {
    expect(kind(k)).toMatchObject({ kind: 'job', retryable })
  })

  it.each([
    'bad_request',
    'invalid_response',
    'dimension_mismatch',
    'invalid_input',
  ] as const)('provider %s is fatal', (k) => {
    expect(kind(k)).toMatchObject({ kind: 'job', retryable: false })
  })

  it('treats an unusable key as a stage-wide block, not a job failure', () => {
    expect(kind('auth')).toMatchObject({ kind: 'blocked' })
  })

  it('classifies local validation errors as fatal', () => {
    expect(classify(new InvalidVectorError('x'))).toMatchObject({
      code: 'invalid_vector',
      retryable: false,
    })
    expect(classify(new InvalidChunkError())).toMatchObject({
      code: 'invalid_input',
      retryable: false,
    })
    expect(classify(new JobIntegrityError('x'))).toMatchObject({
      code: 'integrity_error',
      retryable: false,
    })
  })

  it('treats store errors with no SQLSTATE (network/5xx) as transient', () => {
    expect(classify(new StoreError('store', null))).toMatchObject({
      code: 'storage_error',
      retryable: true,
    })
  })

  it.each(['23503', '22000', '42501', 'P0001'])(
    'treats SQLSTATE %s as a permanent integrity problem',
    (code) => {
      expect(classify(new StoreError('store', code))).toMatchObject({
        code: 'integrity_error',
        retryable: false,
      })
    },
  )

  it('treats anything unknown as fatal', () => {
    expect(classify(new Error('boom'))).toMatchObject({
      code: 'unexpected_error',
      retryable: false,
    })
  })

  it('bounds retries: retryable failures stop retrying once attempts are used up', () => {
    expect(toJobFailure('provider_unavailable', true, 1, 4).retry).toBe(true)
    expect(toJobFailure('provider_unavailable', true, 3, 4).retry).toBe(true)
    expect(toJobFailure('provider_unavailable', true, 4, 4).retry).toBe(false)
    expect(toJobFailure('invalid_vector', false, 1, 4).retry).toBe(false)
  })

  it('backs off between job attempts: 1m, 2m, 4m, ... capped at 30m', () => {
    expect([1, 2, 3, 4, 10].map(jobRetryDelayMs)).toEqual([
      60_000, 120_000, 240_000, 480_000, 1_800_000,
    ])
  })

  it('only ever uses fixed messages for stored errors', () => {
    const failure = toJobFailure('provider_unavailable', false, 4, 4)
    expect(Object.values(FAILURE_MESSAGES)).toContain(failure.message)
  })

  it('StoreError keeps only the operation and SQLSTATE, never database text', () => {
    const e = new StoreError('store_chunk_embeddings', '23514')
    expect(e.message).toBe('store_chunk_embeddings failed (23514)')
  })
})
