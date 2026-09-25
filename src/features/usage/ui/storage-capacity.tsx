import { cn } from 'cn'

const number = new Intl.NumberFormat()

export type StorageCapacity = {
  storageBytes: number | null
  storageCapacityBytes: number | null
  storageRemainingBytes: number | null
  storagePercent: number | null
}

export function formatStorage(value: number | null): string {
  if (value === null) return '—'
  if (value < 1024) return `${number.format(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = -1
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`
}

export function storageState(percent: number | null) {
  if (percent !== null && percent >= 100) {
    return {
      label: 'Storage full',
      ringClass: 'text-destructive',
      messageClass: 'text-destructive',
    }
  }
  if (percent !== null && percent >= 80) {
    return {
      label: 'Storage is nearly full',
      ringClass: 'text-amber-600 dark:text-amber-400',
      messageClass: 'text-amber-700 dark:text-amber-300',
    }
  }
  return {
    label: null,
    ringClass: 'text-primary',
    messageClass: 'text-muted-foreground',
  }
}

export function storageProgressLabel(storage: StorageCapacity): string {
  return `${storage.storagePercent ?? 0}% of storage used. ${formatStorage(storage.storageBytes)} of ${formatStorage(storage.storageCapacityBytes)}.`
}

export function StorageProgressRing({
  storage,
  size = 'default',
}: {
  storage: StorageCapacity
  size?: 'compact' | 'default'
}) {
  const percent = Math.min(100, Math.max(0, storage.storagePercent ?? 0))
  const state = storageState(storage.storagePercent)
  const radius = 42
  const circumference = 2 * Math.PI * radius

  return (
    <div
      className={cn(
        'relative shrink-0',
        size === 'compact' ? 'size-20' : 'size-32 sm:size-36',
      )}
    >
      <svg
        className="size-full -rotate-90"
        viewBox="0 0 100 100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={storageProgressLabel(storage)}
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted/70"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          className={cn('transition-[stroke-dashoffset]', state.ringClass)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums sm:text-xl">
        {percent}%
      </span>
    </div>
  )
}
