import { Link } from '@tanstack/react-router'
import {
  Eye,
  ExternalLink,
  FileText,
  FolderMinus,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { formatBytes, formatDate } from '#/lib/format'
import { STATUS_INFO } from '../status'
import type { Paper, PaperStatus } from '../types'

const STATUS_VARIANT: Record<
  PaperStatus,
  'default' | 'secondary' | 'destructive'
> = {
  uploaded: 'secondary',
  processing: 'secondary',
  ready: 'default',
  failed: 'destructive',
}

export function PaperRow({
  paper,
  projectTitles,
  onOpen,
  onAssign,
  onUnlink,
  onDelete,
}: {
  paper: Paper
  /** Shown in the Library only: titles of every project the paper is linked to. */
  projectTitles?: string[]
  onOpen: (paper: Paper) => void
  onAssign?: (paper: Paper) => void
  onUnlink?: (paper: Paper) => void
  onDelete: (paper: Paper) => void
}) {
  const byline = [
    paper.authors.length > 0 ? paper.authors.join(', ') : null,
    paper.publication_year,
  ]
    .filter(Boolean)
    .join(' · ')

  const meta = [
    byline,
    paper.page_count != null
      ? `${paper.page_count} ${paper.page_count === 1 ? 'page' : 'pages'}`
      : null,
    paper.file_size_bytes != null ? formatBytes(paper.file_size_bytes) : null,
    `Added ${formatDate(paper.created_at)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const statusBadge = (
    <Badge
      variant={STATUS_VARIANT[paper.status]}
      title={
        paper.status === 'failed'
          ? (paper.processing_error ?? undefined)
          : undefined
      }
    >
      {paper.status === 'processing' && <Loader2 className="animate-spin" />}
      {STATUS_INFO[paper.status].label}
    </Badge>
  )

  // Below sm the row is compact: the status badge and project names move into the
  // text column (nothing is dropped), and text wraps instead of truncating.
  return (
    <li className="flex items-start gap-3 py-3 sm:items-center">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <FileText className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to="/papers/$paperId"
          params={{ paperId: paper.id }}
          className="block max-w-full text-sm font-medium break-words text-foreground no-underline hover:underline sm:truncate"
        >
          {paper.title}
        </Link>
        <p className="text-xs break-words text-muted-foreground sm:truncate">
          {meta}
        </p>
        {paper.status !== 'ready' && (
          <p
            className={
              paper.status === 'failed'
                ? 'text-xs break-words text-destructive sm:truncate'
                : 'text-xs break-words text-muted-foreground sm:truncate'
            }
          >
            {STATUS_INFO[paper.status].headline}
          </p>
        )}
        {paper.original_filename && (
          <p className="text-xs break-words text-muted-foreground/80 sm:truncate">
            {paper.original_filename}
          </p>
        )}
        {projectTitles && (
          <p className="text-xs break-words text-muted-foreground sm:hidden">
            {projectTitles.length === 0
              ? 'No project'
              : `In ${projectTitles.join(', ')}`}
          </p>
        )}
        <div className="mt-1.5 sm:hidden">{statusBadge}</div>
      </div>
      {projectTitles && (
        <div className="hidden max-w-56 shrink-0 items-center gap-1 sm:flex">
          {projectTitles.length === 0 ? (
            <Badge variant="outline">No project</Badge>
          ) : (
            <>
              <Badge variant="outline" className="max-w-36">
                <span className="truncate">{projectTitles[0]}</span>
              </Badge>
              {projectTitles.length > 1 && (
                <Badge
                  variant="outline"
                  title={projectTitles.slice(1).join(', ')}
                >
                  +{projectTitles.length - 1}
                </Badge>
              )}
            </>
          )}
        </div>
      )}
      <div className="hidden shrink-0 sm:block">{statusBadge}</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${paper.title}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/papers/$paperId" params={{ paperId: paper.id }}>
              <Eye /> View details
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!paper.storage_path}
            onSelect={() => onOpen(paper)}
          >
            <ExternalLink /> Open PDF
          </DropdownMenuItem>
          {onAssign && (
            <DropdownMenuItem onSelect={() => onAssign(paper)}>
              <FolderPlus />
              Manage projects…
            </DropdownMenuItem>
          )}
          {onUnlink && (
            <DropdownMenuItem onSelect={() => onUnlink(paper)}>
              <FolderMinus /> Remove from project
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete(paper)}
          >
            <Trash2 /> Delete paper…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
