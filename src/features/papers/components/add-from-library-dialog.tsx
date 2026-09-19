import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { projectsQuery } from '#/features/projects/queries'
import { papersQuery, useAssignPaper } from '../queries'
import { matchesSearch } from '../search'

/** Pick existing Library papers to link to a project (no file duplication). */
export function AddFromLibraryDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const papers = useQuery({ ...papersQuery(), enabled: open })
  const projects = useQuery({ ...projectsQuery(), enabled: open })
  const assign = useAssignPaper()
  const [search, setSearch] = useState('')

  const projectTitles = new Map(projects.data?.map((p) => [p.id, p.title]))
  const candidates = (papers.data ?? [])
    .filter((p) => p.project_id !== projectId)
    .filter((p) => matchesSearch(p, search))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add from Library</DialogTitle>
          <DialogDescription>
            Link existing papers to this project. A paper belongs to one project
            at a time, so adding one moves it here.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your library…"
          aria-label="Search your library"
        />
        {papers.error ? (
          <QueryError error={papers.error} onRetry={() => papers.refetch()} />
        ) : papers.isPending ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {search
              ? 'No matching papers.'
              : 'Every paper in your library is already in this project.'}
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {candidates.map((paper) => {
              const other = paper.project_id
                ? projectTitles.get(paper.project_id)
                : null
              return (
                <li key={paper.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {paper.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {other ? `Currently in ${other}` : 'Not in a project'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={assign.isPending}
                    onClick={() =>
                      assign.mutate({ paperId: paper.id, projectId })
                    }
                  >
                    <Plus /> Add
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
