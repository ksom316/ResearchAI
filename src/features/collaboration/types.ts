/**
 * R13 Collaboration V2 domain types. "Finding" and "evidence" (product
 * vocabulary) map onto the existing Evidence Matrix structure: an
 * 'evidence_item' target is one item of one paper_extraction_fields row (any
 * field_key, including 'findings') - see migration 0024 for why.
 */

export type DiscussionTargetType = 'paper' | 'evidence_item'

/** Identifies what a discussion/assignment is about. */
export type TargetRef =
  | { targetType: 'paper'; paperId: string }
  | {
      targetType: 'evidence_item'
      paperId: string
      schemaVersion: number
      fieldKey: string
      itemIndex: number
    }

export type DiscussionStatus = 'open' | 'resolved'

export type Discussion = {
  id: string
  projectId: string
  paperId: string
  targetType: DiscussionTargetType
  schemaVersion: number | null
  fieldKey: string | null
  itemIndex: number | null
  status: DiscussionStatus
  createdBy: string
  resolvedBy: string | null
  resolvedAt: string | null
  reopenedBy: string | null
  reopenedAt: string | null
  createdAt: string
  updatedAt: string
}

export type Comment = {
  id: string
  discussionId: string
  projectId: string
  authorId: string
  authorName: string | null
  body: string
  createdAt: string
  updatedAt: string
  editedAt: string | null
  deletedAt: string | null
}

export type Mention = {
  id: string
  commentId: string
  mentionedUserId: string
  mentionedBy: string
  createdAt: string
}

export type NotificationEventType =
  | 'mention'
  | 'reply'
  | 'discussion_resolved'
  | 'discussion_reopened'
  | 'assignment_created'
  | 'assignment_completed'

export type Notification = {
  id: string
  recipientId: string
  actorId: string | null
  actorName: string | null
  projectId: string
  eventType: NotificationEventType
  discussionId: string | null
  commentId: string | null
  assignmentId: string | null
  readAt: string | null
  createdAt: string
}

export type AssignmentTargetType = 'paper' | 'evidence_item' | 'discussion' | 'note'
export type AssignmentStatus = 'assigned' | 'in_progress' | 'completed'

export type Assignment = {
  id: string
  projectId: string
  targetType: AssignmentTargetType
  paperId: string | null
  schemaVersion: number | null
  fieldKey: string | null
  itemIndex: number | null
  discussionId: string | null
  noteId: string | null
  assigneeId: string
  assigneeName: string | null
  assignerId: string
  assignerName: string | null
  status: AssignmentStatus
  dueDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type Note = {
  id: string
  projectId: string
  title: string
  content: string
  createdBy: string
  lastEditedBy: string | null
  lastEditedByName: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

/** R13 additions to project_activity.event_type (see migration 0024). */
export type CollaborationActivityEventType =
  | 'comment_created'
  | 'discussion_resolved'
  | 'discussion_reopened'
  | 'user_mentioned'
  | 'assignment_created'
  | 'assignment_completed'
  | 'note_created'
  | 'note_updated'
