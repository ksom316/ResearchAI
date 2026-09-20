import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '#/components/ui/sheet'
import { groupSourcesByClaim } from '#/features/evidence-matrix/matrix-model'
import { extractionSourcesForSelection } from '#/features/evidence-matrix/queries'
import { SourceCard } from '#/features/evidence-matrix/ui/source-card'
import type { ExtractionSource } from '#/features/evidence-matrix/types'
import type { EvidenceSelection } from '../view-model'

/**
 * Provenance for a Research Map relationship: reuses Evidence Matrix's own lazy source
 * query (disabled until a relationship is opened) and its grouping/SourceCard, scoped
 * down to just the claim(s) that support this one paper/term (or paper/finding) edge.
 */
export function RelationshipEvidenceSheet({
  selected,
  onClose,
}: {
  selected: EvidenceSelection | null
  onClose: () => void
}) {
  const sources = useQuery(
    extractionSourcesForSelection(
      selected ? { paperId: selected.paperId, fieldKey: selected.fieldKey } : null,
    ),
  )

  return (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-xl">
        {selected && (
          <Body selected={selected} sources={sources.data} error={sources.error} onRetry={() => void sources.refetch()} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Body({
  selected,
  sources,
  error,
  onRetry,
}: {
  selected: EvidenceSelection
  sources: readonly ExtractionSource[] | undefined
  error: Error | null
  onRetry: () => void
}) {
  const loading = sources === undefined && !error
  const maxIndex = Math.max(0, ...selected.items.map((i) => i.itemIndex))
  const claims = Array.from({ length: maxIndex + 1 }, (_, i) => {
    const item = selected.items.find((x) => x.itemIndex === i)
    return item?.claimText ?? ''
  })
  const groups = sources ? groupSourcesByClaim(claims, sources) : null

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <SheetTitle className="text-lg font-semibold">
          {selected.contextLabel}
        </SheetTitle>
        <SheetDescription className="text-sm break-words text-muted-foreground">
          {selected.paperTitle}
        </SheetDescription>
      </header>

      {error && <QueryError error={error} onRetry={onRetry} />}
      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading sources…
        </p>
      )}

      <ol className="space-y-6">
        {selected.items.map((item) => {
          const group = groups?.[item.itemIndex]
          return (
            <li key={item.itemIndex}>
              {item.matchedPhrase && (
                <p className="text-xs text-muted-foreground">
                  Matched: <span className="font-medium text-foreground">&ldquo;{item.matchedPhrase}&rdquo;</span>
                </p>
              )}
              <p className="mt-1 text-sm break-words">{item.claimText}</p>
              {group && (
                <div className="mt-3 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                    Sources
                  </h4>
                  {group.sources.length > 0 ? (
                    group.sources.map((source) => (
                      <SourceCard key={`${source.itemIndex}-${source.ord}`} source={source} />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Source details are unavailable for this claim.
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link to="/papers/$paperId" params={{ paperId: selected.paperId }}>
            Open paper
          </Link>
        </Button>
      </div>
    </div>
  )
}
