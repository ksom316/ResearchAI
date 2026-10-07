import { CheckCircle2, RotateCcw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import type { ProjectMember, ProjectRole } from '#/features/projects/collaboration'
import { formatDate } from '#/lib/format'
import {
  discussionCommentsQuery,
  useAddComment,
  useReopenDiscussion,
  useResolveDiscussion,
} from '../queries'
import { canComment, canCreateAssignment, canResolveDiscussion } from '../permissions'
import type { Discussion } from '../types'
import { AssignDiscussionButton } from './assign-discussion-button'
import { CommentComposer } from './comment-composer'
import { MentionBody } from './mention-body'

export function DiscussionThread({
  paperId,
  discussion,
  members,
  currentUserId,
  role,
}: {
  paperId: string
  discussion: Discussion
  members: readonly ProjectMember[]
  currentUserId: string
  role: ProjectRole | null
}) {
  const comments = useQuery(discussionCommentsQuery(discussion.id))
  const addComment = useAddComment(paperId, discussion.id)
  const resolve = useResolveDiscussion(paperId)
  const reopen = useReopenDiscussion(paperId)

  const memberName = (userId: string) =>
    userId === currentUserId
      ? 'You'
      : members.find((m) => m.user_id === userId)?.profile?.full_name || 'A collaborator'

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={discussion.status === 'resolved' ? 'secondary' : 'outline'}>
          {discussion.status === 'resolved' ? 'Resolved' : 'Open'}
        </Badge>
        <div className="flex items-center gap-1">
        {canCreateAssignment(role) && discussion.status === 'open' && (
          <AssignDiscussionButton
            projectId={discussion.projectId}
            discussionId={discussion.id}
            members={members}
          />
        )}
        {canResolveDiscussion(role) &&
          (discussion.status === 'open' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate(discussion.id)}
            >
              <CheckCircle2 /> Resolve
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={reopen.isPending}
              onClick={() => reopen.mutate(discussion.id)}
            >
              <RotateCcw /> Reopen
            </Button>
          ))}
        </div>
      </div>

      {discussion.status === 'resolved' && discussion.resolvedAt && (
        <p className="text-xs text-muted-foreground">
          Resolved by {memberName(discussion.resolvedBy ?? '')} on {formatDate(discussion.resolvedAt)}
        </p>
      )}

      {comments.isPending && <Skeleton className="h-16 rounded-md" />}
      {comments.data && (
        <ul className="space-y-3">
          {comments.data.map((comment) => (
            <li key={comment.id} className="space-y-0.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">
                  {comment.authorId === currentUserId ? 'You' : comment.authorName || 'A collaborator'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(comment.createdAt)}
                  {comment.editedAt && ' (edited)'}
                </span>
              </div>
              <MentionBody body={comment.deletedAt ? '_Comment deleted_' : comment.body} />
            </li>
          ))}
        </ul>
      )}

      {canComment(role) && discussion.status === 'open' && (
        <CommentComposer
          members={members}
          placeholder="Reply…"
          submitLabel="Reply"
          onSubmit={async (input) => {
            await addComment.mutateAsync(input)
          }}
        />
      )}
    </div>
  )
}
