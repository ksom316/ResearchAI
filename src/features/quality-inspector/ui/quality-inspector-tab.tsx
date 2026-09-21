import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QueryError } from '#/components/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import {
  extractionFieldsQuery,
  extractionOverviewsQuery,
} from '#/features/evidence-matrix/queries'
import { hasActiveExtraction } from '#/features/evidence-matrix/status'
import { papersQuery } from '#/features/papers/queries'
import type { WorkspaceTab } from '#/features/projects/workspace/tabs'
import { inspectWorkspace } from '../inspect'
import { qualityWorkspaceCoverageQuery } from '../queries'
import { buildWorkspaceInspectorInput } from '../workspace-adapter'
import { QualityInspectorView } from './quality-inspector-view'

export function QualityInspectorTab({
  projectId,
  onNavigate,
}: {
  projectId: string
  onNavigate: (tab: WorkspaceTab) => void
}) {
  const papers = useQuery(papersQuery({ projectId }))
  const paperIds = papers.data?.map((paper) => paper.id) ?? []
  const overviews = useQuery(extractionOverviewsQuery(paperIds))
  const fields = useQuery(
    extractionFieldsQuery(paperIds, {
      poll: hasActiveExtraction(overviews.data),
    }),
  )
  const coverage = useQuery(qualityWorkspaceCoverageQuery(projectId))

  const findings = useMemo(() => {
    if (!papers.data || !overviews.data || !fields.data || !coverage.data)
      return null
    return inspectWorkspace(
      buildWorkspaceInspectorInput({
        papers: papers.data,
        overviews: overviews.data,
        fields: fields.data,
        coverage: coverage.data,
      }),
    )
  }, [papers.data, overviews.data, fields.data, coverage.data])

  const error = papers.error ?? overviews.error ?? fields.error ?? coverage.error
  if (error) {
    return (
      <QueryError
        error={new Error('Research quality data could not be loaded.')}
        onRetry={() => {
          void Promise.all([
            papers.refetch(),
            overviews.refetch(),
            fields.refetch(),
            coverage.refetch(),
          ])
        }}
      />
    )
  }
  if (!findings) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading quality findings">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    )
  }

  return (
    <QualityInspectorView
      findings={findings}
      paperTitles={new Map((papers.data ?? []).map((paper) => [paper.id, paper.title]))}
      onNavigate={onNavigate}
    />
  )
}
