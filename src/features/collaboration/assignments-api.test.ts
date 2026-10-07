import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssignment, updateAssignmentStatus } from './assignments-api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('#/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({ rpc: mocks.rpc }),
}))

describe('assignments-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: 'assignment-1', error: null })
  })

  it('createAssignment for an evidence_item target', async () => {
    await createAssignment({
      projectId: 'proj-1',
      target: {
        targetType: 'evidence_item',
        paperId: 'paper-1',
        schemaVersion: 1,
        fieldKey: 'findings',
        itemIndex: 2,
      },
      assigneeId: 'user-2',
      dueDate: '2026-01-01',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('create_assignment', {
      p_project_id: 'proj-1',
      p_target_type: 'evidence_item',
      p_assignee_id: 'user-2',
      p_paper_id: 'paper-1',
      p_schema_version: 1,
      p_field_key: 'findings',
      p_item_index: 2,
      p_discussion_id: null,
      p_note_id: null,
      p_due_date: '2026-01-01',
    })
  })

  it('createAssignment for a note target', async () => {
    await createAssignment({
      projectId: 'proj-1',
      target: { targetType: 'note', noteId: 'note-1' },
      assigneeId: 'user-2',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('create_assignment', {
      p_project_id: 'proj-1',
      p_target_type: 'note',
      p_assignee_id: 'user-2',
      p_paper_id: null,
      p_schema_version: null,
      p_field_key: null,
      p_item_index: null,
      p_discussion_id: null,
      p_note_id: 'note-1',
      p_due_date: null,
    })
  })

  it('updateAssignmentStatus sends the new status', async () => {
    await updateAssignmentStatus('assignment-1', 'completed')
    expect(mocks.rpc).toHaveBeenCalledWith('update_assignment_status', {
      p_assignment_id: 'assignment-1',
      p_status: 'completed',
    })
  })
})
