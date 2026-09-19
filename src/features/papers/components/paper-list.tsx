import type { ReactNode } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Search } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { projectsQuery } from '#/features/projects/queries'
import { papersQuery, useAssignPaper, useOpenPaper } from '../queries'
import { matchesSearch } from '../search'
import type { Paper } from '../types'
import { AssignProjectDialog } from './assign-project-dialog'
import { DeletePaperDialog } from './delete-paper-dialog'
import { PaperRow } from './paper-row'

/**
 * Paper list with search and row actions. Pass `projectId` for a project's
 * Papers tab; omit it for the global Library (which also shows each paper's project).
 */
export function PaperList({
  projectId,
  limit,
  emptyDescription = 'Papers you add will appear here.',
  emptyAction,
}: {
  projectId?: string
  limit?: number
  emptyDescription?: string
  emptyAction?: ReactNode
}) {
  const { data, error, isPending, refetch } = useQuery(
    papersQuery({ projectId, limit }),
  )
  const projects = useQuery({ ...projectsQuery(), enabled: !projectId })
  const open = useOpenPaper()
  const assign = useAssignPaper()
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<Paper | null>(null)
  const [assigning, setAssigning] = useState<Paper | null>(null)

  if (error) return <QueryError error={error} onRetry={() => refetch()} />

  if (isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No papers yet"
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  const titles = new Map(projects.data?.map((p) => [p.id, p.title]))
  const visible = data.filter((paper) => matchesSearch(paper, search))

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, author, filename or year…"
          aria-label="Search papers"
          className="pl-9"
        />
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No papers match “{search.trim()}”.
        </p>
      ) : (
        <ul className="divide-y">
          {visible.map((paper) => (
            <PaperRow
              key={paper.id}
              paper={paper}
              projectTitle={
                projectId
                  ? undefined
                  : paper.project_id
                    ? (titles.get(paper.project_id) ?? '…')
                    : null
              }
              onOpen={(p) => open.mutate(p)}
              onAssign={projectId ? undefined : setAssigning}
              onUnlink={(p) =>
                assign.mutate({ paperId: p.id, projectId: null })
              }
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}

      <DeletePaperDialog
        paper={deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
      />
      <AssignProjectDialog
        paper={assigning}
        onOpenChange={(o) => !o && setAssigning(null)}
      />
    </div>
  )
}
