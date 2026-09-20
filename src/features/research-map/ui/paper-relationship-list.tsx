import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import type { ExtractionStatusKey } from '#/features/evidence-matrix/status'
import type { EvidenceSelection, PaperSummaryRow, SharedTermRef } from '../view-model'

/** Same vocabulary as the Evidence Matrix status badges, kept local (presentational only). */
const STATUS_LABEL: Record<ExtractionStatusKey, string> = {
  waiting: 'Waiting for processing',
  not_extracted: 'Not extracted',
  queued: 'Queued',
  extracting: 'Extracting…',
  extracted: 'Extracted',
  out_of_date: 'Out of date',
  partial: 'Partial',
  failed: 'Extraction failed',
}

function RelationshipRow({
  label,
  refs,
  fieldKey,
  paperId,
  paperTitle,
  onViewEvidence,
}: {
  label: string
  refs: readonly SharedTermRef[]
  fieldKey: EvidenceSelection['fieldKey']
  paperId: string
  paperTitle: string
  onViewEvidence: (selection: EvidenceSelection) => void
}) {
  if (refs.length === 0) return null
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}:</span>
      {refs.map((ref) => (
        <Button
          key={ref.id}
          type="button"
          size="xs"
          variant="outline"
          aria-label={`View evidence for ${ref.label} in ${paperTitle}`}
          onClick={() =>
            onViewEvidence({
              paperId,
              paperTitle,
              fieldKey,
              contextLabel: ref.label,
              items: ref.evidence,
            })
          }
        >
          {ref.label}
        </Button>
      ))}
    </div>
  )
}

/**
 * Paper-oriented view: one row per paper. An isolated paper (no shared terms, no
 * findings) is a perfectly normal row — never styled as an error or a failure.
 */
export function PaperRelationshipList({
  rows,
  onViewEvidence,
  renderTitle = (row) => <span>{row.title}</span>,
}: {
  rows: readonly PaperSummaryRow[]
  onViewEvidence: (selection: EvidenceSelection) => void
  renderTitle?: (row: PaperSummaryRow) => ReactNode
}) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const isolated =
          row.concepts.length === 0 &&
          row.methodologies.length === 0 &&
          row.datasets.length === 0 &&
          row.findings.length === 0
        return (
          <li key={row.paperId}>
            <Card className="gap-3 py-4">
              <CardContent className="space-y-2.5 px-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium break-words">
                    {renderTitle(row)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {STATUS_LABEL[row.statusKey]}
                  </span>
                </div>
                {isolated ? (
                  <p className="text-sm text-muted-foreground italic">
                    No shared relationships yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <RelationshipRow
                      label="Concepts"
                      refs={row.concepts}
                      fieldKey="concepts"
                      paperId={row.paperId}
                      paperTitle={row.title}
                      onViewEvidence={onViewEvidence}
                    />
                    <RelationshipRow
                      label="Methodologies"
                      refs={row.methodologies}
                      fieldKey="methodology"
                      paperId={row.paperId}
                      paperTitle={row.title}
                      onViewEvidence={onViewEvidence}
                    />
                    <RelationshipRow
                      label="Datasets"
                      refs={row.datasets}
                      fieldKey="dataset"
                      paperId={row.paperId}
                      paperTitle={row.title}
                      onViewEvidence={onViewEvidence}
                    />
                    {row.findings.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                          Findings ({row.findings.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {row.findings.map((f, i) => (
                            <li
                              key={f.id}
                              className="flex flex-wrap items-start justify-between gap-2 text-sm"
                            >
                              <span className="min-w-0 break-words">{f.text}</span>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                aria-label={`View evidence for finding ${i + 1} in ${row.title}`}
                                onClick={() =>
                                  onViewEvidence({
                                    paperId: row.paperId,
                                    paperTitle: row.title,
                                    fieldKey: 'findings',
                                    contextLabel: `Finding ${i + 1}`,
                                    items: [
                                      { itemIndex: f.itemIndex, matchedPhrase: null, claimText: f.text },
                                    ],
                                  })
                                }
                              >
                                View evidence
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
