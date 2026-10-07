import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addComment,
  createDiscussion,
  deleteComment,
  editComment,
  reopenDiscussion,
  resolveDiscussion,
} from './discussions-api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('#/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({ rpc: mocks.rpc }),
}))

describe('discussions-api RPC wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: 'new-id', error: null })
  })

  it('createDiscussion for a paper target sends null evidence-item fields', async () => {
    await createDiscussion({
      projectId: 'proj-1',
      target: { targetType: 'paper', paperId: 'paper-1' },
      body: 'Should we include this?',
      mentionedUserIds: [],
    })
    expect(mocks.rpc).toHaveBeenCalledWith('create_discussion', {
      p_project_id: 'proj-1',
      p_paper_id: 'paper-1',
      p_target_type: 'paper',
      p_schema_version: null,
      p_field_key: null,
      p_item_index: null,
      p_body: 'Should we include this?',
      p_mentioned_user_ids: [],
    })
  })

  it('createDiscussion for an evidence_item target sends its coordinates', async () => {
    await createDiscussion({
      projectId: 'proj-1',
      target: {
        targetType: 'evidence_item',
        paperId: 'paper-1',
        schemaVersion: 1,
        fieldKey: 'findings',
        itemIndex: 0,
      },
      body: 'This conflicts with the 2024 study.',
      mentionedUserIds: ['user-2'],
    })
    expect(mocks.rpc).toHaveBeenCalledWith('create_discussion', {
      p_project_id: 'proj-1',
      p_paper_id: 'paper-1',
      p_target_type: 'evidence_item',
      p_schema_version: 1,
      p_field_key: 'findings',
      p_item_index: 0,
      p_body: 'This conflicts with the 2024 study.',
      p_mentioned_user_ids: ['user-2'],
    })
  })

  it('addComment passes through mentioned user ids', async () => {
    await addComment({ discussionId: 'disc-1', body: 'Agreed.', mentionedUserIds: ['user-3'] })
    expect(mocks.rpc).toHaveBeenCalledWith('add_comment', {
      p_discussion_id: 'disc-1',
      p_body: 'Agreed.',
      p_mentioned_user_ids: ['user-3'],
    })
  })

  it('editComment and deleteComment call the author-scoped RPCs', async () => {
    await editComment('c1', 'updated body')
    expect(mocks.rpc).toHaveBeenCalledWith('edit_comment', { p_comment_id: 'c1', p_body: 'updated body' })
    await deleteComment('c1')
    expect(mocks.rpc).toHaveBeenCalledWith('delete_comment', { p_comment_id: 'c1' })
  })

  it('resolveDiscussion and reopenDiscussion call the matching RPCs', async () => {
    await resolveDiscussion('disc-1')
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_discussion', { p_discussion_id: 'disc-1' })
    await reopenDiscussion('disc-1')
    expect(mocks.rpc).toHaveBeenCalledWith('reopen_discussion', { p_discussion_id: 'disc-1' })
  })

  it('throws the Supabase error rather than swallowing it', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('project_member_required') })
    await expect(
      createDiscussion({
        projectId: 'proj-1',
        target: { targetType: 'paper', paperId: 'paper-1' },
        body: 'x',
        mentionedUserIds: [],
      }),
    ).rejects.toThrow('project_member_required')
  })
})
