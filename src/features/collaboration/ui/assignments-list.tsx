import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ClipboardList } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { formatDate } from '#/lib/format'
import { projectAssignmentsQuery, useUpdateAssignmentStatus } from '../queries'

const TARGET_LABEL: Record<string, string> = {
  paper: 'Paper',
  evidence_item: 'Evidence item',
  discussion: 'Discussion',
  note: 'Note',
}

/** Project-wide assignment list (not a task board - just "who owns what"). */
export function AssignmentsList({
  projectId,
  currentUserId,
}: {
  projectId: string
  currentUserId: string
}) {
  const assignments = useQuery(projectAssignmentsQuery(projectId))
  const updateStatus = useUpdateAssignmentStatus(projectId, currentUserId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {assignments.isPending && <Skeleton className="h-16 rounded-md" />}
        {assignments.data?.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title="No assignments yet"
            description="Assign a discussion to a collaborator to track who owns what."
          />
        )}
        {assignments.data?.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {TARGET_LABEL[a.targetType]} assigned to{' '}
                <span className="font-medium">
                  {a.assigneeId === currentUserId ? 'you' : a.assigneeName || 'a collaborator'}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {a.dueDate ? `Due ${formatDate(a.dueDate)}` : `Created ${formatDate(a.createdAt)}`}
              </p>
            </div>
            <Badge variant={a.status === 'completed' ? 'secondary' : 'outline'}>
              {a.status.replace('_', ' ')}
            </Badge>
            {a.status !== 'completed' && a.assigneeId === currentUserId && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Mark complete"
                disabled={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ assignmentId: a.id, status: 'completed' })}
              >
                <CheckCircle2 />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
