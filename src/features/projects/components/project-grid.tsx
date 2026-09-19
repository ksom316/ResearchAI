import { useQuery } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { projectsQuery } from '../queries'
import { CreateProjectButton } from './create-project-button'
import { ProjectCard } from './project-card'

export function ProjectGrid() {
  const { data, error, isPending, refetch } = useQuery(projectsQuery())

  if (error) return <QueryError error={error} onRetry={() => refetch()} />

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title="No research projects yet"
        description="Create your first project to start collecting papers and evidence."
        action={<CreateProjectButton label="Create research project" />}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  )
}
