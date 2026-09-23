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
      <img
        src="/researchai-icon.png"
        alt=""
        width={40}
        height={40}
        className="size-9 shrink-0 object-contain"
      />
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
