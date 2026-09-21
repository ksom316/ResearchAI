import {
  normalizePaperCitationMetadata,
} from '#/features/citations/normalize'
import type {
  PaperCitationMetadata,
  PaperCitationMetadataInput,
} from '#/features/citations/types'

export type CitationMetadataPaperRow = {
  id: string
  title: string
  authors: string[]
  publication_year: number | null
  citation_title: string | null
  citation_container_title: string | null
  citation_publisher: string | null
  citation_doi: string | null
  citation_url: string | null
  citation_volume: string | null
  citation_issue: string | null
  citation_pages: string | null
}

export type CitationMetadataUpdateColumns = {
  authors: string[]
  publication_year: number | null
  citation_title: string | null
  citation_container_title: string | null
  citation_publisher: string | null
  citation_doi: string | null
  citation_url: string | null
  citation_volume: string | null
  citation_issue: string | null
  citation_pages: string | null
}

/** Explicit database-row boundary; original_filename is intentionally absent. */
export function paperRowToCitationMetadata(
  paper: CitationMetadataPaperRow,
): PaperCitationMetadata {
  return normalizePaperCitationMetadata({
    paperId: paper.id,
    title: paper.citation_title ?? paper.title,
    authors: paper.authors,
    publicationYear: paper.publication_year,
    containerTitle: paper.citation_container_title,
    publisher: paper.citation_publisher,
    doi: paper.citation_doi,
    url: paper.citation_url,
    volume: paper.citation_volume,
    issue: paper.citation_issue,
    pages: paper.citation_pages,
  })
}

export function citationMetadataToUpdateColumns(
  metadata: PaperCitationMetadataInput,
): CitationMetadataUpdateColumns {
  const normalized = normalizePaperCitationMetadata(metadata)
  return {
    authors: normalized.authors,
    publication_year: normalized.publicationYear,
    citation_title: normalized.title || null,
    citation_container_title: normalized.containerTitle,
    citation_publisher: normalized.publisher,
    citation_doi: normalized.doi,
    citation_url: normalized.url,
    citation_volume: normalized.volume,
    citation_issue: normalized.issue,
    citation_pages: normalized.pages,
  }
}
