import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink, FileText, Trash2 } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { projectsQuery } from '#/features/projects/queries'
import { formatBytes, formatDate } from '#/lib/format'
import { DeletePaperDialog } from '../components/delete-paper-dialog'
import { paperQuery, useOpenPaper } from '../queries'
import { STATUS_INFO } from '../status'
import type { Paper } from '../types'
import { PaperOutline } from './paper-outline'
import { PaperStatusCard } from './paper-status-card'
import { CitationMetadataCard } from './citation-metadata-card'

const back = (
  <Link
    to="/library"
    className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground no-underline hover:text-foreground"
  >
    <ArrowLeft className="size-4" /> Library
  </Link>
)

export function PaperDetail({ paperId }: { paperId: string }) {
  const {
    data: paper,
    error,
    isPending,
    refetch,
  } = useQuery(paperQuery(paperId))

  if (error) {
    return (
      <>
        {back}
        <QueryError error={error} onRetry={() => refetch()} />
      </>
    )
  }

  if (isPending) {
    return (
      <>
        {back}
        <Skeleton className="mb-8 h-10 w-72 max-w-full" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </>
    )
  }

  if (!paper) {
    return (
      <>
        {back}
        <EmptyState
          icon={FileText}
          title="Paper not found"
          description="It may have been deleted, or you may not have access to it."
          action={
            <Button asChild variant="outline">
              <Link to="/library">Back to Library</Link>
            </Button>
          }
        />
      </>
    )
  }

  return <PaperDetailContent paper={paper} />
}

function PaperDetailContent({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const open = useOpenPaper()
  const [deleting, setDeleting] = useState<Paper | null>(null)

  return (
    <>
      {back}

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-3xl font-medium break-words">{paper.title}</h1>
          {paper.original_filename && (
            <p className="text-sm break-all text-muted-foreground">
              {paper.original_filename}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            disabled={!paper.storage_path || open.isPending}
            onClick={() => open.mutate(paper)}
          >
            <ExternalLink /> Open PDF
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Delete paper"
            onClick={() => setDeleting(paper)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <PaperStatusCard paper={paper} />
          <CitationMetadataCard paper={paper} />
          {paper.status === 'ready' && <PaperOutline paperId={paper.id} />}
        </div>
        <PaperDetails paper={paper} />
      </div>

      <DeletePaperDialog
        paper={deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onDeleted={() => navigate({ to: '/library' })}
      />
    </>
  )
}

function PaperDetails({ paper }: { paper: Paper }) {
  const projects = useQuery(projectsQuery())
  const titles = new Map(projects.data?.map((p) => [p.id, p.title]))

  const rows: { label: string; value: string }[] = [
    { label: 'Status', value: STATUS_INFO[paper.status].label },
    ...(paper.page_count != null
      ? [
          {
            label: 'Pages',
            value: `${paper.page_count}`,
          },
        ]
      : []),
    ...(paper.file_size_bytes != null
      ? [{ label: 'File size', value: formatBytes(paper.file_size_bytes) }]
      : []),
    { label: 'Added', value: formatDate(paper.created_at) },
  ]

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="text-lg">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="text-right font-medium">{row.value}</dd>
            </div>
          ))}
          <div className="space-y-2 border-t pt-3">
            <dt className="text-muted-foreground">Projects</dt>
            <dd>
              {paper.project_ids.length === 0 ? (
                <span className="text-muted-foreground">
                  Not in any project
                </span>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {paper.project_ids.map((id) => (
                    <li key={id} className="max-w-full">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: id }}
                        search={{ tab: 'papers' }}
                        className="no-underline"
                      >
                        <Badge variant="outline" className="max-w-full">
                          <span className="truncate">
                            {titles.get(id) ?? '…'}
                          </span>
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
