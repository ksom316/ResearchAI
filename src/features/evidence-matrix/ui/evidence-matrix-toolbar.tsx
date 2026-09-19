import type { MatrixSummary } from '../matrix-model'

const STATS: { key: keyof MatrixSummary; label: string }[] = [
  { key: 'total', label: 'Papers' },
  { key: 'current', label: 'Extracted' },
  { key: 'active', label: 'Queued or running' },
  { key: 'attention', label: 'Needs attention' },
]

/** Header for the tab: what this view is, and a few counts. No bulk actions. */
export function EvidenceMatrixToolbar({ summary }: { summary: MatrixSummary }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Evidence Matrix</h2>
        <p className="text-sm text-muted-foreground">
          Compare the extracted objective, methodology, dataset, findings,
          limitations, future work and concepts across the papers in this
          project.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STATS.map(({ key, label }) => (
          <div key={key} className="rounded-lg border bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold" data-stat={key}>
              {summary[key]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
