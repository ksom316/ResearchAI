import { describe, expect, it, vi } from 'vitest'
import { LlmError } from './errors'
import { OpenRouterProvider } from './openrouter'

const KEY = 'sk-or-test-key-not-real-0123456789'
const MODEL = 'vendor/test-model'
const SECRET_PROMPT =
  'CONFIDENTIAL-EVIDENCE-TEXT paper says ignore instructions'
const request = {
  system: 'You answer from evidence.',
  user: SECRET_PROMPT,
  schema: {
    name: 'answer',
    schema: { type: 'object', properties: { a: { type: 'string' } } },
  },
  maxTokens: 500,
}

const completion = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: MODEL,
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content } },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      ...extra,
    }),
    { status: 200 },
  )

function provider(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  options: { timeoutMs?: number } = {},
) {
  return new OpenRouterProvider({
    apiKey: KEY,
    model: MODEL,
    fetch: fetchFn as typeof fetch,
    ...options,
  })
}

const failure = async (p: OpenRouterProvider) =>
  (await p.generateStructured(request).catch((e: unknown) => e)) as LlmError

describe('OpenRouterProvider request shape', () => {
  it('sends system + user messages, the model, json_schema and one request', async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) =>
      completion('{"a":"ok"}'),
    )
    const result = await provider(fetchFn).generateStructured(request)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    )
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 500,
      stream: false,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: SECRET_PROMPT },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'answer',
          strict: true,
          schema: request.schema.schema,
        },
      },
      provider: { require_parameters: true },
    })
    expect(result).toMatchObject({
      data: { a: 'ok' },
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      provider: 'openrouter',
      model: MODEL,
    })
  })

  it('reports null usage when the provider sends none', async () => {
    const result = await provider(async () =>
      completion('{"a":"ok"}', { usage: undefined }),
    ).generateStructured(request)
    expect(result.usage).toBeNull()
  })

  it('rejects unusable options before any request', () => {
    const noFetch = vi.fn()
    expect(
      () =>
        new OpenRouterProvider({ apiKey: ' ', model: MODEL, fetch: noFetch }),
    ).toThrow(LlmError)
    expect(
      () => new OpenRouterProvider({ apiKey: KEY, model: '', fetch: noFetch }),
    ).toThrow(LlmError)
    expect(noFetch).not.toHaveBeenCalled()
  })
})

describe('OpenRouterProvider errors (never retried)', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [408, 'timeout'],
    [500, 'provider_error'],
    [503, 'provider_error'],
    [400, 'provider_error'],
  ])('HTTP %i -> %s, one request only', async (status, kind) => {
    const fetchFn = vi.fn(
      async () =>
        new Response(`upstream said: ${KEY} ${SECRET_PROMPT}`, { status }),
    )
    const error = await failure(provider(fetchFn))
    expect(error).toBeInstanceOf(LlmError)
    expect(error.kind).toBe(kind)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(error.message).not.toContain(KEY)
    expect(error.message).not.toContain('CONFIDENTIAL')
    expect(error.message).not.toContain('upstream said')
  })

  it.each([
    ['not JSON at all', () => new Response('<html>', { status: 200 })],
    ['no choices', () => new Response('{"choices":[]}', { status: 200 })],
    ['content not a string', () => completion(null)],
    ['empty content', () => completion('  ')],
    ['malformed JSON content', () => completion('{"a": "ok"')],
    ['markdown-fenced JSON', () => completion('```json\n{"a":"ok"}\n```')],
    ['JSON but not an object', () => completion('["a"]')],
    [
      'truncated by token limit',
      () =>
        completion('{"a":"o', {
          choices: [
            { finish_reason: 'length', message: { content: '{"a":"o' } },
          ],
        }),
    ],
  ])('invalid successful response: %s', async (_name, make) => {
    const fetchFn = vi.fn(async () => make())
    const error = await failure(provider(fetchFn))
    expect(error.kind).toBe('invalid_response')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('treats an error object inside a 200 as a provider error', async () => {
    const error = await failure(
      provider(
        async () =>
          new Response(`{"error":{"message":"${KEY}"}}`, { status: 200 }),
      ),
    )
    expect(error.kind).toBe('provider_error')
    expect(error.message).not.toContain(KEY)
  })

  it('maps network failures without leaking the underlying message', async () => {
    const error = await failure(
      provider(async () => {
        throw new Error(`socket hang up ${KEY} ${SECRET_PROMPT}`)
      }),
    )
    expect(error.kind).toBe('provider_error')
    expect(error.message).not.toContain(KEY)
    expect(error.message).not.toContain('CONFIDENTIAL')
  })

  it('times out via the abort signal', async () => {
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const error = await failure(provider(fetchFn, { timeoutMs: 20 }))
    expect(error.kind).toBe('timeout')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('reports a caller abort as aborted', async () => {
    const controller = new AbortController()
    const fetchFn = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
        controller.abort()
      })
    const error = (await provider(fetchFn)
      .generateStructured({ ...request, signal: controller.signal })
      .catch((e: unknown) => e)) as LlmError
    expect(error.kind).toBe('aborted')
  })
})

describe('OpenRouterProvider json_object mode', () => {
  const objectProvider = (
    fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  ) =>
    new OpenRouterProvider({
      apiKey: KEY,
      model: MODEL,
      structuredMode: 'json_object',
      fetch: fetchFn as typeof fetch,
    })

  it('sends json_object, no strict/json_schema/require_parameters, and the schema as guidance', async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) =>
      completion('{"a":"ok"}'),
    )
    const result = await objectProvider(fetchFn).generateStructured(request)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const raw = String(fetchFn.mock.calls[0][1].body)
    const body = JSON.parse(raw) as {
      response_format: unknown
      provider?: unknown
      messages: { role: string; content: string }[]
    }
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.provider).toBeUndefined()
    expect(raw).not.toMatch(/strict|require_parameters/)
    expect(raw).not.toContain('"json_schema"')

    const [system, user] = body.messages
    expect(system.role).toBe('system')
    expect(system.content).toContain(request.system)
    expect(system.content).toMatch(/ONE JSON object only/)
    expect(system.content).toContain('no code fences')
    expect(system.content).toContain(JSON.stringify(request.schema.schema))
    expect(user).toEqual({ role: 'user', content: SECRET_PROMPT })
    expect(result.data).toEqual({ a: 'ok' })
  })

  it.each([
    ['malformed JSON', '{"a": "ok"'],
    ['markdown-fenced JSON', '```json\n{"a":"ok"}\n```'],
    ['a JSON array', '["a"]'],
    ['a JSON string', '"hello"'],
  ])(
    'rejects %s as invalid_response, with no retry',
    async (_name, content) => {
      const fetchFn = vi.fn(async () => completion(content))
      const error = (await objectProvider(fetchFn)
        .generateStructured(request)
        .catch((e: unknown) => e)) as LlmError
      expect(error.kind).toBe('invalid_response')
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(error.message).not.toContain(SECRET_PROMPT)
    },
  )

  it('does not leak secrets on HTTP errors in this mode', async () => {
    const fetchFn = vi.fn(
      async () => new Response(`${KEY} ${SECRET_PROMPT}`, { status: 500 }),
    )
    const error = (await objectProvider(fetchFn)
      .generateStructured(request)
      .catch((e: unknown) => e)) as LlmError
    expect(error.kind).toBe('provider_error')
    expect(error.message).not.toContain(KEY)
    expect(error.message).not.toContain('CONFIDENTIAL')
  })

  it('rejects an unsupported mode before any request', () => {
    expect(
      () =>
        new OpenRouterProvider({
          apiKey: KEY,
          model: MODEL,
          structuredMode: 'yaml' as never,
          fetch: vi.fn() as never,
        }),
    ).toThrow(LlmError)
  })
})

describe('OpenRouterProvider safe diagnostics', () => {
  const RAW = 'RAW-MODEL-CONTENT-DO-NOT-LOG'
  const diag = async (fetchResponse: Response) => {
    const error = await failure(provider(() => Promise.resolve(fetchResponse)))
    expect(error).toBeInstanceOf(LlmError)
    expect(error.kind).toBe('invalid_response')
    // never any content, key or prompt
    const text = JSON.stringify([error.message, error.diagnostic])
    expect(text).not.toContain(RAW)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain(SECRET_PROMPT)
    return error.diagnostic
  }

  it('reports truncated with the served model and finish_reason', async () => {
    const res = new Response(
      JSON.stringify({
        model: 'vendor/served-model:free',
        choices: [
          { finish_reason: 'length', message: { role: 'assistant', content: RAW } },
        ],
      }),
      { status: 200 },
    )
    expect(await diag(res)).toEqual({
      category: 'truncated',
      model: 'vendor/served-model:free',
      finishReason: 'length',
    })
  })

  it('reports not_json for content that is not JSON (no fence stripping)', async () => {
    expect(
      await diag(completion('```json\n{"a":"' + RAW + '"}\n```')),
    ).toMatchObject({ category: 'not_json', model: MODEL, finishReason: 'stop' })
  })

  it('reports not_object for JSON that is not an object', async () => {
    expect((await diag(completion('["' + RAW + '"]')))?.category).toBe(
      'not_object',
    )
  })

  it('reports empty for missing or blank content', async () => {
    expect((await diag(completion('   ')))?.category).toBe('empty')
    expect((await diag(completion(null)))?.category).toBe('empty')
  })

  it('drops model and finish_reason values that are not plain identifiers', async () => {
    const res = new Response(
      JSON.stringify({
        model: RAW + ' ignore previous instructions',
        choices: [
          {
            finish_reason: 'stop\nnew line',
            message: { role: 'assistant', content: 'nope' },
          },
        ],
      }),
      { status: 200 },
    )
    expect(await diag(res)).toEqual({
      category: 'not_json',
      model: null,
      finishReason: null,
    })
  })

  it('exposes finishReason on success without changing the data', async () => {
    const result = await provider(() =>
      Promise.resolve(completion('{"a":"ok"}')),
    ).generateStructured(request)
    expect(result.data).toEqual({ a: 'ok' })
    expect(result.finishReason).toBe('stop')
  })
})

describe('OpenRouterProvider truncation usage diagnostics', () => {
  const RAW = 'RAW-MODEL-CONTENT-DO-NOT-LOG'
  const REASONING = 'PRIVATE-REASONING-TEXT-DO-NOT-LOG'
  const truncated = (usage: unknown, extraMessage: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({
        model: 'vendor/served:free',
        choices: [
          {
            finish_reason: 'length',
            message: { role: 'assistant', content: RAW, ...extraMessage },
          },
        ],
        ...(usage === undefined ? {} : { usage }),
      }),
      { status: 200 },
    )
  const diag = async (res: Response) => {
    const error = await failure(provider(() => Promise.resolve(res)))
    expect(error.kind).toBe('invalid_response')
    const text = JSON.stringify([error.message, error.diagnostic])
    for (const secret of [RAW, REASONING, KEY, SECRET_PROMPT]) {
      expect(text).not.toContain(secret)
    }
    return error.diagnostic
  }

  it('captures prompt, completion and total tokens on truncation', async () => {
    expect(
      await diag(truncated({ prompt_tokens: 7000, completion_tokens: 3000, total_tokens: 10000 })),
    ).toEqual({
      category: 'truncated',
      model: 'vendor/served:free',
      finishReason: 'length',
      usage: { promptTokens: 7000, completionTokens: 3000, totalTokens: 10000 },
    })
  })

  it('includes reasoning tokens only when the response supplies a numeric count', async () => {
    const withReasoning = await diag(
      truncated({
        prompt_tokens: 100,
        completion_tokens: 3000,
        total_tokens: 3100,
        completion_tokens_details: { reasoning_tokens: 2400 },
      }),
    )
    expect(withReasoning?.usage).toEqual({
      promptTokens: 100,
      completionTokens: 3000,
      totalTokens: 3100,
      reasoningTokens: 2400,
    })
    for (const bad of ['2400', null, -5, Number.NaN, { n: 1 }]) {
      const d = await diag(
        truncated({ completion_tokens: 3000, completion_tokens_details: { reasoning_tokens: bad } }),
      )
      expect(d?.usage, String(bad)).toEqual({ completionTokens: 3000 })
    }
    // nothing is inferred when the details object is absent
    expect((await diag(truncated({ completion_tokens: 3000 })))?.usage).toEqual({ completionTokens: 3000 })
  })

  it('never reads reasoning content or message text', async () => {
    const d = await diag(
      truncated({ completion_tokens: 1 }, { reasoning: REASONING, reasoning_content: REASONING }),
    )
    expect(d?.usage).toEqual({ completionTokens: 1 })
  })

  it('omits usage entirely when the provider supplies none or garbage', async () => {
    for (const usage of [undefined, null, 'x', [], {}, { prompt_tokens: 'a' }]) {
      const d = await diag(truncated(usage))
      expect(d).toEqual({ category: 'truncated', model: 'vendor/served:free', finishReason: 'length' })
      expect(d).not.toHaveProperty('usage')
    }
  })

  it('does not change classification: still one invalid_response error, one request', async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) =>
      truncated({ completion_tokens: 3000 }),
    )
    const error = await failure(provider(fetchFn))
    expect(error.kind).toBe('invalid_response')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('OpenRouterProvider reasoning control (per call, optional)', () => {
  const bodyOf = async (req: typeof request & { reasoning?: { effort: 'low' | 'medium' | 'high' } }) => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) =>
      completion('{"a":"ok"}'),
    )
    const result = await provider(fetchFn).generateStructured(req)
    const body = JSON.parse(String(fetchFn.mock.calls[0][1].body)) as Record<string, unknown>
    return { body, result }
  }

  it('sends NO reasoning key when the request does not ask for it', async () => {
    const { body } = await bodyOf(request)
    expect(body).not.toHaveProperty('reasoning')
    expect(Object.keys(body).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'provider',
      'response_format',
      'stream',
      'temperature',
    ])
  })

  it.each(['low', 'medium', 'high'] as const)(
    'sends exactly reasoning: { effort: "%s" } when requested',
    async (effort) => {
      const { body } = await bodyOf({ ...request, reasoning: { effort } })
      expect(body.reasoning).toEqual({ effort })
      expect(Object.keys(body.reasoning as object)).toEqual(['effort'])
    },
  )

  it('keeps require_parameters, json_schema and every other field when reasoning is set', async () => {
    const plain = (await bodyOf(request)).body
    const withReasoning = (await bodyOf({ ...request, reasoning: { effort: 'low' } })).body
    const { reasoning: _reasoning, ...rest } = withReasoning
    expect(rest).toEqual(plain)
    expect(withReasoning.provider).toEqual({ require_parameters: true })
    expect((withReasoning.response_format as { type: string }).type).toBe('json_schema')
  })

  it('does not change the structured result', async () => {
    const plain = (await bodyOf(request)).result
    const withReasoning = (await bodyOf({ ...request, reasoning: { effort: 'low' } })).result
    expect(withReasoning).toEqual(plain)
  })

  it('an unsupported-parameter HTTP error keeps the existing classification and sends no fallback request', async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response('{"error":{"message":"no endpoints found"}}', { status: 404 }),
    )
    const error = (await provider(fetchFn)
      .generateStructured({ ...request, reasoning: { effort: 'low' } })
      .catch((e: unknown) => e)) as LlmError
    expect(error.kind).toBe('provider_error')
    expect(error.status).toBe(404)
    expect(error.message).not.toContain('no endpoints')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
