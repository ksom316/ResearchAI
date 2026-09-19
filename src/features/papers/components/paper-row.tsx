import { FileText } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { formatDate } from '#/lib/format'
import type { Paper, PaperStatus } from '../types'

const STATUS_LABEL: Record<PaperStatus, string> = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
}

export function PaperRow({ paper }: { paper: Paper }) {
  const byline = [
    paper.authors.length > 0 ? paper.authors.join(', ') : null,
    paper.publication_year,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <FileText className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{paper.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {byline || `Added ${formatDate(paper.created_at)}`}
        </p>
      </div>
      <Badge variant={paper.status === 'failed' ? 'destructive' : 'secondary'}>
        {STATUS_LABEL[paper.status]}
      </Badge>
    </li>
  )
}
