import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FlaskConical, Pencil, Trash2 } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { PageHeader } from '#/components/page-header'
import { DeleteProjectDialog } from '../components/delete-project-dialog'
import { RenameProjectDialog } from '../components/rename-project-dialog'
import { projectQuery } from '../queries'
import { OverviewTab } from './overview-tab'
import { PapersTab } from './papers-tab'
import { PlaceholderTab } from './placeholder-tab'
import { WORKSPACE_TABS } from './tabs'
import type { WorkspaceTab } from './tabs'

const PLACEHOLDERS = {
  'ai-research': {
    title: 'AI Research',
    description:
      'Chat with your sources and surface possible research gaps, grounded in your papers.',
  },
  evidence: {
    title: 'Evidence',
    description:
      'Collect quotes and findings from your papers and organize them by claim.',
  },
  comparisons: {
    title: 'Comparisons',
    description:
      'Compare methods, datasets, and results across papers side by side.',
  },
  writing: {
    title: 'Writing',
    description:
      'Draft with citation-grounded assistance tied to your evidence.',
  },
} as const

export function ProjectWorkspace({
  projectId,
  tab,
  onTabChange,
}: {
  projectId: string
  tab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
}) {
  const navigate = useNavigate()
  const {
    data: project,
    error,
    isPending,
    refetch,
  } = useQuery(projectQuery(projectId))
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const back = (
    <Link
      to="/projects"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground no-underline hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> All projects
    </Link>
  )

  if (error) {
    return (
      <>
        {back}
        <QueryError error={error} onRetry={() => refetch()} />
      </>
    )
  }

  if (isPending) {
    return (
      <>
        {back}
        <Skeleton className="mb-8 h-10 w-72" />
        <Skeleton className="h-64 rounded-xl" />
      </>
    )
  }

  if (!project) {
    return (
      <>
        {back}
        <EmptyState
          icon={FlaskConical}
          title="Project not found"
          description="It may have been deleted, or you may not have access to it."
        />
      </>
    )
  }

  return (
    <>
      {back}
      <PageHeader
        title={project.title}
        description={project.description ?? undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => setRenameOpen(true)}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Delete project"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as WorkspaceTab)}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {WORKSPACE_TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab project={project} />
        </TabsContent>
        <TabsContent value="papers" className="mt-6">
          <PapersTab projectId={project.id} />
        </TabsContent>
        {WORKSPACE_TABS.filter((t) => t.value in PLACEHOLDERS).map(
          ({ value, icon }) => (
            <TabsContent key={value} value={value} className="mt-6">
              <PlaceholderTab
                icon={icon}
                {...PLACEHOLDERS[value as keyof typeof PLACEHOLDERS]}
              />
            </TabsContent>
          ),
        )}
      </Tabs>

      <RenameProjectDialog
        project={project}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteProjectDialog
        project={project}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => void navigate({ to: '/projects' })}
      />
    </>
  )
}
