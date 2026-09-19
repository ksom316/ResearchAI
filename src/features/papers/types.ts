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
  created_at: string
}
