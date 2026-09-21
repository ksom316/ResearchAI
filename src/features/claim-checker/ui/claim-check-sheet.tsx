import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FileSearch, FileText, Loader2, RotateCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '#/components/ui/sheet'
import { WriterCitationSheet } from '#/features/writer/ui/writer-citation-sheet'
import type { WriterCitationSelection } from '#/features/writer/ui/grounded-draft-view'
import { claimCheckResultMessage } from '../presentation'
import type { ClaimCheckResult } from '../types'
import { ClaimSupportStatus } from './claim-support-status'
import type { ClaimCheckUnitCitation } from './claim-check-button'

export function ClaimCheckSheet({
  projectId,
  statement,
  citations,
  open,
  checking,
  result,
  onOpenChange,
  onCheck,
}: {
  projectId: string
  statement: string
  citations: readonly ClaimCheckUnitCitation[]
  open: boolean
  checking: boolean
  result: ClaimCheckResult | null
  onOpenChange: (open: boolean) => void
  onCheck: () => void
}) {
  const [evidenceSelection, setEvidenceSelection] =
    useState<WriterCitationSelection | null>(null)
  const sourceById = new Map(
    citations.map((entry) => [entry.citation.id, entry]),
  )
  const assessment =
    result?.ok && result.status === 'assessed' ? result.assessment : null
  const message = result ? claimCheckResultMessage(result) : null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto p-5 sm:max-w-2xl sm:p-6"
        >
          <div className="min-w-0 space-y-6">
            <header className="space-y-2 pr-7">
              <SheetTitle>Evidence-support assessment</SheetTitle>
              <SheetDescription>
                This checks whether the cited evidence supports this statement. It does not
                determine whether the statement is universally true.
              </SheetDescription>
            </header>

            <section className="min-w-0 space-y-2" aria-labelledby="checked-statement">
              <h3 id="checked-statement" className="text-sm font-semibold">
                Generated statement
              </h3>
              <blockquote className="min-w-0 border-l-2 pl-3 text-sm break-words text-muted-foreground">
                {statement}
              </blockquote>
            </section>

            <div aria-live="polite" aria-busy={checking}>
              {checking && (
                <div role="status" className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                  Checking the statement against its cited evidence…
                </div>
              )}

              {!checking && message && (
                <div role="alert" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {message}
                </div>
              )}

              {!checking && assessment && (
                <div className="min-w-0 space-y-6">
                  <section className="space-y-3" aria-labelledby="overall-support">
                    <h3 id="overall-support" className="text-sm font-semibold">
                      Overall assessment
                    </h3>
                    <ClaimSupportStatus support={assessment.overallSupport} />
                    <p className="text-sm break-words text-muted-foreground">
                      {assessment.summary}
                    </p>
                    {assessment.unsupportedFragments.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Unsupported portions</h4>
                        <ul className="space-y-2">
                          {assessment.unsupportedFragments.map((fragment) => (
                            <li
                              key={fragment}
                              className="rounded-lg border bg-muted/30 p-3 text-sm break-words"
                            >
                              &ldquo;{fragment}&rdquo;
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>

                  <section className="space-y-3" aria-labelledby="citation-assessments">
                    <h3 id="citation-assessments" className="text-sm font-semibold">
                      Citation assessments
                    </h3>
                    <div className="space-y-3">
                      {assessment.citations.map((citationAssessment) => {
                        const source = sourceById.get(citationAssessment.citationId)
                        if (!source) return null
                        return (
                          <article
                            key={citationAssessment.citationId}
                            className="min-w-0 space-y-3 rounded-xl border p-4"
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="shrink-0 text-sm font-semibold">
                                [{source.number}]
                              </span>
                              <ClaimSupportStatus support={citationAssessment.support} />
                            </div>
                            <p className="text-sm font-medium break-words">
                              {citationAssessment.paperTitle}
                            </p>
                            <p className="text-sm break-words text-muted-foreground">
                              {citationAssessment.rationale}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`View evidence for citation ${source.number} from ${citationAssessment.paperTitle}`}
                                onClick={() =>
                                  setEvidenceSelection({
                                    citation: source.citation,
                                    unitText: statement,
                                    number: source.number,
                                  })
                                }
                              >
                                <FileSearch aria-hidden="true" /> View evidence
                              </Button>
                              <Button asChild type="button" variant="outline" size="sm">
                                <Link
                                  to="/papers/$paperId"
                                  params={{ paperId: citationAssessment.paperId }}
                                  aria-label={`Open paper for citation ${source.number}: ${citationAssessment.paperTitle}`}
                                >
                                  <FileText aria-hidden="true" /> Open paper
                                </Link>
                              </Button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                </div>
              )}
            </div>

            {!checking && result && (
              <Button type="button" variant="outline" onClick={onCheck}>
                <RotateCw aria-hidden="true" /> Check support again
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <WriterCitationSheet
        projectId={projectId}
        selection={evidenceSelection}
        onClose={() => setEvidenceSelection(null)}
      />
    </>
  )
}
