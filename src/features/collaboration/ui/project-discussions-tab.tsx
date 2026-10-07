import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { projectMembersQuery } from '#/features/projects/queries'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { formatDate } from '#/lib/format'
import { collaborationKeys, projectDiscussionsQuery } from '../queries'
import { subscribeToProjectCollaboration } from '../realtime'
import { DiscussionThread } from './discussion-thread'
import type { ProjectRole } from '#/features/projects/collaboration'

/**
 * Every discussion across the project's papers. Opening one expands its
 * thread inline (same DiscussionThread used on the paper detail page), and
 * also links to the paper itself.
 */
export function ProjectDiscussionsTab({
  projectId,
  currentUserId,
  role,
}: {
  projectId: string
  currentUserId: string
  role: ProjectRole | null
}) {
  const queryClient = useQueryClient()
  const discussions = useQuery(projectDiscussionsQuery(projectId))
  const members = useQuery(projectMembersQuery(projectId))
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeToProjectCollaboration(
      getSupabaseBrowserClient(),
      projectId,
      (table) => {
        if (table === 'discussions' || table === 'comments') {
          void queryClient.invalidateQueries({ queryKey: collaborationKeys.projectDiscussions(projectId) })
        }
      },
    )
    return unsubscribe
  }, [projectId, queryClient])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discussions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {discussions.isPending && <Skeleton className="h-20 rounded-md" />}
        {discussions.data?.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No discussions yet"
            description="Open a paper and start a discussion to collaborate with your team."
          />
        )}
        {discussions.data?.map((discussion) => (
          <div key={discussion.id} className="rounded-lg border">
            <button
              type="button"
              className="flex w-full items-center gap-2 p-3 text-left"
              onClick={() => setExpanded(expanded === discussion.id ? null : discussion.id)}
            >
              <ChevronRight
                className={`size-4 shrink-0 transition-transform ${expanded === discussion.id ? 'rotate-90' : ''}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{discussion.paperTitle}</span>
                <span className="block text-xs text-muted-foreground">
                  {discussion.targetType === 'evidence_item' ? 'Evidence item' : 'Paper'} · {formatDate(discussion.createdAt)}
                </span>
              </span>
              <Badge variant={discussion.status === 'resolved' ? 'secondary' : 'outline'}>
                {discussion.status === 'resolved' ? 'Resolved' : 'Open'}
              </Badge>
            </button>
            {expanded === discussion.id && (
              <div className="space-y-2 border-t p-3">
                <Link
                  to="/papers/$paperId"
                  params={{ paperId: discussion.paperId }}
                  className="text-xs text-primary hover:underline"
                >
                  Open paper →
                </Link>
                <DiscussionThread
                  paperId={discussion.paperId}
                  discussion={discussion}
                  members={members.data ?? []}
                  currentUserId={currentUserId}
                  role={role}
                />
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
