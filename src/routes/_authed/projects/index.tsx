import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/page-header'
import { CreateProjectButton } from '#/features/projects/components/create-project-button'
import { ProjectGrid } from '#/features/projects/components/project-grid'

export const Route = createFileRoute('/_authed/projects/')({
  head: () => ({ meta: [{ title: 'Research Projects · ResearchAI' }] }),
  component: ProjectsPage,
})

function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Research Projects"
        description="Each project is a workspace for one research question."
        actions={<CreateProjectButton />}
      />
      <ProjectGrid />
    </>
  )
}
