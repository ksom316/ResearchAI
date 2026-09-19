import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { useUpdateProject } from '../queries'
import { ProjectForm } from './project-form'
import type { ResearchProject } from '../types'

export function RenameProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ResearchProject
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateProject(project.id, () => onOpenChange(false))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Rename the project or update its description.
          </DialogDescription>
        </DialogHeader>
        <ProjectForm
          initial={project}
          submitLabel="Save changes"
          pending={update.isPending}
          onSubmit={(input) => update.mutate(input)}
        />
      </DialogContent>
    </Dialog>
  )
}
