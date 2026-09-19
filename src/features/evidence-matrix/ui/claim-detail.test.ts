import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { skipToken, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { formatPages, humanize } from '#/lib/format'
import type { Paper } from '#/features/papers/types'
import { FIELD_KEYS } from '../fields'
import {
  buildMatrixRows,
  findSelectedClaims,
  groupSourcesByClaim,
} from '../matrix-model'
import type { SelectedClaims } from '../matrix-model'
import { evidenceKeys, extractionSourcesForSelection } from '../queries'
import type {
  ExtractionField,
  ExtractionOverview,
  ExtractionSource,
  FieldKey,
} from '../types'
import type * as ApiModule from '../api'
import { ClaimDetailBody } from './claim-detail-body'
import { ClaimDetailSheet } from './claim-detail-sheet'
import { EvidenceMatrixCards } from './evidence-matrix-cards'
import { EvidenceMatrixTab } from './evidence-matrix-tab'
import { EvidenceMatrixTable } from './evidence-matrix-table'
import { MatrixCell, MatrixCellView } from './matrix-cell'
import { actionAriaLabel } from './paper-extraction-status'
import { SourceCard } from './source-card'

const api = vi.hoisted(() => ({ listExtractionSources: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  listExtractionSources: api.listExtractionSources,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: ReactNode; to: string; params?: { paperId: string } }) =>
    createElement(
      'a',
      { href: props.to.replace('$paperId', props.params?.paperId ?? ''), 'data-to': props.to },
      props.children,
    ),
}))

const P1 = '00000000-0000-0000-0000-000000000001'
const P2 = '00000000-0000-0000-0000-000000000002'
const noop = () => undefined
const html = (el: ReactElement) => renderToStaticMarkup(el)

const paper = (id: string, title = `Paper ${id.slice(-1)}`): Paper => ({
  id, project_ids: ['proj'], title, authors: [], publication_year: null,
  original_filename: null, mime_type: null, storage_path: null, content_hash: null,
  file_size_bytes: null, status: 'ready', page_count: null, processing_error: null,
  created_at: '2026-01-01T00:00:00Z',
})
const overview = (paperId: string, over: Partial<ExtractionOverview> = {}): ExtractionOverview => ({
  paperId, schemaVersion: 1, status: 'complete', sourceCompletedAt: 'a', completedAt: 'b',
  provider: null, model: null, createdAt: 'c', updatedAt: 'd', isStale: false, ...over,
})
const field = (
  paperId: string, fieldKey: FieldKey, texts: string[] | 'not_reported' | 'failed',
  over: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId, schemaVersion: 1, fieldKey,
  state: texts === 'not_reported' ? 'not_reported' : texts === 'failed' ? 'failed' : 'extracted',
  items: Array.isArray(texts) ? texts.map((text) => ({ text })) : [],
  itemsMalformed: false, createdAt: 'x', updatedAt: 'y', ...over,
})
const source = (itemIndex: number, ord: number, over: Partial<ExtractionSource> = {}): ExtractionSource => ({
  paperId: P1, schemaVersion: 1, fieldKey: 'objective', itemIndex, ord,
  chunkId: 'chunk', sectionId: 'section', sectionTitle: `Section ${itemIndex}.${ord}`,
  sectionType: 'related_work', pageStart: 1, pageEnd: 2, excerpt: `Excerpt ${itemIndex}.${ord}`, ...over,
})

function collect(node: ReactNode, match: (el: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => collect(n, match))
  if (typeof node !== 'object' || node === null || !('props' in node)) return []
  const el = node as ReactElement<{ children?: ReactNode }>
  return [...(match(el) ? [el] : []), ...collect(el.props.children, match)]
}

const selected = (over: Partial<SelectedClaims> = {}): SelectedClaims => ({
  paperId: P1, fieldKey: 'objective', paperTitle: 'Widget Paper', fieldLabel: 'Objective',
  claims: ['First claim', 'Second claim'], isStale: false, ...over,
})
const body = (
  props: { sel?: SelectedClaims; sources?: readonly ExtractionSource[] | undefined; error?: Error | null } = {},
) =>
  html(
    createElement(ClaimDetailBody, {
      selected: props.sel ?? selected(),
      sources: 'sources' in props ? props.sources : [],
      error: props.error ?? null,
      onRetry: noop,
    }),
  )

describe('groupSourcesByClaim', () => {
  it('attaches item_index N only to claim N', () => {
    const groups = groupSourcesByClaim(['a', 'b', 'c'], [source(0, 0), source(1, 0), source(1, 1), source(2, 0)])
    expect(groups.map((g) => g.sources.map((s) => `${s.itemIndex}.${s.ord}`))).toEqual([['0.0'], ['1.0', '1.1'], ['2.0']])
    expect(groups.map((g) => g.text)).toEqual(['a', 'b', 'c'])
    expect(groups.map((g) => g.index)).toEqual([0, 1, 2])
  })

  it('keeps several sources of one claim ordered by ord, whatever order they arrive in', () => {
    const groups = groupSourcesByClaim(['a'], [source(0, 2), source(0, 0), source(0, 1)])
    expect(groups[0].sources.map((s) => s.ord)).toEqual([0, 1, 2])
  })

  it('a claim with no source gets an empty group', () => {
    const groups = groupSourcesByClaim(['a', 'b'], [source(1, 0)])
    expect(groups[0].sources).toEqual([])
    expect(groups[1].sources).toHaveLength(1)
  })

  it('sources for an item that does not exist are never attached to another claim', () => {
    const groups = groupSourcesByClaim(['a', 'b'], [source(5, 0), source(-1, 0)])
    expect(groups.flatMap((g) => g.sources)).toEqual([])
  })

  it('never matches by text', () => {
    const groups = groupSourcesByClaim(['Excerpt 0.0', 'x'], [source(1, 0, { excerpt: 'Excerpt 0.0' })])
    expect(groups[0].sources).toEqual([])
    expect(groups[1].sources).toHaveLength(1)
  })
})

describe('selection', () => {
  const rows = buildMatrixRows(
    [paper(P1, 'Widget Paper'), paper(P2)],
    [overview(P1), overview(P2, { isStale: true })],
    [
      field(P1, 'objective', ['A', 'B']),
      field(P1, 'dataset', 'not_reported'),
      field(P1, 'findings', 'failed'),
      field(P1, 'limitations', [], { itemsMalformed: true }),
      field(P2, 'objective', ['Old']),
    ],
  )

  it('resolves only an extracted field, with its claims and paper context', () => {
    expect(findSelectedClaims(rows, { paperId: P1, fieldKey: 'objective' })).toEqual({
      paperId: P1, fieldKey: 'objective', paperTitle: 'Widget Paper', fieldLabel: 'Objective',
      claims: ['A', 'B'], isStale: false,
    })
  })

  it('carries the stale flag', () => {
    expect(findSelectedClaims(rows, { paperId: P2, fieldKey: 'objective' })?.isStale).toBe(true)
  })

  it.each(['dataset', 'findings', 'limitations', 'methodology'] as const)(
    'does not open for %s (not_reported, failed, malformed, missing)',
    (fieldKey) => {
      expect(findSelectedClaims(rows, { paperId: P1, fieldKey })).toBeNull()
    },
  )

  it('closes when nothing is selected or the paper is gone', () => {
    expect(findSelectedClaims(rows, null)).toBeNull()
    expect(findSelectedClaims(rows, { paperId: 'gone', fieldKey: 'objective' })).toBeNull()
  })

  it('View evidence exists only on extracted cells', () => {
    const view = (model: Parameters<typeof MatrixCellView>[0]['model'], onViewEvidence?: () => void) =>
      html(createElement(MatrixCellView, { model, expanded: false, onToggle: noop, label: 'Objective', paperTitle: 'Widget Paper', onViewEvidence }))
    const extracted = view({ kind: 'extracted', items: ['A'], first: 'A', more: 0 }, noop)
    expect(extracted).toContain('>View evidence<')
    expect(extracted).toContain('aria-label="View evidence for Objective of Widget Paper"')
    for (const kind of ['not_reported', 'failed', 'missing', 'malformed'] as const) {
      expect(view({ kind })).not.toContain('View evidence')
    }
  })

  it('desktop cells get a handler only when extracted, and it selects that paper + field', () => {
    const onViewEvidence = vi.fn()
    const tree = EvidenceMatrixTable({ rows, pendingIds: new Set<string>(), onRequest: noop, onViewEvidence, renderTitle: (p: Paper) => p.title })
    const cells = collect(tree, (e) => e.type === MatrixCell)
    expect(cells).toHaveLength(14)
    const withHandler = cells.filter((c) => (c.props as { onViewEvidence?: unknown }).onViewEvidence)
    expect(withHandler).toHaveLength(2)
    ;(withHandler[0].props as { onViewEvidence: () => void }).onViewEvidence()
    expect(onViewEvidence).toHaveBeenCalledWith({ paperId: P1, fieldKey: 'objective' })
  })

  it('mobile cards select through the same callback and payload', () => {
    const onViewEvidence = vi.fn()
    const tree = EvidenceMatrixCards({ rows, pendingIds: new Set<string>(), onRequest: noop, onViewEvidence, renderTitle: (p: Paper) => p.title })
    const buttons = collect(tree, (e) => String((e.props as { 'aria-label'?: string })['aria-label']).startsWith('View evidence for'))
    expect(buttons).toHaveLength(2)
    expect((buttons[0].props as { 'aria-label': string })['aria-label']).toBe('View evidence for Objective of Widget Paper')
    ;(buttons[0].props as { onClick: () => void }).onClick()
    expect(onViewEvidence).toHaveBeenCalledWith({ paperId: P1, fieldKey: 'objective' })
    // the card still shows the native details with the claims
    expect(html(createElement(EvidenceMatrixCards, { rows, pendingIds: new Set<string>(), onRequest: noop, onViewEvidence, renderTitle: (p: Paper) => p.title }))).toContain('<details')
  })
})

describe('lazy source query', () => {
  it('is disabled and builds no request while nothing is selected', () => {
    const closed = extractionSourcesForSelection(null)
    expect(closed.enabled).toBe(false)
    expect(closed.queryFn).toBe(skipToken)
    expect(closed.queryKey).toEqual(['evidence-matrix', 'sources', 'none'])
  })

  it('is enabled for a selection and uses that paper + field', async () => {
    api.listExtractionSources.mockResolvedValue([])
    const open = extractionSourcesForSelection({ paperId: P2, fieldKey: 'limitations' })
    expect(open.enabled).toBe(true)
    expect(open.queryKey).toEqual(evidenceKeys.sources(P2, 'limitations'))
    expect(typeof open.queryFn).toBe('function')
    await (open.queryFn as (c: unknown) => Promise<unknown>)({})
    expect(api.listExtractionSources).toHaveBeenCalledExactlyOnceWith(P2, 'limitations')
    api.listExtractionSources.mockClear()
  })

  it('a closed sheet fetches nothing', () => {
    api.listExtractionSources.mockClear()
    const qc = new QueryClient()
    const out = html(createElement(QueryClientProvider, { client: qc }, createElement(ClaimDetailSheet, { selected: null, onClose: noop })))
    expect(out).toBe('')
    expect(api.listExtractionSources).not.toHaveBeenCalled()
  })

  it('the tab loads no sources when it renders (only a selection would)', () => {
    api.listExtractionSources.mockClear()
    const qc = new QueryClient()
    html(createElement(QueryClientProvider, { client: qc }, createElement(EvidenceMatrixTab, { projectId: 'proj' })))
    expect(api.listExtractionSources).not.toHaveBeenCalled()
  })
})

describe('ClaimDetailBody', () => {
  it('shows the field, the paper, every claim and the heading structure', () => {
    const out = body({ sources: [source(0, 0), source(1, 0)] })
    expect(out).toContain('Objective')
    expect(out).toContain('Widget Paper')
    expect(out).toContain('First claim')
    expect(out).toContain('Second claim')
    expect(out).toMatch(/<h2[^>]*>Objective<\/h2>/)
    expect((out.match(/<h3[^>]*>Claim \d<\/h3>/g) ?? []).length).toBe(2)
    expect((out.match(/<h4[^>]*>Sources<\/h4>/g) ?? []).length).toBe(2)
    expect(out).toContain('aria-labelledby="claim-')
  })

  it('shows each source with section, humanized type, pages and excerpt', () => {
    const out = body({
      sources: [source(0, 0, { sectionTitle: 'Pre-training BERT', sectionType: 'related_work', pageStart: 3, pageEnd: 4, excerpt: 'BERT masks fifteen percent of tokens.' })],
    })
    expect(out).toContain('Pre-training BERT')
    expect(out).toContain('related work')
    expect(out).toContain('pp. 3–4')
    expect(out).toContain('BERT masks fifteen percent of tokens.')
  })

  it('lists several sources for one claim in ord order', () => {
    const out = body({ sources: [source(0, 1, { excerpt: 'Second source' }), source(0, 0, { excerpt: 'First source' })] })
    expect(out.indexOf('First source')).toBeLessThan(out.indexOf('Second source'))
  })

  it('says source details are unavailable for a claim without sources, and invents nothing', () => {
    const out = body({ sources: [source(0, 0)] })
    expect(out).toContain('Excerpt 0.0')
    expect((out.match(/Source details are unavailable for this claim\./g) ?? []).length).toBe(1)
    expect(body({ sources: [] })).toContain('Source details are unavailable for this claim.')
  })

  it('shows a loading indicator with text while the sources load, and no source section yet', () => {
    const out = body({ sources: undefined })
    expect(out).toContain('role="status"')
    expect(out).toContain('Loading sources…')
    expect(out).toContain('First claim')
    expect(out).not.toContain('Source details are unavailable')
    expect(out).not.toContain('>Sources<')
  })

  it('shows a textual error with a retry when the query fails, keeping the claims', () => {
    const out = body({ sources: undefined, error: new Error('Permission denied') })
    expect(out).toContain('role="alert"')
    expect(out).toContain('Permission denied')
    expect(out).toContain('Retry')
    expect(out).toContain('First claim')
    expect(out).not.toContain('Loading sources')
  })

  it('warns when the extraction is out of date, but still shows claims and sources', () => {
    const out = body({ sel: selected({ isStale: true }), sources: [source(0, 0)] })
    expect(out).toContain('role="note"')
    expect(out).toContain('Out of date.')
    expect(out).toContain('older version')
    expect(out).toContain('First claim')
    expect(out).toContain('Excerpt 0.0')
    expect(body({ sources: [] })).not.toContain('Out of date')
  })

  it('links to the internal paper route', () => {
    const out = body()
    expect(out).toContain(`href="/papers/${P1}"`)
    expect(out).toContain('data-to="/papers/$paperId"')
    expect(out).toContain('Open paper')
  })

  it('renders claims, the paper title and excerpts as text, never as HTML', () => {
    const evil = '<script>alert(1)</script> <b>x</b> <img src=x onerror=alert(1)>'
    const out = body({
      sel: selected({ paperTitle: evil, claims: [evil] }),
      sources: [source(0, 0, { excerpt: evil, sectionTitle: evil })],
    })
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('<img')
    expect(out).not.toMatch(/<b>x<\/b>/)
    expect(out).toContain('&lt;script&gt;')
  })

  it('never shows raw JSON or internal ids', () => {
    const out = body({ sources: [source(0, 0, { chunkId: 'chunk-uuid-secret', sectionId: 'section-uuid-secret' })] })
    expect(out).not.toMatch(/chunk-uuid-secret|section-uuid-secret|"items"|\{"text"/)
  })
})

describe('SourceCard', () => {
  const card = (over: Partial<ExtractionSource>) => html(createElement(SourceCard, { source: source(0, 0, over) }))

  it('shows title · type · pages and the excerpt', () => {
    const out = card({ sectionTitle: 'Introduction', sectionType: 'introduction', pageStart: 1, pageEnd: 2, excerpt: 'We study widgets.' })
    expect(out).toContain('Introduction')
    expect(out).toContain('pp. 1–2')
    expect(out).toContain('We study widgets.')
    expect(out).toContain('<blockquote')
  })

  it('falls back to the humanized section type when the title is empty', () => {
    const out = card({ sectionTitle: '   ', sectionType: 'related_work' })
    expect(out).toContain('related work')
    expect(out).not.toContain('Section 0.0')
  })

  it('omits the page label instead of inventing one, and a single page reads "p. N"', () => {
    expect(card({ pageStart: null, pageEnd: null })).not.toMatch(/\bp+\. /)
    expect(card({ pageStart: 5, pageEnd: 5 })).toContain('p. 5')
    expect(card({ pageStart: 5, pageEnd: null })).toContain('p. 5')
  })

  it('does not repeat the type when the title already says it', () => {
    const out = card({ sectionTitle: 'Abstract', sectionType: 'abstract' })
    expect((out.match(/[Aa]bstract/g) ?? []).length).toBe(1)
  })

  it('says so when there is no excerpt, and preserves line breaks via CSS', () => {
    expect(card({ excerpt: null })).toContain('No excerpt available.')
    expect(card({ excerpt: '  ' })).toContain('No excerpt available.')
    expect(card({ excerpt: 'line one\nline two' })).toContain('whitespace-pre-line')
  })
})

describe('shared formatting helpers', () => {
  it('formatPages and humanize come from the shared module', () => {
    expect(formatPages(1, 2)).toBe('pp. 1–2')
    expect(formatPages(3, 3)).toBe('p. 3')
    expect(formatPages(null, 4)).toBeNull()
    expect(humanize('future_work')).toBe('future work')
  })
})

describe('accessibility and regression', () => {
  it('extraction actions keep their visible labels but have clearer accessible names', () => {
    expect(actionAriaLabel('extract', 'W')).toBe('Extract evidence for W')
    expect(actionAriaLabel('update', 'W')).toBe('Update evidence for W')
    expect(actionAriaLabel('retry', 'W')).toBe('Retry evidence extraction for W')
    expect(actionAriaLabel('extract', 'W')).not.toMatch(/extraction for/)
  })

  it('the matrix still has seven field columns and the cell shows View evidence as a real button', () => {
    expect(FIELD_KEYS).toHaveLength(7)
    const out = html(createElement(MatrixCell, { model: { kind: 'extracted', items: ['A', 'B'], first: 'A', more: 1 }, label: 'Objective', paperTitle: 'W', onViewEvidence: noop }))
    expect(out).toMatch(/<button[^>]*aria-label="View evidence for Objective of W"/)
    expect(out).toContain('+1 more')
  })

  it('UI files never touch Supabase, never request extraction implicitly, and use the shared sheet', () => {
    const root = new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const dir = join(root, 'src/features/evidence-matrix/ui')
    const strip = (t: string) => t.replace(/\r\n/g, '\n').replace(/\/\*[^]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const code = strip(readFileSync(join(dir, f), 'utf8'))
      expect(code, f).not.toMatch(/supabase|\.rpc\(|\.from\(|useEffect|requestPaperExtraction/i)
    }
    const sheet = strip(readFileSync(join(dir, 'claim-detail-sheet.tsx'), 'utf8'))
    expect(sheet).toContain("from '#/components/ui/sheet'")
    expect(sheet).toContain('extractionSourcesForSelection')
    // no signed URLs or storage access from the sheet
    expect(strip(readFileSync(join(dir, 'claim-detail-body.tsx'), 'utf8'))).not.toMatch(/storage|signed|getPaperUrl/i)
  })
})
