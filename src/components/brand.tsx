import { BookOpenText } from 'lucide-react'
import { cn } from '#/lib/utils'

export function Brand({
  className,
  tone = 'default',
}: {
  className?: string
  tone?: 'default' | 'light'
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <BookOpenText className="size-5" />
      </span>
      <span
        className={cn(
          'font-heading text-xl font-semibold',
          tone === 'light' && 'text-white',
        )}
      >
        ResearchAI
      </span>
    </div>
  )
}
