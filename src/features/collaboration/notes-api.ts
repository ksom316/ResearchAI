import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import type { Note } from './types'

type NoteRow = {
  id: string
  project_id: string
  title: string
  content: string
  created_by: string
  last_edited_by: string | null
  revision: number
  created_at: string
  updated_at: string
  editor: { full_name: string | null } | null
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    lastEditedBy: row.last_edited_by,
    lastEditedByName: row.editor?.full_name ?? null,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT =
  'id, project_id, title, content, created_by, last_edited_by, revision, created_at, updated_at, editor:profiles!notes_last_edited_by_fkey(full_name)'

export async function listProjectNotes(projectId: string): Promise<Note[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('notes')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as NoteRow[]).map(toNote)
}

export async function getNote(noteId: string): Promise<Note | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('notes')
    .select(SELECT)
    .eq('id', noteId)
    .maybeSingle()
  if (error) throw error
  return data ? toNote(data as NoteRow) : null
}

export async function createNote(input: {
  projectId: string
  title: string
  content?: string
}): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc('create_note', {
    p_project_id: input.projectId,
    p_title: input.title,
    p_content: input.content ?? '',
  })
  if (error) throw error
  return data as string
}

export class NoteConflictError extends Error {
  constructor() {
    super('This note was changed by someone else. Reload it before saving again.')
    this.name = 'NoteConflictError'
  }
}

/** Returns the new revision. Throws NoteConflictError if `expectedRevision` is stale. */
export async function updateNote(input: {
  noteId: string
  title: string
  content: string
  expectedRevision: number
}): Promise<number> {
  const { data, error } = await getSupabaseBrowserClient().rpc('update_note', {
    p_note_id: input.noteId,
    p_title: input.title,
    p_content: input.content,
    p_expected_revision: input.expectedRevision,
  })
  if (error) {
    if (error.message.includes('note_revision_conflict')) throw new NoteConflictError()
    throw error
  }
  return data as number
}
