import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QueryError } from '#/components/query-error'
import type { InspectorFinding } from '../types'
import { QualityInspectorView } from './quality-inspector-view'

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('#/test/router-link-mock')).RouterLinkMock,
}))

const finding = (
  severity: InspectorFinding['severity'],
  kind = `kind-${severity}`,
): InspectorFinding => ({
  id: `workspace:${kind}:p1`, scope: 'workspace', kind, severity,
  title: `${severity} title`, message: `${severity} message`,
  relatedPaperIds: ['p1'], relatedUnitIds: [],
})

describe('Quality Inspector workspace UI', () => {
  it('renders every severity with text labels and affected paper context', () => {
    const out = renderToStaticMarkup(createElement(QualityInspectorView, {
      findings: [finding('significant'), finding('attention'), finding('info')],
      paperTitles: new Map([['p1', 'A long paper title']]), onNavigate: vi.fn(),
    }))
    expect(out).toContain('Significant')
    expect(out).toContain('Attention')
    expect(out).toContain('Info')
    expect(out).toContain('Affected paper')
    expect(out).toContain('A long paper title')
    expect(out).toContain('not an overall quality score')
  })

  it('preserves safe not_reported language and relevant actions', () => {
    const safe = finding('info', 'matrix_field_not_reported')
    safe.message = 'No source-backed item was extracted. This does not prove that the information is absent from the paper.'
    safe.actionTarget = { type: 'workspace', tab: 'evidence-matrix' }
    const metadata = finding('info', 'citation_metadata_incomplete')
    metadata.actionTarget = { type: 'paper', paperId: 'p1' }
    const out = renderToStaticMarkup(createElement(QualityInspectorView, {
      findings: [safe, metadata], paperTitles: new Map([['p1', 'Paper']]), onNavigate: vi.fn(),
    }))
    expect(out).toContain('does not prove that the information is absent')
    expect(out).toContain('Open Evidence Matrix')
    expect(out).toContain('Review citation metadata')
    expect(out).toContain('/papers/p1')
  })

  it('renders a cautious no-finding state', () => {
    const out = renderToStaticMarkup(createElement(QualityInspectorView, {
      findings: [], paperTitles: new Map(), onNavigate: vi.fn(),
    }))
    expect(out).toContain('No attention items identified')
    expect(out).toContain('not a score or proof of research quality')
  })

  it('uses a safe accessible retrieval error', () => {
    const out = renderToStaticMarkup(createElement(QueryError, {
      error: new Error('Research quality data could not be loaded.'),
    }))
    expect(out).toContain('role="alert"')
    expect(out).toContain('Research quality data could not be loaded.')
  })

  it('keeps the workspace tab responsive and loading state accessible', async () => {
    const fs = await import('node:fs')
    const tabs = fs.readFileSync('src/features/projects/workspace/tabs.ts', 'utf8')
    const workspace = fs.readFileSync('src/features/projects/workspace/project-workspace.tsx', 'utf8')
    const tab = fs.readFileSync('src/features/quality-inspector/ui/quality-inspector-tab.tsx', 'utf8')
    const view = fs.readFileSync('src/features/quality-inspector/ui/quality-inspector-view.tsx', 'utf8')
    expect(tabs).toContain("value: 'quality-inspector', label: 'Quality Inspector'")
    expect(workspace).toContain('<TabsContent value="quality-inspector"')
    expect(workspace).toContain('sm:overflow-x-auto')
    expect(tab).toContain('aria-busy="true"')
    expect(tab).toContain('aria-label="Loading quality findings"')
    expect(view).toContain('grid-cols-1')
    expect(view).toContain('break-words')
    expect(view).toContain('aria-labelledby')
  })
})
