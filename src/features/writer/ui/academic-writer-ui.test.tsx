import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WORKSPACE_TABS } from '#/features/projects/workspace/tabs'
import { GroundedDraftView } from './grounded-draft-view'
import { WriterConfiguration } from './writer-configuration'
import type { GroundedDraft } from '../types'

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('#/test/router-link-mock')).RouterLinkMock,
}))

const root = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (relative: string) => readFileSync(join(root, relative), 'utf8')

const papers = Array.from({ length: 2 }, (_, index) => ({
  id: `${index + 1}`,
  project_ids: ['project'],
  title: `A very long paper title ${index + 1}`,
  authors: [], publication_year: null, citation_title: null,
  citation_container_title: null, citation_publisher: null, citation_doi: null,
  citation_url: null, citation_volume: null, citation_issue: null,
  citation_pages: null, original_filename: null, mime_type: null,
  storage_path: null, content_hash: null, file_size_bytes: null,
  status: 'ready' as const, page_count: null, processing_error: null, created_at: '',
}))

const draft: GroundedDraft = {
  title: 'Findings synthesis', mode: 'findings_synthesis',
  paragraphs: [{ units: [{ id: 'U1', text: 'Grounded result.', citationIds: ['W1', 'W2'] }] }],
  citations: [
    { id: 'W1', paperId: '1', paperTitle: 'First paper', locator: { kind: 'chunk', paperId: '1', chunkId: 'c1', sectionId: 's1' }, sources: [] },
    { id: 'W2', paperId: '1', paperTitle: 'First paper', locator: { kind: 'chunk', paperId: '1', chunkId: 'c2', sectionId: 's1' }, sources: [] },
  ],
  references: [{
    number: 1, paperId: '1', evidenceIds: ['W1', 'W2'],
    metadata: {
      paperId: '1', title: 'First paper', authors: [], publicationYear: null,
      containerTitle: null, publisher: null, doi: null, url: null,
      volume: null, issue: null, pages: null,
    },
  }],
  coverage: { projectPaperCount: 2, selectedPaperCount: 0, participatingPaperCount: 1, unavailablePaperCount: 1, evidenceItemCount: 2 },
}

describe('Academic Writer UI', () => {
  it('registers Academic Writer in the existing workspace slot and keeps overflow safeguards', () => {
    expect(WORKSPACE_TABS.find((tab) => tab.value === 'writing')?.label).toBe('Academic Writer')
    const workspace = read('features/projects/workspace/project-workspace.tsx')
    expect(workspace).toContain('<AcademicWriterTab key={project.id} projectId={project.id} />')
    expect(workspace).toContain('sm:overflow-x-auto')
    expect(workspace).toContain('sm:flex-none')
  })

  it('renders exactly five accessible mode choices and no gap candidate control', () => {
    const html = renderToStaticMarkup(createElement(WriterConfiguration, {
      value: { mode: 'literature_synthesis', focus: '', paperIds: [] },
      papers, disabled: false, onChange: () => undefined,
    }))
    expect((html.match(/role="radio"/g) ?? []).length).toBe(5)
    expect(html).toContain('Focus or topic')
    expect(html).not.toContain('Gap candidate')
  })

  it('renders structured units with global numeric citation buttons, not internal ids', () => {
    const html = renderToStaticMarkup(createElement(GroundedDraftView, {
      projectId: '11111111-1111-4111-8111-111111111111',
      draft, onSelectCitation: () => undefined,
    }))
    expect(html).toContain('Grounded result.')
    expect(html).toContain('>[1]</button>')
    expect((html.match(/>\[1\]<\/button>/g) ?? []).length).toBe(1)
    expect(html).not.toContain('>[2]</button>')
    expect(html).not.toContain('>W1<')
    expect(html).not.toContain('>U1<')
    expect(html).toContain('break-words')
    expect(html).toContain('>Check support</button>')
    expect(html).toContain('>References</h3>')
    expect(html).toContain('Incomplete citation metadata')
    expect(html).toContain('View cited evidence for reference 1')
    expect(html).toContain('Open paper for reference 1')
    expect(html).toContain('h-9 min-w-9')
    expect(html).toContain('sm:h-6 sm:min-w-7')
    expect(html).toContain('ml-1 h-9')
    expect(html).toContain('sm:h-7')
  })

  it('collapses visible same-paper markers without collapsing Claim Checker evidence', () => {
    const presentation = read('features/writer/ui/grounded-draft-view.tsx')
    expect(presentation).toContain('groupUnitCitationsByPaper(draft, unit.citationIds)')
    expect(presentation).toContain('unit.citationIds.flatMap')
    expect(presentation).toContain('citations: group.citations')
    const checker = read('features/claim-checker/ui/claim-check-button.tsx')
    expect(checker).toContain('citations.map(({ citation })')
    expect(checker).toContain('citationId: citation.id')
    expect(checker).toContain('locator: citation.locator')
  })

  it('keeps provenance lazy and exposes accessible Sheet and Open paper wiring', () => {
    const sheet = read('features/writer/ui/writer-citation-sheet.tsx')
    expect(sheet).toContain("getWriterCitationProvenanceFn")
    expect(sheet).toContain('<SheetTitle')
    expect(sheet).toContain('<SheetDescription>')
    expect(sheet).toContain('Open paper')
    expect(sheet).toContain('overflow-y-auto')
    expect(sheet).toContain('Cited evidence items')
    expect(sheet).toContain('setActiveId')
  })

  it('browser generation sends only the normalized request to the server function', () => {
    const tab = read('features/writer/ui/academic-writer-tab.tsx')
    expect(tab).toContain('generateWriterDraftFn({ data: request })')
    expect(tab).not.toMatch(/userId|providerOptions|evidencePacket/)
  })
})
