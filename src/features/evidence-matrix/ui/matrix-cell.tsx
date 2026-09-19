import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '#/components/ui/button'
import type { CellModel } from '../matrix-model'

const muted = 'text-sm text-muted-foreground'

/**
 * Presentation of one cell. Values are shown as ordinary React text (never HTML) and are
 * only visually clamped: the full claim is always in the DOM.
 */
export function MatrixCellView({
  model,
  expanded,
  onToggle,
  label,
  paperTitle,
  onViewEvidence,
}: {
  model: CellModel
  expanded: boolean
  onToggle: () => void
  /** Column name, for accessible control labels. */
  label: string
  paperTitle: string
  /** Opens the provenance sheet; only ever provided for an extracted field. */
  onViewEvidence?: () => void
}) {
  switch (model.kind) {
    case 'not_reported':
      return <span className={cn(muted, 'italic')}>Not reported</span>
    case 'failed':
      return <span className={muted}>Field unavailable</span>
    case 'malformed':
      return <span className={muted}>Unable to display</span>
    case 'missing':
      return (
        <span className={muted}>
          <span aria-hidden="true">—</span>
          <span className="sr-only">No data</span>
        </span>
      )
    case 'extracted': {
      const shown = expanded ? model.items : [model.first]
      const multiple = model.items.length > 1
      return (
        <div className="space-y-1.5">
          <ul className="space-y-1.5">
            {shown.map((text, i) => (
              <li
                key={i}
                className={cn(
                  'text-sm break-words',
                  multiple && !expanded && 'line-clamp-3',
                )}
              >
                {text}
              </li>
            ))}
          </ul>
          {onViewEvidence && (
            <div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={onViewEvidence}
                aria-label={`View evidence for ${label} of ${paperTitle}`}
              >
                View evidence
              </Button>
            </div>
          )}
          {multiple && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? `Show fewer ${label} items`
                  : `Show all ${model.items.length} ${label} items`
              }
              className="text-xs font-medium text-primary hover:underline"
            >
              {expanded ? 'Show less' : `+${model.more} more`}
            </button>
          )}
        </div>
      )
    }
  }
}

/** Local expand/collapse only; no provenance is loaded here. */
export function MatrixCell({
  model,
  label,
  paperTitle,
  onViewEvidence,
  defaultExpanded = false,
}: {
  model: CellModel
  label: string
  paperTitle: string
  onViewEvidence?: () => void
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <MatrixCellView
      model={model}
      label={label}
      paperTitle={paperTitle}
      onViewEvidence={onViewEvidence}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    />
  )
}
