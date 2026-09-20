import { Button } from '#/components/ui/button'
import { gapTypeLabel } from '../presentation'
import type {
  GapStatusFilter,
  GapTypeFilter,
} from '../view-model'
import type { GapType } from '../types'

export function ResearchGapsFilters({
  availableTypes,
  type,
  status,
  onTypeChange,
  onStatusChange,
}: {
  availableTypes: readonly GapType[]
  type: GapTypeFilter
  status: GapStatusFilter
  onTypeChange: (value: GapTypeFilter) => void
  onStatusChange: (value: GapStatusFilter) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div
        role="group"
        aria-label="Filter potential gaps by type"
        className="flex flex-wrap gap-2"
      >
        <Button
          type="button"
          size="xs"
          variant={type === 'all' ? 'secondary' : 'outline'}
          aria-pressed={type === 'all'}
          onClick={() => onTypeChange('all')}
        >
          All types
        </Button>
        {availableTypes.map((gapType) => (
          <Button
            key={gapType}
            type="button"
            size="xs"
            variant={type === gapType ? 'secondary' : 'outline'}
            aria-pressed={type === gapType}
            onClick={() => onTypeChange(gapType)}
          >
            {gapTypeLabel(gapType)}
          </Button>
        ))}
      </div>
      <div
        role="group"
        aria-label="Filter potential gaps by evidence freshness"
        className="flex flex-wrap gap-2"
      >
        {(
          [
            ['all', 'All evidence'],
            ['current', 'Current'],
            ['stale', 'Includes stale evidence'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="xs"
            variant={status === value ? 'secondary' : 'outline'}
            aria-pressed={status === value}
            onClick={() => onStatusChange(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
