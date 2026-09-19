import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, FlaskConical } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { formatDate } from '#/lib/format'
import { projectsQuery } from '#/features/projects/queries'
import { CreateProjectButton } from '#/features/projects/components/create-project-button'

export function RecentProjects() {
  const { data, error, isPending, refetch } = useQuery(projectsQuery(5))

  if (error) return <QueryError error={error} onRetry={() => refetch()} />
  if (isPending) return <Skeleton className="h-40 rounded-xl" />

  if (data.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title="Start your first project"
        description="Projects keep your papers, evidence, and writing organized."
        action={<CreateProjectButton label="Create research project" />}
      />
    )
  }

  return (
    <ul className="divide-y">
      {data.map((project) => (
        <li key={project.id}>
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="flex items-center gap-3 py-3 text-foreground no-underline hover:text-primary"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <FlaskConical className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {project.title}
              </span>
              <span className="block text-xs text-muted-foreground">
                Updated {formatDate(project.updated_at)}
              </span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
