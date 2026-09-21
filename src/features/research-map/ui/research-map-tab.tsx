import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Network } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { extractionFieldsQuery, extractionOverviewsQuery } from '#/features/evidence-matrix/queries'
import { hasActiveExtraction } from '#/features/evidence-matrix/status'
import { papersQuery } from '#/features/papers/queries'
import type { Paper } from '#/features/papers/types'
import { buildGraphViewModel } from '../graph-view-model'
import {
  buildPaperSummaries,
  buildTermIndex,
  deriveResearchMapState,
  filterPaperSummaries,
  filterTermIndex,
} from '../view-model'
import type { EvidenceSelection, TermKindFilter } from '../view-model'
import { PaperRelationshipList } from './paper-relationship-list'
import { RelationshipEvidenceSheet } from './relationship-evidence-sheet'
import { RelationshipIndex } from './relationship-index'
import { ResearchMapFilters } from './research-map-filters'
import { ResearchMapSummaryView } from './research-map-summary'
import { VisualMap } from './visual-map'

type ViewMode = 'graph' | 'index'

const paperLink = (paper: Paper) => (
  <Link
    to="/papers/$paperId"
    params={{ paperId: paper.id }}
    className="break-words text-foreground no-underline hover:underline"
  >
    {paper.title}
  </Link>
)

/**
 * Project-level Research Map. Reuses the Evidence Matrix browser data layer for
 * fetching (papers, overviews, fields, sources) and derives the map client-side with
 * the frozen deriveResearchMap engine. Never triggers extraction: everything here is a
 * read of already-persisted data.
 */
export function ResearchMapTab({ projectId }: { projectId: string }) {
  const papers = useQuery(papersQuery({ projectId }))
  const paperIds = papers.data?.map((p) => p.id) ?? []
  const overviews = useQuery(extractionOverviewsQuery(paperIds))
  const fields = useQuery(
    extractionFieldsQuery(paperIds, { poll: hasActiveExtraction(overviews.data) }),
  )

  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<TermKindFilter>('all')
  const [hideStale, setHideStale] = useState(false)
  const [selection, setSelection] = useState<EvidenceSelection | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('graph')
  const [mobileViewMode, setMobileViewMode] = useState<ViewMode>('index')
  const [showFindings, setShowFindings] = useState(false)

  const state = useMemo(
    () => deriveResearchMapState({ papers, overviews, fields }),
    [
      papers.data,
      papers.error,
      papers.isPending,
      overviews.data,
      overviews.error,
      overviews.isPending,
      fields.data,
      fields.error,
      fields.isPending,
    ],
  )

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
          icon={Network}
          title="No papers to map yet"
          description="Add papers to this project on the Papers tab, then extract their evidence, to see how they relate here."
        />
      )
    case 'ready': {
      const termIndex = buildTermIndex(state.map, state.fields)
      const paperRows = buildPaperSummaries(state.map, state.fields)
      const filteredTerms = filterTermIndex(termIndex, { kind, search, hideStale })
      const filteredPapers = filterPaperSummaries(paperRows, search)
      const filtersActive = search.trim() !== '' || kind !== 'all' || hideStale
      const renderTitle = (row: { paperId: string; title: string }): ReactNode => {
        const paper = papers.data?.find((p) => p.id === row.paperId)
        return paper ? paperLink(paper) : <span>{row.title}</span>
      }

      const indexView = (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">
              Relationships
            </h3>
            <RelationshipIndex
              entries={filteredTerms}
              onViewEvidence={setSelection}
              filtersActive={filtersActive}
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">
              Papers
            </h3>
            <PaperRelationshipList
              rows={filteredPapers}
              onViewEvidence={setSelection}
              renderTitle={renderTitle}
            />
          </div>
        </div>
      )

      const graph = buildGraphViewModel(filteredTerms, filteredPapers, { showFindings })

      return (
        <div className="space-y-4">
          <ResearchMapSummaryView summary={state.map.summary} />
          <ResearchMapFilters
            search={search}
            onSearchChange={setSearch}
            kind={kind}
            onKindChange={setKind}
            hideStale={hideStale}
            onHideStaleChange={setHideStale}
            showStaleToggle={state.map.summary.stalePapers > 0}
          />

          {/* Mobile keeps the structured index by default and offers the visual map explicitly. */}
          <div className="space-y-4 md:hidden">
            <div
              role="group"
              aria-label="Research Map mobile display mode"
              className="flex flex-wrap items-center gap-2"
            >
              <Button
                type="button"
                size="xs"
                variant={mobileViewMode === 'graph' ? 'secondary' : 'outline'}
                aria-pressed={mobileViewMode === 'graph'}
                onClick={() => setMobileViewMode('graph')}
              >
                Visual Map
              </Button>
              <Button
                type="button"
                size="xs"
                variant={mobileViewMode === 'index' ? 'secondary' : 'outline'}
                aria-pressed={mobileViewMode === 'index'}
                onClick={() => setMobileViewMode('index')}
              >
                Relationship Index
              </Button>
              {mobileViewMode === 'graph' && (
                <Button
                  type="button"
                  size="xs"
                  variant={showFindings ? 'secondary' : 'outline'}
                  aria-pressed={showFindings}
                  onClick={() => setShowFindings((value) => !value)}
                >
                  {showFindings ? 'Hide findings' : 'Show findings'}
                </Button>
              )}
            </div>
            {mobileViewMode === 'graph' ? (
              <VisualMap
                graph={graph}
                onViewEvidence={setSelection}
                onSwitchToIndex={() => setMobileViewMode('index')}
              />
            ) : (
              indexView
            )}
          </div>

          {/* Tablet/desktop: an explicit switcher between the visual map and the index. */}
          <div className="hidden space-y-4 md:block">
            <div
              role="group"
              aria-label="Research Map display mode"
              className="flex flex-wrap items-center gap-2"
            >
              <Button
                type="button"
                size="xs"
                variant={viewMode === 'graph' ? 'secondary' : 'outline'}
                aria-pressed={viewMode === 'graph'}
                onClick={() => setViewMode('graph')}
              >
                Visual Map
              </Button>
              <Button
                type="button"
                size="xs"
                variant={viewMode === 'index' ? 'secondary' : 'outline'}
                aria-pressed={viewMode === 'index'}
                onClick={() => setViewMode('index')}
              >
                Relationship Index
              </Button>
              {viewMode === 'graph' && (
                <Button
                  type="button"
                  size="xs"
                  variant={showFindings ? 'secondary' : 'outline'}
                  aria-pressed={showFindings}
                  onClick={() => setShowFindings((v) => !v)}
                >
                  {showFindings ? 'Hide findings' : 'Show findings'}
                </Button>
              )}
            </div>
            {viewMode === 'graph' ? (
              <VisualMap
                graph={graph}
                onViewEvidence={setSelection}
                onSwitchToIndex={() => setViewMode('index')}
              />
            ) : (
              indexView
            )}
          </div>

          <RelationshipEvidenceSheet selected={selection} onClose={() => setSelection(null)} />
        </div>
      )
    }
  }
}
