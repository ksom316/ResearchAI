import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileSearch, Lightbulb } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import {
  extractionFieldsQuery,
  extractionOverviewsQuery,
} from '#/features/evidence-matrix/queries'
import { hasActiveExtraction } from '#/features/evidence-matrix/status'
import { papersQuery } from '#/features/papers/queries'
import {
  availableGapTypes,
  buildGapCandidateView,
  buildGapEvidenceSelection,
  deriveResearchGapsState,
  filterGapCandidates,
  summarizeResearchGaps,
} from '../view-model'
import type {
  GapEvidenceSelection,
  GapStatusFilter,
  GapTypeFilter,
} from '../view-model'
import { GapCandidateCard } from './gap-candidate-card'
import { GapEvidenceSheet } from './gap-evidence-sheet'
import { ResearchGapsFilters } from './research-gaps-filters'
import { ResearchGapsSummaryView } from './research-gaps-summary'

/**
 * Project-level, read-only explorer. Reuses the Evidence Matrix React Query cache,
 * derives Research Map + gaps client-side, and fetches provenance only in the open sheet.
 */
export function ResearchGapsTab({ projectId }: { projectId: string }) {
  const papers = useQuery(papersQuery({ projectId }))
  const paperIds = papers.data?.map((paper) => paper.id) ?? []
  const overviews = useQuery(extractionOverviewsQuery(paperIds))
  const fields = useQuery(
    extractionFieldsQuery(paperIds, {
      poll: hasActiveExtraction(overviews.data),
    }),
  )
  const [typeFilter, setTypeFilter] = useState<GapTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<GapStatusFilter>('all')
  const [selection, setSelection] = useState<GapEvidenceSelection | null>(null)
  const state = deriveResearchGapsState({ papers, overviews, fields })

  switch (state.kind) {
    case 'loading':
      return (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-20 rounded-lg" />
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
          icon={FileSearch}
          title="No papers to analyze yet"
          description="Add papers to this project before looking for grounded potential gaps in the corpus."
          action={
            <Button asChild variant="outline">
              <Link
                to="/projects/$projectId"
                params={{ projectId }}
                search={{ tab: 'papers' }}
              >
                View papers
              </Link>
            </Button>
          }
        />
      )
    case 'not_ready':
      return (
        <EmptyState
          icon={Lightbulb}
          title="Paper intelligence is not ready yet"
          description="At least two papers need processed Evidence Matrix extractions before grounded potential gaps can be identified. Extraction is never started automatically here."
          action={
            <Button asChild variant="outline">
              <Link
                to="/projects/$projectId"
                params={{ projectId }}
                search={{ tab: 'evidence' }}
              >
                View Evidence Matrix
              </Link>
            </Button>
          }
        />
      )
    case 'ready': {
      const summary = summarizeResearchGaps(state.candidates)
      if (state.candidates.length === 0)
        return (
          <div className="space-y-4">
            <ResearchGapsSummaryView summary={summary} />
            <EmptyState
              icon={Lightbulb}
              title="No grounded potential gaps found in this corpus yet"
              description="ResearchAI only surfaces potential gaps or opportunities supported by multiple directly related papers. It abstains when the available evidence is insufficient."
            />
          </div>
        )

      const filtered = filterGapCandidates(state.candidates, {
        type: typeFilter,
        status: statusFilter,
      })
      return (
        <div className="min-w-0 space-y-4">
          <ResearchGapsSummaryView summary={summary} />
          <ResearchGapsFilters
            availableTypes={availableGapTypes(state.candidates)}
            type={typeFilter}
            status={statusFilter}
            onTypeChange={setTypeFilter}
            onStatusChange={setStatusFilter}
          />
          {filtered.length > 0 ? (
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
              {filtered.map((candidate) => {
                const view = buildGapCandidateView(candidate, state.map)
                return (
                  <GapCandidateCard
                    key={candidate.id}
                    view={view}
                    onViewEvidence={() =>
                      setSelection(
                        buildGapEvidenceSelection(
                          candidate,
                          state.map,
                          state.fields,
                        ),
                      )
                    }
                  />
                )
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No potential gaps match the selected filters.
            </p>
          )}
          <GapEvidenceSheet
            selected={selection}
            onClose={() => setSelection(null)}
          />
        </div>
      )
    }
  }
}
