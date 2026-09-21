import type { AuthUser } from '#/lib/auth/auth.functions'

export function landingDestinationForUser(user: AuthUser | null) {
  return user ? ('/dashboard' as const) : null
}
