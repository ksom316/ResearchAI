import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIELD_COLUMNS,
  listExtractionFields,
  listExtractionOverviews,
  listExtractionSources,
  normalizePaperIds,
  OVERVIEW_COLUMNS,
  PAPER_IDS_PER_REQUEST,
  parseFieldValue,
  requestPaperExtraction,
  SOURCE_COLUMNS,
} from './api'
import { FIELD_KEYS } from './fields'
import {
  evidenceKeys,
  EXTRACTION_REFRESH_MS,
  extractionFieldsQuery,
  extractionOverviewsQuery,
  extractionSourcesQuery,
} from './queries'
import {
  actionLabel,
  describeExtraction,
  hasActiveExtraction,
  REQUEST_MESSAGES,
} from './status'
import type { ExtractionOverview, RequestResult } from './types'

type Call = { method: string; args: unknown[] }

const mock = vi.hoisted((): { current: unknown } => ({ current: undefined }))
vi.mock('#/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => mock.current,
}))

/** A chainable, awaitable query builder that records every call. */
function fakeClient(options: {
  rows?: unknown[] | ((table: string, calls: Call[]) => unknown[])
  error?: unknown
  rpc?: { data: unknown; error: unknown }
}) {
  const calls: Call[] = []
  const rpcCalls: { fn: string; args: unknown }[] = []
  const client = {
    from: (table: string) => {
      const local: Call[] = [{ method: 'from', args: [table] }]
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'order', 'insert', 'update', 'upsert', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          local.push({ method, args })
          return builder
        }
      }
      builder.then = (resolve: (v: unknown) => unknown) => {
        calls.push(...local)
        const rows =
          typeof options.rows === 'function'
            ? options.rows(table, local)
            : (options.rows ?? [])
        return Promise.resolve({ data: rows, error: options.error ?? null }).then(resolve)
      }
      return builder
    },
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(options.rpc ?? { data: 'requested', error: null })
    },
  }
  mock.current = client
  return { calls, rpcCalls }
}

const P1 = '00000000-0000-0000-0000-000000000001'
const P2 = '00000000-0000-0000-0000-000000000002'

const overviewRow = (over: Record<string, unknown> = {}) => ({
  paper_id: P1,
  schema_version: 1,
  status: 'complete',
  source_completed_at: '2026-01-01T00:00:00+00:00',
  completed_at: '2026-01-01T00:05:00+00:00',
  provider: 'openrouter',
  model: 'vendor/m',
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-01T00:05:00+00:00',
  is_stale: false,
  ...over,
})

const overview = (over: Partial<ExtractionOverview> = {}): ExtractionOverview => ({
  paperId: P1,
  schemaVersion: 1,
  status: 'complete',
  sourceCompletedAt: 'a',
  completedAt: 'b',
  provider: null,
  model: null,
  createdAt: 'c',
  updatedAt: 'd',
  isStale: false,
  ...over,
})

beforeEach(() => {
  mock.current = undefined
})

describe('explicit column lists (never select *)', () => {
  it('uses exactly the browser-granted columns', () => {
    expect(OVERVIEW_COLUMNS.split(', ')).toEqual([
      'paper_id', 'schema_version', 'status', 'source_completed_at', 'completed_at',
      'provider', 'model', 'created_at', 'updated_at', 'is_stale',
    ])
    expect(FIELD_COLUMNS.split(', ')).toEqual([
      'paper_id', 'schema_version', 'field_key', 'state', 'value', 'created_at', 'updated_at',
    ])
    expect(SOURCE_COLUMNS.split(', ')).toEqual([
      'paper_id', 'schema_version', 'field_key', 'item_index', 'ord', 'chunk_id',
      'section_id', 'section_title', 'section_type', 'page_start', 'page_end', 'excerpt',
    ])
    for (const hidden of ['user_id', 'attempts', 'claim_started_at', 'last_error']) {
      for (const cols of [OVERVIEW_COLUMNS, FIELD_COLUMNS, SOURCE_COLUMNS]) {
        expect(cols).not.toContain(hidden)
      }
    }
  })

  it('every query selects those columns, filters schema_version = 1, and never uses *', async () => {
    const { calls } = fakeClient({})
    await listExtractionOverviews([P1])
    await listExtractionFields([P1])
    await listExtractionSources(P1, 'objective')
    const selects = calls.filter((c) => c.method === 'select').map((c) => c.args[0])
    expect(selects).toEqual([OVERVIEW_COLUMNS, FIELD_COLUMNS, SOURCE_COLUMNS])
    for (const s of selects) expect(s).not.toMatch(/\*/)
    const versions = calls.filter((c) => c.method === 'eq' && c.args[0] === 'schema_version')
    expect(versions).toHaveLength(3)
    for (const v of versions) expect(v.args[1]).toBe(1)
    expect(calls.filter((c) => c.method === 'from').map((c) => c.args[0])).toEqual([
      'paper_extraction_overview',
      'paper_extraction_fields',
      'paper_extraction_sources',
    ])
  })
})

describe('overview and field queries', () => {
  it('issues no query for an empty paper-id list', async () => {
    const { calls } = fakeClient({})
    expect(await listExtractionOverviews([])).toEqual([])
    expect(await listExtractionFields([])).toEqual([])
    expect(calls).toEqual([])
  })

  it('filters by the sorted, de-duplicated paper ids', async () => {
    const { calls } = fakeClient({})
    await listExtractionOverviews([P2, P1, P2])
    expect(calls.find((c) => c.method === 'in')?.args).toEqual(['paper_id', [P1, P2]])
  })

  it('splits a large project into bounded requests', async () => {
    const ids = Array.from({ length: PAPER_IDS_PER_REQUEST * 2 + 1 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    )
    const { calls } = fakeClient({})
    await listExtractionOverviews(ids)
    const batches = calls.filter((c) => c.method === 'in').map((c) => (c.args[1] as string[]).length)
    expect(batches.sort((a, b) => b - a)).toEqual([PAPER_IDS_PER_REQUEST, PAPER_IDS_PER_REQUEST, 1])
  })

  it('maps rows to browser types and drops rows that do not validate', async () => {
    fakeClient({
      rows: [overviewRow(), overviewRow({ paper_id: P2, status: 'stale' }), { junk: true }],
    })
    const rows = await listExtractionOverviews([P1, P2])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ paperId: P1, status: 'complete', isStale: false, model: 'vendor/m' })
  })

  it('normalizes field rows and tolerates malformed values', async () => {
    fakeClient({
      rows: [
        { paper_id: P1, schema_version: 1, field_key: 'objective', state: 'extracted', value: { items: [{ text: 'A' }, { text: 'B' }] }, created_at: 'x', updated_at: 'y' },
        { paper_id: P1, schema_version: 1, field_key: 'dataset', state: 'not_reported', value: { items: [] }, created_at: 'x', updated_at: 'y' },
        { paper_id: P1, schema_version: 1, field_key: 'findings', state: 'extracted', value: 'oops', created_at: 'x', updated_at: 'y' },
        { paper_id: P1, schema_version: 1, field_key: 'not_a_field', state: 'extracted', value: { items: [] }, created_at: 'x', updated_at: 'y' },
      ],
    })
    const rows = await listExtractionFields([P1])
    expect(rows.map((r) => r.fieldKey)).toEqual(['objective', 'dataset', 'findings'])
    expect(rows[0]).toMatchObject({ items: [{ text: 'A' }, { text: 'B' }], itemsMalformed: false })
    expect(rows[1]).toMatchObject({ state: 'not_reported', items: [], itemsMalformed: false })
    expect(rows[2]).toMatchObject({ items: [], itemsMalformed: true })
  })

  it('propagates database errors', async () => {
    fakeClient({ error: new Error('denied') })
    await expect(listExtractionOverviews([P1])).rejects.toThrow('denied')
  })
})

describe('parseFieldValue', () => {
  it.each([
    [null], [undefined], [42], ['x'], [[]], [{}], [{ items: 'nope' }], [{ items: null }],
  ])('treats %j as malformed with no items', (value) => {
    expect(parseFieldValue(value)).toEqual({ items: [], malformed: true })
  })

  it('keeps valid items, drops invalid ones and flags the value', () => {
    expect(parseFieldValue({ items: [{ text: 'ok' }, { text: 5 }, null, { text: '  ' }, 'x'] })).toEqual({
      items: [{ text: 'ok' }],
      malformed: true,
    })
    expect(parseFieldValue({ items: [] })).toEqual({ items: [], malformed: false })
  })
})

describe('sources query', () => {
  it('filters by paper and field, version 1, ordered by item_index then ord', async () => {
    const { calls } = fakeClient({})
    await listExtractionSources(P1, 'limitations')
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args)
    expect(eqs).toEqual(
      expect.arrayContaining([['schema_version', 1], ['paper_id', P1], ['field_key', 'limitations']]),
    )
    expect(calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['item_index', { ascending: true }],
      ['ord', { ascending: true }],
    ])
  })

  it('maps provenance rows, keeping snapshots when live pointers are cleared', async () => {
    fakeClient({
      rows: [
        {
          paper_id: P1, schema_version: 1, field_key: 'objective', item_index: 0, ord: 0,
          chunk_id: null, section_id: null, section_title: 'Abstract', section_type: 'abstract',
          page_start: 1, page_end: 2, excerpt: 'We study widgets.',
        },
      ],
    })
    expect(await listExtractionSources(P1, 'objective')).toEqual([
      {
        paperId: P1, schemaVersion: 1, fieldKey: 'objective', itemIndex: 0, ord: 0,
        chunkId: null, sectionId: null, sectionTitle: 'Abstract', sectionType: 'abstract',
        pageStart: 1, pageEnd: 2, excerpt: 'We study widgets.',
      },
    ])
  })

  it('rejects an unknown field key without querying', async () => {
    const { calls } = fakeClient({})
    await expect(listExtractionSources(P1, 'bogus' as never)).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

describe('request_paper_extraction RPC', () => {
  it('calls the exact function with only the paper id', async () => {
    const { rpcCalls, calls } = fakeClient({ rpc: { data: 'requested', error: null } })
    await requestPaperExtraction(P1)
    expect(rpcCalls).toEqual([{ fn: 'request_paper_extraction', args: { p_paper_id: P1 } }])
    expect(calls).toEqual([])
  })

  it.each(['requested', 'unchanged', 'not_ready', 'not_found'] as const)('returns %s', async (result) => {
    fakeClient({ rpc: { data: result, error: null } })
    expect(await requestPaperExtraction(P1)).toBe(result)
  })

  it.each([[null], [undefined], ['queued'], [1], [{ result: 'requested' }], ['']])(
    'fails safely on the unexpected result %j',
    async (data) => {
      fakeClient({ rpc: { data, error: null } })
      await expect(requestPaperExtraction(P1)).rejects.toThrow(/Unexpected response/)
    },
  )

  it('propagates an RPC error', async () => {
    fakeClient({ rpc: { data: null, error: new Error('not authenticated') } })
    await expect(requestPaperExtraction(P1)).rejects.toThrow('not authenticated')
  })

  it('has a user message for every result, none mentioning internals', () => {
    const results: RequestResult[] = ['requested', 'unchanged', 'not_ready', 'not_found']
    for (const r of results) {
      expect(REQUEST_MESSAGES[r].message.length).toBeGreaterThan(10)
      expect(REQUEST_MESSAGES[r].message).not.toMatch(/worker|service|rpc|database/i)
    }
    expect(REQUEST_MESSAGES.requested.tone).toBe('success')
    expect(REQUEST_MESSAGES.not_found.tone).toBe('error')
    expect(REQUEST_MESSAGES.not_ready.message).toMatch(/still being processed/)
  })
})

describe('query keys', () => {
  it('are independent of paper id order and duplicates', () => {
    expect(evidenceKeys.overview([P2, P1])).toEqual(evidenceKeys.overview([P1, P2, P1]))
    expect(evidenceKeys.fields([P2, P1])).toEqual(evidenceKeys.fields([P1, P2]))
    expect(normalizePaperIds([P2, P1, P2])).toEqual([P1, P2])
  })

  it('are distinct per kind, paper set, paper and field', () => {
    expect(evidenceKeys.overview([P1])).not.toEqual(evidenceKeys.fields([P1]))
    expect(evidenceKeys.overview([P1])).not.toEqual(evidenceKeys.overview([P1, P2]))
    expect(evidenceKeys.sources(P1, 'objective')).not.toEqual(evidenceKeys.sources(P1, 'dataset'))
    expect(evidenceKeys.sources(P1, 'objective')).not.toEqual(evidenceKeys.sources(P2, 'objective'))
    expect(evidenceKeys.overview([P1]).slice(0, 2)).toEqual([...evidenceKeys.overviews])
    expect(evidenceKeys.fields([P1]).slice(0, 2)).toEqual([...evidenceKeys.fieldsAll])
  })

  it('the sources query uses its key', () => {
    expect(extractionSourcesQuery(P1, 'concepts').queryKey).toEqual(evidenceKeys.sources(P1, 'concepts'))
  })
})

describe('polling', () => {
  const intervalOf = (data: ExtractionOverview[] | undefined) => {
    const fn = extractionOverviewsQuery([P1]).refetchInterval
    if (typeof fn !== 'function') throw new Error('expected a function')
    return fn({ state: { data } } as never)
  }

  it('the overview query polls every 10 s only while something is pending or running', () => {
    expect(EXTRACTION_REFRESH_MS).toBe(10_000)
    expect(intervalOf([overview({ status: 'pending' })])).toBe(10_000)
    expect(intervalOf([overview({ status: 'complete' }), overview({ paperId: P2, status: 'running' })])).toBe(10_000)
    for (const status of ['complete', 'partial', 'failed'] as const) {
      expect(intervalOf([overview({ status })]), status).toBe(false)
    }
    expect(intervalOf([])).toBe(false)
    expect(intervalOf(undefined)).toBe(false)
  })

  it('the fields query polls only when told to', () => {
    expect(extractionFieldsQuery([P1]).refetchInterval).toBe(false)
    expect(extractionFieldsQuery([P1], { poll: false }).refetchInterval).toBe(false)
    expect(extractionFieldsQuery([P1], { poll: true }).refetchInterval).toBe(10_000)
  })

  it('hasActiveExtraction drives the coordination', () => {
    expect(hasActiveExtraction([overview({ status: 'pending' })])).toBe(true)
    expect(hasActiveExtraction([overview({ status: 'running' })])).toBe(true)
    expect(hasActiveExtraction([overview({ status: 'failed' }), overview({ status: 'partial' })])).toBe(false)
    expect(hasActiveExtraction(undefined)).toBe(false)
  })
})

describe('status helpers', () => {
  it('a paper that is not ready waits, whatever its extraction says', () => {
    for (const paperStatus of ['uploaded', 'processing', 'failed'] as const) {
      for (const o of [undefined, overview(), overview({ status: 'failed' })]) {
        expect(describeExtraction(paperStatus, o)).toMatchObject({
          key: 'waiting',
          label: 'Waiting for processing',
          action: null,
          active: false,
        })
      }
    }
  })

  it.each([
    ['no overview', undefined, 'Not extracted', 'extract', false],
    ['pending', overview({ status: 'pending' }), 'Queued', null, true],
    ['running', overview({ status: 'running' }), 'Extracting…', null, true],
    ['complete, current', overview({ status: 'complete', isStale: false }), 'Extracted', null, false],
    ['complete, stale', overview({ status: 'complete', isStale: true }), 'Out of date', 'update', false],
    ['partial', overview({ status: 'partial' }), 'Partial', 'retry', false],
    ['failed', overview({ status: 'failed' }), 'Extraction failed', 'retry', false],
  ] as const)('%s', (_name, o, label, action, active) => {
    expect(describeExtraction('ready', o)).toMatchObject({ label, action, active })
  })

  it('a stale complete extraction is updatable but a current one offers nothing', () => {
    expect(describeExtraction('ready', overview({ isStale: true })).action).toBe('update')
    expect(describeExtraction('ready', overview({ isStale: false })).action).toBeNull()
  })

  it('an action is offered only where a request can change something', () => {
    // pending / running / current complete would answer "unchanged"
    for (const o of [overview({ status: 'pending' }), overview({ status: 'running' }), overview()]) {
      expect(describeExtraction('ready', o).action).toBeNull()
    }
    expect(actionLabel('extract')).toBe('Extract')
    expect(actionLabel('update')).toBe('Update')
    expect(actionLabel('retry')).toBe('Retry')
  })
})

describe('boundaries', () => {
  const src = (name: string) =>
    readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
      .replace(/\/\*[^]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const files = ['api.ts', 'queries.ts', 'status.ts', 'types.ts']

  it('never writes to the extraction tables and never selects *', () => {
    for (const f of files) {
      const code = src(f)
      expect(code, f).not.toMatch(/\.(insert|update|upsert|delete)\(/)
      expect(code, f).not.toMatch(/select\(\s*['"`]\*['"`]/)
    }
    // the only remote calls are three reads and one RPC
    const api = src('api.ts')
    expect([...api.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1]).sort()).toEqual([
      'paper_extraction_fields',
      'paper_extraction_overview',
      'paper_extraction_sources',
    ])
    expect([...api.matchAll(/\.rpc\(\s*'(\w+)'/g)].map((m) => m[1])).toEqual(['request_paper_extraction'])
  })

  it('stays browser-safe: no worker, server, service-role or extraction-service imports', () => {
    for (const f of files) {
      const code = src(f)
      expect(code, f).not.toMatch(/worker|\.server|service_role|SERVICE_ROLE|process\.env/)
      expect(code, f).not.toMatch(/from '\.\/(extract|prompt|evidence-packet|schema)'/)
      expect(code, f).not.toMatch(/supabase\.server/)
    }
  })

  it('covers exactly the seven fields', () => {
    expect([...FIELD_KEYS]).toEqual([
      'objective', 'methodology', 'dataset', 'findings', 'limitations', 'future_work', 'concepts',
    ])
  })
})
