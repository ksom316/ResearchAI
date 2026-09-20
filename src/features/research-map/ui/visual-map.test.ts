import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { evidenceKeys } from '#/features/evidence-matrix/queries'
import { papersQuery } from '#/features/papers/queries'
import type { Paper } from '#/features/papers/types'
import type { ExtractionField, ExtractionOverview } from '#/features/evidence-matrix/types'
import { MAX_GRAPH_NODES } from '../graph-view-model'
import { FindingFlowNode, PaperFlowNode, TermFlowNode } from './graph-nodes'
import { ResearchMapTab } from './research-map-tab'
import { VisualMap } from './visual-map'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: ReactNode; to: string; params?: { paperId: string } }) =>
    createElement(
      'a',
      { href: props.to.replace('$paperId', props.params?.paperId ?? '') },
      props.children,
    ),
}))

const html = (el: ReactElement) => renderToStaticMarkup(el)
const noop = () => undefined

const paper = (id: string, title: string): Paper => ({
  id, project_ids: ['proj'], title, authors: [], publication_year: null, original_filename: null,
  mime_type: null, storage_path: null, content_hash: null, file_size_bytes: null, status: 'ready',
  page_count: null, processing_error: null, created_at: '2026-01-01T00:00:00Z',
})
const overview = (paperId: string): ExtractionOverview => ({
  paperId, schemaVersion: 1, status: 'complete', sourceCompletedAt: 'a', completedAt: 'b',
  provider: null, model: null, createdAt: 'c', updatedAt: 'd', isStale: false,
})
const field = (paperId: string, fieldKey: ExtractionField['fieldKey'], texts: string[]): ExtractionField => ({
  paperId, schemaVersion: 1, fieldKey, state: 'extracted', items: texts.map((text) => ({ text })),
  itemsMalformed: false, createdAt: 'x', updatedAt: 'y',
})

describe('VisualMap: presentation states', () => {
  it('renders a calm message, not an error, for an empty graph', () => {
    const out = html(createElement(VisualMap, { graph: { kind: 'empty' }, onViewEvidence: noop, onSwitchToIndex: noop }))
    expect(out).toContain('Nothing to show')
    expect(out).not.toMatch(/role="alert"/)
  })

  it('offers to switch to the Relationship Index when the graph is too large', () => {
    const out = html(
      createElement(VisualMap, {
        graph: { kind: 'too_large', nodeCount: 200, limit: MAX_GRAPH_NODES },
        onViewEvidence: noop,
        onSwitchToIndex: noop,
      }),
    )
    expect(out).toContain('Too many relationships to graph')
    expect(out).toContain(String(MAX_GRAPH_NODES))
    expect(out).toContain('Relationship Index')
  })

  it('renders the React Flow wrapper and controls for a real graph', () => {
    // React Flow defers actual node/edge markup to a client-side effect (its internal
    // store is populated on mount), so renderToStaticMarkup never shows node content —
    // only the wrapper, background and controls. Node CONTENT is tested directly below,
    // against the plain node components React Flow renders with.
    const out = html(
      createElement(VisualMap, {
        graph: {
          kind: 'graph',
          nodes: [
            { id: 'graph-paper:p1', kind: 'paper', position: { x: 0, y: 220 }, data: { label: 'test research', isStale: false } },
          ],
          edges: [],
        },
        onViewEvidence: noop,
        onSwitchToIndex: noop,
      }),
    )
    expect(out).toContain('data-testid="rf__wrapper"')
    expect(out).toContain('data-testid="rf__controls"')
    expect(out).toContain('Click a paper or a shared term')
  })
})

describe('graph node components (rendered directly, as React Flow renders them client-side)', () => {
  // <Handle> needs a ReactFlowProvider ancestor even outside the full canvas.
  const renderNode = (el: ReactElement) => html(createElement(ReactFlowProvider, null, el))
  const nodeProps = (data: Record<string, unknown>, selected = false) => ({
    data,
    selected,
    id: 'n',
    type: 'x',
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  })

  it('a paper node shows the "Paper" kind label and title, and is the visually dominant style', () => {
    const out = renderNode(createElement(PaperFlowNode, nodeProps({ label: 'test research', isStale: false }) as never))
    expect(out).toContain('Paper')
    expect(out).toContain('test research')
    expect(out).toMatch(/border-2/) // visually dominant vs. term/finding nodes
  })

  it('a term node shows its kind as TEXT, not just color, and its connected-paper count', () => {
    const out = renderNode(
      createElement(TermFlowNode, nodeProps({ label: 'BERT', isStale: false, paperCount: 2, kind: 'methodology' }) as never),
    )
    expect(out).toContain('Method')
    expect(out).toContain('BERT')
    expect(out).toContain('2 papers')
  })

  it('concept vs dataset term nodes carry different kind text', () => {
    const concept = renderNode(createElement(TermFlowNode, nodeProps({ label: 'X', isStale: false, paperCount: 2, kind: 'concept' }) as never))
    const dataset = renderNode(createElement(TermFlowNode, nodeProps({ label: 'X', isStale: false, paperCount: 2, kind: 'dataset' }) as never))
    expect(concept).toContain('Concept')
    expect(dataset).toContain('Dataset')
  })

  it('a finding node shows the "Finding" label and the (already-truncated) text', () => {
    const out = renderNode(createElement(FindingFlowNode, nodeProps({ label: 'Accuracy improved…', isStale: false }) as never))
    expect(out).toContain('Finding')
    expect(out).toContain('Accuracy improved…')
  })

  it('a stale node is marked with BOTH an icon and text, never color alone', () => {
    const out = renderNode(createElement(PaperFlowNode, nodeProps({ label: 'Old Paper', isStale: true }) as never))
    expect(out).toContain('aria-label="out of date"')
    expect(out).toMatch(/<svg[^>]*aria-label="out of date"/)
  })

  it('a selected node gets a visibly distinct style', () => {
    const plain = renderNode(createElement(PaperFlowNode, nodeProps({ label: 'A', isStale: false }, false) as never))
    const selected = renderNode(createElement(PaperFlowNode, nodeProps({ label: 'A', isStale: false }, true) as never))
    expect(selected).not.toBe(plain)
    expect(selected).toMatch(/ring-primary/)
  })

  it('a dimmed (out-of-neighborhood) node gets reduced opacity', () => {
    const out = renderNode(createElement(PaperFlowNode, nodeProps({ label: 'A', isStale: false, dimmed: true }) as never))
    expect(out).toMatch(/opacity-30/)
  })
})

describe('ResearchMapTab: graph/index switching', () => {
  const papersKey = papersQuery({ projectId: 'proj' }).queryKey
  const render = (seed: (qc: QueryClient) => void) => {
    const qc = new QueryClient()
    seed(qc)
    return html(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(ResearchMapTab, { projectId: 'proj' }),
      ),
    )
  }
  const seedBertLike = (qc: QueryClient) => {
    qc.setQueryData(papersKey, [paper('p1', 'test research'), paper('p2', 'RoBERTa')])
    qc.setQueryData(evidenceKeys.overview(['p1', 'p2']), [overview('p1'), overview('p2')])
    qc.setQueryData(evidenceKeys.fields(['p1', 'p2']), [
      field('p1', 'methodology', ['We build on BERT.']),
      field('p2', 'methodology', ['We reimplement BERT.']),
    ])
  }

  it('mobile view (md:hidden) always renders the structured index, never the graph canvas', () => {
    const out = render(seedBertLike)
    const mobileBlock = out.slice(out.indexOf('class="md:hidden"'), out.indexOf('class="hidden space-y-4 md:block"'))
    expect(mobileBlock).toContain('Relationships')
    expect(mobileBlock).toContain('Papers')
    expect(mobileBlock).not.toContain('react-flow')
  })

  it('desktop/tablet block defaults to the graph and offers an explicit switcher to the index', () => {
    const out = render(seedBertLike)
    const desktopBlock = out.slice(out.indexOf('class="hidden space-y-4 md:block"'))
    expect(desktopBlock).toContain('Visual Map')
    expect(desktopBlock).toContain('Relationship Index')
    expect(desktopBlock).toMatch(/aria-pressed="true"[^>]*>\s*Visual Map/)
    expect(desktopBlock).toContain('react-flow')
  })

  it('a findings toggle is offered only in graph mode', () => {
    const out = render(seedBertLike)
    const desktopBlock = out.slice(out.indexOf('class="hidden space-y-4 md:block"'))
    expect(desktopBlock).toContain('Show findings')
  })
})
