import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import type { Paper } from './types'

const COLUMNS =
  'id, project_id, title, authors, publication_year, file_size_bytes, status, created_at'

export async function listPapers(options?: {
  projectId?: string
  limit?: number
}): Promise<Paper[]> {
  let query = getSupabaseBrowserClient()
    .from('papers')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
  if (options?.projectId) query = query.eq('project_id', options.projectId)
  if (options?.limit) query = query.limit(options.limit)
  const { data, error } = await query
  if (error) throw error
  return data as Paper[]
}

export async function getLibraryStats() {
  const { data, error } = await getSupabaseBrowserClient()
    .from('papers')
    .select('file_size_bytes')
  if (error) throw error
  const rows = data as { file_size_bytes: number | null }[]
  return {
    paperCount: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + (row.file_size_bytes ?? 0), 0),
  }
}
