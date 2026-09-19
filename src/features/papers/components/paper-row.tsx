import {
  ExternalLink,
  FileText,
  FolderMinus,
  FolderPlus,
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

export function PaperRow({
  paper,
  projectTitle,
  onOpen,
  onAssign,
  onUnlink,
  onDelete,
}: {
  paper: Paper
  /** Shown when the row is displayed outside of its project (i.e. the Library). */
  projectTitle?: string | null
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
      {projectTitle !== undefined && (
        <Badge variant="outline" className="hidden max-w-40 sm:inline-flex">
          <span className="truncate">{projectTitle ?? 'No project'}</span>
        </Badge>
      )}
      <Badge variant={paper.status === 'failed' ? 'destructive' : 'secondary'}>
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
              {paper.project_id ? 'Move to project…' : 'Add to project…'}
            </DropdownMenuItem>
          )}
          {onUnlink && paper.project_id && (
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
