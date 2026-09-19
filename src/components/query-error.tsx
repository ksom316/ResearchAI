import { AlertCircle } from 'lucide-react'
import { Button } from '#/components/ui/button'

export function QueryError({
  error,
  onRetry,
}: {
  error: Error
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <AlertCircle className="size-5 shrink-0 text-destructive" />
      <p className="flex-1">{error.message || 'Something went wrong.'}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
