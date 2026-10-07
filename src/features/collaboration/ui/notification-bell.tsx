import { useEffect } from 'react'
import { Bell } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getDiscussionPaperId } from '../discussions-api'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { formatDate } from '#/lib/format'
import { formatNotificationMessage } from '../labels'
import {
  collaborationKeys,
  notificationsQuery,
  unreadNotificationCountQuery,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '../queries'
import { subscribeToNotifications } from '../realtime'

/**
 * Global notification bell, mounted once in the app shell. Realtime keeps the
 * unread badge and list current without a manual refresh; see realtime.ts for
 * why this uses invalidation rather than patching the cache directly.
 */
export function NotificationBell({
  userId,
  tone = 'default',
}: {
  userId: string
  tone?: 'default' | 'light'
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const unread = useQuery(unreadNotificationCountQuery())
  const notifications = useQuery(notificationsQuery())
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  useEffect(() => {
    const unsubscribe = subscribeToNotifications(getSupabaseBrowserClient(), userId, () => {
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.notifications() })
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.unreadCount() })
    })
    return unsubscribe
  }, [userId, queryClient])

  const count = unread.data ?? 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
          className={cn('relative', tone === 'light' && 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}
        >
          <Bell />
          {count > 0 && (
            <Badge
              variant="secondary"
              className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full p-0 text-[10px]"
            >
              {count > 9 ? '9+' : count}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {count > 0 && (
            <button
              type="button"
              className="text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={() => markAllRead.mutate()}
            >
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.data?.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            No notifications yet.
          </p>
        )}
        {notifications.data?.map((n) => (
          <DropdownMenuItem
            key={n.id}
            className="flex flex-col items-start gap-0.5 whitespace-normal"
            onSelect={() => {
              if (!n.readAt) markRead.mutate(n.id)
              if (n.discussionId) {
                void getDiscussionPaperId(n.discussionId).then((paperId) => {
                  if (paperId) void navigate({ to: '/papers/$paperId', params: { paperId } })
                })
              }
            }}
          >
            <span className={n.readAt ? 'text-muted-foreground' : 'font-medium'}>
              {formatNotificationMessage(n)}
            </span>
            <span className="text-xs text-muted-foreground">{formatDate(n.createdAt)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
