import { useQuery } from '@tanstack/react-query'
import { Clock, FlaskConical, HardDrive, Library } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { formatBytes } from '#/lib/format'
import { libraryStatsQuery } from '#/features/papers/queries'
import { projectsQuery } from '#/features/projects/queries'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string | undefined
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {value === undefined ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <p className="text-2xl font-semibold">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function StatsCards() {
  const projects = useQuery(projectsQuery())
  const library = useQuery(libraryStatsQuery)

  const activeThisWeek = projects.data?.filter(
    (p) => Date.now() - new Date(p.updated_at).getTime() < WEEK_MS,
  ).length

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={FlaskConical}
        label="Research projects"
        value={projects.data?.length.toString()}
      />
      <StatCard
        icon={Library}
        label="Papers in library"
        value={library.data?.paperCount.toString()}
      />
      <StatCard
        icon={Clock}
        label="Active this week"
        value={activeThisWeek?.toString()}
      />
      <StatCard
        icon={HardDrive}
        label="Storage used"
        value={library.data ? formatBytes(library.data.totalBytes) : undefined}
      />
    </div>
  )
}
