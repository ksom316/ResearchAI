import { formatPages, humanize } from '#/lib/format'
import type { ExtractionSource } from '../types'

/**
 * One piece of provenance: where in the paper a claim came from. Everything is the stored
 * snapshot, shown as plain text (never HTML). Nothing is invented: a missing page label
 * or excerpt is omitted or stated as unavailable.
 */
export function SourceCard({ source }: { source: ExtractionSource }) {
  const type = humanize(source.sectionType)
  const title = source.sectionTitle.trim() || type
  const pages = formatPages(source.pageStart, source.pageEnd)
  const excerpt = source.excerpt?.trim() ?? ''
  const showType = title.toLowerCase() !== type.toLowerCase()

  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-3 text-sm">
      <p className="font-medium break-words">
        {title}
        {(showType || pages) && (
          <span className="font-normal text-muted-foreground">
            {showType && (
              <>
                {' · '}
                <span className="capitalize">{type}</span>
              </>
            )}
            {pages && ` · ${pages}`}
          </span>
        )}
      </p>
      {excerpt ? (
        <blockquote className="mt-2 border-l-2 pl-3 break-words whitespace-pre-line text-muted-foreground">
          {excerpt}
        </blockquote>
      ) : (
        <p className="mt-2 text-muted-foreground italic">
          No excerpt available.
        </p>
      )}
    </div>
  )
}
