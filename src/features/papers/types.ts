export type PaperStatus = 'uploaded' | 'processing' | 'ready' | 'failed'

/** R12: deterministic document classification, mirrors papers.document_type. */
export type DocumentType =
  | 'academic'
  | 'financial'
  | 'annual_report'
  | 'government'
  | 'policy'
  | 'technical'
  | 'market_research'
  | 'thesis'
  | 'case_study'
  | 'survey'
  | 'general_report'
  | 'unknown'

/** R12: how much the extracted text can be trusted, mirrors papers.extraction_quality. */
export type ExtractionQuality =
  | 'successful'
  | 'partial'
  | 'poor'
  | 'no_extractable_text'
  | 'ocr_required'

export type Paper = {
  id: string
  project_ids: string[]
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
  original_filename: string | null
  mime_type: string | null
  storage_path: string | null
  content_hash: string | null
  file_size_bytes: number | null
  status: PaperStatus
  page_count: number | null
  processing_error: string | null
  created_at: string
  /** R12. Optional so existing fixtures/tests built before document intelligence still type-check. */
  document_type?: DocumentType | null
  document_type_confidence?: number | null
  extraction_quality?: ExtractionQuality | null
}

/** One entry of a paper's document outline. The section text is deliberately not loaded. */
export type PaperSection = {
  id: string
  position: number
  title: string
  section_type: string
  page_start: number | null
  page_end: number | null
}
