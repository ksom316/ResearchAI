import { Link } from '@tanstack/react-router'
import { BookOpen, Check, Copy, FileSearch, FileText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { ClaimCheckButton } from '#/features/claim-checker/ui/claim-check-button'
import { assessCitationMetadataCompleteness } from '#/features/citations/normalize'
import { formatNumericReference } from '#/features/citations/format'
import {
  citationNumberMap,
  formatDraftForCopy,
  groupUnitCitationsByPaper,
} from '../presentation'
import type { GroundedDraft, GroundedDraftCitation } from '../types'

export type WriterCitationSelection = {
  citation: GroundedDraftCitation
  /** Additional evidence from the same visible paper-level marker. */
  citations?: GroundedDraftCitation[]
  unitText: string
  number: number
}

export function GroundedDraftView({
  projectId,
  draft,
  onSelectCitation,
}: {
  projectId: string
  draft: GroundedDraft
  onSelectCitation: (selection: WriterCitationSelection) => void
}) {
  const [copied, setCopied] = useState(false)
  const numbers = citationNumberMap(draft)
  const citations = new Map(draft.citations.map((citation) => [citation.id, citation]))

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(formatDraftForCopy(draft))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <CardTitle className="break-words">{draft.title}</CardTitle>
          <p className="mt-2 text-xs text-muted-foreground">
            {draft.coverage.participatingPaperCount} papers represented ·{' '}
            {draft.citations.length} evidence items cited
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void copyDraft()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy draft'}
        </Button>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {draft.paragraphs.map((paragraph, paragraphIndex) => (
          <p key={paragraphIndex} className="min-w-0 leading-7 break-words">
            {paragraph.units.map((unit, unitIndex) => (
              <span key={unit.id}>
                {unitIndex > 0 && ' '}
                {unit.text}{' '}
                {groupUnitCitationsByPaper(draft, unit.citationIds).map((group) => {
                  const citation = group.citations[0]
                  return (
                    <button
                      key={group.paperId}
                      type="button"
                      aria-label={`Citation ${group.number}: ${group.citations.length} evidence item${group.citations.length === 1 ? '' : 's'} from ${group.paperTitle}`}
                      onClick={() =>
                        onSelectCitation({
                          citation,
                          citations: group.citations,
                          unitText: unit.text,
                          number: group.number,
                        })
                      }
                      className="mx-0.5 inline-flex h-6 min-w-7 items-center justify-center rounded-md border bg-accent px-1.5 align-baseline text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      [{group.number}]
                    </button>
                  )
                })}
                <ClaimCheckButton
                  projectId={projectId}
                  unit={unit}
                  citations={unit.citationIds.flatMap((id) => {
                    const citation = citations.get(id)
                    const number = numbers.get(id)
                    return citation && number !== undefined
                      ? [{ citation, number }]
                      : []
                  })}
                />
              </span>
            ))}
          </p>
        ))}
        <section className="min-w-0 space-y-3 border-t pt-4" aria-labelledby="writer-references">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4" aria-hidden="true" />
            <h3 id="writer-references" className="font-semibold">References</h3>
          </div>
          <ol className="space-y-3">
            {draft.references.map((reference) => {
              const completeness = assessCitationMetadataCompleteness(reference.metadata)
              const referenceCitations = reference.evidenceIds.flatMap((id) => {
                const citation = citations.get(id)
                return citation ? [citation] : []
              })
              const primary = referenceCitations[0]
              const unitText = draft.paragraphs
                .flatMap((paragraph) => paragraph.units)
                .find((unit) =>
                  unit.citationIds.some((id) => reference.evidenceIds.includes(id)),
                )?.text ?? draft.title
              return (
                <li key={reference.paperId} className="min-w-0 space-y-2 rounded-lg border p-3">
                  <p className="text-sm break-words">
                    {formatNumericReference(reference.number, reference.metadata)}
                  </p>
                  {completeness.status === 'incomplete' && (
                    <Badge variant="outline">Incomplete citation metadata</Badge>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`View cited evidence for reference ${reference.number}`}
                      onClick={() =>
                        onSelectCitation({
                          citation: primary,
                          citations: referenceCitations,
                          unitText,
                          number: reference.number,
                        })
                      }
                    >
                      <FileSearch aria-hidden="true" /> View evidence
                    </Button>
                    <Button asChild type="button" variant="outline" size="sm">
                      <Link
                        to="/papers/$paperId"
                        params={{ paperId: reference.paperId }}
                        aria-label={`Open paper for reference ${reference.number}`}
                      >
                        <FileText aria-hidden="true" /> Open paper
                      </Link>
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
        <p className="flex items-start gap-2 border-t pt-4 text-xs text-muted-foreground">
          <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Citations identify evidence used for each generated statement; they do not by themselves prove entailment.
        </p>
      </CardContent>
    </Card>
  )
}
