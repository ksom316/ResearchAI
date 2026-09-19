import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { QueryError } from '#/components/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { projectsQuery } from '#/features/projects/queries'
import { cn } from '#/lib/utils'
import { useAssignPaper } from '../queries'
import type { Paper } from '../types'

/** Links an existing paper to a project. Only the record changes; the PDF is not copied. */
export function AssignProjectDialog({
  paper,
  onOpenChange,
}: {
  paper: Paper | null
  onOpenChange: (open: boolean) => void
}) {
  const projects = useQuery(projectsQuery())
  const assign = useAssignPaper()

  return (
    <Dialog
      open={paper !== null}
      onOpenChange={(open) => !assign.isPending && onOpenChange(open)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to project</DialogTitle>
          <DialogDescription>
            Choose a project for “{paper?.title}”. The PDF isn’t duplicated.
          </DialogDescription>
        </DialogHeader>

        {projects.error ? (
          <QueryError
            error={projects.error}
            onRetry={() => projects.refetch()}
          />
        ) : projects.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : projects.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no projects yet. Create one from the Projects page first.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {projects.data.map((project) => {
              const current = project.id === paper?.project_id
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    disabled={assign.isPending || current}
                    onClick={() =>
                      paper &&
                      assign.mutate(
                        { paperId: paper.id, projectId: project.id },
                        { onSuccess: () => onOpenChange(false) },
                      )
                    }
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60',
                      current && 'bg-accent',
                    )}
                  >
                    <span className="truncate">{project.title}</span>
                    {current && <Check className="size-4 shrink-0" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
