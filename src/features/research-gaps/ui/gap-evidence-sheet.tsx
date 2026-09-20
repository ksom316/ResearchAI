import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '#/components/ui/sheet'
import { extractionSourcesForSelection } from '#/features/evidence-matrix/queries'
import { SourceCard } from '#/features/evidence-matrix/ui/source-card'
import type { GapEvidenceClaim, GapEvidenceSelection } from '../view-model'

function ClaimSources({
  paperId,
  claim,
}: {
  paperId: string
  claim: GapEvidenceClaim
}) {
  const sources = useQuery(
    extractionSourcesForSelection({ paperId, fieldKey: claim.fieldKey }),
  )
  if (sources.error)
    return <QueryError error={sources.error} onRetry={() => void sources.refetch()} />
  if (!sources.data)
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading sources…
      </p>
    )
  const matching = sources.data.filter(
    (source) => source.itemIndex === claim.itemIndex,
  )
  if (matching.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Source details are unavailable for this claim.
      </p>
    )
  return (
    <div className="space-y-2">
      {matching.map((source) => (
        <SourceCard
          key={`${source.itemIndex}-${source.ord}`}
          source={source}
        />
      ))}
    </div>
  )
}

export function GapEvidenceSheet({
  selected,
  onClose,
}: {
  selected: GapEvidenceSelection | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-6 sm:max-w-2xl"
      >
        {selected && (
          <div className="space-y-6">
            <header className="space-y-2 pr-6">
              <Badge variant="secondary">Potential {selected.typeLabel.toLowerCase()}</Badge>
              <SheetTitle className="text-lg break-words">
                {selected.heading}
              </SheetTitle>
              <SheetDescription>
                Supported by {selected.candidate.supportCount}{' '}
                {selected.candidate.supportCount === 1 ? 'paper' : 'papers'} in
                this corpus. Review the extracted claims and their persisted sources
                below.
              </SheetDescription>
            </header>

            {selected.showStaleWarning && (
              <p
                role="note"
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Some supporting evidence is from an older paper-processing
                  generation. Refresh the affected paper intelligence before relying
                  on this result.
                </span>
              </p>
            )}

            <section className="space-y-2" aria-labelledby="gap-explanation-heading">
              <h3 id="gap-explanation-heading" className="text-sm font-semibold">
                Why this was surfaced
              </h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {selected.explanations.map((explanation) => (
                  <li key={explanation}>{explanation}</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2" aria-labelledby="gap-relationships-heading">
              <h3 id="gap-relationships-heading" className="text-sm font-semibold">
                Related Research Map terms
              </h3>
              <div className="flex flex-wrap gap-2">
                {selected.relatedTerms.map((term) => (
                  <Badge key={term.termId} variant="outline" className="whitespace-normal">
                    {term.label}
                  </Badge>
                ))}
              </div>
            </section>

            <div className="space-y-6">
              {selected.evidencePapers.map((paper) => (
                <section
                  key={paper.paperId}
                  className="min-w-0 space-y-4 border-t pt-5"
                  aria-labelledby={`gap-paper-${paper.paperId}`}
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <h3
                      id={`gap-paper-${paper.paperId}`}
                      className="min-w-0 font-semibold break-words"
                    >
                      {paper.title}
                    </h3>
                    <Button asChild variant="outline" size="xs">
                      <Link
                        to="/papers/$paperId"
                        params={{ paperId: paper.paperId }}
                      >
                        Open paper
                      </Link>
                    </Button>
                  </div>
                  {paper.claims.map((claim) => (
                    <article
                      key={`${claim.fieldKey}-${claim.itemIndex}`}
                      className="min-w-0 space-y-3"
                    >
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase">
                          {claim.fieldLabel}
                        </p>
                        <p className="mt-1 text-sm break-words">{claim.text}</p>
                      </div>
                      <ClaimSources paperId={paper.paperId} claim={claim} />
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
