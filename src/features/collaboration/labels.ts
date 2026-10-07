import type { CollaborationActivityEventType, NotificationEventType } from './types'

/**
 * Pure, deterministic message formatting for the activity feed and
 * notifications - no AI calls, matching R13's "comments/mentions/
 * notifications/activity/assignments/notes should be deterministic" rule.
 */

export type ActivityEvent = {
  eventType: string
  actorName: string | null
  metadata: Record<string, unknown>
}

const actorOrSomeone = (name: string | null) => name ?? 'Someone'

const metaString = (metadata: Record<string, unknown>, key: string): string | null => {
  const value = metadata[key]
  return typeof value === 'string' ? value : null
}

/** R13 activity feed entries. Existing R10 event types fall through to a generic label. */
export function formatActivityMessage(event: ActivityEvent): string {
  const actor = actorOrSomeone(event.actorName)
  const type = event.eventType as CollaborationActivityEventType

  switch (type) {
    case 'comment_created':
      return metaString(event.metadata, 'target_type') === 'evidence_item'
        ? `${actor} commented on an evidence item.`
        : `${actor} commented on a paper.`
    case 'discussion_resolved':
      return `${actor} resolved a discussion.`
    case 'discussion_reopened':
      return `${actor} reopened a discussion.`
    case 'user_mentioned':
      return `${actor} mentioned someone in a discussion.`
    case 'assignment_created':
      return `${actor} assigned work to a collaborator.`
    case 'assignment_completed':
      return `${actor} completed an assignment.`
    case 'note_created': {
      const title = metaString(event.metadata, 'title')
      return title ? `${actor} added the note "${title}".` : `${actor} added a research note.`
    }
    case 'note_updated':
      return `${actor} updated a research note.`
    default:
      return `${actor} made a change.`
  }
}

export type NotificationContext = {
  eventType: NotificationEventType
  actorName: string | null
}

/** User-facing notification sentences, matching the examples in the R13 spec. */
export function formatNotificationMessage(ctx: NotificationContext): string {
  const actor = actorOrSomeone(ctx.actorName)
  switch (ctx.eventType) {
    case 'mention':
      return `${actor} mentioned you in a discussion.`
    case 'reply':
      return `${actor} replied to your discussion.`
    case 'discussion_resolved':
      return `${actor} resolved a discussion you're part of.`
    case 'discussion_reopened':
      return `${actor} reopened a discussion you resolved.`
    case 'assignment_created':
      return `${actor} assigned you a research task.`
    case 'assignment_completed':
      return `${actor} completed a task you assigned.`
    default:
      return `${actor} did something in a project you're part of.`
  }
}
