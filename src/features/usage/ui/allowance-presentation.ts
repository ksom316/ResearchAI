const number = new Intl.NumberFormat()
const compact = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function allowanceState(percent: number) {
  if (percent >= 100)
    return {
      barClass: 'bg-destructive',
      textClass: 'text-destructive',
      label: 'Monthly allowance reached',
    }
  if (percent >= 80)
    return {
      barClass: 'bg-amber-500',
      textClass: 'text-amber-700 dark:text-amber-300',
      label: 'Approaching monthly allowance',
    }
  return {
    barClass: 'bg-primary',
    textClass: 'text-muted-foreground',
    label: null,
  }
}

export function formatAllowanceValue(
  value: number,
  compactValue = false,
): string {
  return (compactValue ? compact : number).format(value)
}

export function formatAllowanceResetDate(resetDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(resetDate))
}

export function allowanceProgressLabel({
  label,
  used,
  limit,
  resetDate,
  compactValue = false,
}: {
  label: string
  used: number
  limit: number
  resetDate: string
  compactValue?: boolean
}): string {
  return `${label}: ${formatAllowanceValue(used, compactValue)} of ${formatAllowanceValue(limit, compactValue)} used. Resets ${formatAllowanceResetDate(resetDate)}.`
}
