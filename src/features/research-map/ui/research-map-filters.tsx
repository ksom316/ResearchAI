import { Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { TERM_KIND_LABELS } from '../view-model'
import type { TermKindFilter } from '../view-model'

const KIND_OPTIONS: { value: TermKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'concept', label: TERM_KIND_LABELS.concept },
  { value: 'methodology', label: TERM_KIND_LABELS.methodology },
  { value: 'dataset', label: TERM_KIND_LABELS.dataset },
]

/** Lightweight, deliberately small: a search box, a kind toggle, and an optional stale toggle. */
export function ResearchMapFilters({
  search,
  onSearchChange,
  kind,
  onKindChange,
  hideStale,
  onHideStaleChange,
  showStaleToggle,
}: {
  search: string
  onSearchChange: (value: string) => void
  kind: TermKindFilter
  onKindChange: (value: TermKindFilter) => void
  hideStale: boolean
  onHideStaleChange: (value: boolean) => void
  showStaleToggle: boolean
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search terms or papers…"
          aria-label="Search research map terms and papers"
          className="pl-9"
        />
      </div>
      <div
        role="group"
        aria-label="Filter by relationship kind"
        className="flex flex-wrap gap-1.5"
      >
        {KIND_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="xs"
            variant={kind === opt.value ? 'secondary' : 'outline'}
            aria-pressed={kind === opt.value}
            onClick={() => onKindChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      {showStaleToggle && (
        <Button
          type="button"
          size="xs"
          variant={hideStale ? 'secondary' : 'outline'}
          aria-pressed={hideStale}
          onClick={() => onHideStaleChange(!hideStale)}
        >
          Hide out-of-date
        </Button>
      )}
    </div>
  )
}
