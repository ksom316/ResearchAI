const dateFormat = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

/** "p. 3" or "pp. 3–4"; null when the start page is unknown (never an invented page). */
export function formatPages(
  start: number | null,
  end: number | null,
): string | null {
  if (start === null) return null
  return end === null || end === start ? `p. ${start}` : `pp. ${start}–${end}`
}

/** "related_work" -> "related work". */
export const humanize = (value: string): string => value.replace(/_/g, ' ')

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
  )
}
