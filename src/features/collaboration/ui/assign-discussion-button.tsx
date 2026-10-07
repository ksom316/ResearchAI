import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import type { ProjectMember } from '#/features/projects/collaboration'
import { useCreateAssignment } from '../queries'

/**
 * Lightweight "assign this to someone" affordance on a discussion - not a
 * generic task manager: it only ever targets this one discussion, with three
 * states (assigned / in_progress / completed), matching the R13 scope limit.
 */
export function AssignDiscussionButton({
  projectId,
  discussionId,
  members,
}: {
  projectId: string
  discussionId: string
  members: readonly ProjectMember[]
}) {
  const [open, setOpen] = useState(false)
  const createAssignment = useCreateAssignment(projectId)

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <UserPlus /> Assign
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign this discussion</DialogTitle>
            <DialogDescription>Pick a collaborator to follow up.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {members.map((member) => (
              <button
                key={member.user_id}
                type="button"
                className="flex w-full items-center rounded-md border p-2 text-left text-sm hover:bg-accent"
                disabled={createAssignment.isPending}
                onClick={async () => {
                  await createAssignment.mutateAsync({
                    projectId,
                    target: { targetType: 'discussion', discussionId },
                    assigneeId: member.user_id,
                  })
                  setOpen(false)
                }}
              >
                {member.profile?.full_name || 'Researcher'}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
