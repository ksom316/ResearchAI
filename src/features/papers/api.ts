import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getSignedUrl, removeObject, uploadObject } from './storage'
import type { Paper } from './types'
import { PDF_MIME, sanitizeFilename, titleFromFilename } from './validation'

const COLUMNS =
  'id, project_id, title, authors, publication_year, original_filename, mime_type, storage_path, file_size_bytes, status, created_at'

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

/**
 * Upload a PDF, then create its record. If the record insert fails the
 * uploaded object is removed so no orphan file is left behind.
 */
export async function uploadPaper(input: {
  file: File
  projectId: string | null
  onProgress?: (fraction: number) => void
}): Promise<Paper> {
  const supabase = getSupabaseBrowserClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('Your session has expired. Please sign in again.')
  }
  const userId = userData.user.id
  const paperId = crypto.randomUUID()
  const path = `${userId}/${paperId}/${sanitizeFilename(input.file.name)}`

  await uploadObject(path, input.file, input.onProgress)

  const { data, error } = await supabase
    .from('papers')
    .insert({
      id: paperId,
      user_id: userId,
      project_id: input.projectId,
      title: titleFromFilename(input.file.name),
      original_filename: input.file.name.slice(0, 255),
      mime_type: PDF_MIME,
      storage_path: path,
      file_size_bytes: input.file.size,
      status: 'uploaded',
    })
    .select(COLUMNS)
    .single()

  if (error) {
    await removeObject(path).catch(() => undefined)
    throw new Error(`Couldn’t save the paper record: ${error.message}`)
  }
  return data as Paper
}

/** Assign to a project, or pass null to unlink. Never touches the file. */
export async function setPaperProject(
  paperId: string,
  projectId: string | null,
): Promise<void> {
  const { error } = await getSupabaseBrowserClient()
    .from('papers')
    .update({ project_id: projectId })
    .eq('id', paperId)
  if (error) throw error
}

/**
 * Delete the file first, then the record. If file deletion fails the record
 * is kept so the user can retry; if the record delete fails after the file is
 * gone, a retry succeeds (removing a missing object is not an error).
 */
export async function deletePaper(paper: Paper): Promise<void> {
  if (paper.storage_path) {
    try {
      await removeObject(paper.storage_path)
    } catch (e) {
      const detail = e instanceof Error ? e.message : ''
      throw new Error(
        `Couldn’t delete the PDF file, so the paper was kept. ${detail}`.trim(),
      )
    }
  }
  const { error } = await getSupabaseBrowserClient()
    .from('papers')
    .delete()
    .eq('id', paper.id)
  if (error) {
    throw new Error(
      `The file was removed but the record couldn’t be deleted. Try deleting again. ${error.message}`,
    )
  }
}

export async function getPaperUrl(paper: Paper): Promise<string> {
  if (!paper.storage_path) throw new Error('This paper has no PDF file.')
  return getSignedUrl(paper.storage_path)
}
