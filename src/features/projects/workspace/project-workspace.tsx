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
import { ChatPanel } from '#/features/chat/ui/chat-panel'
import { EvidenceMatrixTab } from '#/features/evidence-matrix/ui/evidence-matrix-tab'
import { ResearchMapTab } from '#/features/research-map/ui/research-map-tab'
import { DeleteProjectDialog } from '../components/delete-project-dialog'
import { RenameProjectDialog } from '../components/rename-project-dialog'
import { projectQuery } from '../queries'
import { OverviewTab } from './overview-tab'
import { PapersTab } from './papers-tab'
import { PlaceholderTab } from './placeholder-tab'
import { WORKSPACE_TABS } from './tabs'
import type { WorkspaceTab } from './tabs'

const PLACEHOLDERS = {
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
        {/* Mobile: a 3-column grid; labels may wrap inside their own pill.
            From sm up it is a single-row strip that never squeezes its tabs: it
            scrolls sideways (scrollbar hidden) when the row is wider than the page. */}
        <TabsList className="grid h-auto! w-full grid-cols-3 sm:inline-flex sm:h-9! sm:w-fit sm:max-w-full sm:justify-start sm:overflow-x-auto sm:overflow-y-hidden sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden">
          {WORKSPACE_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-center text-xs whitespace-normal sm:h-[calc(100%-1px)] sm:min-w-fit sm:flex-none sm:shrink-0 sm:flex-row sm:gap-1.5 sm:px-3 sm:py-1 sm:text-sm sm:whitespace-nowrap"
            >
              <Icon /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab project={project} />
        </TabsContent>
        <TabsContent value="papers" className="mt-6">
          <PapersTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="ai-research" className="mt-6">
          <ChatPanel key={project.id} projectId={project.id} />
        </TabsContent>
        <TabsContent value="evidence" className="mt-6">
          <EvidenceMatrixTab key={project.id} projectId={project.id} />
        </TabsContent>
        <TabsContent value="research-map" className="mt-6">
          <ResearchMapTab key={project.id} projectId={project.id} />
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
