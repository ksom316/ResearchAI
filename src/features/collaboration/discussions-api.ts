import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import type { Comment, Discussion, TargetRef } from './types'

type DiscussionRow = {
  id: string
  project_id: string
  paper_id: string
  target_type: 'paper' | 'evidence_item'
  schema_version: number | null
  field_key: string | null
  item_index: number | null
  status: 'open' | 'resolved'
  created_by: string
  resolved_by: string | null
  resolved_at: string | null
  reopened_by: string | null
  reopened_at: string | null
  created_at: string
  updated_at: string
}

function toDiscussion(row: DiscussionRow): Discussion {
  return {
    id: row.id,
    projectId: row.project_id,
    paperId: row.paper_id,
    targetType: row.target_type,
    schemaVersion: row.schema_version,
    fieldKey: row.field_key,
    itemIndex: row.item_index,
    status: row.status,
    createdBy: row.created_by,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    reopenedBy: row.reopened_by,
    reopenedAt: row.reopened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type CommentRow = {
  id: string
  discussion_id: string
  project_id: string
  author_id: string
  body: string
  created_at: string
  updated_at: string
  edited_at: string | null
  deleted_at: string | null
  profiles: { full_name: string | null } | null
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    projectId: row.project_id,
    authorId: row.author_id,
    authorName: row.profiles?.full_name ?? null,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  }
}

const DISCUSSION_COLUMNS =
  'id, project_id, paper_id, target_type, schema_version, field_key, item_index, status, created_by, resolved_by, resolved_at, reopened_by, reopened_at, created_at, updated_at'

/** Lists open-then-resolved discussions for a paper, newest first within each group. */
export async function listPaperDiscussions(paperId: string): Promise<Discussion[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('discussions')
    .select(DISCUSSION_COLUMNS)
    .eq('paper_id', paperId)
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as DiscussionRow[]).map(toDiscussion)
}

export type ProjectDiscussion = Discussion & { paperTitle: string }

/** Every discussion across a project's papers, newest first, for the project-wide Discussions tab. */
export async function listProjectDiscussions(projectId: string): Promise<ProjectDiscussion[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('discussions')
    .select(`${DISCUSSION_COLUMNS}, papers(title)`)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as (DiscussionRow & { papers: { title: string } | null })[]).map(
    (row) => ({ ...toDiscussion(row), paperTitle: row.papers?.title ?? 'Untitled paper' }),
  )
}

/** The paper a discussion belongs to, for notification "open this discussion" navigation. */
export async function getDiscussionPaperId(discussionId: string): Promise<string | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('discussions')
    .select('paper_id')
    .eq('id', discussionId)
    .maybeSingle()
  if (error) throw error
  return (data as { paper_id: string } | null)?.paper_id ?? null
}

export async function listDiscussionComments(discussionId: string): Promise<Comment[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('comments')
    .select(
      'id, discussion_id, project_id, author_id, body, created_at, updated_at, edited_at, deleted_at, profiles(full_name)',
    )
    .eq('discussion_id', discussionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as CommentRow[]).map(toComment)
}

function targetRefArgs(target: TargetRef) {
  return target.targetType === 'paper'
    ? {
        p_paper_id: target.paperId,
        p_target_type: 'paper' as const,
        p_schema_version: null,
        p_field_key: null,
        p_item_index: null,
      }
    : {
        p_paper_id: target.paperId,
        p_target_type: 'evidence_item' as const,
        p_schema_version: target.schemaVersion,
        p_field_key: target.fieldKey,
        p_item_index: target.itemIndex,
      }
}

/** Opens a new discussion with its first comment, atomically. */
export async function createDiscussion(input: {
  projectId: string
  target: TargetRef
  body: string
  mentionedUserIds: string[]
}): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc('create_discussion', {
    p_project_id: input.projectId,
    ...targetRefArgs(input.target),
    p_body: input.body,
    p_mentioned_user_ids: input.mentionedUserIds,
  })
  if (error) throw error
  return data as string
}

export async function addComment(input: {
  discussionId: string
  body: string
  mentionedUserIds: string[]
}): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc('add_comment', {
    p_discussion_id: input.discussionId,
    p_body: input.body,
    p_mentioned_user_ids: input.mentionedUserIds,
  })
  if (error) throw error
  return data as string
}

export async function editComment(commentId: string, body: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc('edit_comment', {
    p_comment_id: commentId,
    p_body: body,
  })
  if (error) throw error
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc('delete_comment', {
    p_comment_id: commentId,
  })
  if (error) throw error
}

export async function resolveDiscussion(discussionId: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc('resolve_discussion', {
    p_discussion_id: discussionId,
  })
  if (error) throw error
}

export async function reopenDiscussion(discussionId: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc('reopen_discussion', {
    p_discussion_id: discussionId,
  })
  if (error) throw error
}
