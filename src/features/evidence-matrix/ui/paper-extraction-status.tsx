import { Clock, Loader2 } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { actionLabel } from '../status'
import type { ExtractionAction, ExtractionStatusView } from '../status'

/** Accessible names say what the button does to the paper's evidence. */
export function actionAriaLabel(
  action: ExtractionAction,
  paperTitle: string,
): string {
  switch (action) {
    case 'extract':
      return `Extract evidence for ${paperTitle}`
    case 'update':
      return `Update evidence for ${paperTitle}`
    case 'retry':
      return `Retry evidence extraction for ${paperTitle}`
  }
}

const VARIANT: Record<
  ExtractionStatusView['tone'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  muted: 'secondary',
  active: 'secondary',
  success: 'default',
  warning: 'outline',
  danger: 'destructive',
}

/**
 * Paper-level extraction state and its one action. Presentational: the caller owns the
 * request and says whether THIS paper's request is in flight. Nothing here starts an
 * extraction by itself. Failures are described generically (the reason is not readable
 * from the browser).
 */
export function PaperExtractionStatus({
  status,
  paperTitle,
  pending = false,
  onAction,
}: {
  status: ExtractionStatusView
  paperTitle: string
  /** This paper's extraction request is in flight. */
  pending?: boolean
  onAction?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={VARIANT[status.tone]}>
        {status.key === 'extracting' && (
          <Loader2 className="animate-spin" aria-hidden="true" />
        )}
        {status.key === 'queued' && <Clock aria-hidden="true" />}
        {status.label}
      </Badge>
      {status.action && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          aria-label={actionAriaLabel(status.action, paperTitle)}
          onClick={onAction}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {actionLabel(status.action)}
        </Button>
      )}
      {status.key === 'failed' && (
        <span className="text-xs text-muted-foreground">
          The extraction did not finish.
        </span>
      )}
    </div>
  )
}
