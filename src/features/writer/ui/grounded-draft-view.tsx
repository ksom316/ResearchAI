import { Check, Copy, FileText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { citationNumberMap, formatDraftForCopy } from '../presentation'
import type { GroundedDraft, GroundedDraftCitation } from '../types'

export type WriterCitationSelection = {
  citation: GroundedDraftCitation
  unitText: string
  number: number
}

export function GroundedDraftView({
  draft,
  onSelectCitation,
}: {
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
                {unit.citationIds.map((id) => {
                  const citation = citations.get(id)
                  const number = numbers.get(id)
                  if (!citation || number === undefined) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={`Citation ${number}: evidence from ${citation.paperTitle}`}
                      onClick={() =>
                        onSelectCitation({ citation, unitText: unit.text, number })
                      }
                      className="mx-0.5 inline-flex h-6 min-w-7 items-center justify-center rounded-md border bg-accent px-1.5 align-baseline text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      [{number}]
                    </button>
                  )
                })}
              </span>
            ))}
          </p>
        ))}
        <p className="flex items-start gap-2 border-t pt-4 text-xs text-muted-foreground">
          <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Citations identify evidence used for each generated statement; they do not by themselves prove entailment.
        </p>
      </CardContent>
    </Card>
  )
}
