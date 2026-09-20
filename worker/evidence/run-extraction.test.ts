import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PaperInput } from '../../src/features/evidence-matrix/evidence-packet'
import type { NormalizedField } from '../../src/features/evidence-matrix/extract'
import { FIELD_KEYS } from '../../src/features/evidence-matrix/fields'
import { LlmError } from '../../src/lib/llm'
import type { LlmProvider } from '../../src/lib/llm'
import { StoreError } from '../embedding/failure'
import { decideExtractionFailure, FAILURE_MESSAGE } from './retry-policy'
import { runNextExtraction } from './run-extraction'
import type { ClaimedExtraction, ExtractionStore } from './types'

const SECTIONS = [
  { id: 's-abs', title: 'Abstract', sectionType: 'abstract' },
  { id: 's-meth', title: 'Methods', sectionType: 'methods' },
  { id: 's-ref', title: 'References', sectionType: 'references' },
]

const PAPER: PaperInput = {
  paperId: 'p1',
  sections: SECTIONS,
  chunks: [
    { id: 'c-abs', sectionId: 's-abs', chunkIndex: 0, text: 'We study widgets in a synthetic setting.', pageStart: 1, pageEnd: 1 },
    { id: 'c-meth', sectionId: 's-meth', chunkIndex: 1, text: 'We train a widget model.', pageStart: 3, pageEnd: 4 },
  ],
}
const REFS_ONLY: PaperInput = {
  paperId: 'p1',
  sections: SECTIONS,
  chunks: [{ id: 'c-ref', sectionId: 's-ref', chunkIndex: 0, text: 'Smith 2020.', pageStart: 9, pageEnd: 9 }],
}

const claim = (over: Partial<ClaimedExtraction> = {}): ClaimedExtraction => ({
  paperId: 'p1',
  userId: 'u1',
  schemaVersion: 1,
  sourceCompletedAt: '2026-01-01T00:00:00+00:00',
  claimStartedAt: '2026-01-02T00:00:00+00:00',
  attempts: 1,
  ...over,
})

type Calls = {
  stored: NormalizedField[]
  complete: { provider: string | null; model: string | null }[]
  retry: number
  fail: string[]
  loads: number
}

function makeStore(
  opts: {
    claim?: ClaimedExtraction | null
    paper?: PaperInput
    generationCurrent?: boolean
    storeFieldAt?: (n: number) => boolean | Error
    complete?: string | null | Error
    retry?: boolean | Error
    fail?: boolean | Error
  } = {},
) {
  const calls: Calls = { stored: [], complete: [], retry: 0, fail: [], loads: 0 }
  const claimed = opts.claim === undefined ? claim() : opts.claim
  const store: ExtractionStore = {
    claimNext: () => Promise.resolve(claimed),
    loadPaper: () => {
      calls.loads++
      return Promise.resolve({
        input: opts.paper ?? PAPER,
        generationCurrent: opts.generationCurrent ?? true,
      })
    },
    storeField: (_c, field) => {
      calls.stored.push(field)
      const r = opts.storeFieldAt?.(calls.stored.length) ?? true
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
    },
    complete: (_c, provider, model) => {
      calls.complete.push({ provider, model })
      const r = opts.complete === undefined ? 'complete' : opts.complete
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
    },
    retry: () => {
      calls.retry++
      const r = opts.retry ?? true
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
    },
    fail: (_c, message) => {
      calls.fail.push(message)
      const r = opts.fail ?? true
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
    },
  }
  return { store, calls }
}

const notReported = () =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, { state: 'not_reported', items: [] }]))

/** Valid model output citing E1 (abstract) for objective and E2 (methods) for methodology. */
const goodOutput = () => ({
  fields: {
    ...notReported(),
    objective: { state: 'extracted', items: [{ text: 'Study widgets.', evidence_ids: ['E1'] }] },
    methodology: { state: 'extracted', items: [{ text: 'Train a widget model.', evidence_ids: ['E2'] }] },
  },
})

function fakeLlm(behaviour: unknown | Error) {
  const state = { calls: 0 }
  const llm: LlmProvider = {
    generateStructured: () => {
      state.calls++
      return behaviour instanceof Error
        ? Promise.reject(behaviour)
        : Promise.resolve({
            data: behaviour as Record<string, unknown>,
            usage: null,
            provider: 'fake',
            model: 'fake/model',
          })
    },
  }
  return { llm, state }
}

const run = (store: ExtractionStore, llm: LlmProvider, maxAttempts = 3) =>
  runNextExtraction({ store, getLlm: () => llm, maxAttempts })

describe('runNextExtraction: success', () => {
  it('stores all seven fields, passes provenance unchanged, completes with provider/model', async () => {
    const { store, calls } = makeStore()
    const { llm, state } = fakeLlm(goodOutput())
    const result = await run(store, llm)

    expect(result).toEqual({ kind: 'complete', paperId: 'p1', status: 'complete', llmCalled: true })
    expect(state.calls).toBe(1)
    expect(calls.stored.map((f) => f.fieldKey)).toEqual([...FIELD_KEYS])
    expect(calls.complete).toEqual([{ provider: 'fake', model: 'fake/model' }])

    const objective = calls.stored[0]
    expect(objective.state).toBe('extracted')
    expect(objective.value).toEqual({ items: [{ text: 'Study widgets.' }] })
    expect(objective.sources).toHaveLength(1)
    expect(objective.sources[0]).toMatchObject({ item_index: 0, ord: 0, chunk_id: 'c-abs' })
    // verbatim, database-checkable excerpt
    expect(PAPER.chunks[0].text.includes(objective.sources[0].excerpt)).toBe(true)
    expect(calls.stored[1].sources[0].chunk_id).toBe('c-meth')
    for (const f of calls.stored.filter((x) => x.state === 'not_reported')) {
      expect(f.value).toEqual({ items: [] })
      expect(f.sources).toEqual([])
    }
    expect(calls.retry).toBe(0)
    expect(calls.fail).toEqual([])
  })
})

describe('runNextExtraction: nothing claimed / no evidence', () => {
  it('is idle without loading or calling the model when nothing is requested', async () => {
    const { store, calls } = makeStore({ claim: null })
    const { llm, state } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toEqual({ kind: 'idle' })
    expect(calls.loads).toBe(0)
    expect(state.calls).toBe(0)
  })

  it('makes ZERO LLM calls and completes with NULL provider/model when no evidence is routed', async () => {
    const { store, calls } = makeStore({ paper: REFS_ONLY })
    const { llm, state } = fakeLlm(new Error('must not be called'))
    const result = await run(store, llm)
    expect(state.calls).toBe(0)
    expect(result).toEqual({ kind: 'complete', paperId: 'p1', status: 'complete', llmCalled: false })
    expect(calls.stored.map((f) => f.fieldKey)).toEqual([...FIELD_KEYS])
    expect(calls.stored.every((f) => f.state === 'not_reported' && f.sources.length === 0)).toBe(true)
    expect(calls.complete).toEqual([{ provider: null, model: null }])
  })
})

describe('runNextExtraction: failures and retry policy', () => {
  it('re-queues a provider failure while attempts remain', async () => {
    const { store, calls } = makeStore({ claim: claim({ attempts: 1 }) })
    const { llm, state } = fakeLlm(new LlmError('timeout', 'x'))
    expect(await run(store, llm, 3)).toMatchObject({ kind: 'retry', paperId: 'p1', reason: 'llm_unavailable' })
    expect(state.calls).toBe(1)
    expect(calls.retry).toBe(1)
    expect(calls.fail).toEqual([])
    expect(calls.stored).toEqual([])
  })

  it('fails a provider failure once attempts are used up, with a bounded fixed message', async () => {
    const { store, calls } = makeStore({ claim: claim({ attempts: 3 }) })
    const { llm } = fakeLlm(new LlmError('rate_limited', 'x', 429))
    expect(await run(store, llm, 3)).toMatchObject({ kind: 'failed', paperId: 'p1', reason: 'llm_unavailable' })
    expect(calls.retry).toBe(0)
    expect(calls.fail).toEqual([FAILURE_MESSAGE.llm_unavailable])
    expect(calls.fail[0].length).toBeLessThanOrEqual(500)
  })

  it('does not retry invalid model output; nothing is stored or completed', async () => {
    const { store, calls } = makeStore({ claim: claim({ attempts: 1 }) })
    const { llm, state } = fakeLlm({ fields: 'nope' })
    expect(await run(store, llm)).toMatchObject({ kind: 'failed', paperId: 'p1', reason: 'invalid_output' })
    expect(state.calls).toBe(1)
    expect(calls.retry).toBe(0)
    expect(calls.stored).toEqual([])
    expect(calls.complete).toEqual([])
    expect(calls.fail).toEqual([FAILURE_MESSAGE.invalid_output])
  })

  it('does not retry invalid citations (evidence not routed to the field)', async () => {
    const bad = { fields: { ...notReported(), objective: { state: 'extracted', items: [{ text: 'x', evidence_ids: ['E2'] }] } } }
    const { store, calls } = makeStore()
    const { llm } = fakeLlm(bad)
    expect(await run(store, llm)).toMatchObject({ kind: 'failed', paperId: 'p1', reason: 'invalid_citation' })
    expect(calls.stored).toEqual([])
    expect(calls.complete).toEqual([])
  })

  it('retries a transient persistence error and never completes', async () => {
    const { store, calls } = makeStore({ storeFieldAt: (n) => (n === 3 ? new StoreError('store_extraction_field', null) : true) })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toMatchObject({ kind: 'retry', paperId: 'p1', reason: 'persistence' })
    expect(calls.stored).toHaveLength(3)
    expect(calls.complete).toEqual([])
    expect(calls.retry).toBe(1)
  })

  it('fails (no retry) when the database rejects the data itself', async () => {
    const { store, calls } = makeStore({ storeFieldAt: () => new StoreError('store_extraction_field', '23514') })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toMatchObject({ kind: 'failed', paperId: 'p1', reason: 'persistence_permanent' })
    expect(calls.retry).toBe(0)
    expect(calls.complete).toEqual([])
    expect(calls.fail).toEqual([FAILURE_MESSAGE.persistence_permanent])
  })

  it('failure to record the failure does not throw and reports lost', async () => {
    const { store } = makeStore({ storeFieldAt: () => new Error('boom'), fail: new StoreError('fail_paper_extraction', null) })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toEqual({ kind: 'lost', paperId: 'p1' })
  })

  it('unknown errors fail without leaking their message', async () => {
    const { store, calls } = makeStore({ storeFieldAt: () => new Error('secret sk-123 in message') })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toMatchObject({ kind: 'failed', paperId: 'p1', reason: 'unexpected' })
    expect(calls.fail).toEqual([FAILURE_MESSAGE.unexpected])
    expect(calls.fail[0]).not.toContain('sk-123')
  })

  it('bounds the whole request: a permanently failing provider is called exactly maxAttempts times', async () => {
    // stateful queue: retry -> pending again (attempts increments on each claim), fail -> done
    let attempts = 0
    let pending = true
    const store: ExtractionStore = {
      claimNext: () => {
        if (!pending) return Promise.resolve(null)
        pending = false
        attempts++
        return Promise.resolve(claim({ attempts }))
      },
      loadPaper: () => Promise.resolve({ input: PAPER, generationCurrent: true }),
      storeField: () => Promise.resolve(true),
      complete: () => Promise.resolve('complete'),
      retry: () => {
        pending = true
        return Promise.resolve(true)
      },
      fail: () => Promise.resolve(true),
    }
    const { llm, state } = fakeLlm(new LlmError('provider_error', 'x', 503))
    const kinds: string[] = []
    for (let i = 0; i < 20; i++) {
      const r = await run(store, llm, 3)
      kinds.push(r.kind)
      if (r.kind === 'idle') break
    }
    expect(state.calls).toBe(3)
    expect(kinds).toEqual(['retry', 'retry', 'failed', 'idle'])
  })
})

describe('runNextExtraction: generation and claim fencing', () => {
  it('re-queues without calling the model when the paper changed generation', async () => {
    const { store, calls } = makeStore({ generationCurrent: false })
    const { llm, state } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toEqual({ kind: 'superseded', paperId: 'p1' })
    expect(state.calls).toBe(0)
    expect(calls.retry).toBe(1)
    expect(calls.stored).toEqual([])
    expect(calls.fail).toEqual([])
  })

  it('fails instead of looping when a generation mismatch keeps recurring past the attempt budget', async () => {
    const { store, calls } = makeStore({ claim: claim({ attempts: 3 }), generationCurrent: false })
    const { llm, state } = fakeLlm(goodOutput())
    expect(await run(store, llm, 3)).toEqual({ kind: 'superseded', paperId: 'p1' })
    expect(state.calls).toBe(0)
    expect(calls.retry).toBe(0)
    expect(calls.fail).toEqual([FAILURE_MESSAGE.superseded])
  })

  it('a fenced-out store on the last attempt fails rather than re-queues', async () => {
    const { store, calls } = makeStore({ claim: claim({ attempts: 3 }), storeFieldAt: () => false })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(store, llm, 3)).toEqual({ kind: 'lost', paperId: 'p1' })
    expect(calls.retry).toBe(0)
    expect(calls.complete).toEqual([])
  })

  it('field 5 failing after fields 1-4 stored never completes; the retry re-stores all seven', async () => {
    let n = 0
    const first = makeStore({ storeFieldAt: (i) => (i === 5 ? new StoreError('store_extraction_field', null) : true) })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(first.store, llm)).toMatchObject({ kind: 'retry', reason: 'persistence' })
    expect(first.calls.stored).toHaveLength(5)
    expect(first.calls.complete).toEqual([])
    const second = makeStore({ claim: claim({ attempts: 2 }) })
    expect(await run(second.store, llm)).toMatchObject({ kind: 'complete', status: 'complete' })
    n = second.calls.stored.length
    expect(n).toBe(7) // a retry rewrites every field, so nothing stale survives
  })

  it('does not treat a network error (no SQLSTATE) or a serialization failure as a permanent rejection', () => {
    for (const code of [null, '40001', '40P01', '53300', '57014', '08006']) {
      expect(new StoreError('x', code).retryable, String(code)).toBe(true)
    }
    for (const code of ['22001', '23514', '42501', 'P0001']) {
      expect(new StoreError('x', code).retryable, code).toBe(false)
    }
  })

  it('stops writing and never completes when a store is fenced out', async () => {
    const { store, calls } = makeStore({ storeFieldAt: (n) => n < 2 })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toEqual({ kind: 'lost', paperId: 'p1' })
    expect(calls.stored).toHaveLength(2)
    expect(calls.complete).toEqual([])
    expect(calls.fail).toEqual([])
  })

  it('reports lost (not complete) when complete is refused', async () => {
    const { store, calls } = makeStore({ complete: null })
    const { llm } = fakeLlm(goodOutput())
    expect(await run(store, llm)).toEqual({ kind: 'lost', paperId: 'p1' })
    expect(calls.stored).toHaveLength(7)
  })

  it('does not call the model twice for one claim', async () => {
    const { store } = makeStore()
    const { llm, state } = fakeLlm(goodOutput())
    await run(store, llm)
    expect(state.calls).toBe(1)
  })
})

describe('boundaries', () => {
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
  const strip = (s: string) => s.replace(/\/\*[^]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('the worker store writes only through RPCs (no direct table writes)', () => {
    const code = strip(readFileSync(join(root, 'worker/evidence/job-store.ts'), 'utf8'))
    expect(code).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(code).not.toMatch(/paper_extractions|paper_extraction_fields|paper_extraction_sources/)
    for (const rpc of ['claim_next_paper_extraction', 'store_extraction_field', 'complete_paper_extraction', 'retry_paper_extraction', 'fail_paper_extraction']) {
      expect(code).toContain(`'${rpc}'`)
    }
    // discovery is the queue: the worker never scans papers for work
    expect(code).not.toMatch(/from\('papers'\)[^;]*\.(neq|eq)\('status'/)
  })

  it('worker secrets are never exposed through VITE_ variables or imported into src/', () => {
    for (const file of ['.env.example', '.env.worker.example', 'src/env.d.ts', 'vite.config.ts']) {
      let text = ''
      try {
        text = readFileSync(join(root, file), 'utf8')
      } catch {
        continue
      }
      const active = text
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n')
      expect(active, file).not.toMatch(/VITE_[A-Z_]*(SERVICE|OPENROUTER|LLM|SECRET)/)
    }
    const web = walk(join(root, 'src')).filter(
      (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p),
    )
    for (const path of web) {
      const code = strip(readFileSync(path, 'utf8'))
      expect(code, path).not.toMatch(/\.\.\/worker|\/worker\//)
    }
  })

  it('no service-role key or worker code reaches the web application', () => {
    const web = walk(join(root, 'src')).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
    for (const path of web) {
      const code = strip(readFileSync(path, 'utf8'))
      expect(code, path).not.toMatch(/SERVICE_ROLE|service_role/)
      expect(code, path).not.toMatch(/from ['"][./]*worker\//)
    }
    // The extraction service (pure) must not touch Supabase or the environment. The
    // browser data layer (api/queries/status/types and ui/) is the one place allowed to
    // use the anon browser client, and it must not import the extraction service back.
    const BROWSER_LAYER =
      /[\\/]evidence-matrix[\\/](api|queries|status|types)\.ts$|[\\/]evidence-matrix[\\/]ui[\\/]/
    const evidence = walk(join(root, 'src/features/evidence-matrix')).filter(
      (p) => !/\.test\.tsx?$/.test(p),
    )
    for (const path of evidence.filter((p) => !BROWSER_LAYER.test(p))) {
      expect(strip(readFileSync(path, 'utf8')), path).not.toMatch(/supabase|process\.env/)
    }
    for (const path of evidence.filter((p) => BROWSER_LAYER.test(p))) {
      expect(strip(readFileSync(path, 'utf8')), path).not.toMatch(
        /from '\.\/(extract|prompt|evidence-packet|schema)'/,
      )
    }
  })

  it('the request function is the only browser-executable evidence function', () => {
    const migration = ['0010_evidence_matrix_worker.sql', '0011_evidence_matrix_worker_fix.sql']
      .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8'))
      .join('\n')
    const grants = [...migration.matchAll(/grant execute on function public\.(\w+)[^;]* to (\w+);/g)]
    const browser = grants.filter((g) => g[2] === 'authenticated').map((g) => g[1])
    expect(browser).toEqual(['request_paper_extraction'])
  })
})

describe('runNextExtraction: safe diagnostics', () => {
  it('logs a concise content-free diagnostic, keeps the domain reason, and persists only the fixed message', async () => {
    const RAW = 'RAW-MODEL-TEXT-SECRET'
    const logs: string[] = []
    const { store, calls } = makeStore()
    const bad = {
      fields: {
        ...notReported(),
        objective: {
          state: 'extracted',
          items: [{ text: RAW, evidence_ids: [] }],
        },
      },
    }
    const { llm, state } = fakeLlm(bad)
    const result = await runNextExtraction({
      store,
      getLlm: () => llm,
      maxAttempts: 3,
      log: (m) => logs.push(m),
    })
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid_output' })
    expect(state.calls).toBe(1) // no retry
    const line = logs.find((l) => l.includes('failed'))!
    expect(line).toMatch(
      /failed \(invalid_output: schema_validation fields\.objective/,
    )
    expect(logs.join('\n')).not.toContain(RAW)
    // the database only ever sees the fixed, user-friendly message
    expect(calls.fail).toEqual([FAILURE_MESSAGE.invalid_output])
  })

  it('reports invalid_citation with its reason and still does not retry', async () => {
    const logs: string[] = []
    const bad = {
      fields: {
        ...notReported(),
        objective: {
          state: 'extracted',
          items: [{ text: 'x', evidence_ids: ['E2'] }],
        },
      },
    }
    const { store, calls } = makeStore()
    const { llm } = fakeLlm(bad)
    const result = await runNextExtraction({
      store,
      getLlm: () => llm,
      maxAttempts: 3,
      log: (m) => logs.push(m),
    })
    expect(result).toMatchObject({ kind: 'failed', reason: 'invalid_citation' })
    expect(logs.join('\n')).toMatch(
      /invalid_citation: citation field=objective item=0 not_eligible_for_field/,
    )
    expect(calls.retry).toBe(0)
    expect(calls.fail).toEqual([FAILURE_MESSAGE.invalid_citation])
  })
})

describe('runNextExtraction: truncation is retryable within the attempt budget', () => {
  const truncated = () =>
    new LlmError('invalid_response', 'cut off', undefined, {
      category: 'truncated',
      model: 'vendor/m:free',
      finishReason: 'length',
      usage: { promptTokens: 8827, completionTokens: 3000, totalTokens: 11827 },
    })

  it('the policy retries only truncated (and the existing transient kinds) while attempts remain', () => {
    for (const attempts of [1, 2]) {
      expect(decideExtractionFailure('truncated', attempts, 3)).toBe('retry')
      expect(decideExtractionFailure('llm_unavailable', attempts, 3)).toBe('retry')
      expect(decideExtractionFailure('persistence', attempts, 3)).toBe('retry')
    }
    expect(decideExtractionFailure('truncated', 3, 3)).toBe('fail')
    for (const kind of ['invalid_output', 'invalid_citation', 'persistence_permanent', 'unexpected'] as const) {
      expect(decideExtractionFailure(kind, 1, 3), kind).toBe('fail')
    }
  })

  it.each([1, 2])('attempt %i: a truncated response is re-queued, not failed', async (attempts) => {
    const { store, calls } = makeStore({ claim: claim({ attempts }) })
    const { llm, state } = fakeLlm(truncated())
    const logs: string[] = []
    const result = await runNextExtraction({ store, getLlm: () => llm, maxAttempts: 3, log: (m) => logs.push(m) })
    expect(result).toMatchObject({ kind: 'retry', paperId: 'p1', reason: 'truncated' })
    expect(state.calls).toBe(1) // one call per claimed attempt, no loop inside
    expect(calls.retry).toBe(1)
    expect(calls.fail).toEqual([])
    expect(calls.stored).toEqual([])
    expect(calls.complete).toEqual([])
    expect(logs.join('\n')).toMatch(/will retry \(truncated: truncated; model=vendor\/m:free; finish_reason=length; prompt_tokens=8827; completion_tokens=3000/)
  })

  it('the last attempt fails closed with a fixed message', async () => {
    const { store, calls } = makeStore({ claim: claim({ attempts: 3 }) })
    const { llm } = fakeLlm(truncated())
    const result = await runNextExtraction({ store, getLlm: () => llm, maxAttempts: 3 })
    expect(result).toMatchObject({ kind: 'failed', reason: 'truncated' })
    expect(calls.retry).toBe(0)
    expect(calls.fail).toEqual([FAILURE_MESSAGE.truncated])
    expect(FAILURE_MESSAGE.truncated.length).toBeLessThanOrEqual(500)
  })

  it('other unusable output is still terminal on the first attempt', async () => {
    for (const bad of [
      new LlmError('invalid_response', 'x', undefined, { category: 'not_json', model: null, finishReason: 'stop' }),
      new LlmError('invalid_response', 'x'),
    ]) {
      const { store, calls } = makeStore({ claim: claim({ attempts: 1 }) })
      const { llm } = fakeLlm(bad)
      const result = await runNextExtraction({ store, getLlm: () => llm, maxAttempts: 3 })
      expect(result).toMatchObject({ kind: 'failed', reason: 'invalid_output' })
      expect(calls.retry).toBe(0)
    }
    // completed but schema-invalid
    const { store, calls } = makeStore({ claim: claim({ attempts: 1 }) })
    const { llm } = fakeLlm({ fields: 'nope' })
    expect(await runNextExtraction({ store, getLlm: () => llm, maxAttempts: 3 })).toMatchObject({ kind: 'failed', reason: 'invalid_output' })
    expect(calls.retry).toBe(0)
  })

  it('full lifecycle: a route that always truncates is called exactly maxAttempts times, then fails', async () => {
    // queue semantics of the real RPCs: claim increments attempts, retry re-queues WITHOUT
    // touching attempts, only a user request (not simulated) resets them
    let attempts = 0
    let pending = true
    let failed: string | null = null
    const store: ExtractionStore = {
      claimNext: () => {
        if (!pending) return Promise.resolve(null)
        pending = false
        attempts++
        return Promise.resolve(claim({ attempts }))
      },
      loadPaper: () => Promise.resolve({ input: PAPER, generationCurrent: true }),
      storeField: () => Promise.resolve(true),
      complete: () => Promise.resolve('complete'),
      retry: () => {
        pending = true
        return Promise.resolve(true)
      },
      fail: (_c, message) => {
        failed = message
        return Promise.resolve(true)
      },
    }
    const { llm, state } = fakeLlm(truncated())
    const kinds: string[] = []
    for (let i = 0; i < 20; i++) {
      const r = await runNextExtraction({ store, getLlm: () => llm, maxAttempts: 3 })
      kinds.push(r.kind)
      if (r.kind === 'idle') break
    }
    expect(kinds).toEqual(['retry', 'retry', 'failed', 'idle'])
    expect(state.calls).toBe(3)
    expect(attempts).toBe(3)
    expect(failed).toBe(FAILURE_MESSAGE.truncated)
  })

  it('a later attempt can succeed on another route (truncated once, then valid)', async () => {
    let calls = 0
    const llm: LlmProvider = {
      generateStructured: () => {
        calls++
        return calls === 1
          ? Promise.reject(truncated())
          : Promise.resolve({ data: goodOutput(), usage: null, provider: 'openrouter', model: 'other/route:free' })
      },
    }
    const first = makeStore({ claim: claim({ attempts: 1 }) })
    expect(await runNextExtraction({ store: first.store, getLlm: () => llm, maxAttempts: 3 })).toMatchObject({ kind: 'retry' })
    const second = makeStore({ claim: claim({ attempts: 2 }) })
    expect(await runNextExtraction({ store: second.store, getLlm: () => llm, maxAttempts: 3 })).toMatchObject({ kind: 'complete', status: 'complete' })
    expect(second.calls.stored).toHaveLength(7)
    expect(second.calls.complete).toEqual([{ provider: 'openrouter', model: 'other/route:free' }])
  })
})
