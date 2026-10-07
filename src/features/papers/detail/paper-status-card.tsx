import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'
import { cn } from '#/lib/utils'
import {
  DOCUMENT_TYPE_LABELS,
  EXTRACTION_QUALITY_INFO,
  STATUS_INFO,
  describeFailure,
} from '../status'
import type { Paper, PaperStatus } from '../types'

const ICONS: Record<PaperStatus, LucideIcon> = {
  uploaded: Clock,
  processing: Loader2,
  ready: CheckCircle2,
  failed: AlertCircle,
}

/** Processing state of a paper, in plain language. Failed papers explain why. */
export function PaperStatusCard({
  paper,
}: {
  paper: Pick<
    Paper,
    | 'status'
    | 'processing_error'
    | 'document_type'
    | 'extraction_quality'
  >
}) {
  const info = STATUS_INFO[paper.status]
  const Icon = ICONS[paper.status]
  const failed = paper.status === 'failed'
  const failure = failed ? describeFailure(paper.processing_error) : null
  const ready = paper.status === 'ready'
  const quality = paper.extraction_quality
    ? EXTRACTION_QUALITY_INFO[paper.extraction_quality]
    : null
  const documentTypeLabel = paper.document_type
    ? DOCUMENT_TYPE_LABELS[paper.document_type]
    : null

  return (
    <Card className={cn(failed && 'border-destructive/30 bg-destructive/5')}>
      <CardContent
        role={failed ? 'alert' : 'status'}
        className="flex items-start gap-4"
      >
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            failed
              ? 'bg-destructive/10 text-destructive'
              : 'bg-accent text-accent-foreground',
          )}
        >
          <Icon
            className={cn(
              'size-5',
              paper.status === 'processing' && 'animate-spin',
            )}
          />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold">{info.headline}</h2>
          <p className="text-sm text-muted-foreground">
            {failure ? failure.explanation : info.description}
          </p>
          {failure?.detail && (
            <p className="text-sm break-words text-muted-foreground">
              {failure.detail}
            </p>
          )}
          {ready && (documentTypeLabel || quality) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {documentTypeLabel && (
                <Badge variant="secondary">{documentTypeLabel}</Badge>
              )}
              {quality && (
                <Badge
                  variant={quality.tone === 'good' ? 'secondary' : 'outline'}
                  className={cn(
                    quality.tone === 'bad' &&
                      'border-destructive/40 text-destructive',
                    quality.tone === 'caution' &&
                      'border-amber-500/40 text-amber-600 dark:text-amber-400',
                  )}
                >
                  {quality.label}
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
