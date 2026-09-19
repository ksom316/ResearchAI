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
import { papersQuery, useLinkPaper, useUnlinkPaper } from '../queries'

/**
 * Toggle which projects a paper belongs to. A paper can be in many projects;
 * only the link changes, never the PDF or the paper record.
 */
export function AssignProjectDialog({
  paperId,
  onOpenChange,
}: {
  paperId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const projects = useQuery(projectsQuery())
  const papers = useQuery(papersQuery())
  const link = useLinkPaper()
  const unlink = useUnlinkPaper()
  const paper = papers.data?.find((p) => p.id === paperId)
  const pending = link.isPending || unlink.isPending

  return (
    <Dialog open={paperId !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
          <DialogDescription>
            Choose the projects “{paper?.title}” belongs to. The PDF isn’t
            duplicated.
          </DialogDescription>
        </DialogHeader>

        {projects.error ? (
          <QueryError
            error={projects.error}
            onRetry={() => projects.refetch()}
          />
        ) : projects.isPending || papers.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : projects.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no projects yet. Create one from the Projects page first.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {projects.data.map((project) => {
              const linked = paper?.project_ids.includes(project.id) ?? false
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    disabled={pending || !paper}
                    aria-pressed={linked}
                    onClick={() =>
                      (linked ? unlink : link).mutate({
                        paperId: paper!.id,
                        projectId: project.id,
                      })
                    }
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60',
                      linked && 'bg-accent',
                    )}
                  >
                    <span className="truncate">{project.title}</span>
                    {linked && <Check className="size-4 shrink-0" />}
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
