import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { papersQuery } from '#/features/papers/queries'
import type { Paper } from '#/features/papers/types'
import { WORKSPACE_TABS } from '#/features/projects/workspace/tabs'
import { FIELD_KEYS } from '../fields'
import {
  buildMatrixRows,
  cellModel,
  deriveMatrixState,
  FIELD_LABELS,
  requestExtractionOnce,
  summarizeMatrix,
} from '../matrix-model'
import { evidenceKeys, EXTRACTION_REFRESH_MS } from '../queries'
import { describeExtraction } from '../status'
import type { ExtractionField, ExtractionOverview, FieldKey } from '../types'
import { EvidenceMatrixCards } from './evidence-matrix-cards'
import { EvidenceMatrixTab, fieldsQueryFor } from './evidence-matrix-tab'
import { EvidenceMatrixTable } from './evidence-matrix-table'
import { EvidenceMatrixToolbar } from './evidence-matrix-toolbar'
import { EvidenceMatrixView } from './evidence-matrix-view'
import { MatrixCellView } from './matrix-cell'
import { PaperExtractionStatus } from './paper-extraction-status'

// The tab links to /papers/$paperId; a plain anchor is enough without a router.
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: ReactNode }) =>
    createElement('a', { href: '#' }, props.children),
}))

const P1 = '00000000-0000-0000-0000-000000000001'
const P2 = '00000000-0000-0000-0000-000000000002'
const P3 = '00000000-0000-0000-0000-000000000003'

const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  id,
  project_ids: ['proj'],
  title: `Paper ${id.slice(-1)} <b>bold</b>`,
  authors: [],
  publication_year: null,
  original_filename: null,
  mime_type: null,
  storage_path: null,
  content_hash: null,
  file_size_bytes: null,
  status: 'ready',
  page_count: null,
  processing_error: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})

const overview = (
  paperId: string,
  over: Partial<ExtractionOverview> = {},
): ExtractionOverview => ({
  paperId,
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

const field = (
  paperId: string,
  fieldKey: FieldKey,
  texts: string[] | 'not_reported' | 'failed',
  over: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId,
  schemaVersion: 1,
  fieldKey,
  state:
    texts === 'not_reported' ? 'not_reported' : texts === 'failed' ? 'failed' : 'extracted',
  items: Array.isArray(texts) ? texts.map((text) => ({ text })) : [],
  itemsMalformed: false,
  createdAt: 'x',
  updatedAt: 'y',
  ...over,
})

const html = (el: ReactElement) => renderToStaticMarkup(el)
const noop = () => undefined

/** Every element in a (hook-free) element tree that satisfies `match`. */
function collect(node: ReactNode, match: (el: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => collect(n, match))
  if (typeof node !== 'object' || node === null || !('props' in node)) return []
  const el = node as ReactElement<{ children?: ReactNode }>
  return [...(match(el) ? [el] : []), ...collect(el.props.children, match)]
}

const rowsFor = () =>
  buildMatrixRows(
    [paper(P1), paper(P2), paper(P3)],
    [
      overview(P1),
      overview(P2, { status: 'complete', isStale: true }),
    ],
    [
      field(P1, 'objective', ['Objective A', 'Objective B', 'Objective C']),
      field(P1, 'dataset', 'not_reported'),
      field(P1, 'findings', 'failed'),
      field(P2, 'objective', ['Old claim from before reprocessing']),
    ],
  )

describe('buildMatrixRows: the in-memory join', () => {
  it('keeps the papers in order and attaches each paper only its own data', () => {
    const rows = rowsFor()
    expect(rows.map((r) => r.paper.id)).toEqual([P1, P2, P3])
    expect(rows[0].overview?.paperId).toBe(P1)
    expect(Object.keys(rows[0].fields).sort()).toEqual(['dataset', 'findings', 'objective'])
    expect(rows[1].fields.objective?.items).toEqual([{ text: 'Old claim from before reprocessing' }])
    expect(rows[2].overview).toBeUndefined()
    expect(rows[2].fields).toEqual({})
  })

  it('derives each paper status, and a paper with no extraction is simply Not extracted', () => {
    const rows = rowsFor()
    expect(rows.map((r) => r.status.label)).toEqual(['Extracted', 'Out of date', 'Not extracted'])
    expect(rows[2].status.action).toBe('extract')
  })

  it('extraction rows for unknown papers add no rows', () => {
    const rows = buildMatrixRows([paper(P1)], [overview(P2)], [field(P2, 'objective', ['x'])])
    expect(rows).toHaveLength(1)
    expect(rows[0].overview).toBeUndefined()
  })
})

describe('cellModel', () => {
  it('extracted: first item as the preview and the number of further items', () => {
    expect(cellModel(field(P1, 'objective', ['a', 'b', 'c']))).toEqual({
      kind: 'extracted', items: ['a', 'b', 'c'], first: 'a', more: 2,
    })
    expect(cellModel(field(P1, 'objective', ['only']))).toEqual({
      kind: 'extracted', items: ['only'], first: 'only', more: 0,
    })
  })

  it('not_reported, failed and missing', () => {
    expect(cellModel(field(P1, 'dataset', 'not_reported'))).toEqual({ kind: 'not_reported' })
    expect(cellModel(field(P1, 'dataset', 'failed'))).toEqual({ kind: 'failed' })
    expect(cellModel(undefined)).toEqual({ kind: 'missing' })
  })

  it('an extracted field with no usable items is malformed', () => {
    expect(cellModel(field(P1, 'objective', [], { state: 'extracted', itemsMalformed: true }))).toEqual({ kind: 'malformed' })
    expect(cellModel(field(P1, 'objective', []))).toEqual({ kind: 'malformed' })
  })
})

describe('summarizeMatrix', () => {
  it('counts papers, current, queued/running and needs-attention', () => {
    const rows = buildMatrixRows(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => paper(`00000000-0000-0000-0000-00000000000${n}`, n === 8 ? { status: 'processing' } : {})),
      [
        overview('00000000-0000-0000-0000-000000000001'),
        overview('00000000-0000-0000-0000-000000000002', { status: 'pending' }),
        overview('00000000-0000-0000-0000-000000000003', { status: 'running' }),
        overview('00000000-0000-0000-0000-000000000004', { isStale: true }),
        overview('00000000-0000-0000-0000-000000000005', { status: 'partial' }),
        overview('00000000-0000-0000-0000-000000000006', { status: 'failed' }),
      ],
      [],
    )
    expect(summarizeMatrix(rows)).toEqual({ total: 8, current: 1, active: 2, attention: 3 })
  })

  it('renders the four counts in the toolbar', () => {
    const out = html(createElement(EvidenceMatrixToolbar, { summary: { total: 9, current: 4, active: 2, attention: 3 } }))
    expect(out).toContain('Evidence Matrix')
    expect(out).toMatch(/data-stat="total">9</)
    expect(out).toMatch(/data-stat="current">4</)
    expect(out).toMatch(/data-stat="active">2</)
    expect(out).toMatch(/data-stat="attention">3</)
    expect(out).not.toMatch(/Request all|Extract all/i)
  })
})

describe('deriveMatrixState', () => {
  const ok = <T,>(data: T) => ({ data, error: null, isPending: false })
  const pending = { data: undefined, error: null, isPending: true }
  const fail = (message: string) => ({ data: undefined, error: new Error(message), isPending: false })

  it('loading while the papers load', () => {
    expect(deriveMatrixState({ papers: pending, overviews: pending, fields: pending })).toEqual({ kind: 'loading' })
  })

  it('a papers error is an error', () => {
    const s = deriveMatrixState({ papers: fail('papers down'), overviews: ok([]), fields: ok([]) })
    expect(s).toMatchObject({ kind: 'error', source: 'papers' })
  })

  it('no papers is an empty state, without waiting for extraction data', () => {
    expect(deriveMatrixState({ papers: ok([]), overviews: pending, fields: pending })).toEqual({ kind: 'empty' })
  })

  it('an extraction-data failure is an error, never "Not extracted"', () => {
    for (const q of [
      { overviews: fail('overview down'), fields: ok([]) },
      { overviews: ok([]), fields: fail('fields down') },
    ]) {
      const s = deriveMatrixState({ papers: ok([paper(P1)]), ...q })
      expect(s).toMatchObject({ kind: 'error', source: 'extraction' })
    }
  })

  it('loading while extraction data is still coming', () => {
    expect(deriveMatrixState({ papers: ok([paper(P1)]), overviews: pending, fields: ok([]) })).toEqual({ kind: 'loading' })
  })

  it('papers with no extraction rows still produce rows with the Extract action', () => {
    const s = deriveMatrixState({ papers: ok([paper(P1), paper(P2)]), overviews: ok([]), fields: ok([]) })
    expect(s.kind).toBe('ready')
    if (s.kind !== 'ready') return
    expect(s.rows.map((r) => r.status.action)).toEqual(['extract', 'extract'])
  })

  it('joins papers, overviews and fields', () => {
    const s = deriveMatrixState({
      papers: ok([paper(P1)]),
      overviews: ok([overview(P1)]),
      fields: ok([field(P1, 'objective', ['x'])]),
    })
    expect(s.kind === 'ready' && s.rows[0].fields.objective?.items).toEqual([{ text: 'x' }])
  })
})

describe('polling coordination', () => {
  it('fields poll only while an extraction is queued or running', () => {
    expect(fieldsQueryFor([P1], [overview(P1, { status: 'pending' })]).refetchInterval).toBe(EXTRACTION_REFRESH_MS)
    expect(fieldsQueryFor([P1], [overview(P1, { status: 'running' })]).refetchInterval).toBe(EXTRACTION_REFRESH_MS)
    expect(fieldsQueryFor([P1], [overview(P1, { status: 'complete' })]).refetchInterval).toBe(false)
    expect(fieldsQueryFor([P1], undefined).refetchInterval).toBe(false)
  })
})

describe('requestExtractionOnce (per-paper in-flight handling)', () => {
  it('calls the request with the paper id and clears the in-flight state', async () => {
    const request = vi.fn(async (_id: string) => 'requested')
    const seen: string[][] = []
    const inFlight = new Set<string>()
    await requestExtractionOnce(P1, inFlight, request, (s) => seen.push([...s]))
    expect(request).toHaveBeenCalledExactlyOnceWith(P1)
    expect(seen).toEqual([[P1], []])
    expect(inFlight.size).toBe(0)
  })

  it('ignores a second request for the same paper while one is running, not other papers', async () => {
    const releases: (() => void)[] = []
    const request = vi.fn(
      (_id: string) => new Promise<void>((resolve) => { releases.push(resolve) }),
    )
    const inFlight = new Set<string>()
    const first = requestExtractionOnce(P1, inFlight, request, noop)
    await requestExtractionOnce(P1, inFlight, request, noop)
    expect(request).toHaveBeenCalledTimes(1)
    const other = requestExtractionOnce(P2, inFlight, request, noop)
    expect(request).toHaveBeenCalledTimes(2)
    expect([...inFlight].sort()).toEqual([P1, P2])
    for (const release of releases) release()
    await Promise.all([first, other])
    expect(inFlight.size).toBe(0)
  })

  it('a failed request is cleared and does not throw', async () => {
    const inFlight = new Set<string>()
    await expect(
      requestExtractionOnce(P1, inFlight, () => Promise.reject(new Error('x')), noop),
    ).resolves.toBeUndefined()
    expect(inFlight.size).toBe(0)
  })
})

describe('PaperExtractionStatus', () => {
  const view = (status: ReturnType<typeof describeExtraction>, extra: { pending?: boolean; onAction?: () => void } = {}) =>
    PaperExtractionStatus({ status, paperTitle: 'Widgets', ...extra })
  const buttons = (el: ReactElement) => collect(el, (e) => e.type === 'button' || (typeof e.type === 'function' && e.type.name === 'Button'))

  it.each([
    ['ready', undefined, 'Not extracted', 'Extract', 'Extract evidence'],
    ['ready', overview(P1, { isStale: true }), 'Out of date', 'Update', 'Update evidence'],
    ['ready', overview(P1, { status: 'partial' }), 'Partial', 'Retry', 'Retry evidence extraction'],
    ['ready', overview(P1, { status: 'failed' }), 'Extraction failed', 'Retry', 'Retry evidence extraction'],
  ] as const)('%s / %s shows "%s" with the %s button for that paper', (paperStatus, o, label, action, ariaLabel) => {
    const out = html(createElement(PaperExtractionStatus, { status: describeExtraction(paperStatus, o), paperTitle: 'Widgets' }))
    expect(out).toContain(label)
    expect(out).toContain(`>${action}<`)
    expect(out).toContain(`aria-label="${ariaLabel} for Widgets"`)
  })

  it('the button calls onAction (which the tab binds to this paper)', () => {
    const onAction = vi.fn()
    const el = view(describeExtraction('ready', undefined), { onAction })
    const [button] = buttons(el)
    ;(button.props as { onClick: () => void }).onClick()
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['ready', overview(P1), 'Extracted'],
    ['ready', overview(P1, { status: 'pending' }), 'Queued'],
    ['ready', overview(P1, { status: 'running' }), 'Extracting…'],
    ['processing', undefined, 'Waiting for processing'],
    ['uploaded', overview(P1), 'Waiting for processing'],
  ] as const)('%s / %s shows "%s" and no action', (paperStatus, o, label) => {
    const out = html(createElement(PaperExtractionStatus, { status: describeExtraction(paperStatus, o), paperTitle: 'Widgets' }))
    expect(out).toContain(label)
    expect(out).not.toContain('<button')
  })

  it('the running state has a spinner AND a text label', () => {
    const out = html(createElement(PaperExtractionStatus, { status: describeExtraction('ready', overview(P1, { status: 'running' })), paperTitle: 'W' }))
    expect(out).toContain('animate-spin')
    expect(out).toContain('Extracting…')
  })

  it('the action is disabled while THIS paper is requesting, and enabled otherwise', () => {
    const status = describeExtraction('ready', undefined)
    expect(html(createElement(PaperExtractionStatus, { status, paperTitle: 'W', pending: true }))).toMatch(/<button[^>]*\sdisabled=""/)
    expect(html(createElement(PaperExtractionStatus, { status, paperTitle: 'W', pending: false }))).not.toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('a failure is described generically, with no internals', () => {
    const out = html(createElement(PaperExtractionStatus, { status: describeExtraction('ready', overview(P1, { status: 'failed' })), paperTitle: 'W' }))
    expect(out).toContain('The extraction did not finish.')
    expect(out).not.toMatch(/worker|local|attempt|error:/i)
  })
})

describe('MatrixCellView', () => {
  const cell = (fieldRow: ExtractionField | undefined, expanded = false) =>
    html(createElement(MatrixCellView, { model: cellModel(fieldRow), expanded, onToggle: noop, label: 'Objective', paperTitle: 'Widgets' }))

  it('extracted: first item as a preview with "+N more"', () => {
    const out = cell(field(P1, 'objective', ['First claim', 'Second claim', 'Third claim']))
    expect(out).toContain('First claim')
    expect(out).not.toContain('Second claim')
    expect(out).toContain('+2 more')
    expect(out).toMatch(/<button[^>]*aria-expanded="false"/)
    expect(out).toContain('aria-label="Show all 3 Objective items"')
  })

  it('a single extracted item has no toggle', () => {
    const out = cell(field(P1, 'objective', ['Only claim']))
    expect(out).toContain('Only claim')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('more')
  })

  it('expanded shows every item, unclamped', () => {
    const out = cell(field(P1, 'objective', ['One', 'Two', 'Three']), true)
    for (const t of ['One', 'Two', 'Three']) expect(out).toContain(t)
    expect(out).toContain('Show less')
    expect(out).not.toContain('line-clamp')
  })

  it('not_reported, failed, missing and malformed', () => {
    expect(cell(field(P1, 'dataset', 'not_reported'))).toContain('Not reported')
    expect(cell(field(P1, 'dataset', 'failed'))).toContain('Field unavailable')
    expect(cell(undefined)).toContain('—')
    expect(cell(field(P1, 'dataset', [], { itemsMalformed: true }))).toContain('Unable to display')
  })

  it('renders claims as text, never as HTML, and never exposes JSON', () => {
    const out = cell(field(P1, 'objective', ['<script>alert(1)</script> & <b>x</b>']))
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toMatch(/"items"|\{"text"/)
  })

  it('does not truncate the claim text in the data, only visually', () => {
    const long = 'word '.repeat(200).trim()
    const model = cellModel(field(P1, 'objective', [long, 'two']))
    expect(model.kind === 'extracted' && model.first).toBe(long)
    expect(cell(field(P1, 'objective', [long, 'two']))).toContain(long)
  })
})

describe('EvidenceMatrixTable (desktop)', () => {
  const out = () =>
    html(createElement(EvidenceMatrixTable, { rows: rowsFor(), pendingIds: new Set<string>(), onRequest: noop, onViewEvidence: noop, renderTitle: (p: Paper) => createElement('span', null, p.title) }))

  it('has the Paper column then the seven fields in order, as column headers', () => {
    const headers = [...out().matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])
    expect(headers).toEqual(['Paper', 'Objective', 'Methodology', 'Dataset', 'Findings', 'Limitations', 'Future Work', 'Concepts'])
    expect(headers.slice(1)).toEqual(FIELD_KEYS.map((k) => FIELD_LABELS[k]))
  })

  it('is a semantic, captioned table that scrolls horizontally inside its own container', () => {
    const o = out()
    expect(o).toMatch(/<table[^>]*min-w-\[1200px\]/)
    expect(o).toContain('<caption class="sr-only">')
    expect(o).toContain('<thead>')
    expect(o).toContain('<tbody>')
    expect(o).toMatch(/data-testid="matrix-scroll"[^>]*overflow-x-auto|overflow-x-auto[^>]*data-testid="matrix-scroll"/)
  })

  it('makes the Paper column sticky in the header and in every row', () => {
    const o = out()
    expect(o).toMatch(/<th scope="col"[^>]*sticky left-0[^>]*>Paper</)
    const rowHeaders = [...o.matchAll(/<th scope="row"([^>]*)>/g)]
    expect(rowHeaders).toHaveLength(3)
    for (const m of rowHeaders) expect(m[1]).toContain('sticky left-0')
  })

  it('shows each paper title and its status next to it, and cells across the row', () => {
    const o = out()
    expect(o).toContain('Paper 1 &lt;b&gt;bold&lt;/b&gt;')
    for (const label of ['Extracted', 'Out of date', 'Not extracted']) expect(o).toContain(label)
    expect(o).toContain('Objective A')
    expect(o).toContain('Old claim from before reprocessing')
    expect(o).toContain('Not reported')
    expect(o).toContain('Field unavailable')
    // three rows x seven cells
    expect((o.match(/<td /g) ?? []).length).toBe(21)
  })

  it('each action names its paper', () => {
    expect(out()).toContain('aria-label="Update evidence for Paper 2 &lt;b&gt;bold&lt;/b&gt;"')
  })
})

describe('EvidenceMatrixCards (mobile)', () => {
  const out = () =>
    html(createElement(EvidenceMatrixCards, { rows: rowsFor(), pendingIds: new Set<string>(), onRequest: noop, onViewEvidence: noop, renderTitle: (p: Paper) => createElement('span', null, p.title) }))

  it('renders one card per paper with status and action', () => {
    const o = out()
    expect((o.match(/data-slot="card"/g) ?? []).length).toBe(3)
    expect(o).toContain('Out of date')
    expect(o).toContain('aria-label="Extract evidence for Paper 3 &lt;b&gt;bold&lt;/b&gt;"')
  })

  it('has all seven field sections per paper', () => {
    const o = out()
    for (const key of FIELD_KEYS) {
      expect((o.match(new RegExp(`>${FIELD_LABELS[key]}<`, 'g')) ?? []).length, key).toBe(3)
    }
  })

  it('extracted fields are native details with an item count and their claims', () => {
    const o = out()
    expect(o).toContain('<details')
    expect(o).toContain('<summary')
    expect(o).toContain('3 items')
    expect(o).toContain('1 item')
    for (const t of ['Objective A', 'Objective B', 'Objective C']) expect(o).toContain(t)
  })

  it('other states say so plainly', () => {
    const o = out()
    expect(o).toContain('Not reported')
    expect(o).toContain('Field unavailable')
    expect(o).toContain('No data')
  })
})

describe('EvidenceMatrixView', () => {
  it('shows the table at md and up and the cards below, in one place', () => {
    const o = html(createElement(EvidenceMatrixView, { rows: rowsFor(), pendingIds: new Set<string>(), onRequest: noop, onViewEvidence: noop }))
    expect(o).toMatch(/class="hidden md:block"/)
    expect(o).toMatch(/class="md:hidden"/)
    expect(o).toContain('Evidence Matrix')
    expect(o).toMatch(/data-stat="total">3</)
  })

  it('papers with no extraction rows still render with Extract actions', () => {
    const rows = buildMatrixRows([paper(P1), paper(P2)], [], [])
    const o = html(createElement(EvidenceMatrixView, { rows, pendingIds: new Set<string>(), onRequest: noop, onViewEvidence: noop }))
    expect((o.match(/>Extract</g) ?? []).length).toBe(4) // table + cards
    expect(o).toContain('Not extracted')
  })
})

describe('EvidenceMatrixTab (with a seeded query cache)', () => {
  const render = (seed: (qc: QueryClient) => void) => {
    const qc = new QueryClient()
    seed(qc)
    return html(createElement(QueryClientProvider, { client: qc }, createElement(EvidenceMatrixTab, { projectId: 'proj' })))
  }
  const papersKey = papersQuery({ projectId: 'proj' }).queryKey

  it('shows a loading skeleton while papers load', () => {
    const o = render(() => undefined)
    expect(o).toContain('aria-busy="true"')
    expect(o).not.toContain('<table')
  })

  it('explains that papers are needed when the project has none', () => {
    const o = render((qc) => qc.setQueryData(papersKey, []))
    expect(o).toContain('No papers to compare yet')
    expect(o).toMatch(/Add papers to this project first/)
    expect(o).not.toContain('<table')
  })

  it('renders the joined matrix from papers + overviews + fields', () => {
    const o = render((qc) => {
      qc.setQueryData(papersKey, [paper(P1), paper(P2)])
      qc.setQueryData(evidenceKeys.overview([P1, P2]), [overview(P1)])
      qc.setQueryData(evidenceKeys.fields([P1, P2]), [field(P1, 'objective', ['Seeded claim'])])
    })
    expect(o).toContain('<table')
    expect(o).toContain('Seeded claim')
    expect(o).toContain('Extracted')
    expect(o).toContain('Not extracted')
  })

  it('papers with no extraction data render Extract states (and nothing is requested)', () => {
    const o = render((qc) => {
      qc.setQueryData(papersKey, [paper(P1)])
      qc.setQueryData(evidenceKeys.overview([P1]), [])
      qc.setQueryData(evidenceKeys.fields([P1]), [])
    })
    expect(o).toContain('Not extracted')
    expect(o).toContain('aria-label="Extract evidence for Paper 1')
  })
})

describe('workspace wiring and boundaries', () => {
  const root = new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const read = (rel: string) =>
    readFileSync(join(root, rel), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[^]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('the evidence tab renders EvidenceMatrixTab, not a placeholder', () => {
    const src = read('src/features/projects/workspace/project-workspace.tsx')
    expect(src).toMatch(/<TabsContent value="evidence"[^>]*>\s*<EvidenceMatrixTab key=\{project\.id\} projectId=\{project\.id\} \/>/)
    const placeholders = src.slice(src.indexOf('const PLACEHOLDERS'), src.indexOf('export function ProjectWorkspace'))
    expect([...placeholders.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1])).toEqual(['comparisons', 'writing'])
  })

  it('the other tabs and the tab list are unchanged', () => {
    expect(WORKSPACE_TABS.map((t) => t.value)).toEqual(['overview', 'papers', 'ai-research', 'evidence', 'research-map', 'comparisons', 'writing'])
    const src = read('src/features/projects/workspace/project-workspace.tsx')
    for (const value of ['overview', 'papers', 'ai-research']) {
      expect(src).toContain(`<TabsContent value="${value}"`)
    }
  })

  it('UI components never touch Supabase or start an extraction on their own', () => {
    const dir = join(root, 'src/features/evidence-matrix/ui')
    for (const f of readdirSync(dir).filter((n) => /\.tsx$/.test(n))) {
      const code = read(`src/features/evidence-matrix/ui/${f}`)
      expect(code, f).not.toMatch(/supabase|\.rpc\(|\.from\(|requestPaperExtraction/i)
      expect(code, f).not.toMatch(/useEffect/)
    }
    const tab = read('src/features/evidence-matrix/ui/evidence-matrix-tab.tsx')
    // extraction is requested only from the user-triggered handler
    expect([...tab.matchAll(/request\.mutateAsync/g)]).toHaveLength(1)
    expect(tab).not.toMatch(/useEffect|useLayoutEffect/)
  })

  it('does not import the extraction service or worker code', () => {
    const dir = join(root, 'src/features/evidence-matrix/ui')
    for (const f of readdirSync(dir).filter((n) => /\.tsx$/.test(n))) {
      expect(read(`src/features/evidence-matrix/ui/${f}`), f).not.toMatch(/from '\.\.\/(extract|prompt|evidence-packet|schema)'|worker/)
    }
  })
})
