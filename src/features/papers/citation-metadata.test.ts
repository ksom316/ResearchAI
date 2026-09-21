import { describe, expect, it } from 'vitest'
import {
  citationMetadataToUpdateColumns,
  paperRowToCitationMetadata,
} from './citation-metadata'

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Stored paper title',
  authors: ['Author One'],
  publication_year: 2024,
  citation_title: null,
  citation_container_title: null,
  citation_publisher: null,
  citation_doi: null,
  citation_url: null,
  citation_volume: null,
  citation_issue: null,
  citation_pages: null,
}

describe('paper citation metadata mapping', () => {
  it('uses citation_title with stored paper title as the explicit fallback', () => {
    expect(paperRowToCitationMetadata(row).title).toBe('Stored paper title')
    expect(
      paperRowToCitationMetadata({ ...row, citation_title: 'Citation title' })
        .title,
    ).toBe('Citation title')
  })

  it('maps every citation field without a Supabase row dependency', () => {
    expect(
      paperRowToCitationMetadata({
        ...row,
        citation_container_title: 'Journal',
        citation_publisher: 'Publisher',
        citation_doi: '10.1000/EXAMPLE',
        citation_url: 'https://example.org/paper',
        citation_volume: '8',
        citation_issue: '2',
        citation_pages: '10–20',
      }),
    ).toEqual({
      paperId: row.id,
      title: 'Stored paper title',
      authors: ['Author One'],
      publicationYear: 2024,
      containerTitle: 'Journal',
      publisher: 'Publisher',
      doi: '10.1000/example',
      url: 'https://example.org/paper',
      volume: '8',
      issue: '2',
      pages: '10–20',
    })
  })

  it('creates an explicit citation-only update payload', () => {
    expect(
      citationMetadataToUpdateColumns({
        paperId: row.id,
        title: ' Citation title ',
        authors: [' Author One ', 'Organization'],
        publicationYear: 2025,
        doi: 'doi: 10.1000/Test',
      }),
    ).toEqual({
      authors: ['Author One', 'Organization'],
      publication_year: 2025,
      citation_title: 'Citation title',
      citation_container_title: null,
      citation_publisher: null,
      citation_doi: '10.1000/test',
      citation_url: null,
      citation_volume: null,
      citation_issue: null,
      citation_pages: null,
    })
  })
})
