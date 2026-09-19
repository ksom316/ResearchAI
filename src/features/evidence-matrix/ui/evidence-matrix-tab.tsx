import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { papersQuery } from '#/features/papers/queries'
import type { Paper } from '#/features/papers/types'
import {
  deriveMatrixState,
  findSelectedClaims,
  requestExtractionOnce,
} from '../matrix-model'
import {
  extractionFieldsQuery,
  extractionOverviewsQuery,
  useRequestExtraction,
} from '../queries'
import { hasActiveExtraction } from '../status'
import type { ClaimSelection, ExtractionOverview } from '../types'
import { ClaimDetailSheet } from './claim-detail-sheet'
import { EvidenceMatrixView } from './evidence-matrix-view'

/** Fields refresh only while some extraction is queued or running. */
export const fieldsQueryFor = (
  paperIds: readonly string[],
  overviews: readonly ExtractionOverview[] | undefined,
) => extractionFieldsQuery(paperIds, { poll: hasActiveExtraction(overviews) })

const paperLink = (paper: Paper) => (
  <Link
    to="/papers/$paperId"
    params={{ paperId: paper.id }}
    className="text-foreground no-underline hover:underline"
  >
    {paper.title}
  </Link>
)

/**
 * Project-level Evidence Matrix. Loads the project's papers plus their extraction
 * overviews and fields, joins them in memory, and only ever requests an extraction when
 * the user presses a button.
 */
export function EvidenceMatrixTab({ projectId }: { projectId: string }) {
  const papers = useQuery(papersQuery({ projectId }))
  const paperIds = papers.data?.map((p) => p.id) ?? []
  const overviews = useQuery(extractionOverviewsQuery(paperIds))
  const fields = useQuery(fieldsQueryFor(paperIds, overviews.data))
  const request = useRequestExtraction()
  // One selection for both layouts. Nothing is fetched until a field is selected.
  const [selection, setSelection] = useState<ClaimSelection | null>(null)

  const inFlight = useRef(new Set<string>()).current
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const onRequest = (paperId: string) =>
    void requestExtractionOnce(
      paperId,
      inFlight,
      (id) => request.mutateAsync(id),
      setPendingIds,
    )

  const state = deriveMatrixState({ papers, overviews, fields })

  switch (state.kind) {
    case 'loading':
      return (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )
    case 'error':
      return (
        <QueryError
          error={state.error}
          onRetry={() => {
            if (state.source === 'papers') void papers.refetch()
            else {
              void overviews.refetch()
              void fields.refetch()
            }
          }}
        />
      )
    case 'empty':
      return (
        <EmptyState
          icon={FileText}
          title="No papers to compare yet"
          description="Add papers to this project first: upload a PDF or add one from your Library on the Papers tab. Once they are processed you can extract evidence here."
        />
      )
    case 'ready':
      return (
        <>
          <EvidenceMatrixView
            rows={state.rows}
            pendingIds={pendingIds}
            onRequest={onRequest}
            onViewEvidence={setSelection}
            renderTitle={paperLink}
          />
          <ClaimDetailSheet
            selected={findSelectedClaims(state.rows, selection)}
            onClose={() => setSelection(null)}
          />
        </>
      )
  }
}
