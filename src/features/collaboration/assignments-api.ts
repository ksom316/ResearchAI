import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import type { Assignment, AssignmentStatus, TargetRef } from './types'

type AssignmentRow = {
  id: string
  project_id: string
  target_type: Assignment['targetType']
  paper_id: string | null
  schema_version: number | null
  field_key: string | null
  item_index: number | null
  discussion_id: string | null
  note_id: string | null
  assignee_id: string
  assigner_id: string
  status: AssignmentStatus
  due_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  assignee: { full_name: string | null } | null
  assigner: { full_name: string | null } | null
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    projectId: row.project_id,
    targetType: row.target_type,
    paperId: row.paper_id,
    schemaVersion: row.schema_version,
    fieldKey: row.field_key,
    itemIndex: row.item_index,
    discussionId: row.discussion_id,
    noteId: row.note_id,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee?.full_name ?? null,
    assignerId: row.assigner_id,
    assignerName: row.assigner?.full_name ?? null,
    status: row.status,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT =
  'id, project_id, target_type, paper_id, schema_version, field_key, item_index, discussion_id, note_id, assignee_id, assigner_id, status, due_date, completed_at, created_at, updated_at, assignee:profiles!assignments_assignee_id_fkey(full_name), assigner:profiles!assignments_assigner_id_fkey(full_name)'

export async function listProjectAssignments(projectId: string): Promise<Assignment[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('assignments')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as AssignmentRow[]).map(toAssignment)
}

export async function listMyAssignments(userId: string): Promise<Assignment[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('assignments')
    .select(SELECT)
    .eq('assignee_id', userId)
    .neq('status', 'completed')
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return ((data ?? []) as unknown as AssignmentRow[]).map(toAssignment)
}

function targetArgs(target: TargetRef | { targetType: 'discussion'; discussionId: string } | { targetType: 'note'; noteId: string }) {
  switch (target.targetType) {
    case 'paper':
      return { p_paper_id: target.paperId, p_schema_version: null, p_field_key: null, p_item_index: null, p_discussion_id: null, p_note_id: null }
    case 'evidence_item':
      return {
        p_paper_id: target.paperId,
        p_schema_version: target.schemaVersion,
        p_field_key: target.fieldKey,
        p_item_index: target.itemIndex,
        p_discussion_id: null,
        p_note_id: null,
      }
    case 'discussion':
      return { p_paper_id: null, p_schema_version: null, p_field_key: null, p_item_index: null, p_discussion_id: target.discussionId, p_note_id: null }
    case 'note':
      return { p_paper_id: null, p_schema_version: null, p_field_key: null, p_item_index: null, p_discussion_id: null, p_note_id: target.noteId }
  }
}

export async function createAssignment(input: {
  projectId: string
  target:
    | TargetRef
    | { targetType: 'discussion'; discussionId: string }
    | { targetType: 'note'; noteId: string }
  assigneeId: string
  dueDate?: string | null
}): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc('create_assignment', {
    p_project_id: input.projectId,
    p_target_type: input.target.targetType,
    p_assignee_id: input.assigneeId,
    ...targetArgs(input.target),
    p_due_date: input.dueDate ?? null,
  })
  if (error) throw error
  return data as string
}

export async function updateAssignmentStatus(
  assignmentId: string,
  status: AssignmentStatus,
): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc('update_assignment_status', {
    p_assignment_id: assignmentId,
    p_status: status,
  })
  if (error) throw error
}
