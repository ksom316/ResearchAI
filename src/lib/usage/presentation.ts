export function allowanceReachedMessage(resetDate?: string): string {
  if (!resetDate) {
    return "You've reached your AI usage allowance for this month. Your allowance resets at the start of next month."
  }
  const date = new Date(resetDate)
  if (Number.isNaN(date.getTime())) return allowanceReachedMessage()
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  return `You've reached your AI usage allowance for this month. Your allowance resets on ${label}.`
}
