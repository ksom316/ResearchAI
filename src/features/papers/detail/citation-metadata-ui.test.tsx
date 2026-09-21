import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { Paper } from '../types'
import { CitationMetadataCard } from './citation-metadata-card'

const root = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (relative: string) => readFileSync(join(root, relative), 'utf8')

const paper: Paper = {
  id: '11111111-1111-4111-8111-111111111111',
  project_ids: [],
  title: 'Stored title',
  authors: [],
  publication_year: null,
  citation_title: null,
  citation_container_title: null,
  citation_publisher: null,
  citation_doi: null,
  citation_url: null,
  citation_volume: null,
  citation_issue: null,
  citation_pages: null,
  original_filename: 'filename.pdf',
  mime_type: 'application/pdf',
  storage_path: null,
  content_hash: null,
  file_size_bytes: null,
  status: 'ready',
  page_count: 2,
  processing_error: null,
  created_at: '2026-01-01T00:00:00Z',
}

function render(value: Paper) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(CitationMetadataCard, { paper: value }),
    ),
  )
}

describe('Citation metadata paper-detail UI', () => {
  it('shows a deterministic preview and missing-field indicator', () => {
    const html = render(paper)
    expect(html).toContain('[1] “Stored title.”')
    expect(html).toContain('Incomplete citation metadata')
    expect(html).toContain('Missing: authors, publication year.')
    expect(html).not.toContain('filename.pdf')
  })

  it('shows complete-enough state for title, author, and year', () => {
    const html = render({
      ...paper,
      citation_title: 'Citation title',
      authors: ['Research Organization'],
      publication_year: 2024,
    })
    expect(html).toContain('Complete enough')
    expect(html).toContain(
      '[1] Research Organization, “Citation title,” 2024.',
    )
    expect(html).not.toContain('Missing:')
  })

  it('provides explicit save/cancel/errors and mobile-safe layout markers', () => {
    const source = read('features/papers/detail/citation-metadata-card.tsx')
    expect(source).toContain('Save citation metadata')
    expect(source).toContain('Cancel')
    expect(source).toContain('role="alert"')
    expect(source).toContain('max-h-[90vh]')
    expect(source).toContain('overflow-y-auto')
    expect(source).toContain('min-w-0')
    expect(source).toContain('break-words')
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })

  it('prepopulates persisted values and restores them on cancel', () => {
    const source = read('features/papers/detail/citation-metadata-card.tsx')
    expect(source).toContain('useState(() => formFromPaper(paper))')
    expect(source).toMatch(/function close\(\)[\s\S]*setForm\(formFromPaper\(paper\)\)/)
    expect(source).toContain("paper.citation_title ?? ''")
    expect(source).toContain("paper.authors.join('\\n')")
  })
})
