import { createFileRoute } from '@tanstack/react-router'
import { ProjectWorkspace } from '#/features/projects/workspace/project-workspace'
import { parseWorkspaceTab } from '#/features/projects/workspace/tabs'
import type { WorkspaceTab } from '#/features/projects/workspace/tabs'

export const Route = createFileRoute('/_authed/projects/$projectId')({
  validateSearch: (search: Record<string, unknown>): { tab?: WorkspaceTab } =>
    search.tab === undefined ? {} : { tab: parseWorkspaceTab(search.tab) },
  head: () => ({ meta: [{ title: 'Project · ResearchAI' }] }),
  component: ProjectPage,
})

function ProjectPage() {
  const { projectId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ProjectWorkspace
      projectId={projectId}
      tab={tab ?? 'overview'}
      onTabChange={(next) =>
        void navigate({ search: { tab: next }, replace: true })
      }
    />
  )
}
