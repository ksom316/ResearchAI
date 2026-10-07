import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getInitials } from '#/lib/format'
import { joinPresence } from '../presence'
import type { PresenceUser } from '../presence'

/** Shows who else is currently viewing this project (or project+paper). See presence.ts. */
export function PresenceAvatars({
  projectId,
  paperId,
  currentUser,
}: {
  projectId: string
  paperId?: string
  currentUser: PresenceUser
}) {
  const [users, setUsers] = useState<PresenceUser[]>([])

  useEffect(() => {
    const leave = joinPresence(
      getSupabaseBrowserClient(),
      currentUser,
      { projectId, paperId },
      setUsers,
    )
    return leave
    // currentUser is intentionally omitted: it is stable per session, and
    // including it would needlessly rejoin presence on every rerender.
  }, [projectId, paperId])

  const others = users.filter((u) => u.userId !== currentUser.userId)
  if (others.length === 0) return null

  return (
    <div className="flex items-center" aria-label="Collaborators currently viewing">
      {others.slice(0, 5).map((user, i) => (
        <Avatar
          key={user.userId}
          size="sm"
          className="border-2 border-background"
          style={{ marginLeft: i === 0 ? 0 : '-0.5rem' }}
          title={user.name ?? 'Collaborator'}
        >
          <AvatarFallback className="text-[10px]">
            {getInitials(user.name ?? '?')}
          </AvatarFallback>
        </Avatar>
      ))}
      {others.length > 5 && (
        <span className="ml-1.5 text-xs text-muted-foreground">+{others.length - 5}</span>
      )}
    </div>
  )
}
