import type { ReactNode } from 'react'
import type { Paper } from '#/features/papers/types'
import type { ClaimSelection } from '../types'
import { FIELD_KEYS } from '../fields'
import { cellModel, FIELD_LABELS } from '../matrix-model'
import type { MatrixRow } from '../matrix-model'
import { MatrixCell } from './matrix-cell'
import { PaperExtractionStatus } from './paper-extraction-status'

/**
 * Desktop matrix: a real <table> that scrolls horizontally inside its own container.
 * The Paper column is sticky so the title stays visible while scrolling across the
 * seven field columns.
 */
export function EvidenceMatrixTable({
  rows,
  pendingIds,
  onRequest,
  onViewEvidence,
  renderTitle,
}: {
  rows: readonly MatrixRow[]
  pendingIds: ReadonlySet<string>
  onRequest: (paperId: string) => void
  onViewEvidence: (selection: ClaimSelection) => void
  renderTitle: (paper: Paper) => ReactNode
}) {
  return (
    <div
      data-testid="matrix-scroll"
      className="overflow-x-auto rounded-lg border bg-card"
    >
      <table className="w-full min-w-[1200px] border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          Evidence matrix: extracted research fields for each paper
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 w-64 min-w-64 border-r border-b bg-card px-4 py-3 text-xs font-semibold text-muted-foreground uppercase"
            >
              Paper
            </th>
            {FIELD_KEYS.map((key) => (
              <th
                key={key}
                scope="col"
                className="min-w-56 border-b bg-card px-4 py-3 text-xs font-semibold text-muted-foreground uppercase"
              >
                {FIELD_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.paper.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 w-64 min-w-64 border-r border-b bg-card px-4 py-3 align-top font-normal"
              >
                <div className="space-y-2">
                  <div className="min-w-0 text-sm font-medium break-words">
                    {renderTitle(row.paper)}
                  </div>
                  <PaperExtractionStatus
                    status={row.status}
                    paperTitle={row.paper.title}
                    pending={pendingIds.has(row.paper.id)}
                    onAction={() => onRequest(row.paper.id)}
                  />
                </div>
              </th>
              {FIELD_KEYS.map((key) => {
                const model = cellModel(row.fields[key])
                return (
                  <td key={key} className="min-w-56 border-b px-4 py-3 align-top">
                    <MatrixCell
                      model={model}
                      label={FIELD_LABELS[key]}
                      paperTitle={row.paper.title}
                      onViewEvidence={
                        model.kind === 'extracted'
                          ? () =>
                              onViewEvidence({
                                paperId: row.paper.id,
                                fieldKey: key,
                              })
                          : undefined
                      }
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
