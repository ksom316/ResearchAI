import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import { createServerLlm, isServerDevelopment } from './llm.server'

const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
const okEnv = { OPENROUTER_API_KEY: KEY, LLM_MODEL: 'vendor/test-model' }

describe('createServerLlm (env adapter)', () => {
  it('reports development mode only for the explicit server environment', () => {
    expect(isServerDevelopment({ NODE_ENV: 'development' })).toBe(true)
    expect(isServerDevelopment({ NODE_ENV: 'test' })).toBe(false)
    expect(isServerDevelopment({ NODE_ENV: 'production' })).toBe(false)
    expect(isServerDevelopment({})).toBe(false)
  })

  it('builds a provider from server env and sends the configured model', async () => {
    const fetchFn = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
          { status: 200 },
        ),
    )
    const llm = createServerLlm(okEnv, { fetch: fetchFn as typeof fetch })
    await llm.generateStructured({
      system: 's',
      user: 'u',
      schema: { name: 'x', schema: {} },
      maxTokens: 10,
    })
    const body = JSON.parse(String(fetchFn.mock.calls[0][1].body)) as {
      model: string
    }
    expect(body.model).toBe('vendor/test-model')
  })

  it.each([
    ['missing key', { LLM_MODEL: 'vendor/m' }],
    ['blank key', { OPENROUTER_API_KEY: '  ', LLM_MODEL: 'vendor/m' }],
    [
      'placeholder key',
      { OPENROUTER_API_KEY: 'your-openrouter-key', LLM_MODEL: 'vendor/m' },
    ],
    ['missing model', { OPENROUTER_API_KEY: KEY }],
    ['placeholder model', { OPENROUTER_API_KEY: KEY, LLM_MODEL: 'your-model' }],
    ['malformed model', { OPENROUTER_API_KEY: KEY, LLM_MODEL: 'not a model' }],
  ])('rejects %s without making a request or leaking values', (_name, env) => {
    const fetchFn = vi.fn()
    try {
      createServerLlm(env, { fetch: fetchFn as typeof fetch })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError)
      expect((error as LlmError).kind).toBe('configuration')
      expect((error as LlmError).message).not.toContain(KEY)
    }
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, 'json_schema'],
    ['', 'json_schema'],
    ['json_schema', 'json_schema'],
    ['json_object', 'json_object'],
  ])('LLM_STRUCTURED_MODE=%s requests %s', async (mode, expected) => {
    const fetchFn = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
          { status: 200 },
        ),
    )
    const llm = createServerLlm(
      { ...okEnv, LLM_STRUCTURED_MODE: mode },
      { fetch: fetchFn as typeof fetch },
    )
    await llm.generateStructured({
      system: 's',
      user: 'u',
      schema: { name: 'x', schema: {} },
      maxTokens: 10,
    })
    const body = JSON.parse(String(fetchFn.mock.calls[0][1].body)) as {
      response_format: { type: string }
    }
    expect(body.response_format.type).toBe(expected)
  })

  it('rejects an unknown LLM_STRUCTURED_MODE without a request', () => {
    const fetchFn = vi.fn()
    expect(() =>
      createServerLlm(
        { ...okEnv, LLM_STRUCTURED_MODE: 'yaml' },
        { fetch: fetchFn as typeof fetch },
      ),
    ).toThrow(LlmError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('ignores VITE_ fallbacks', () => {
    expect(() =>
      createServerLlm({
        VITE_OPENROUTER_API_KEY: KEY,
        VITE_LLM_MODEL: 'vendor/m',
        VITE_LLM_STRUCTURED_MODE: 'json_object',
      }),
    ).toThrow(LlmError)
  })
})

describe('LLM boundaries', () => {
  const root = join(
    new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    '..',
    '..',
    '..',
  )
  const source = (path: string) => readFileSync(path, 'utf8')
  const code = (path: string) =>
    source(path)
      .replace(/\/\*[^]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    )
  const norm = (p: string) => p.replace(/\\/g, '/')
  const srcFiles = walk(join(root, 'src')).filter(
    (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p),
  )

  it('src/lib/llm never reads environment variables', () => {
    for (const file of srcFiles.filter((p) =>
      norm(p).includes('src/lib/llm/'),
    )) {
      expect(code(file), file).not.toMatch(/process\.env|import\.meta\.env/)
    }
  })

  it('only llm.server.ts names the LLM variables, and never with a VITE_ prefix', () => {
    for (const file of srcFiles) {
      const text = code(file)
      expect(text, file).not.toMatch(/VITE_[A-Z_]*(OPENROUTER|LLM)/)
      if (!norm(file).endsWith('src/features/chat/llm.server.ts')) {
        expect(text, file).not.toMatch(
          /OPENROUTER_API_KEY|LLM_MODEL|LLM_STRUCTURED_MODE/,
        )
      }
    }
  })

  it('the adapter is a .server module imported only by server-function files', () => {
    for (const file of srcFiles) {
      if (/llm\.server/.test(source(file))) {
        expect(norm(file), file).toMatch(/\.functions\.ts$|llm\.server\.ts$/)
      }
    }
  })

  it('no browser-facing code imports the provider library directly', () => {
    for (const file of srcFiles.filter(
      (p) => /\.tsx$/.test(p) || norm(p).includes('/src/routes/'),
    )) {
      expect(source(file), file).not.toMatch(/lib\/llm|llm\.server/)
    }
  })

  it('the provider only ever targets the fixed OpenRouter endpoint', () => {
    const text = source(join(root, 'src/lib/llm/openrouter.ts'))
    const urls = [...text.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0])
    expect(urls.filter((u) => !u.includes('openrouter.ai/docs'))).toEqual([
      'https://openrouter.ai/api/v1',
    ])
  })
})
