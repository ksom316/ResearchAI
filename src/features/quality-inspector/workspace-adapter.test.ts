import { describe, expect, it } from 'vitest'
import type { Paper } from '#/features/papers/types'
import { buildWorkspaceInspectorInput } from './workspace-adapter'

const paper: Paper = {
  id: 'p1', project_ids: ['project'], title: 'Stored title', authors: ['A'],
  publication_year: 2024, citation_title: 'Citation title',
  citation_container_title: null, citation_publisher: null, citation_doi: null,
  citation_url: null, citation_volume: null, citation_issue: null,
  citation_pages: null, original_filename: 'ignored.pdf', mime_type: 'application/pdf',
  storage_path: null, content_hash: null, file_size_bytes: null, status: 'ready',
  page_count: 1, processing_error: null, created_at: '2026-01-01',
}

describe('workspace inspector input mapping', () => {
  it('joins existing paper, Matrix, and coverage state and uses the citation mapper', () => {
    const overview = {
      paperId: 'p1', schemaVersion: 1, status: 'complete' as const,
      sourceCompletedAt: 'now', completedAt: 'now', provider: null, model: null,
      createdAt: 'now', updatedAt: 'now', isStale: false,
    }
    const field = {
      paperId: 'p1', schemaVersion: 1, fieldKey: 'findings' as const,
      state: 'extracted' as const, items: [{ text: 'Finding' }],
      itemsMalformed: false, createdAt: 'now', updatedAt: 'now',
    }
    const input = buildWorkspaceInspectorInput({
      papers: [paper], overviews: [overview], fields: [field],
      coverage: [{ paperId: 'p1', paperTitle: 'Stored title', state: 'searchable', chunkCount: 3 }],
    })
    expect(input.papers[0]).toMatchObject({
      paperId: 'p1', status: 'ready', matrixOverview: overview,
      matrixFields: [field], searchCoverage: { state: 'searchable' },
      citationMetadata: { title: 'Citation title' },
    })
  })
})
