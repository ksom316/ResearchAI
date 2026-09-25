import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedSearchQuery } from './query-embedder.server'
import type { UsageEventInput } from '#/lib/usage/types'

const vector = Array.from({ length: 1024 }, (_, i) => i / 1024)
const okResponse = () =>
  new Response(
    JSON.stringify({
      data: [{ index: 0, embedding: vector }],
      usage: { total_tokens: 4 },
    }),
    { status: 200 },
  )

afterEach(() => vi.unstubAllGlobals())

describe('embedSearchQuery (fake fetch, no real Voyage)', () => {
  it('sends the query as-is with input_type query, voyage-4, 1024 dims, no ctx-v1 header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      okResponse(),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await embedSearchQuery('What is BERT?', {
      EMBEDDING_API_KEY: 'pa-test-key-not-real-000000',
    })
    expect(result).toHaveLength(1024)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      input: ['What is BERT?'],
      model: 'voyage-4',
      input_type: 'query',
      output_dimension: 1024,
    })
    expect(JSON.stringify(body)).not.toMatch(/ctx-v1|Title:|Section:/i)
  })

  it('records provider-reported query tokens with the trusted actor and project', async () => {
    const events: UsageEventInput[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse()),
    )
    await embedSearchQuery(
      'What is BERT?',
      { EMBEDDING_API_KEY: 'pa-test-key-not-real-000000' },
      {
        actorUserId: 'ama',
        projectId: 'project-a',
        feature: 'semantic_search',
        recordUsage: async (event) => {
          events.push(event)
        },
      },
    )
    expect(events).toEqual([
      expect.objectContaining({
        actorUserId: 'ama',
        projectId: 'project-a',
        eventType: 'embedding_request',
        provider: 'voyage',
        model: 'voyage-4',
        inputTokens: 4,
        totalTokens: 4,
        quantity: 1,
        metadata: { input_type: 'query', outcome: 'success' },
      }),
    ])
  })

  it('makes and meters one attempt on 429, then reports the rate limit', async () => {
    const events: UsageEventInput[] = []
    const fetchMock = vi.fn(async () => new Response('{}', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      embedSearchQuery(
        'What is BERT?',
        { EMBEDDING_API_KEY: 'pa-test-key-not-real-000000' },
        {
          actorUserId: 'ama',
          projectId: null,
          feature: 'research_chat',
          recordUsage: async (event) => {
            events.push(event)
          },
        },
      ),
    ).rejects.toMatchObject({ kind: 'rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'embedding_request',
        inputTokens: null,
        totalTokens: null,
        quantity: 1,
        metadata: { input_type: 'query', outcome: 'failure' },
      }),
    ])
  })

  it('fails without a network call when the key is missing, and never reads VITE_ variables', async () => {
    const fetchMock = vi.fn()
    const recordUsage = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      embedSearchQuery(
        'What is BERT?',
        { VITE_EMBEDDING_API_KEY: 'pa-should-be-ignored-000000' },
        {
          actorUserId: 'ama',
          projectId: null,
          feature: 'research_chat',
          recordUsage,
        },
      ),
    ).rejects.toMatchObject({ kind: 'invalid_input' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
  })

  it('never puts the key or query in an error message', async () => {
    const key = 'pa-test-key-not-real-000000'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`bad ${key}`, { status: 500 })),
    )
    const error = await embedSearchQuery('private question text', {
      EMBEDDING_API_KEY: key,
    }).catch((e: unknown) => e)
    expect(String((error as Error).message)).not.toContain(key)
    expect(String((error as Error).message)).not.toContain(
      'private question text',
    )
  })
})
