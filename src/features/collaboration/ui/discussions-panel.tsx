import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare, Plus } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Skeleton } from '#/components/ui/skeleton'
import { projectMembersQuery, projectRoleQuery } from '#/features/projects/queries'
import { paperDiscussionsQuery, useCreateDiscussion } from '../queries'
import { canComment } from '../permissions'
import { CommentComposer } from './comment-composer'
import { DiscussionThread } from './discussion-thread'

/**
 * Discussions for one paper, scoped to one of the projects it is linked to.
 * A paper with no project link isn't part of a shared workspace yet, so
 * there is nothing to collaborate on here (R13 discussions always belong to
 * a project - see migration 0024).
 */
export function DiscussionsPanel({
  paperId,
  projectIds,
  currentUserId,
}: {
  paperId: string
  projectIds: readonly string[]
  currentUserId: string
}) {
  const [projectId] = useState(projectIds[0])
  const [newOpen, setNewOpen] = useState(false)
  const discussions = useQuery(paperDiscussionsQuery(paperId))
  const members = useQuery({ ...projectMembersQuery(projectId), enabled: projectIds.length > 0 })
  const role = useQuery({ ...projectRoleQuery(projectId), enabled: projectIds.length > 0 })
  const createDiscussion = useCreateDiscussion(paperId)

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discussion</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Link this paper to a project to discuss it with collaborators.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Discussion</CardTitle>
        {canComment(role.data ?? null) && (
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus /> New discussion
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {discussions.isPending && <Skeleton className="h-24 rounded-md" />}
        {discussions.data?.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No discussions yet"
            description="Start a discussion to ask the team a question about this paper."
          />
        )}
        {discussions.data?.map((discussion) => (
          <DiscussionThread
            key={discussion.id}
            paperId={paperId}
            discussion={discussion}
            members={members.data ?? []}
            currentUserId={currentUserId}
            role={role.data ?? null}
          />
        ))}
      </CardContent>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a discussion</DialogTitle>
            <DialogDescription>
              Visible to everyone in this project.
            </DialogDescription>
          </DialogHeader>
          <CommentComposer
            members={members.data ?? []}
            placeholder="Should we include this paper in the final evidence set?"
            submitLabel="Start discussion"
            autoFocus
            onSubmit={async (input) => {
              await createDiscussion.mutateAsync({
                projectId,
                target: { targetType: 'paper', paperId },
                body: input.body,
                mentionedUserIds: input.mentionedUserIds,
              })
              setNewOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  )
}
