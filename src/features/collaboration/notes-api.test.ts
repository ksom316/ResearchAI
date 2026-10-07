import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteConflictError, createNote, updateNote } from './notes-api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('#/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({ rpc: mocks.rpc }),
}))

describe('notes-api', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createNote sends the project/title/content', async () => {
    mocks.rpc.mockResolvedValue({ data: 'note-1', error: null })
    const id = await createNote({ projectId: 'proj-1', title: 'Lit review plan' })
    expect(id).toBe('note-1')
    expect(mocks.rpc).toHaveBeenCalledWith('create_note', {
      p_project_id: 'proj-1',
      p_title: 'Lit review plan',
      p_content: '',
    })
  })

  it('updateNote returns the new revision on success', async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null })
    const revision = await updateNote({
      noteId: 'note-1',
      title: 'Updated title',
      content: 'Updated content',
      expectedRevision: 2,
    })
    expect(revision).toBe(3)
    expect(mocks.rpc).toHaveBeenCalledWith('update_note', {
      p_note_id: 'note-1',
      p_title: 'Updated title',
      p_content: 'Updated content',
      p_expected_revision: 2,
    })
  })

  it('updateNote translates a revision conflict into NoteConflictError', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('note_revision_conflict'),
    })
    await expect(
      updateNote({ noteId: 'note-1', title: 't', content: 'c', expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(NoteConflictError)
  })

  it('updateNote rethrows an unrelated error unchanged', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('project_editor_required') })
    await expect(
      updateNote({ noteId: 'note-1', title: 't', content: 'c', expectedRevision: 1 }),
    ).rejects.toThrow('project_editor_required')
  })
})
