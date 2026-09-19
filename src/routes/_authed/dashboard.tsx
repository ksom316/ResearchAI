import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/page-header'
import { DashboardSection } from '#/features/dashboard/dashboard-section'
import { RecentProjects } from '#/features/dashboard/recent-projects'
import { StatsCards } from '#/features/dashboard/stats-cards'
import { PaperList } from '#/features/papers/components/paper-list'
import { CreateProjectButton } from '#/features/projects/components/create-project-button'

export const Route = createFileRoute('/_authed/dashboard')({
  head: () => ({ meta: [{ title: 'Dashboard · ResearchAI' }] }),
  component: DashboardPage,
})

function DashboardPage() {
  const { user } = Route.useRouteContext()
  const firstName = user.fullName.split(' ')[0]

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Pick up where you left off, or start a new line of inquiry."
        actions={<CreateProjectButton label="Create research project" />}
      />
      <div className="space-y-6">
        <StatsCards />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DashboardSection title="Recent projects" viewAllTo="/projects">
            <RecentProjects />
          </DashboardSection>
          <DashboardSection title="Recent papers" viewAllTo="/library">
            <PaperList
              limit={5}
              emptyDescription="Uploaded papers will show up here once uploads are available."
            />
          </DashboardSection>
        </div>
      </div>
    </>
  )
}
