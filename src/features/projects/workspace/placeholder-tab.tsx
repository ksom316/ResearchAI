import { EmptyState } from '#/components/empty-state'
import { Badge } from '#/components/ui/badge'
import type { LucideIcon } from 'lucide-react'

export function PlaceholderTab({
  icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={<Badge variant="secondary">Coming soon</Badge>}
    />
  )
}
