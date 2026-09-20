import type { ElementType } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { groupSourcesByClaim } from '../matrix-model'
import type { SelectedClaims } from '../matrix-model'
import type { ExtractionSource } from '../types'
import { SourceCard } from './source-card'

/**
 * Content of the claim sheet: the field's claims, each with the sources that ground it.
 * Presentational and free of Radix, so it renders (and tests) without a dialog. The
 * sheet passes its Title/Description components for correct dialog labelling.
 */
export function ClaimDetailBody({
  selected,
  sources,
  error,
  onRetry,
  Title = 'h2',
  Description = 'p',
}: {
  selected: SelectedClaims
  /** undefined until the sources have loaded. */
  sources: readonly ExtractionSource[] | undefined
  error: Error | null
  onRetry: () => void
  Title?: ElementType
  Description?: ElementType
}) {
  const loading = sources === undefined && !error
  const groups = groupSourcesByClaim(selected.claims, sources ?? [])
  const idBase = `claim-${selected.paperId}-${selected.fieldKey}`

  return (
    <div className="space-y-5">
      <header className="space-y-2 pr-6">
        <Title className="text-lg font-semibold">{selected.fieldLabel}</Title>
        <Description className="text-sm break-words text-muted-foreground">
          {selected.paperTitle}
        </Description>
        {selected.isStale && (
          <p
            role="note"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              <strong>Out of date.</strong> This evidence was extracted from an
              older version of the paper&rsquo;s processing. It is shown as it was
              extracted; use Update on the paper to refresh it.
            </span>
          </p>
        )}
      </header>

      {error && <QueryError error={error} onRetry={onRetry} />}
      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading sources…
        </p>
      )}

      <ol className="space-y-6">
        {groups.map((group) => (
          <li key={group.index}>
            <section aria-labelledby={`${idBase}-${group.index}`}>
              <h3
                id={`${idBase}-${group.index}`}
                className="text-sm font-semibold"
              >
                Claim {group.index + 1}
              </h3>
              <p className="mt-1 text-sm break-words">{group.text}</p>
              {sources !== undefined && (
                <div className="mt-3 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                    Sources
                  </h4>
                  {group.sources.length > 0 ? (
                    group.sources.map((source) => (
                      <SourceCard
                        key={`${source.itemIndex}-${source.ord}`}
                        source={source}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Source details are unavailable for this claim.
                    </p>
                  )}
                </div>
              )}
            </section>
          </li>
        ))}
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
