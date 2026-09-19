import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '#/components/ui/card'
import { cn } from '#/lib/utils'
import { STATUS_INFO, describeFailure } from '../status'
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
  paper: Pick<Paper, 'status' | 'processing_error'>
}) {
  const info = STATUS_INFO[paper.status]
  const Icon = ICONS[paper.status]
  const failed = paper.status === 'failed'
  const failure = failed ? describeFailure(paper.processing_error) : null

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
        </div>
      </CardContent>
    </Card>
  )
}
