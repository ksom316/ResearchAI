/** Only allow same-origin relative paths to prevent open redirects. */
export function safeRedirect(target?: string | null): string {
  return target &&
    target.startsWith('/') &&
    !target.startsWith('//') &&
    !target.includes('\\')
    ? target
    : '/dashboard'
}
