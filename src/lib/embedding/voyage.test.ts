import { describe, expect, it, vi } from 'vitest'
import { EmbeddingError } from './errors'
import {
  VOYAGE_BASE_URL,
  VOYAGE_PHASE4_PROFILE,
  VoyageEmbeddingProvider,
  createVoyageProvider,
} from './voyage'
import type { VoyageOptions } from './voyage'

// A fake key in Voyage's shape; the real key is never used in tests.
const KEY = 'pa-TESTKEY_abcdefghijklmnopqrstuvwxyz0123456789'
const PRIVATE_TEXT = 'PRIVATE-CHUNK-TEXT the confidential sentence'

type Call = { url: string; init: RequestInit; body: Record<string, unknown> }

/** A vector whose first value identifies it, so order mistakes are detectable. */
const vec = (marker: number, dims = 1024) =>
  Array.from({ length: dims }, (_, i) => (i === 0 ? marker : (i % 100) / 100))

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

/** A well-formed success response for `n` inputs, with marker i in vector i. */
const ok = (
  n: number,
  {
    dims = 1024,
    tokens = 7,
    reverse = false,
  }: { dims?: number; tokens?: number | null; reverse?: boolean } = {},
) => {
  const data = Array.from({ length: n }, (_, i) => ({
    object: 'embedding',
    embedding: vec(i, dims),
    index: i,
  }))
  return json({
    object: 'list',
    data: reverse ? data.reverse() : data,
    model: 'voyage-4',
    ...(tokens === null ? {} : { usage: { total_tokens: tokens } }),
  })
}

function mockFetch(
  handler: (call: Call, callNumber: number) => Response | Promise<Response>,
) {
  const calls: Call[] = []
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    }
    calls.push(call)
    return Promise.resolve(handler(call, calls.length))
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

function makeProvider(
  fetchFn: typeof fetch,
  overrides: Partial<VoyageOptions> = {},
  delays: number[] = [],
) {
  return new VoyageEmbeddingProvider({
    apiKey: KEY,
    fetch: fetchFn,
    retry: { sleep: async (ms) => void delays.push(ms), random: () => 1 },
    ...overrides,
  })
}

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return e as EmbeddingError
  }
  throw new Error('expected the promise to reject')
}

describe('request format', () => {
  it('sends documents with input_type "document", voyage-4 and 1024 dimensions', async () => {
    const { fetch, calls } = mockFetch((c) =>
      ok((c.body.input as string[]).length),
    )
    await makeProvider(fetch).embedDocuments([
      'first passage',
      'second passage',
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${VOYAGE_BASE_URL}/embeddings`)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].body).toEqual({
      input: ['first passage', 'second passage'],
      model: 'voyage-4',
      input_type: 'document',
      output_dimension: 1024,
      output_dtype: 'float',
      truncation: false,
    })
  })

  it('sends queries with input_type "query"', async () => {
    const { fetch, calls } = mockFetch(() => ok(1))
    await makeProvider(fetch).embedQuery('What methods improve BERT?')
    expect(calls[0].body).toMatchObject({
      input: ['What methods improve BERT?'],
      model: 'voyage-4',
      input_type: 'query',
      output_dimension: 1024,
    })
  })

  it('authenticates with a Bearer header and never puts the key in the body or URL', async () => {
    const { fetch, calls } = mockFetch(() => ok(1))
    await makeProvider(fetch).embedDocuments(['x'])
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.stringify(calls[0].body)).not.toContain(KEY)
    expect(calls[0].url).not.toContain(KEY)
  })

  it('disables silent truncation so an oversized input is an error, not a cut-off', async () => {
    const { fetch, calls } = mockFetch(() => ok(1))
    await makeProvider(fetch).embedDocuments(['x'])
    expect(calls[0].body.truncation).toBe(false)
  })

  it('exposes the locked Phase 4 profile', () => {
    const provider = createVoyageProvider({
      apiKey: KEY,
      fetch: mockFetch(() => ok(1)).fetch,
    })
    expect(provider.profile).toEqual({
      provider: 'voyage',
      model: 'voyage-4',
      dimensions: 1024,
    })
    expect(VOYAGE_PHASE4_PROFILE).toEqual({
      provider: 'voyage',
      model: 'voyage-4',
      dimensions: 1024,
    })
  })
})

describe('results', () => {
  it('returns vectors in input order, one per input, each 1024 finite numbers', async () => {
    const { fetch } = mockFetch((c) =>
      ok((c.body.input as string[]).length, { tokens: 42 }),
    )
    const result = await makeProvider(fetch).embedDocuments(['a', 'b', 'c'])
    expect(result.vectors).toHaveLength(3)
    expect(result.vectors.map((v) => v[0])).toEqual([0, 1, 2])
    for (const v of result.vectors) {
      expect(v).toHaveLength(1024)
      expect(v.every(Number.isFinite)).toBe(true)
    }
    expect(result.tokens).toBe(42)
  })

  it('restores input order from the index field even if the provider reorders entries', async () => {
    const { fetch } = mockFetch((c) =>
      ok((c.body.input as string[]).length, { reverse: true }),
    )
    const result = await makeProvider(fetch).embedDocuments([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(result.vectors.map((v) => v[0])).toEqual([0, 1, 2, 3])
  })

  it('returns a single 1024-dimension vector for a query', async () => {
    const { fetch } = mockFetch(() => ok(1))
    const { vector } = await makeProvider(fetch).embedQuery('q')
    expect(vector).toHaveLength(1024)
  })

  it('reports token usage as null when the provider does not send it', async () => {
    const { fetch } = mockFetch((c) =>
      ok((c.body.input as string[]).length, { tokens: null }),
    )
    expect((await makeProvider(fetch).embedDocuments(['a'])).tokens).toBeNull()
  })
})

describe('batching', () => {
  // Embed each input's number in its vector so global order can be verified.
  const numbered = (n: number) =>
    Array.from({ length: n }, (_, i) => `item-${i}`)
  const echoNumbers = (call: Call) => {
    const inputs = call.body.input as string[]
    return json({
      data: inputs.map((text, index) => ({
        index,
        embedding: vec(Number.parseInt(text.split('-')[1], 10)),
      })),
      usage: { total_tokens: inputs.length },
    })
  }

  it('splits into requests of at most batchSize and preserves global order', async () => {
    const { fetch, calls } = mockFetch(echoNumbers)
    const result = await makeProvider(fetch, { batchSize: 32 }).embedDocuments(
      numbered(70),
    )
    expect(calls.map((c) => (c.body.input as string[]).length)).toEqual([
      32, 32, 6,
    ])
    expect(result.vectors.map((v) => v[0])).toEqual(
      Array.from({ length: 70 }, (_, i) => i),
    )
    expect(result.tokens).toBe(70)
  })

  it('uses the configured batch size', async () => {
    const { fetch, calls } = mockFetch(echoNumbers)
    await makeProvider(fetch, { batchSize: 10 }).embedDocuments(numbered(25))
    expect(calls.map((c) => (c.body.input as string[]).length)).toEqual([
      10, 10, 5,
    ])
  })

  it('respects the per-request character budget', async () => {
    const { fetch, calls } = mockFetch(echoNumbers)
    const inputs = numbered(12).map((s) => s.padEnd(1_000, ' .'))
    await makeProvider(fetch, {
      batchSize: 128,
      maxBatchChars: 3_500,
    }).embedDocuments(inputs)
    expect(calls.length).toBeGreaterThan(1)
    for (const c of calls) {
      const chars = (c.body.input as string[]).reduce((n, s) => n + s.length, 0)
      expect(chars).toBeLessThanOrEqual(3_500)
    }
  })

  it('sends batches one at a time, in order', async () => {
    let active = 0
    let maxActive = 0
    const { fetch } = mockFetch(async (c) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return echoNumbers(c)
    })
    await makeProvider(fetch, { batchSize: 5 }).embedDocuments(numbered(20))
    expect(maxActive).toBe(1)
  })

  it('reports null tokens if any batch omits usage', async () => {
    const { fetch } = mockFetch((c, n) =>
      n === 1
        ? echoNumbers(c)
        : ok((c.body.input as string[]).length, { tokens: null }),
    )
    const result = await makeProvider(fetch, { batchSize: 2 }).embedDocuments(
      numbered(4),
    )
    expect(result.tokens).toBeNull()
  })
})

describe('response validation (never retried)', () => {
  const rejects = async (response: () => Response, kind: string) => {
    const { fetch, calls } = mockFetch(response)
    const error = await errorOf(makeProvider(fetch).embedDocuments(['a', 'b']))
    expect(error).toBeInstanceOf(EmbeddingError)
    expect(error.kind).toBe(kind)
    expect(error.retryable).toBe(false)
    expect(calls).toHaveLength(1) // not retried
    return error
  }

  it('rejects a wrong vector dimension, never silently accepting it', async () => {
    const error = await rejects(
      () => ok(2, { dims: 768 }),
      'dimension_mismatch',
    )
    expect(error.message).toContain('1024')
    expect(error.message).toContain('768')
  })

  it('rejects a vector that is too long', async () => {
    await rejects(() => ok(2, { dims: 1025 }), 'dimension_mismatch')
  })

  it('rejects non-finite values (Infinity from an overflowing number)', async () => {
    const body = JSON.stringify({
      data: [
        { index: 0, embedding: vec(0) },
        { index: 1, embedding: vec(1) },
      ],
    }).replace('[0,', '[1e999,') // JSON.parse turns this into Infinity
    await rejects(() => new Response(body, { status: 200 }), 'invalid_response')
  })

  it('rejects null and string entries inside a vector', async () => {
    const bad = vec(0) as unknown[]
    bad[5] = null
    await rejects(
      () =>
        json({
          data: [
            { index: 0, embedding: bad },
            { index: 1, embedding: vec(1) },
          ],
        }),
      'invalid_response',
    )
    const strings = vec(0) as unknown[]
    strings[9] = '0.5'
    await rejects(
      () =>
        json({
          data: [
            { index: 0, embedding: strings },
            { index: 1, embedding: vec(1) },
          ],
        }),
      'invalid_response',
    )
  })

  it('rejects a body that is not JSON', async () => {
    await rejects(
      () => new Response('<html>oops</html>', { status: 200 }),
      'invalid_response',
    )
  })

  it('rejects a response with no data array', async () => {
    await rejects(() => json({ object: 'list' }), 'invalid_response')
    await rejects(() => json({ data: 'nope' }), 'invalid_response')
    await rejects(() => json([]), 'invalid_response')
  })

  it('rejects the wrong number of embeddings', async () => {
    await rejects(() => ok(1), 'invalid_response')
    await rejects(() => ok(3), 'invalid_response')
  })

  it('rejects duplicate, missing or out-of-range indexes', async () => {
    await rejects(
      () =>
        json({
          data: [
            { index: 0, embedding: vec(0) },
            { index: 0, embedding: vec(1) },
          ],
        }),
      'invalid_response',
    )
    await rejects(
      () =>
        json({
          data: [
            { index: 0, embedding: vec(0) },
            { index: 5, embedding: vec(1) },
          ],
        }),
      'invalid_response',
    )
    await rejects(
      () =>
        json({
          data: [
            { index: -1, embedding: vec(0) },
            { index: 1, embedding: vec(1) },
          ],
        }),
      'invalid_response',
    )
    await rejects(
      () => json({ data: [{ embedding: vec(0) }, { embedding: vec(1) }] }),
      'invalid_response',
    )
  })

  it('rejects entries without an embedding array', async () => {
    await rejects(
      () => json({ data: [{ index: 0 }, { index: 1, embedding: vec(1) }] }),
      'invalid_response',
    )
    await rejects(
      () =>
        json({
          data: [
            { index: 0, embedding: 'abc' },
            { index: 1, embedding: vec(1) },
          ],
        }),
      'invalid_response',
    )
  })
})

describe('retry behavior', () => {
  it('retries a 429 and then succeeds', async () => {
    const delays: number[] = []
    const { fetch, calls } = mockFetch((_c, n) =>
      n === 1 ? json({}, 429) : ok(1),
    )
    const result = await makeProvider(fetch, {}, delays).embedDocuments(['a'])
    expect(calls).toHaveLength(2)
    expect(result.vectors).toHaveLength(1)
    expect(delays).toHaveLength(1)
  })

  it('waits for the Retry-After the provider sends (seconds)', async () => {
    const delays: number[] = []
    const { fetch } = mockFetch((_c, n) =>
      n === 1 ? json({}, 429, { 'retry-after': '3' }) : ok(1),
    )
    await makeProvider(fetch, {}, delays).embedDocuments(['a'])
    expect(delays).toEqual([3_000])
  })

  it('caps an unreasonable Retry-After', async () => {
    const delays: number[] = []
    const { fetch } = mockFetch((_c, n) =>
      n === 1 ? json({}, 429, { 'retry-after': '99999' }) : ok(1),
    )
    await makeProvider(fetch, {}, delays).embedDocuments(['a'])
    expect(delays).toEqual([60_000])
  })

  it.each([500, 502, 503, 504])(
    'retries HTTP %i then succeeds',
    async (status) => {
      const { fetch, calls } = mockFetch((_c, n) =>
        n === 1 ? json({ detail: 'try later' }, status) : ok(1),
      )
      await makeProvider(fetch).embedDocuments(['a'])
      expect(calls).toHaveLength(2)
    },
  )

  it('backs off exponentially between attempts', async () => {
    const delays: number[] = []
    const { fetch } = mockFetch((_c, n) => (n < 4 ? json({}, 503) : ok(1)))
    await makeProvider(fetch, { maxAttempts: 4 }, delays).embedDocuments(['a'])
    expect(delays).toEqual([500, 1_000, 2_000])
  })

  it('retries a network failure and reports only the error code, not the raw message', async () => {
    const failing = new TypeError('fetch failed', {
      cause: Object.assign(new Error(`connect ECONNRESET while using ${KEY}`), {
        code: 'ECONNRESET',
      }),
    })
    const { fetch, calls } = mockFetch((_c, n) => {
      if (n === 1) throw failing
      return ok(1)
    })
    await makeProvider(fetch).embedDocuments(['a'])
    expect(calls).toHaveLength(2)

    const always = mockFetch(() => {
      throw failing
    })
    const error = await errorOf(
      makeProvider(always.fetch, { maxAttempts: 2 }).embedDocuments(['a']),
    )
    expect(error.kind).toBe('network')
    expect(error.message).toContain('ECONNRESET')
    expect(error.message).not.toContain(KEY)
    expect(error.message).not.toContain('fetch failed')
  })

  it('retries a timeout, then gives up with kind "timeout"', async () => {
    const { fetch, calls } = mockFetch(
      (c) =>
        new Promise<Response>((_resolve, reject) => {
          ;(c.init.signal as AbortSignal).addEventListener('abort', () =>
            reject(
              Object.assign(new Error('The operation was aborted'), {
                name: 'AbortError',
              }),
            ),
          )
        }),
    )
    const error = await errorOf(
      makeProvider(fetch, { timeoutMs: 15, maxAttempts: 2 }).embedDocuments([
        'a',
      ]),
    )
    expect(calls).toHaveLength(2)
    expect(error.kind).toBe('timeout')
    expect(error.message).toContain('timed out')
    expect(error.attempts).toBe(2)
  })

  it('stops after maxAttempts on persistent 5xx and says how many tries it made', async () => {
    const { fetch, calls } = mockFetch(() => json({}, 503))
    const error = await errorOf(
      makeProvider(fetch, { maxAttempts: 3 }).embedDocuments(['a']),
    )
    expect(calls).toHaveLength(3)
    expect(error.kind).toBe('server')
    expect(error.status).toBe(503)
    expect(error.attempts).toBe(3)
    expect(error.message).toContain('gave up after 3 attempts')
  })

  it('stops after maxAttempts on persistent 429', async () => {
    const { fetch, calls } = mockFetch(() => json({}, 429))
    const error = await errorOf(
      makeProvider(fetch, { maxAttempts: 2 }).embedDocuments(['a']),
    )
    expect(calls).toHaveLength(2)
    expect(error.kind).toBe('rate_limited')
  })

  it.each([401, 403])(
    'does NOT retry HTTP %i (authentication)',
    async (status) => {
      const { fetch, calls } = mockFetch(() =>
        json({ detail: `Provided API key is invalid: ${KEY}` }, status),
      )
      const error = await errorOf(makeProvider(fetch).embedDocuments(['a']))
      expect(calls).toHaveLength(1)
      expect(error.kind).toBe('auth')
      expect(error.retryable).toBe(false)
      expect(error.status).toBe(status)
    },
  )

  it('does NOT retry other 4xx (invalid request) and includes a redacted detail', async () => {
    const { fetch, calls } = mockFetch(() =>
      json({ detail: `Input too long for key ${KEY}` }, 400),
    )
    const error = await errorOf(makeProvider(fetch).embedDocuments(['a']))
    expect(calls).toHaveLength(1)
    expect(error.kind).toBe('bad_request')
    expect(error.message).toContain('HTTP 400')
    expect(error.message).toContain('Input too long')
    expect(error.message).not.toContain(KEY)
  })

  it('applies retries per batch, so an earlier good batch is not resent', async () => {
    let batch2Attempts = 0
    const { fetch, calls } = mockFetch((c) => {
      const inputs = c.body.input as string[]
      if (inputs[0] === 'b0') {
        batch2Attempts++
        if (batch2Attempts === 1) return json({}, 503)
      }
      return ok(inputs.length)
    })
    await makeProvider(fetch, { batchSize: 2 }).embedDocuments([
      'a0',
      'a1',
      'b0',
      'b1',
    ])
    expect(calls.map((c) => (c.body.input as string[])[0])).toEqual([
      'a0',
      'b0',
      'b0',
    ])
  })
})

describe('input handling', () => {
  it('rejects an empty batch without calling the provider', async () => {
    const { fetch, calls } = mockFetch(() => ok(1))
    const error = await errorOf(makeProvider(fetch).embedDocuments([]))
    expect(error.kind).toBe('invalid_input')
    expect(calls).toHaveLength(0)
  })

  it.each([[''], ['   '], ['\n']])(
    'rejects blank input %j without calling the provider',
    async (blank) => {
      const { fetch, calls } = mockFetch(() => ok(2))
      expect(
        (await errorOf(makeProvider(fetch).embedDocuments(['fine', blank])))
          .kind,
      ).toBe('invalid_input')
      expect((await errorOf(makeProvider(fetch).embedQuery(blank))).kind).toBe(
        'invalid_input',
      )
      expect(calls).toHaveLength(0)
    },
  )

  it('rejects an over-long document without calling the provider or leaking its text', async () => {
    const { fetch, calls } = mockFetch(() => ok(1))
    const huge = `${PRIVATE_TEXT} `.repeat(3_000)
    const error = await errorOf(makeProvider(fetch).embedDocuments([huge]))
    expect(error.kind).toBe('invalid_input')
    expect(error.message).not.toContain('PRIVATE-CHUNK-TEXT')
    expect(calls).toHaveLength(0)
  })

  it('validates constructor options', () => {
    const f = mockFetch(() => ok(1)).fetch
    expect(
      () => new VoyageEmbeddingProvider({ apiKey: '  ', fetch: f }),
    ).toThrow(EmbeddingError)
    expect(
      () =>
        new VoyageEmbeddingProvider({ apiKey: KEY, dimensions: 768, fetch: f }),
    ).toThrow(/dimension/)
    expect(
      () =>
        new VoyageEmbeddingProvider({ apiKey: KEY, batchSize: 0, fetch: f }),
    ).toThrow(/Batch size/)
    expect(
      () =>
        new VoyageEmbeddingProvider({ apiKey: KEY, batchSize: 500, fetch: f }),
    ).toThrow(/Batch size/)
  })
})

describe('safe errors: no secrets or paper text in any failure', () => {
  const scenarios: [string, (n: number) => Response | never][] = [
    ['401', () => json({ detail: `bad key ${KEY}`, echo: PRIVATE_TEXT }, 401)],
    ['403', () => json({ detail: `Bearer ${KEY}` }, 403)],
    ['429', () => json({ detail: PRIVATE_TEXT }, 429)],
    ['500', () => json({ detail: `${KEY} ${PRIVATE_TEXT}` }, 500)],
    ['400', () => json({ detail: `${KEY} ${PRIVATE_TEXT}` }, 400)],
    [
      'non-JSON 200',
      () => new Response(`${KEY} ${PRIVATE_TEXT}`, { status: 200 }),
    ],
    ['wrong dims', () => ok(1, { dims: 3 })],
    [
      'network',
      () => {
        throw new TypeError(`${KEY} ${PRIVATE_TEXT}`, {
          cause: { code: 'ENOTFOUND' },
        })
      },
    ],
  ]

  it.each(scenarios)('%s', async (_name, response) => {
    const { fetch } = mockFetch((_c, n) => response(n))
    const error = await errorOf(
      makeProvider(fetch, { maxAttempts: 2 }).embedDocuments([PRIVATE_TEXT]),
    )
    const text = `${error.message} ${error.name} ${String(error)}`
    expect(text).not.toContain(KEY)
    expect(text).not.toMatch(/Bearer/i)
    expect(text).not.toContain('PRIVATE-CHUNK-TEXT')
    expect(text).not.toContain('confidential')
    expect(text).not.toMatch(/\bpa-[A-Za-z0-9_-]{16,}/)
  })
})
