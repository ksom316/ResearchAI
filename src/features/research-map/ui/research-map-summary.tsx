import { AlertTriangle } from 'lucide-react'
import type { ResearchMapSummary } from '../types'

const STATS: { key: keyof ResearchMapSummary; label: string }[] = [
  { key: 'totalPapers', label: 'Papers' },
  { key: 'sharedConcepts', label: 'Shared concepts' },
  { key: 'sharedMethodologies', label: 'Shared methodologies' },
  { key: 'sharedDatasets', label: 'Shared datasets' },
  { key: 'findings', label: 'Findings' },
]

/**
 * Compact corpus summary: counts computed entirely by the frozen derivation engine
 * (map.summary), never recomputed here. A stale generation is called out but never
 * hides its relationships.
 */
export function ResearchMapSummaryView({ summary }: { summary: ResearchMapSummary }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Research Map</h2>
        <p className="text-sm text-muted-foreground">
          Concepts, methodologies and datasets shared across the papers in this
          project, derived from their Evidence Matrix extractions.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STATS.map(({ key, label }) => (
          <div key={key} className="rounded-lg border bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold" data-stat={key}>
              {summary[key]}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        {summary.contributingPapers} of {summary.totalPapers} papers currently
        contribute a shared relationship or finding.
      </p>
      {summary.stalePapers > 0 && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {summary.stalePapers} {summary.stalePapers === 1 ? 'paper has' : 'papers have'}{' '}
            out-of-date extractions. Their relationships are still shown, from the
            version they were last extracted from.
          </span>
        </p>
      )}
    </div>
  )
}
