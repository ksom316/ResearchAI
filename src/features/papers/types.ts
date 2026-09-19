export type PaperStatus = 'uploaded' | 'processing' | 'ready' | 'failed'

export type Paper = {
  id: string
  project_ids: string[]
  title: string
  authors: string[]
  publication_year: number | null
  original_filename: string | null
  mime_type: string | null
  storage_path: string | null
  content_hash: string | null
  file_size_bytes: number | null
  status: PaperStatus
  page_count: number | null
  processing_error: string | null
  created_at: string
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
