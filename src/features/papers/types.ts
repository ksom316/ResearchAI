export type PaperStatus = 'uploaded' | 'processing' | 'ready' | 'failed'

export type Paper = {
  id: string
  project_id: string | null
  title: string
  authors: string[]
  publication_year: number | null
  original_filename: string | null
  mime_type: string | null
  storage_path: string | null
  file_size_bytes: number | null
  status: PaperStatus
  created_at: string
}
