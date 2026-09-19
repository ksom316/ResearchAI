import {
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
import type { Paper, PaperStatus } from '../types'

const STATUS_LABEL: Record<PaperStatus, string> = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
}

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

  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <FileText className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(paper)}
          disabled={!paper.storage_path}
          className="block max-w-full truncate text-left text-sm font-medium hover:underline disabled:no-underline"
        >
          {paper.title}
        </button>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
        {paper.original_filename && (
          <p className="truncate text-xs text-muted-foreground/80">
            {paper.original_filename}
          </p>
        )}
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
      <Badge
        variant={STATUS_VARIANT[paper.status]}
        title={
          paper.status === 'failed'
            ? (paper.processing_error ?? undefined)
            : undefined
        }
      >
        {paper.status === 'processing' && <Loader2 className="animate-spin" />}
        {STATUS_LABEL[paper.status]}
      </Badge>
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
