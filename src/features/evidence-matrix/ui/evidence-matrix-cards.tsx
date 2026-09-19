import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import type { Paper } from '#/features/papers/types'
import type { ClaimSelection } from '../types'
import { FIELD_KEYS } from '../fields'
import { cellModel, FIELD_LABELS, itemCountLabel } from '../matrix-model'
import type { MatrixRow } from '../matrix-model'
import { PaperExtractionStatus } from './paper-extraction-status'

/**
 * Mobile layout: one Card per paper with seven sections. Extracted fields are native
 * <details> (keyboard accessible, no dependency); everything else is a plain line.
 */
export function EvidenceMatrixCards({
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
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.paper.id}>
          <Card className="gap-3 py-4">
            <CardContent className="space-y-3 px-4">
              <div className="space-y-2">
                <div className="text-sm font-medium break-words">
                  {renderTitle(row.paper)}
                </div>
                <PaperExtractionStatus
                  status={row.status}
                  paperTitle={row.paper.title}
                  pending={pendingIds.has(row.paper.id)}
                  onAction={() => onRequest(row.paper.id)}
                />
              </div>
              <div className="divide-y rounded-md border">
                {FIELD_KEYS.map((key) => {
                  const model = cellModel(row.fields[key])
                  const label = FIELD_LABELS[key]
                  if (model.kind === 'extracted') {
                    return (
                      <details key={key} className="group px-3 py-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
                          <span>{label}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {itemCountLabel(model.items.length)}
                          </span>
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {model.items.map((text, i) => (
                            <li key={i} className="text-sm break-words">
                              {text}
                            </li>
                          ))}
                        </ul>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="mt-3"
                          aria-label={`View evidence for ${label} of ${row.paper.title}`}
                          onClick={() =>
                            onViewEvidence({
                              paperId: row.paper.id,
                              fieldKey: key,
                            })
                          }
                        >
                          View evidence
                        </Button>
                      </details>
                    )
                  }
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {model.kind === 'not_reported' && 'Not reported'}
                        {model.kind === 'failed' && 'Field unavailable'}
                        {model.kind === 'malformed' && 'Unable to display'}
                        {model.kind === 'missing' && 'No data'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
