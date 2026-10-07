import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import type { Notification, NotificationEventType } from './types'

type NotificationRow = {
  id: string
  recipient_id: string
  actor_id: string | null
  project_id: string
  event_type: NotificationEventType
  discussion_id: string | null
  comment_id: string | null
  assignment_id: string | null
  read_at: string | null
  created_at: string
  actor: { full_name: string | null } | null
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    actorId: row.actor_id,
    actorName: row.actor?.full_name ?? null,
    projectId: row.project_id,
    eventType: row.event_type,
    discussionId: row.discussion_id,
    commentId: row.comment_id,
    assignmentId: row.assignment_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

/** The caller's own notifications (RLS already scopes this to recipient_id = auth.uid()). */
export async function listNotifications(options?: { limit?: number }): Promise<Notification[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('notifications')
    .select(
      'id, recipient_id, actor_id, project_id, event_type, discussion_id, comment_id, assignment_id, read_at, created_at, actor:profiles(full_name)',
    )
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 30)
  if (error) throw error
  return ((data ?? []) as unknown as NotificationRow[]).map(toNotification)
}

export async function countUnreadNotifications(): Promise<number> {
  const { count, error } = await getSupabaseBrowserClient()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc('mark_notification_read', {
    p_notification_id: notificationId,
  })
  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc('mark_all_notifications_read')
  if (error) throw error
}
