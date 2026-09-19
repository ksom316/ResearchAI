import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getSignedUrl, removeObject, uploadObject } from './storage'
import type { Paper, PaperSection } from './types'
import {
  PDF_MIME,
  hashFile,
  sanitizeFilename,
  titleFromFilename,
} from './validation'

const COLUMNS =
  'id, title, authors, publication_year, original_filename, mime_type, storage_path, content_hash, file_size_bytes, status, page_count, processing_error, created_at'

type PaperRow = Omit<Paper, 'project_ids'> & {
  paper_project_links: { project_id: string }[]
}

function toPaper({ paper_project_links, ...rest }: PaperRow): Paper {
  return { ...rest, project_ids: paper_project_links.map((l) => l.project_id) }
}

export async function listPapers(options?: {
  projectId?: string
  limit?: number
}): Promise<Paper[]> {
  const projectId = options?.projectId
  // With a project filter the embed is an inner join, so only linked papers return.
  let query = getSupabaseBrowserClient()
    .from('papers')
    .select(
      projectId
        ? `${COLUMNS}, paper_project_links!inner(project_id)`
        : `${COLUMNS}, paper_project_links(project_id)`,
    )
    .order('created_at', { ascending: false })
  if (projectId) query = query.eq('paper_project_links.project_id', projectId)
  if (options?.limit) query = query.limit(options.limit)
  const { data, error } = await query
  if (error) throw error
  return (data as unknown as PaperRow[]).map(toPaper)
}

/** One paper (RLS limits this to the owner), or null if it doesn't exist / isn't theirs. */
export async function getPaper(id: string): Promise<Paper | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('papers')
    .select(`${COLUMNS}, paper_project_links(project_id)`)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? toPaper(data) : null
}

/** Outline entries only (no section text), in document order. Read-only under RLS. */
export async function listPaperSections(
  paperId: string,
): Promise<PaperSection[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('paper_sections')
    .select('id, position, title, section_type, page_start, page_end')
    .eq('paper_id', paperId)
    .order('position', { ascending: true })
  if (error) throw error
  return data as PaperSection[]
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

export type UploadResult =
  | { kind: 'created'; paper: Paper }
  | {
      kind: 'duplicate'
      paper: { id: string; title: string }
      /** True if this call added a new link to the target project. */
      linkedToProject: boolean
      /** True if the paper was already linked to the target project. */
      alreadyInProject: boolean
    }

async function findByHash(hash: string) {
  const { data, error } = await getSupabaseBrowserClient()
    .from('papers')
    .select('id, title')
    .eq('content_hash', hash)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; title: string } | null
}

/** Idempotent: returns true only if a new link was created. */
export async function linkPaperToProject(
  paperId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('paper_project_links')
    .upsert(
      { paper_id: paperId, project_id: projectId },
      { onConflict: 'paper_id,project_id', ignoreDuplicates: true },
    )
    .select('paper_id')
  if (error) throw error
  return data.length > 0
}

export async function unlinkPaperFromProject(
  paperId: string,
  projectId: string,
): Promise<void> {
  const { error } = await getSupabaseBrowserClient()
    .from('paper_project_links')
    .delete()
    .eq('paper_id', paperId)
    .eq('project_id', projectId)
  if (error) throw error
}

async function reuseExisting(
  existing: { id: string; title: string },
  projectId: string | null,
): Promise<UploadResult> {
  const linkedToProject = projectId
    ? await linkPaperToProject(existing.id, projectId)
    : false
  return {
    kind: 'duplicate',
    paper: existing,
    linkedToProject,
    alreadyInProject: projectId !== null && !linkedToProject,
  }
}

/**
 * Hash the file and reuse an identical existing paper if there is one.
 * Otherwise upload the PDF, then create its record; if the insert fails the
 * uploaded object is removed so no orphan file is left behind. A concurrent
 * identical upload is caught by the unique (user_id, content_hash) index.
 */
export async function uploadPaper(input: {
  file: File
  projectId: string | null
  onProgress?: (fraction: number) => void
}): Promise<UploadResult> {
  const supabase = getSupabaseBrowserClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('Your session has expired. Please sign in again.')
  }
  const userId = userData.user.id

  const hash = await hashFile(input.file)
  const existing = await findByHash(hash)
  if (existing) return reuseExisting(existing, input.projectId)

  const paperId = crypto.randomUUID()
  const path = `${userId}/${paperId}/${sanitizeFilename(input.file.name)}`

  await uploadObject(path, input.file, input.onProgress)

  const { data, error } = await supabase
    .from('papers')
    .insert({
      id: paperId,
      user_id: userId,
      title: titleFromFilename(input.file.name),
      original_filename: input.file.name.slice(0, 255),
      mime_type: PDF_MIME,
      storage_path: path,
      content_hash: hash,
      file_size_bytes: input.file.size,
      // status is not client-writable; the database default ('uploaded') applies.
    })
    .select(COLUMNS)
    .single()

  if (error) {
    await removeObject(path).catch(() => undefined)
    if (error.code === '23505') {
      // Lost a race with an identical upload: reuse the winner.
      const winner = await findByHash(hash)
      if (winner) return reuseExisting(winner, input.projectId)
    }
    throw new Error(`Couldn’t save the paper record: ${error.message}`)
  }

  const row = data as unknown as Omit<Paper, 'project_ids'>
  if (input.projectId) {
    try {
      await linkPaperToProject(paperId, input.projectId)
    } catch (e) {
      // The paper is saved and visible in the Library; only the link failed.
      const detail = e instanceof Error ? e.message : ''
      throw new Error(
        `Uploaded to your Library, but couldn’t add it to the project. ${detail}`.trim(),
      )
    }
  }
  return {
    kind: 'created',
    paper: { ...row, project_ids: input.projectId ? [input.projectId] : [] },
  }
}

/**
 * Delete the file first, then the record (its project links cascade). If file
 * deletion fails the record is kept so the user can retry; if the record delete
 * fails after the file is gone, a retry succeeds (removing a missing object is
 * not an error).
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
