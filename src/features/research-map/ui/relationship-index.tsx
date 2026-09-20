import { Button } from '#/components/ui/button'
import { makeEvidenceSelection, TERM_KIND_LABELS } from '../view-model'
import type { EvidenceSelection, TermIndexEntry } from '../view-model'
import type { TermKind } from '../types'

const KIND_ORDER: readonly TermKind[] = ['concept', 'methodology', 'dataset']

/**
 * The Concepts / Methodologies / Datasets index. Each shared term is a collapsed
 * <details> naming only its display label and connected papers — never the
 * normalization key or an internal id.
 */
export function RelationshipIndex({
  entries,
  onViewEvidence,
  filtersActive = false,
}: {
  entries: readonly TermIndexEntry[]
  onViewEvidence: (selection: EvidenceSelection) => void
  /** True when search/kind/stale filters are narrowing the list, for accurate empty-state wording. */
  filtersActive?: boolean
}) {
  return (
    <div className="space-y-5">
      {KIND_ORDER.map((kind) => {
        const forKind = entries.filter((e) => e.kind === kind)
        return (
          <section key={kind} aria-label={TERM_KIND_LABELS[kind]}>
            <h3 className="text-sm font-semibold">
              {TERM_KIND_LABELS[kind]} ({forKind.length})
            </h3>
            {forKind.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {filtersActive
                  ? `No ${TERM_KIND_LABELS[kind].toLowerCase()} match the current filters.`
                  : `No shared ${TERM_KIND_LABELS[kind].toLowerCase()} yet.`}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {forKind.map((entry) => (
                  <li key={entry.id}>
                    <details className="rounded-md border px-3 py-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
                        <span className="break-words">{entry.label}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {entry.papers.length} papers
                        </span>
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {entry.papers.map((p) => (
                          <li
                            key={p.paperId}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <span className="break-words">
                              {p.title}
                              {p.isStale && (
                                <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-500">
                                  (out of date)
                                </span>
                              )}
                            </span>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              aria-label={`View evidence for ${entry.label} in ${p.title}`}
                              onClick={() =>
                                onViewEvidence(
                                  makeEvidenceSelection(
                                    p.paperId,
                                    p.title,
                                    entry.fieldKey,
                                    entry.label,
                                    p.evidence,
                                  ),
                                )
                              }
                            >
                              View evidence
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
