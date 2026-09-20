import type { ResearchGapsSummary } from '../view-model'

const METRICS: {
  key: keyof Omit<ResearchGapsSummary, 'current' | 'stale'>
  label: string
}[] = [
  { key: 'potentialGaps', label: 'Potential gaps' },
  { key: 'supportingPapers', label: 'Supporting papers' },
  { key: 'evidenceClaims', label: 'Evidence claims' },
]

export function ResearchGapsSummaryView({
  summary,
}: {
  summary: ResearchGapsSummary
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Research Gaps</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Potential gaps and research opportunities supported by related papers
          in this corpus. Results are evidence-grounded and corpus-relative, not
          claims about the entire literature.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METRICS.map(({ key, label }) => (
          <div key={key} className="rounded-lg border bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold" data-stat={key}>
              {summary[key]}
            </dd>
          </div>
        ))}
        <div className="rounded-lg border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">Current / stale</dt>
          <dd className="text-lg font-semibold" data-stat="freshness">
            {summary.current} / {summary.stale}
          </dd>
        </div>
      </dl>
    </div>
  )
}
